"""Routes for the SOW Generator."""
import io
from flask import (
    Blueprint, render_template, request, jsonify,
    send_file, current_app
)
from app.markdown_parser import render_markdown
from app.pdf_engine import generate_pdf
from app.template_manager import TemplateManager

main_bp = Blueprint('main', __name__)
api_bp = Blueprint('api', __name__)


# ─── Page Routes ──────────────────────────────────────────────

@main_bp.route('/')
def index():
    """Landing page / editor."""
    return render_template('editor.html')


@main_bp.route('/templates')
def template_gallery():
    """Template gallery page."""
    tm = TemplateManager()
    templates = tm.list_templates()
    return render_template('gallery.html', templates=templates)


# ─── API Routes ───────────────────────────────────────────────

@api_bp.route('/preview', methods=['POST'])
def preview():
    """Render markdown to HTML for live preview."""
    data = request.get_json()
    markdown_text = data.get('markdown', '')
    variables = data.get('variables', {})
    template_name = data.get('template', 'modern')

    html = render_markdown(markdown_text, variables)
    return jsonify({'html': html, 'template': template_name})


@api_bp.route('/export', methods=['POST'])
def export_pdf():
    """Generate and download PDF from markdown."""
    data = request.get_json()
    markdown_text = data.get('markdown', '')
    variables = data.get('variables', {})
    template_name = data.get('template', 'modern')
    page_size = data.get('page_size', 'Letter')

    html_content = render_markdown(markdown_text, variables)
    pdf_bytes = generate_pdf(
        html_content,
        template_name=template_name,
        page_size=page_size
    )

    filename = variables.get('project_name', 'proposal').replace(' ', '_')
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'{filename}_SOW.pdf'
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
    data = request.get_json()
    tm = TemplateManager()
    template = tm.save_template(
        name=data['name'],
        description=data.get('description', ''),
        markdown=data['markdown'],
        variables=data.get('variables', {})
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
    data = request.get_json()
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
