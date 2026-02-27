"""PDF generation engine using WeasyPrint."""
import os
from flask import current_app, render_template
from weasyprint import HTML, CSS


TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates', 'pdf')
CSS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static', 'css', 'pdf')

PAGE_SIZES = {
    'Letter': 'size: letter;',
    'A4': 'size: A4;',
    'Legal': 'size: legal;',
}


def generate_pdf(
    html_content: str,
    template_name: str = 'modern',
    page_size: str = 'Letter',
    logo_url: str = None,
    brand_color: str = '#2563eb'
) -> bytes:
    """Generate a PDF from rendered HTML content.

    Args:
        html_content: Pre-rendered HTML from markdown parser
        template_name: Name of PDF template (modern, classic, minimal)
        page_size: Page size (Letter, A4, Legal)
        logo_url: Optional URL/path to company logo
        brand_color: Primary brand color hex code

    Returns:
        PDF file as bytes
    """
    # Render the full PDF HTML using the selected template
    full_html = render_template(
        f'pdf/{template_name}.html',
        content=html_content,
        logo_url=logo_url,
        brand_color=brand_color
    )

    # Load template-specific CSS
    css_path = os.path.join(CSS_DIR, f'{template_name}.css')
    stylesheets = []

    if os.path.exists(css_path):
        stylesheets.append(CSS(filename=css_path))

    # Add page size override
    page_css = f'@page {{ {PAGE_SIZES.get(page_size, PAGE_SIZES["Letter"])} margin: 2cm; }}'
    stylesheets.append(CSS(string=page_css))

    # Generate PDF
    html_doc = HTML(
        string=full_html,
        base_url=current_app.static_folder
    )

    return html_doc.write_pdf(stylesheets=stylesheets)
