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
from html import escape
from markdown_it import MarkdownIt


_MD = MarkdownIt('commonmark', {'html': True})
_MD.enable('table')


def _render_inner_markdown(text: str) -> str:
    """Render markdown fragments used inside custom blocks."""
    return _MD.render(text)


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


def _extract_percent(line: str, field: str) -> float | None:
    if not re.match(rf'^{field}\s*:', line, flags=re.IGNORECASE):
        return None
    match = re.search(r'(-?\d+(\.\d+)?)\s*%?', line)
    if not match:
        return None
    return float(match.group(1))


def _extract_table_amount(line: str) -> float | None:
    if '|' not in line or re.match(r'^\s*\|?[-:|\s]+\|?\s*$', line):
        return None
    cells = [cell.strip() for cell in line.split('|') if cell.strip()]
    if len(cells) < 2:
        return None
    if 'total' in cells[0].lower():
        return None
    return _parse_money(cells[-1])


def _summarize_pricing_values(content: str) -> tuple[float, float, float]:
    lines = content.replace('\r\n', '\n').split('\n')
    subtotal = 0.0
    discount_pct = 0.0
    tax_pct = 0.0
    for raw_line in lines:
        line = raw_line.strip()
        maybe_discount = _extract_percent(line, 'discount')
        if maybe_discount is not None:
            discount_pct = maybe_discount
            continue
        maybe_tax = _extract_percent(line, 'tax')
        if maybe_tax is not None:
            tax_pct = maybe_tax
            continue
        maybe_amount = _extract_table_amount(line)
        if maybe_amount is not None:
            subtotal += maybe_amount
    return subtotal, discount_pct, tax_pct


def _build_pricing_summary(content: str) -> str:
    subtotal, discount_pct, tax_pct = _summarize_pricing_values(content)
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


def _parse_timeline_entry(entry: str) -> dict | None:
    range_match = re.search(
        r'(?:week|wk)?\s*(\d+)\s*-\s*(\d+)\s*:\s*(.+)$',
        entry,
        flags=re.IGNORECASE,
    )
    if range_match:
        return {
            'start': int(range_match.group(1)),
            'end': int(range_match.group(2)),
            'label': range_match.group(3).strip(),
        }

    point_match = re.search(r'(?:week|wk)?\s*(\d+)\s*:\s*(.+)$', entry, flags=re.IGNORECASE)
    if point_match:
        point = int(point_match.group(1))
        return {
            'start': point,
            'end': point,
            'label': point_match.group(2).strip(),
        }
    return None


def _parse_timeline_rows(content: str) -> list[dict]:
    rows = []
    for raw_line in content.replace('\r\n', '\n').split('\n'):
        line = raw_line.strip()
        if not re.match(r'^[-*]\s+', line):
            continue
        entry = re.sub(r'^[-*]\s+', '', line)
        parsed = _parse_timeline_entry(entry)
        if parsed:
            rows.append(parsed)
    return rows


def _timeline_span(rows: list[dict]) -> tuple[int, int]:
    min_start = min(row['start'] for row in rows)
    max_end = max(row['end'] for row in rows)
    return min_start, max(1, (max_end - min_start + 1))


def _render_gantt_row(row: dict, min_start: int, span: int) -> str:
    offset = ((row['start'] - min_start) / span) * 100
    width = (((row['end'] - row['start'] + 1) / span) * 100)
    return (
        '<div class="gantt-row">'
        f'<div class="gantt-label">{escape(row["label"])} '
        f'<span class="muted">(W{row["start"]}-W{row["end"]})</span></div>'
        '<div class="gantt-track">'
        f'<div class="gantt-bar" style="margin-left:{offset:.2f}%;width:{width:.2f}%;"></div>'
        '</div>'
        '</div>'
    )


def _build_timeline_gantt(content: str) -> str:
    rows = _parse_timeline_rows(content)
    if not rows:
        return ''

    min_start, span = _timeline_span(rows)

    html = '<div class="sow-gantt"><h4>Gantt View</h4>'
    for row in rows:
        html += _render_gantt_row(row, min_start, span)
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
    blocks = _signature_blocks(content)
    body = ''.join(_build_sig_block(block) for block in blocks)
    return f'<div class="sow-signatures">\n{body}</div>'


def _signature_blocks(content: str) -> list[list[str]]:
    blocks = []
    for section in content.strip().split('---'):
        lines = [line.strip() for line in section.split('\n') if line.strip()]
        if lines:
            blocks.append(lines)
    return blocks


def _render_signature_line(line: str) -> str:
    if ':' not in line:
        return f'  <p>{escape(line)}</p>\n'
    label, value = line.split(':', 1)
    return (
        '  <div class="sig-field">'
        f'<span class="sig-label">{escape(label.strip())}:</span> '
        f'<span class="sig-value">{escape(value.strip())}</span>'
        '<div class="sig-line"></div>'
        '</div>\n'
    )


def _build_sig_block(lines: list) -> str:
    """Build a single signature block HTML."""
    html = ''.join(_render_signature_line(line) for line in lines)
    return f'<div class="sig-block">\n{html}</div>\n'


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
    html = _MD.render(text)
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
        compiled = re.compile(pattern, flags=re.DOTALL)
        text = compiled.sub(lambda match: renderer(match.group(1)), text)

    return text
