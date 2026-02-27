"""Custom markdown parser with SOW-specific extensions.

Supports custom fenced directives:
  :::pricing  - Styled pricing tables
  :::timeline - Project timeline blocks
  :::signature - Signature blocks with lines
  :::variables - Variable definitions (YAML-like)

Supports variable substitution:
  {{variable_name}} -> replaced with value from variables dict
"""
import re
from markdown_it import MarkdownIt


def _substitute_variables(text: str, variables: dict) -> str:
    """Replace {{variable_name}} placeholders with values."""
    def replacer(match):
        key = match.group(1).strip()
        return variables.get(key, match.group(0))
    return re.sub(r'\{\{\s*([\w_]+)\s*\}\}', replacer, text)


def _extract_variables_block(text: str) -> tuple[str, dict]:
    """Extract :::variables block and parse key-value pairs."""
    extracted_vars = {}

    def parse_block(match):
        content = match.group(1)
        for line in content.strip().split('\n'):
            line = line.strip()
            if ':' in line:
                key, value = line.split(':', 1)
                extracted_vars[key.strip()] = value.strip()
        return ''  # Remove the block from output
    text = re.sub(
        r':::variables\s*\n(.*?)\n:::', parse_block, text, flags=re.DOTALL
    )
    return text, extracted_vars


def _render_pricing_block(content: str) -> str:
    """Render a pricing table with auto-calculated totals."""
    return f'<div class="sow-pricing">\n{content}\n</div>'


def _render_timeline_block(content: str) -> str:
    """Render a timeline/milestones block."""
    return f'<div class="sow-timeline">\n<h3>Project Timeline</h3>\n{content}\n</div>'


def _render_signature_block(content: str) -> str:
    """Render a signature block with signature lines."""
    lines = content.strip().split('\n')
    sig_html = '<div class="sow-signatures">\n'
    current_block = []

    for line in lines:
        line = line.strip()
        if line == '---':
            if current_block:
                sig_html += _build_sig_block(current_block)
                current_block = []
        elif line:
            current_block.append(line)

    if current_block:
        sig_html += _build_sig_block(current_block)

    sig_html += '</div>'
    return sig_html


def _build_sig_block(lines: list) -> str:
    """Build a single signature block HTML."""
    html = '<div class="sig-block">\n'
    for line in lines:
        if ':' in line:
            label, value = line.split(':', 1)
            html += '  <div class="sig-field">'
            html += f'<span class="sig-label">{label.strip()}:</span> '
            html += f'<span class="sig-value">{value.strip()}</span>'
            html += '<div class="sig-line"></div>'
            html += '</div>\n'
        else:
            html += f'  <p>{line}</p>\n'
    html += '</div>\n'
    return html


def _create_container_renderer(block_type: str):
    """Create a render function for custom container blocks."""
    def render(self, tokens, idx, options, env):
        if tokens[idx].nesting == 1:
            return f'<!-- {block_type}_start -->'
        else:
            return f'<!-- {block_type}_end -->'

    return render


def render_markdown(text: str, variables: dict = None) -> str:
    """Parse and render markdown with SOW extensions.

    Args:
        text: Raw markdown string with optional SOW directives
        variables: Dict of variable substitutions

    Returns:
        Rendered HTML string
    """
    if variables is None:
        variables = {}

    # Extract inline variable definitions
    text, inline_vars = _extract_variables_block(text)

    # Merge: explicit variables override inline ones
    merged_vars = {**inline_vars, **variables}

    # Substitute variables
    text = _substitute_variables(text, merged_vars)

    # Process custom blocks before markdown parsing
    text = _process_custom_blocks(text)

    # Parse markdown
    md = MarkdownIt('commonmark', {'html': True})
    md.enable('table')

    html = md.render(text)
    return html


def _process_custom_blocks(text: str) -> str:
    """Pre-process custom :::block directives into HTML."""
    block_types = {
        'pricing': _render_pricing_block,
        'timeline': _render_timeline_block,
        'signature': _render_signature_block,
    }

    for block_type, renderer in block_types.items():
        pattern = rf':::{block_type}\s*\n(.*?)\n:::'
        matches = re.finditer(pattern, text, flags=re.DOTALL)
        for match in matches:
            content = match.group(1)
            # Parse the inner content as markdown first
            inner_md = MarkdownIt('commonmark', {'html': True})
            inner_md.enable('table')
            inner_html = inner_md.render(content)
            rendered = renderer(inner_html)
            text = text.replace(match.group(0), rendered)

    return text
