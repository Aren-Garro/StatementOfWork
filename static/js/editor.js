/**
 * SOW Generator — Editor Logic
 * Handles live preview, variable substitution, PDF export, and template management.
 */

(function () {
    'use strict';

    // ─── DOM Elements ────────────────────────────────────
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('preview-content');
    const charCount = document.getElementById('char-count');
    const templateSelect = document.getElementById('template-select');
    const pageSizeSelect = document.getElementById('page-size');
    const btnExport = document.getElementById('btn-export');
    const btnSave = document.getElementById('btn-save');

    // ─── State ───────────────────────────────────────────
    let debounceTimer = null;
    const DEBOUNCE_MS = 300;

    // ─── Sample Content ──────────────────────────────────
    const SAMPLE_MARKDOWN = `# {{project_name}}
## Statement of Work

**Prepared for:** {{client_name}}  
**Prepared by:** {{consultant_name}}  
**Date:** {{date}}

---

## 1. Project Overview

This Statement of Work outlines the scope, deliverables, timeline, and terms for the {{project_name}} engagement between {{client_name}} and {{consultant_name}}.

## 2. Scope of Work

The following services will be provided:

- Discovery & requirements gathering
- Architecture & technical design
- Development & implementation
- Testing & quality assurance
- Deployment & launch support
- Post-launch support (2 weeks)

## 3. Deliverables

| # | Deliverable | Description |
|---|------------|-------------|
| 1 | Requirements Document | Detailed functional requirements |
| 2 | Technical Architecture | System design & tech stack documentation |
| 3 | Working Application | Fully functional application per requirements |
| 4 | Test Report | QA results and bug resolution summary |
| 5 | Deployment Guide | Production deployment documentation |

:::pricing
| Phase | Hours | Rate | Total |
|-------|-------|------|-------|
| Discovery | 10 | $150 | $1,500 |
| Design | 15 | $150 | $2,250 |
| Development | 40 | $150 | $6,000 |
| Testing | 10 | $150 | $1,500 |
| Deployment | 5 | $150 | $750 |
| **Total** | **80** | | **$12,000** |
:::

:::timeline
- **Phase 1: Discovery** — Week 1-2
- **Phase 2: Design** — Week 3-4  
- **Phase 3: Development** — Week 5-8
- **Phase 4: Testing** — Week 9-10
- **Phase 5: Deployment** — Week 11
:::

## 4. Payment Terms

- 30% upfront deposit upon signing
- 40% upon completion of development phase
- 30% upon final delivery and acceptance

## 5. Terms & Conditions

- Changes to scope require written approval and may affect timeline/cost
- All intellectual property transfers to client upon final payment
- Confidentiality obligations apply to both parties

:::signature
Client: {{client_name}}
Date: {{date}}
---
Consultant: {{consultant_name}}
Date: {{date}}
:::
`;

    // ─── Initialize ──────────────────────────────────────
    function init() {
        // Load saved content or use sample
        const saved = localStorage.getItem('sow_markdown');
        editor.value = saved || SAMPLE_MARKDOWN;

        // Set today's date
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('var-date').value = today;

        // Load saved variables
        loadVariables();

        // Initial preview
        updatePreview();
        updateCharCount();

        // Event listeners
        editor.addEventListener('input', onEditorInput);
        templateSelect.addEventListener('change', updatePreview);
        pageSizeSelect.addEventListener('change', updatePreview);
        btnExport.addEventListener('click', exportPDF);
        btnSave.addEventListener('click', saveTemplate);

        // Variable inputs
        document.querySelectorAll('[data-var]').forEach(input => {
            input.addEventListener('input', () => {
                saveVariables();
                updatePreview();
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboard);
    }

    // ─── Editor Events ───────────────────────────────────
    function onEditorInput() {
        updateCharCount();
        localStorage.setItem('sow_markdown', editor.value);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updatePreview, DEBOUNCE_MS);
    }

    function updateCharCount() {
        charCount.textContent = `${editor.value.length} chars`;
    }

    // ─── Live Preview ────────────────────────────────────
    async function updatePreview() {
        const variables = getVariables();
        const template = templateSelect.value;

        try {
            const response = await fetch('/api/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    markdown: editor.value,
                    variables: variables,
                    template: template
                })
            });

            const data = await response.json();
            preview.innerHTML = data.html;
        } catch (err) {
            console.error('Preview error:', err);
        }
    }

    // ─── PDF Export ──────────────────────────────────────
    async function exportPDF() {
        btnExport.disabled = true;
        btnExport.textContent = '⏳ Generating...';

        try {
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    markdown: editor.value,
                    variables: getVariables(),
                    template: templateSelect.value,
                    page_size: pageSizeSelect.value
                })
            });

            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${getVariables().project_name || 'proposal'}_SOW.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export error:', err);
            alert('Failed to generate PDF. Please try again.');
        } finally {
            btnExport.disabled = false;
            btnExport.textContent = '\uD83D\uDCC4 Export PDF';
        }
    }

    // ─── Template Save ───────────────────────────────────
    async function saveTemplate() {
        const name = prompt('Template name:');
        if (!name) return;

        const description = prompt('Description (optional):') || '';

        try {
            const response = await fetch('/api/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    description: description,
                    markdown: editor.value,
                    variables: getVariables()
                })
            });

            if (response.ok) {
                alert('Template saved!');
            }
        } catch (err) {
            console.error('Save error:', err);
        }
    }

    // ─── Variables ────────────────────────────────────────
    function getVariables() {
        const vars = {};
        document.querySelectorAll('[data-var]').forEach(input => {
            vars[input.dataset.var] = input.value;
        });
        return vars;
    }

    function saveVariables() {
        localStorage.setItem('sow_variables', JSON.stringify(getVariables()));
    }

    function loadVariables() {
        try {
            const saved = JSON.parse(localStorage.getItem('sow_variables'));
            if (saved) {
                Object.entries(saved).forEach(([key, value]) => {
                    const input = document.querySelector(`[data-var="${key}"]`);
                    if (input && value) input.value = value;
                });
            }
        } catch (e) {}
    }

    // ─── Snippet Insertion ────────────────────────────────
    window.insertSnippet = function (type) {
        const snippets = {
            pricing: `\n:::pricing\n| Item | Hours | Rate | Total |\n|------|-------|------|-------|\n| Phase 1 | 10 | $150 | $1,500 |\n| Phase 2 | 20 | $150 | $3,000 |\n| **Total** | **30** | | **$4,500** |\n:::\n`,
            timeline: `\n:::timeline\n- **Phase 1: Discovery** — Week 1-2\n- **Phase 2: Development** — Week 3-6\n- **Phase 3: Launch** — Week 7-8\n:::\n`,
            signature: `\n:::signature\nClient: {{client_name}}\nDate: {{date}}\n---\nConsultant: {{consultant_name}}\nDate: {{date}}\n:::\n`
        };

        const snippet = snippets[type];
        if (!snippet) return;

        const start = editor.selectionStart;
        editor.value = editor.value.substring(0, start) + snippet + editor.value.substring(editor.selectionEnd);
        editor.selectionStart = editor.selectionEnd = start + snippet.length;
        editor.focus();
        onEditorInput();
    };

    // ─── Keyboard Shortcuts ──────────────────────────────
    function handleKeyboard(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            localStorage.setItem('sow_markdown', editor.value);
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            exportPDF();
        }
    }

    // ─── Boot ────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);
})();
