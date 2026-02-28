"""Routes for the SOW Generator."""
import io
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
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

main_bp = Blueprint('main', __name__)
api_bp = Blueprint('api', __name__)
plugin_bp = Blueprint('plugin', __name__)

_RATE_WINDOW_SECONDS = 60
_RATE_LIMIT_PER_WINDOW = 20
_CAPTCHA_THRESHOLD_PER_WINDOW = 10
_rate_events = defaultdict(deque)
_ALLOWED_JURISDICTIONS = {'US_BASE', 'US_NY', 'US_CA'}


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
    row = db.execute(
        '''SELECT id, title, html, created_at, expires_at, deleted
           FROM published_docs
           WHERE id = ?''',
        (publish_id,),
    ).fetchone()

    if not row or row['deleted']:
        return render_template('published.html', title='Not Found', content='<p>Document not found.</p>'), 404

    expires_at = datetime.fromisoformat(row['expires_at'])
    if expires_at < _utc_now():
        return render_template('published.html', title='Expired', content='<p>This link has expired.</p>'), 410

    db.execute('UPDATE published_docs SET views = views + 1 WHERE id = ?', (publish_id,))
    db.commit()

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
                'template_id': t.get('id'),
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

    name = (data.get('name') or '').strip()
    markdown = data.get('markdown')
    variables = data.get('variables', {})

    if not name:
        return jsonify({'error': 'name is required'}), 400
    if not isinstance(markdown, str) or not markdown.strip():
        return jsonify({'error': 'markdown is required'}), 400
    if not isinstance(variables, dict):
        return jsonify({'error': 'variables must be an object'}), 400

    tm = TemplateManager()
    template = tm.save_template(
        name=name,
        description=data.get('description', ''),
        markdown=markdown,
        variables=variables,
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

    if 'name' in data and not isinstance(data.get('name'), str):
        return jsonify({'error': 'name must be a string'}), 400
    if 'name' in data and not data.get('name', '').strip():
        return jsonify({'error': 'name cannot be empty'}), 400
    if 'description' in data and not isinstance(data.get('description'), str):
        return jsonify({'error': 'description must be a string'}), 400
    if 'markdown' in data and not isinstance(data.get('markdown'), str):
        return jsonify({'error': 'markdown must be a string'}), 400
    if 'variables' in data and not isinstance(data.get('variables'), dict):
        return jsonify({'error': 'variables must be an object'}), 400

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

    if _is_rate_limited(client_ip):
        _log_event('warning', 'plugin.publish.rate_limited', client_ip=client_ip)
        return jsonify({'error': 'Too many requests'}), 429

    if _needs_captcha(client_ip):
        required_token = (os.environ.get('PUBLISH_CAPTCHA_TOKEN') or '').strip()
        supplied = (request.headers.get('X-Captcha-Token') or '').strip()
        if required_token and supplied != required_token:
            _log_event('warning', 'plugin.publish.captcha_failed', client_ip=client_ip)
            return jsonify({'error': 'Captcha verification required'}), 429

    data = request.get_json() or {}
    title = (data.get('title') or 'Statement of Work').strip()[:200]
    raw_html = (data.get('html') or '').strip()
    html = _sanitize_html(raw_html)
    expires_in_days = _parse_int(data.get('expires_in_days', 30), 30)
    revision = _parse_int(data.get('revision'), None)
    signed = _parse_bool(data.get('signed'), False)
    signed_only = _parse_bool(data.get('signed_only'), False)
    jurisdiction = (data.get('jurisdiction') or 'US_BASE').strip()[:32] or 'US_BASE'

    if not html:
        _log_event('info', 'plugin.publish.invalid_html', client_ip=client_ip)
        return jsonify({'error': 'html is required'}), 400
    if signed_only and not signed:
        _log_event('info', 'plugin.publish.invalid_signed', client_ip=client_ip)
        return jsonify({'error': 'signed_only publish requires signed=true'}), 400
    if revision is not None and revision < 1:
        _log_event('info', 'plugin.publish.invalid_revision', client_ip=client_ip, revision=revision)
        return jsonify({'error': 'revision must be >= 1 when provided'}), 400
    if jurisdiction not in _ALLOWED_JURISDICTIONS:
        _log_event('info', 'plugin.publish.invalid_jurisdiction', client_ip=client_ip, jurisdiction=jurisdiction)
        return jsonify({'error': 'invalid jurisdiction'}), 400

    expires_in_days = max(1, min(365, expires_in_days))
    doc_id = secrets.token_urlsafe(8)
    now = _utc_now()
    expires_at = now + timedelta(days=expires_in_days)

    db = get_db()
    db.execute(
        '''INSERT INTO published_docs (id, title, html, created_at, expires_at, revision, signed, jurisdiction)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
        (doc_id, title, html, now.isoformat(), expires_at.isoformat(), revision, 1 if signed else 0, jurisdiction),
    )
    db.commit()

    view_url = f"{request.host_url.rstrip('/')}/p/{doc_id}"
    _log_event(
        'info',
        'plugin.publish.created',
        client_ip=client_ip,
        publish_id=doc_id,
        revision=revision,
        signed=signed,
        jurisdiction=jurisdiction,
        expires_at=expires_at.isoformat(),
    )
    return jsonify(
        {
            'publish_id': doc_id,
            'view_url': view_url,
            'expires_at': expires_at.isoformat(),
            'revision': revision,
            'signed': signed,
            'jurisdiction': jurisdiction,
            'sanitized': True,
        }
    ), 201


@plugin_bp.route('/v1/p/<publish_id>', methods=['GET'])
def plugin_get_published(publish_id):
    """Get publish metadata."""
    publish_id = _normalize_doc_id(publish_id)
    db = get_db()
    row = db.execute(
        '''SELECT id, title, created_at, expires_at, deleted, views, revision, signed, jurisdiction
           FROM published_docs WHERE id = ?''',
        (publish_id,),
    ).fetchone()

    if not row:
        return jsonify({'error': 'Not found'}), 404

    return jsonify({'document': dict(row)})


@plugin_bp.route('/v1/p/<publish_id>', methods=['DELETE'])
def plugin_delete_published(publish_id):
    """Soft-delete a published document."""
    publish_id = _normalize_doc_id(publish_id)
    db = get_db()
    cursor = db.execute(
        'UPDATE published_docs SET deleted = 1 WHERE id = ? AND deleted = 0',
        (publish_id,),
    )
    db.commit()
    if cursor.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
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
    now = _utc_now().isoformat()
    scanned = db.execute(
        'SELECT COUNT(*) FROM published_docs WHERE deleted = 0'
    ).fetchone()[0]
    cursor = db.execute(
        '''UPDATE published_docs
           SET deleted = 1
           WHERE deleted = 0 AND expires_at < ?''',
        (now,),
    )
    db.commit()
    _log_event('info', 'plugin.cleanup.completed', cleaned=cursor.rowcount, scanned=scanned, timestamp=now)
    return jsonify(
        {
            'status': 'ok',
            'cleaned': cursor.rowcount,
            'scanned': scanned,
            'timestamp': now,
        }
    )
