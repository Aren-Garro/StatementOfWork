"""Routes for the SOW Generator."""
import io
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque

from flask import (
    Blueprint,
    jsonify,
    render_template,
    request,
    send_file,
)

from app.markdown_parser import render_markdown
from app.models import get_db
from app.pdf_engine import generate_pdf
from app.template_manager import TemplateManager

main_bp = Blueprint('main', __name__)
api_bp = Blueprint('api', __name__)
plugin_bp = Blueprint('plugin', __name__)

_RATE_WINDOW_SECONDS = 60
_RATE_LIMIT_PER_WINDOW = 20
_CAPTCHA_THRESHOLD_PER_WINDOW = 10
_rate_events = defaultdict(deque)


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
    """Apply minimal sanitization for published content."""
    no_script = re.sub(r'<\s*script[^>]*>.*?<\s*/\s*script\s*>', '', content, flags=re.IGNORECASE | re.DOTALL)
    no_events = re.sub(r'\son\w+\s*=\s*"[^"]*"', '', no_script, flags=re.IGNORECASE)
    no_js_urls = re.sub(r'javascript:', '', no_events, flags=re.IGNORECASE)
    return no_js_urls


def _parse_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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
    data = request.get_json() or {}
    markdown_text = data.get('markdown', '')
    variables = data.get('variables', {})
    template_name = data.get('template', 'modern')

    html = render_markdown(markdown_text, variables)
    return jsonify({'html': html, 'template': template_name})


@api_bp.route('/export', methods=['POST'])
def export_pdf():
    """Generate and download PDF from markdown."""
    data = request.get_json() or {}
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


@api_bp.route('/templates', methods=['POST'])
def save_template():
    """Save a new template."""
    data = request.get_json() or {}
    tm = TemplateManager()
    template = tm.save_template(
        name=data['name'],
        description=data.get('description', ''),
        markdown=data['markdown'],
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
    data = request.get_json() or {}
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
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr or 'unknown').split(',')[0].strip()

    if _is_rate_limited(client_ip):
        return jsonify({'error': 'Too many requests'}), 429

    if _needs_captcha(client_ip):
        required_token = (os.environ.get('PUBLISH_CAPTCHA_TOKEN') or '').strip()
        supplied = (request.headers.get('X-Captcha-Token') or '').strip()
        if required_token and supplied != required_token:
            return jsonify({'error': 'Captcha verification required'}), 429

    data = request.get_json() or {}
    title = (data.get('title') or 'Statement of Work').strip()[:200]
    html = _sanitize_html((data.get('html') or '').strip())
    expires_in_days = _parse_int(data.get('expires_in_days', 30), 30)
    revision = _parse_int(data.get('revision'), None)
    signed = bool(data.get('signed'))
    signed_only = bool(data.get('signed_only'))
    jurisdiction = (data.get('jurisdiction') or 'US_BASE').strip()[:32] or 'US_BASE'

    if not html:
        return jsonify({'error': 'html is required'}), 400
    if signed_only and not signed:
        return jsonify({'error': 'signed_only publish requires signed=true'}), 400

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
    return jsonify(
        {
            'publish_id': doc_id,
            'view_url': view_url,
            'expires_at': expires_at.isoformat(),
            'revision': revision,
            'signed': signed,
            'jurisdiction': jurisdiction,
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
    cursor = db.execute(
        '''UPDATE published_docs
           SET deleted = 1
           WHERE deleted = 0 AND expires_at < ?''',
        (now,),
    )
    db.commit()
    return jsonify({'status': 'ok', 'cleaned': cursor.rowcount})
