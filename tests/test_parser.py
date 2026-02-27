"""Tests for the markdown parser with SOW extensions."""
import pytest
from app.markdown_parser import render_markdown


def test_basic_markdown():
    result = render_markdown('# Hello World')
    assert '<h1>Hello World</h1>' in result


def test_variable_substitution():
    result = render_markdown(
        'Hello {{client_name}}',
        variables={'client_name': 'Acme Corp'}
    )
    assert 'Acme Corp' in result
    assert '{{client_name}}' not in result


def test_unresolved_variable_kept():
    result = render_markdown('Hello {{unknown_var}}')
    assert '{{unknown_var}}' in result


def test_inline_variables_block():
    md = ''':::variables
client_name: Test Corp
project_name: Big Project
:::

Hello {{client_name}}, welcome to {{project_name}}.'''
    result = render_markdown(md)
    assert 'Test Corp' in result
    assert 'Big Project' in result


def test_explicit_vars_override_inline():
    md = ''':::variables
client_name: Inline Corp
:::

Hello {{client_name}}.'''
    result = render_markdown(md, variables={'client_name': 'Override Corp'})
    assert 'Override Corp' in result


def test_pricing_block():
    md = ''':::pricing
| Item | Cost |
|------|------|
| Dev | $100 |
:::
'''
    result = render_markdown(md)
    assert 'sow-pricing' in result
    assert 'Dev' in result


def test_timeline_block():
    md = ''':::timeline
- Phase 1: Week 1
- Phase 2: Week 2
:::
'''
    result = render_markdown(md)
    assert 'sow-timeline' in result
    assert 'Phase 1' in result


def test_signature_block():
    md = ''':::signature
Client: John Doe
Date: 2026-01-01
---
Consultant: Jane Smith
Date: 2026-01-01
:::
'''
    result = render_markdown(md)
    assert 'sow-signatures' in result
    assert 'sig-block' in result
    assert 'John Doe' in result
    assert 'Jane Smith' in result


def test_tables():
    md = '''| A | B |
|---|---|
| 1 | 2 |
'''
    result = render_markdown(md)
    assert '<table>' in result
    assert '<td>' in result
