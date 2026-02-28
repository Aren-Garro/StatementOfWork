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


def _render_inner_markdown(text: str) -> str:
    """Render markdown fragments used inside custom blocks."""
    inner_md = MarkdownIt('commonmark', {'html': True})
    inner_md.enable('table')
    return inner_md.render(text)


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


def _parse_money(value: str) -> float | None:
    cleaned = re.sub(r'[^0-9.\-]', '', str(value or ''))
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def _format_money(amount: float) -> str:
    return f'${amount:.2f}'


def _build_pricing_summary(content: str) -> str:
    lines = content.replace('\r\n', '\n').split('\n')
    subtotal = 0.0
    discount_pct = 0.0
    tax_pct = 0.0

    for raw_line in lines:
        line = raw_line.strip()
        if re.match(r'^discount\s*:', line, flags=re.IGNORECASE):
            match = re.search(r'(-?\d+(\.\d+)?)\s*%?', line)
            if match:
                discount_pct = float(match.group(1))
            continue
        if re.match(r'^tax\s*:', line, flags=re.IGNORECASE):
            match = re.search(r'(-?\d+(\.\d+)?)\s*%?', line)
            if match:
                tax_pct = float(match.group(1))
            continue
        if '|' not in line or re.match(r'^\s*\|?[-:|\s]+\|?\s*$', line):
            continue

        cells = [cell.strip() for cell in line.split('|') if cell.strip()]
        if len(cells) < 2:
            continue
        if 'total' in cells[0].lower():
            continue
        maybe_amount = _parse_money(cells[-1])
        if maybe_amount is None:
            continue
        subtotal += maybe_amount

    discount_amount = subtotal * (discount_pct / 100.0)
    discounted = subtotal - discount_amount
    tax_amount = discounted * (tax_pct / 100.0)
    grand_total = discounted + tax_amount

    html = (
        '<div class="pricing-summary">'
        f'<div><strong>Subtotal:</strong> {_format_money(subtotal)}</div>'
    )
    if discount_pct != 0:
        html += (
            f'<div><strong>Discount ({discount_pct:g}%):</strong> -{_format_money(discount_amount)}</div>'
        )
    if tax_pct != 0:
        html += (
            f'<div><strong>Tax ({tax_pct:g}%):</strong> {_format_money(tax_amount)}</div>'
        )
    html += (
        f'<div class="pricing-grand-total"><strong>Total:</strong> {_format_money(grand_total)}</div>'
        '</div>'
    )
    return html


def _build_timeline_gantt(content: str) -> str:
    rows = []
    lines = content.replace('\r\n', '\n').split('\n')

    for raw_line in lines:
        line = raw_line.strip()
        if not re.match(r'^[-*]\s+', line):
            continue
        entry = re.sub(r'^[-*]\s+', '', line)

        range_match = re.search(
            r'(?:week|wk)?\s*(\d+)\s*-\s*(\d+)\s*:\s*(.+)$',
            entry,
            flags=re.IGNORECASE,
        )
        if range_match:
            rows.append(
                {
                    'start': int(range_match.group(1)),
                    'end': int(range_match.group(2)),
                    'label': range_match.group(3).strip(),
                }
            )
            continue

        point_match = re.search(r'(?:week|wk)?\s*(\d+)\s*:\s*(.+)$', entry, flags=re.IGNORECASE)
        if point_match:
            point = int(point_match.group(1))
            rows.append(
                {
                    'start': point,
                    'end': point,
                    'label': point_match.group(2).strip(),
                }
            )

    if not rows:
        return ''

    min_start = min(row['start'] for row in rows)
    max_end = max(row['end'] for row in rows)
    span = max(1, (max_end - min_start + 1))

    html = '<div class="sow-gantt"><h4>Gantt View</h4>'
    for row in rows:
        offset = ((row['start'] - min_start) / span) * 100
        width = (((row['end'] - row['start'] + 1) / span) * 100)
        html += (
            '<div class="gantt-row">'
            f'<div class="gantt-label">{row["label"]} <span class="muted">(W{row["start"]}-W{row["end"]})</span></div>'
            '<div class="gantt-track">'
            f'<div class="gantt-bar" style="margin-left:{offset:.2f}%;width:{width:.2f}%;"></div>'
            '</div>'
            '</div>'
        )
    html += '</div>'
    return html


def _render_pricing_block(content: str) -> str:
    """Render a pricing table with auto-calculated totals."""
    rendered = _render_inner_markdown(content)
    summary = _build_pricing_summary(content)
    return f'<div class="sow-pricing">\n{rendered}\n{summary}\n</div>'


def _render_timeline_block(content: str) -> str:
    """Render a timeline/milestones block."""
    rendered = _render_inner_markdown(content)
    gantt = _build_timeline_gantt(content)
    return f'<div class="sow-timeline">\n<h3>Project Timeline</h3>\n{rendered}\n{gantt}\n</div>'


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
            rendered = renderer(content)
            text = text.replace(match.group(0), rendered)

    return text
