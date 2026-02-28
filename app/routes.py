"""Routes for the SOW Generator."""
import io
import json
import os
import re
from datetime import datetime, timezone
from collections import defaultdict, deque

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


def _parse_publish_request(data: dict) -> dict:
    """Normalize publish payload for service input."""
    raw_html = (data.get('html') or '').strip()
    return {
        'title': (data.get('title') or 'Statement of Work').strip()[:200],
        'sanitized_html': _sanitize_html(raw_html),
        'expires_in_days': _parse_int(data.get('expires_in_days', 30), 30),
        'revision': _parse_int(data.get('revision'), None),
        'signed': _parse_bool(data.get('signed'), False),
        'signed_only': _parse_bool(data.get('signed_only'), False),
        'template': (data.get('template') or 'modern').strip(),
        'page_size': (data.get('page_size') or 'Letter').strip(),
        'jurisdiction': (data.get('jurisdiction') or 'US_BASE').strip()[:32] or 'US_BASE',
    }


def _parse_publish_email_request(data: dict) -> dict:
    """Normalize plugin email payload."""
    return {
        'to_email': (data.get('to_email') or '').strip(),
        'attach_pdf': _parse_bool(data.get('attach_pdf'), True),
        'subject': (data.get('subject') or '').strip(),
        'message': (data.get('message') or '').strip(),
    }


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

    curated = []
    for item in load_curated_templates():
        normalized = dict(item)
        normalized['templateId'] = normalized.get('templateId', 'modern')
        normalized['source'] = 'curated'
        curated.append(normalized)

    tm = TemplateManager()
    user_templates = []
    for t in tm.list_templates():
        user_templates.append(
            {
                'id': f"user_{t['id']}",
                'name': t.get('name', ''),
                'description': t.get('description', ''),
                'industry': 'Custom',
                'tags': ['saved', 'custom'],
                'markdown': t.get('markdown', ''),
                'variables': t.get('variables', {}),
                'source': 'user',
                'templateId': t.get('pdf_template', 'modern'),
            }
        )

    merged = curated + user_templates
    filtered = filter_library_items(merged, query=q, industry=industry)
    total = len(filtered)
    page = filtered[offset:offset + limit]
    industries = sorted(
        {str(item.get('industry', '')).strip() for item in merged if str(item.get('industry', '')).strip()}
    )

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


# Optional sharing plugin endpoints
@plugin_bp.route('/v1/publish', methods=['POST'])
def publish_document():
    """Publish a read-only document with expiry."""
    client_ip = _get_client_ip()
    limited = _enforce_rate_limit(client_ip, 'plugin.publish')
    if limited:
        return limited
    captcha_blocked = _enforce_publish_captcha(client_ip)
    if captcha_blocked:
        return captcha_blocked

    data = _read_json_object() or {}
    payload = _parse_publish_request(data)

    db = get_db()
    try:
        published = create_published_document(
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
    except ServiceError as exc:
        _log_event('info', 'plugin.publish.invalid', client_ip=client_ip, error=str(exc))
        return jsonify({'error': str(exc)}), exc.status_code

    view_url = f"{request.host_url.rstrip('/')}/p/{published['publish_id']}"
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
    return jsonify(
        {
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
    ), 201


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
    limited = _enforce_rate_limit(client_ip, 'plugin.email')
    if limited:
        return limited

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
