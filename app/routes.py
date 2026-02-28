"""Routes for the SOW Generator."""
import io
import json
import os
import re
import smtplib
import socket
from datetime import datetime, timezone
from collections import defaultdict, deque
from urllib import request as urllib_request
from urllib.error import URLError, HTTPError

from flask import (
    Blueprint,
    current_app,
    jsonify,
    render_template,
    request,
    send_file,
)

from app.markdown_parser import render_markdown
from app.models import get_db
from app.template_manager import TemplateManager
from app.template_library import filter_library_items, load_curated_templates
from app.services.publish_service import (
    ServiceError,
    cleanup_expired_published_documents,
    create_published_document,
    delete_published_document,
    get_public_published_document,
    get_published_for_email,
    get_published_metadata,
)
from app.services.email_delivery_service import send_published_email

main_bp = Blueprint('main', __name__)
api_bp = Blueprint('api', __name__)
plugin_bp = Blueprint('plugin', __name__)

_RATE_WINDOW_SECONDS = 60
_RATE_LIMIT_PER_WINDOW = 20
_CAPTCHA_THRESHOLD_PER_WINDOW = 10
_rate_events = defaultdict(deque)
_ALLOWED_TEMPLATES = {'modern', 'classic', 'minimal'}
_ALLOWED_PAGE_SIZES = {'Letter', 'A4', 'Legal'}
_ALLOWED_JURISDICTIONS = {
    'US_BASE',
    'US_NY',
    'US_CA',
    'EU_BASE',
    'UK_BASE',
    'CA_BASE',
    'AU_BASE',
}
_RUNTIME_SETUP = {
    'sharing_plugin_url': '',
    'smtp': {},
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_doc_id(raw: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_-]', '', raw or '')


def _is_rate_limited(client_ip: str) -> bool:
    now = _utc_now().timestamp()
    events = _rate_events[client_ip]
    while events and now - events[0] > _RATE_WINDOW_SECONDS:
        events.popleft()

    events.append(now)
    return len(events) > _RATE_LIMIT_PER_WINDOW


def _needs_captcha(client_ip: str) -> bool:
    now = _utc_now().timestamp()
    events = _rate_events[client_ip]
    while events and now - events[0] > _RATE_WINDOW_SECONDS:
        events.popleft()
    return len(events) > _CAPTCHA_THRESHOLD_PER_WINDOW


def _sanitize_html(content: str) -> str:
    """Apply defensive sanitization for published content."""
    sanitized = content
    # Strip high-risk tags and their contents.
    for tag in ('script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'):
        sanitized = re.sub(
            rf'<\s*{tag}[^>]*>.*?<\s*/\s*{tag}\s*>',
            '',
            sanitized,
            flags=re.IGNORECASE | re.DOTALL,
        )
    # Strip self-closing high-risk tags.
    sanitized = re.sub(
        r'<\s*(meta|base|link)\b[^>]*>',
        '',
        sanitized,
        flags=re.IGNORECASE,
    )
    # Strip inline event handlers: on*="...", on*='...', on*=unquoted
    sanitized = re.sub(
        r'\son\w+\s*=\s*(".*?"|\'.*?\'|[^\s>]+)',
        '',
        sanitized,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Strip javascript: pseudo-protocols and srcdoc attributes.
    sanitized = re.sub(r'javascript\s*:', '', sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(
        r'\ssrcdoc\s*=\s*(".*?"|\'.*?\'|[^\s>]+)',
        '',
        sanitized,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return sanitized


def _parse_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_bool(value, default=False):
    """Parse booleans from JSON values, including common string forms."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if text in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return default


def _get_client_ip() -> str:
    """Return client IP after optional trusted-proxy normalization."""
    return (request.remote_addr or 'unknown').strip()


def _read_json_object():
    data = request.get_json(silent=True)
    if isinstance(data, dict):
        return data
    return None


def _log_event(level: str, event: str, **fields):
    logger = current_app.logger
    payload = {'event': event, **fields}
    message = json.dumps(payload, sort_keys=True, default=str)
    getattr(logger, level, logger.info)(message)


def _enforce_rate_limit(client_ip: str, event_prefix: str):
    """Return a 429 response tuple when requests exceed limits."""
    if not _is_rate_limited(client_ip):
        return None
    _log_event('warning', f'{event_prefix}.rate_limited', client_ip=client_ip)
    return jsonify({'error': 'Too many requests'}), 429


def _enforce_publish_captcha(client_ip: str):
    """Return a 429 response tuple when CAPTCHA verification fails."""
    if not _needs_captcha(client_ip):
        return None

    required_token = (os.environ.get('PUBLISH_CAPTCHA_TOKEN') or '').strip()
    supplied = (request.headers.get('X-Captcha-Token') or '').strip()
    if required_token and supplied != required_token:
        _log_event('warning', 'plugin.publish.captcha_failed', client_ip=client_ip)
        return jsonify({'error': 'Captcha verification required'}), 429
    return None


def _plugin_guard(client_ip: str, event_prefix: str, *, require_captcha: bool = False):
    limited = _enforce_rate_limit(client_ip, event_prefix)
    if limited:
        return limited
    if require_captcha:
        return _enforce_publish_captcha(client_ip)
    return None


def _normalized_text(value, default: str = '', max_len: int | None = None) -> str:
    text = (value or default).strip()
    if max_len is not None:
        return text[:max_len]
    return text


def _parse_publish_request(data: dict) -> dict:
    """Normalize publish payload for service input."""
    raw_html = _normalized_text(data.get('html'))
    return {
        'title': _normalized_text(data.get('title'), 'Statement of Work', 200),
        'sanitized_html': _sanitize_html(raw_html),
        'expires_in_days': _parse_int(data.get('expires_in_days', 30), 30),
        'revision': _parse_int(data.get('revision'), None),
        'signed': _parse_bool(data.get('signed'), False),
        'signed_only': _parse_bool(data.get('signed_only'), False),
        'template': _normalized_text(data.get('template'), 'modern'),
        'page_size': _normalized_text(data.get('page_size'), 'Letter'),
        'jurisdiction': _normalized_text(data.get('jurisdiction'), 'US_BASE', 32) or 'US_BASE',
    }


def _parse_publish_email_request(data: dict) -> dict:
    """Normalize plugin email payload."""
    return {
        'to_email': _normalized_text(data.get('to_email')),
        'attach_pdf': _parse_bool(data.get('attach_pdf'), True),
        'subject': _normalized_text(data.get('subject')),
        'message': _normalized_text(data.get('message')),
    }


def _normalized_curated_templates(items: list[dict]) -> list[dict]:
    normalized = []
    for item in items:
        record = dict(item)
        record['templateId'] = record.get('templateId', 'modern')
        record['source'] = 'curated'
        normalized.append(record)
    return normalized


def _normalized_user_templates(items: list[dict]) -> list[dict]:
    normalized = []
    for template in items:
        normalized.append(
            {
                'id': f"user_{template['id']}",
                'name': template.get('name', ''),
                'description': template.get('description', ''),
                'industry': 'Custom',
                'tags': ['saved', 'custom'],
                'markdown': template.get('markdown', ''),
                'variables': template.get('variables', {}),
                'source': 'user',
                'templateId': template.get('pdf_template', 'modern'),
            }
        )
    return normalized


def _template_industries(items: list[dict]) -> list[str]:
    return sorted(
        {str(item.get('industry', '')).strip() for item in items if str(item.get('industry', '')).strip()}
    )


def _publish_response_payload(published: dict, *, host_url: str) -> dict:
    view_url = f"{host_url.rstrip('/')}/p/{published['publish_id']}"
    return {
        'publish_id': published['publish_id'],
        'view_url': view_url,
        'expires_at': published['expires_at'],
        'revision': published['revision'],
        'signed': published['signed'],
        'jurisdiction': published['jurisdiction'],
        'template': published['template'],
        'page_size': published['page_size'],
        'sanitized': True,
    }


def _create_published_or_error(payload: dict):
    db = get_db()
    return create_published_document(
        db=db,
        title=payload['title'],
        sanitized_html=payload['sanitized_html'],
        expires_in_days=payload['expires_in_days'],
        revision=payload['revision'],
        signed=payload['signed'],
        signed_only=payload['signed_only'],
        jurisdiction=payload['jurisdiction'],
        template=payload['template'],
        page_size=payload['page_size'],
        allowed_jurisdictions=_ALLOWED_JURISDICTIONS,
        allowed_templates=_ALLOWED_TEMPLATES,
        allowed_page_sizes=_ALLOWED_PAGE_SIZES,
    )


def _module_available(module_name: str) -> bool:
    try:
        __import__(module_name)
        return True
    except ModuleNotFoundError:
        return False


def _default_plugin_url() -> str:
    return f"{request.host_url.rstrip('/')}/plugin"


def _normalize_setup_smtp(raw: dict | None) -> dict:
    smtp = raw if isinstance(raw, dict) else {}
    return {
        'host': _normalized_text(smtp.get('host')),
        'port': _parse_int(smtp.get('port', 587), 587),
        'username': _normalized_text(smtp.get('username')),
        'password': _normalized_text(smtp.get('password')),
        'from_email': _normalized_text(smtp.get('from_email')),
        'from_name': _normalized_text(smtp.get('from_name'), 'SOW Creator'),
        'use_starttls': _parse_bool(smtp.get('use_starttls'), True),
        'use_ssl': _parse_bool(smtp.get('use_ssl'), False),
        'timeout_seconds': _parse_int(smtp.get('timeout_seconds', 10), 10),
    }


def _validate_setup_smtp(smtp: dict) -> list[str]:
    issues = []
    if not smtp['host']:
        issues.append('SMTP host is required')
    if not smtp['from_email']:
        issues.append('SMTP from_email is required')
    if smtp['use_ssl'] and smtp['use_starttls']:
        issues.append('SMTP cannot enable both SSL and STARTTLS')
    if smtp['port'] <= 0:
        issues.append('SMTP port must be a positive integer')
    if smtp['timeout_seconds'] <= 0:
        issues.append('SMTP timeout_seconds must be a positive integer')
    return issues


def _check_smtp_connection(smtp: dict) -> tuple[bool, str]:
    try:
        if smtp['use_ssl']:
            server = smtplib.SMTP_SSL(
                smtp['host'],
                smtp['port'],
                timeout=smtp['timeout_seconds'],
            )
        else:
            server = smtplib.SMTP(
                smtp['host'],
                smtp['port'],
                timeout=smtp['timeout_seconds'],
            )
        with server:
            if smtp['use_starttls'] and not smtp['use_ssl']:
                server.starttls()
            if smtp['username']:
                server.login(smtp['username'], smtp['password'])
        return True, 'SMTP connection OK'
    except (smtplib.SMTPException, OSError, socket.error) as exc:
        return False, str(exc)


def _check_plugin_health(plugin_url: str) -> tuple[bool, str]:
    target = f"{plugin_url.rstrip('/')}/v1/health/check"
    req = urllib_request.Request(
        target,
        data=b'{}',
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib_request.urlopen(req, timeout=5) as resp:
            if 200 <= resp.status < 300:
                return True, 'Plugin health check OK'
            return False, f'Plugin returned status {resp.status}'
    except HTTPError as exc:
        return False, f'Plugin returned status {exc.code}'
    except URLError as exc:
        return False, str(exc.reason)
    except Exception as exc:  # pragma: no cover - defensive
        return False, str(exc)


def _apply_runtime_setup(plugin_url: str, smtp: dict) -> None:
    _RUNTIME_SETUP['sharing_plugin_url'] = plugin_url
    _RUNTIME_SETUP['smtp'] = dict(smtp)

    os.environ['SMTP_HOST'] = smtp['host']
    os.environ['SMTP_PORT'] = str(smtp['port'])
    os.environ['SMTP_USERNAME'] = smtp['username']
    os.environ['SMTP_PASSWORD'] = smtp['password']
    os.environ['SMTP_FROM_EMAIL'] = smtp['from_email']
    os.environ['SMTP_FROM_NAME'] = smtp['from_name']
    os.environ['SMTP_USE_STARTTLS'] = 'true' if smtp['use_starttls'] else 'false'
    os.environ['SMTP_USE_SSL'] = 'true' if smtp['use_ssl'] else 'false'
    os.environ['SMTP_TIMEOUT_SECONDS'] = str(smtp['timeout_seconds'])


def _validate_template_create_payload(data: dict) -> str | None:
    """Return validation error text for template create payloads."""
    name = data.get('name')
    markdown = data.get('markdown')
    variables = data.get('variables', {})
    if not isinstance(name, str) or not name.strip():
        return 'name is required'
    if not isinstance(markdown, str) or not markdown.strip():
        return 'markdown is required'
    if not isinstance(variables, dict):
        return 'variables must be an object'
    return None


def _validate_template_update_payload(data: dict) -> str | None:
    """Return validation error text for template update payloads."""
    checks = (
        ('name', str, 'name must be a string'),
        ('description', str, 'description must be a string'),
        ('markdown', str, 'markdown must be a string'),
        ('variables', dict, 'variables must be an object'),
    )
    for field, expected_type, message in checks:
        if field in data and not isinstance(data.get(field), expected_type):
            return message
    if 'name' in data and not data.get('name', '').strip():
        return 'name cannot be empty'
    return None


# Page Routes
@main_bp.route('/')
def index():
    """Landing page / editor."""
    return render_template('editor.html')


@main_bp.route('/templates')
def template_gallery():
    """Backward-compatible route, currently points to editor."""
    return render_template('editor.html')


@main_bp.route('/p/<publish_id>')
def published_doc(publish_id):
    """Read-only public document page."""
    publish_id = _normalize_doc_id(publish_id)
    db = get_db()
    try:
        row = get_public_published_document(db=db, publish_id=publish_id)
    except ServiceError as exc:
        if exc.status_code == 404:
            return render_template('published.html', title='Not Found', content='<p>Document not found.</p>'), 404
        if exc.status_code == 410:
            return render_template('published.html', title='Expired', content='<p>This link has expired.</p>'), 410
        return render_template('published.html', title='Not Found', content='<p>Document not found.</p>'), 404

    return render_template('published.html', title=row['title'], content=row['html'])


# API Routes (legacy-compatible)
@api_bp.route('/preview', methods=['POST'])
def preview():
    """Render markdown to HTML for live preview."""
    data = _read_json_object() or {}
    markdown_text = data.get('markdown', '')
    variables = data.get('variables', {})
    template_name = data.get('template', 'modern')

    html = render_markdown(markdown_text, variables)
    return jsonify({'html': html, 'template': template_name})


@api_bp.route('/export', methods=['POST'])
def export_pdf():
    """Generate and download PDF from markdown."""
    try:
        from app.pdf_engine import generate_pdf
    except ModuleNotFoundError:
        return jsonify({'error': 'PDF export dependency not installed'}), 503

    data = _read_json_object() or {}
    markdown_text = data.get('markdown', '')
    variables = data.get('variables', {})
    template_name = data.get('template', 'modern')
    page_size = data.get('page_size', 'Letter')

    html_content = render_markdown(markdown_text, variables)
    pdf_bytes = generate_pdf(
        html_content,
        template_name=template_name,
        page_size=page_size,
    )

    filename = variables.get('project_name', 'proposal').replace(' ', '_')
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'{filename}_SOW.pdf',
    )


@api_bp.route('/templates', methods=['GET'])
def list_templates():
    """List all saved templates."""
    tm = TemplateManager()
    templates = tm.list_templates()
    return jsonify({'templates': templates})


@api_bp.route('/templates/library', methods=['GET'])
def template_library():
    """Return curated and user templates with optional filtering."""
    q = (request.args.get('q') or '').strip()
    industry = (request.args.get('industry') or '').strip()
    limit = max(1, min(100, _parse_int(request.args.get('limit'), 25)))
    offset = max(0, _parse_int(request.args.get('offset'), 0))

    curated = _normalized_curated_templates(load_curated_templates())

    tm = TemplateManager()
    user_templates = _normalized_user_templates(tm.list_templates())

    merged = curated + user_templates
    filtered = filter_library_items(merged, query=q, industry=industry)
    total = len(filtered)
    page = filtered[offset:offset + limit]
    industries = _template_industries(merged)

    return jsonify(
        {
            'templates': page,
            'total': total,
            'limit': limit,
            'offset': offset,
            'industries': industries,
        }
    )


@api_bp.route('/templates', methods=['POST'])
def save_template():
    """Save a new template."""
    data = _read_json_object()
    if data is None:
        return jsonify({'error': 'JSON object body is required'}), 400

    error = _validate_template_create_payload(data)
    if error:
        return jsonify({'error': error}), 400

    tm = TemplateManager()
    template = tm.save_template(
        name=data.get('name', '').strip(),
        description=data.get('description', ''),
        markdown=data.get('markdown'),
        variables=data.get('variables', {}),
    )
    return jsonify({'template': template}), 201


@api_bp.route('/templates/<int:template_id>', methods=['GET'])
def get_template(template_id):
    """Load a specific template."""
    tm = TemplateManager()
    template = tm.get_template(template_id)
    if not template:
        return jsonify({'error': 'Template not found'}), 404
    return jsonify({'template': template})


@api_bp.route('/templates/<int:template_id>', methods=['PUT'])
def update_template(template_id):
    """Update an existing template."""
    data = _read_json_object()
    if data is None:
        return jsonify({'error': 'JSON object body is required'}), 400

    error = _validate_template_update_payload(data)
    if error:
        return jsonify({'error': error}), 400

    tm = TemplateManager()
    template = tm.update_template(template_id, data)
    if not template:
        return jsonify({'error': 'Template not found'}), 404
    return jsonify({'template': template})


@api_bp.route('/templates/<int:template_id>', methods=['DELETE'])
def delete_template(template_id):
    """Delete a template."""
    tm = TemplateManager()
    success = tm.delete_template(template_id)
    if not success:
        return jsonify({'error': 'Template not found'}), 404
    return jsonify({'message': 'Deleted'})


@api_bp.route('/setup/status', methods=['GET'])
def setup_status():
    """Return current startup/setup status for first-run onboarding."""
    default_plugin_url = _default_plugin_url()
    configured_plugin_url = (
        _RUNTIME_SETUP.get('sharing_plugin_url')
        or (os.environ.get('SHARING_PLUGIN_URL') or '').strip()
    )
    smtp_from_env = {
        'host': (os.environ.get('SMTP_HOST') or '').strip(),
        'from_email': (os.environ.get('SMTP_FROM_EMAIL') or '').strip(),
    }
    smtp_configured = bool(smtp_from_env['host'] and smtp_from_env['from_email'])
    deps = {
        'weasyprint': _module_available('weasyprint'),
        'gunicorn': _module_available('gunicorn'),
    }
    return jsonify(
        {
            'setup_completed': bool(configured_plugin_url and smtp_configured),
            'sharing': {
                'default_plugin_url': default_plugin_url,
                'configured_plugin_url': configured_plugin_url,
                'configured': bool(configured_plugin_url),
            },
            'smtp': {
                'configured': smtp_configured,
                'host': smtp_from_env['host'],
                'from_email': smtp_from_env['from_email'],
            },
            'dependencies': deps,
        }
    )


@api_bp.route('/setup/check', methods=['POST'])
def setup_check():
    """Validate plugin and SMTP setup details without persisting."""
    data = _read_json_object()
    if data is None:
        return jsonify({'error': 'JSON object body is required'}), 400

    plugin_url = _normalized_text(data.get('sharing_plugin_url'), _default_plugin_url())
    smtp = _normalize_setup_smtp(data.get('smtp'))
    check_smtp_connection = _parse_bool(data.get('check_smtp_connection'), False)
    check_plugin_health = _parse_bool(data.get('check_plugin_health'), True)

    smtp_issues = _validate_setup_smtp(smtp)
    smtp_ok = len(smtp_issues) == 0
    smtp_connection = {'ok': None, 'message': 'Skipped'}
    if smtp_ok and check_smtp_connection:
        ok, message = _check_smtp_connection(smtp)
        smtp_connection = {'ok': ok, 'message': message}

    plugin_health = {'ok': None, 'message': 'Skipped'}
    if plugin_url and check_plugin_health:
        ok, message = _check_plugin_health(plugin_url)
        plugin_health = {'ok': ok, 'message': message}

    return jsonify(
        {
            'sharing_plugin_url': plugin_url,
            'smtp': {
                'issues': smtp_issues,
                'valid': smtp_ok,
                'connection': smtp_connection,
            },
            'plugin': {
                'health': plugin_health,
            },
            'ready_to_save': smtp_ok and (plugin_health['ok'] is not False),
        }
    )


@api_bp.route('/setup/save', methods=['POST'])
def setup_save():
    """Persist setup configuration for current app runtime."""
    data = _read_json_object()
    if data is None:
        return jsonify({'error': 'JSON object body is required'}), 400

    plugin_url = _normalized_text(data.get('sharing_plugin_url'), _default_plugin_url())
    smtp = _normalize_setup_smtp(data.get('smtp'))
    smtp_issues = _validate_setup_smtp(smtp)
    if smtp_issues:
        return jsonify({'error': '; '.join(smtp_issues)}), 400

    _apply_runtime_setup(plugin_url, smtp)
    return jsonify(
        {
            'status': 'ok',
            'sharing_plugin_url': plugin_url,
            'smtp_configured': True,
            'setup_completed': True,
        }
    )


# Optional sharing plugin endpoints
@plugin_bp.route('/v1/publish', methods=['POST'])
def publish_document():
    """Publish a read-only document with expiry."""
    client_ip = _get_client_ip()
    blocked = _plugin_guard(client_ip, 'plugin.publish', require_captcha=True)
    if blocked:
        return blocked

    data = _read_json_object() or {}
    payload = _parse_publish_request(data)

    try:
        published = _create_published_or_error(payload)
    except ServiceError as exc:
        _log_event('info', 'plugin.publish.invalid', client_ip=client_ip, error=str(exc))
        return jsonify({'error': str(exc)}), exc.status_code

    response = _publish_response_payload(published, host_url=request.host_url)
    _log_event(
        'info',
        'plugin.publish.created',
        client_ip=client_ip,
        publish_id=published['publish_id'],
        revision=published['revision'],
        signed=published['signed'],
        jurisdiction=published['jurisdiction'],
        template=published['template'],
        page_size=published['page_size'],
        expires_at=published['expires_at'],
    )
    return jsonify(response), 201


@plugin_bp.route('/v1/p/<publish_id>', methods=['GET'])
def plugin_get_published(publish_id):
    """Get publish metadata."""
    publish_id = _normalize_doc_id(publish_id)
    db = get_db()
    try:
        row = get_published_metadata(db=db, publish_id=publish_id)
    except ServiceError as exc:
        return jsonify({'error': str(exc)}), exc.status_code
    return jsonify({'document': row})


@plugin_bp.route('/v1/p/<publish_id>/email', methods=['POST'])
def plugin_email_published(publish_id):
    """Send published SOW by email via SMTP."""
    client_ip = _get_client_ip()
    blocked = _plugin_guard(client_ip, 'plugin.email')
    if blocked:
        return blocked

    publish_id = _normalize_doc_id(publish_id)
    data = _read_json_object()
    if data is None:
        return jsonify({'error': 'JSON object body is required'}), 400
    payload = _parse_publish_email_request(data)

    db = get_db()
    try:
        row = get_published_for_email(db=db, publish_id=publish_id)
        result = send_published_email(
            row=row,
            to_email=payload['to_email'],
            subject=payload['subject'],
            message=payload['message'],
            attach_pdf=payload['attach_pdf'],
            host_url=request.host_url,
        )
    except ServiceError as exc:
        _log_event('error', 'plugin.email.failed', client_ip=client_ip, publish_id=publish_id, error=str(exc))
        return jsonify({'error': str(exc)}), exc.status_code

    _log_event(
        'info',
        'plugin.email.sent',
        client_ip=client_ip,
        publish_id=publish_id,
        to_email=result['to_email'],
        attach_pdf=result['attached_pdf'],
        sent_at=result['sent_at'],
    )
    return jsonify(result)


@plugin_bp.route('/v1/p/<publish_id>', methods=['DELETE'])
def plugin_delete_published(publish_id):
    """Soft-delete a published document."""
    publish_id = _normalize_doc_id(publish_id)
    db = get_db()
    try:
        delete_published_document(db=db, publish_id=publish_id)
    except ServiceError as exc:
        return jsonify({'error': str(exc)}), exc.status_code
    return jsonify({'message': 'Deleted'})


@plugin_bp.route('/v1/health', methods=['GET'])
def plugin_health():
    return jsonify({'status': 'ok'})


@plugin_bp.route('/v1/health/check', methods=['POST'])
def plugin_health_check():
    """Connectivity diagnostic endpoint for UI plugin settings checks."""
    return jsonify({'status': 'ok', 'time': _utc_now().isoformat()})


@plugin_bp.route('/v1/cleanup', methods=['POST'])
def plugin_cleanup():
    """Soft-delete all expired published docs."""
    db = get_db()
    result = cleanup_expired_published_documents(db=db)
    _log_event('info', 'plugin.cleanup.completed', **result)
    return jsonify(
        {
            'status': 'ok',
            'cleaned': result['cleaned'],
            'scanned': result['scanned'],
            'timestamp': result['timestamp'],
        }
    )
