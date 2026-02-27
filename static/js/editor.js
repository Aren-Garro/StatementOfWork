(function () {
    'use strict';

    const DB_NAME = 'sow_creator_db';
    const DB_VERSION = 1;
    const DOC_STORE = 'documents';
    const TEMPLATE_STORE = 'templates';
    const SAVE_DEBOUNCE_MS = 500;

    const SAMPLE_MARKDOWN = `# {{project_name}}
## Statement of Work

**Prepared for:** {{client_name}}  
**Prepared by:** {{consultant_name}}  
**Date:** {{date}}

---

## Scope

- Discovery
- Implementation
- Testing
- Launch support

:::pricing
| Phase | Hours | Rate | Total |
|---|---:|---:|---:|
| Discovery | 8 | $150 | $1200 |
| Build | 40 | $150 | $6000 |
| QA | 12 | $150 | $1800 |
| **Total** | **60** |  | **$9000** |
:::

:::timeline
- Week 1-2: Discovery
- Week 3-8: Build
- Week 9-10: QA and launch
:::

:::signature
Client: {{client_name}}
Date: {{date}}
---
Consultant: {{consultant_name}}
Date: {{date}}
:::
`;

    const state = {
        db: null,
        currentDoc: null,
        saveTimer: null,
    };

    const el = {
        editor: document.getElementById('markdown-editor'),
        preview: document.getElementById('preview-content'),
        charCount: document.getElementById('char-count'),
        saveStatus: document.getElementById('save-status'),
        docName: document.getElementById('doc-name'),
        docList: document.getElementById('doc-list'),
        templateSelect: document.getElementById('template-select'),
        pageSize: document.getElementById('page-size'),
        btnSave: document.getElementById('btn-save'),
        btnNew: document.getElementById('btn-new'),
        btnExport: document.getElementById('btn-export'),
        btnPublish: document.getElementById('btn-publish'),
        btnSettings: document.getElementById('btn-settings'),
        varInputs: document.querySelectorAll('[data-var]'),
        snippetButtons: document.querySelectorAll('[data-snippet]'),
    };

    function uid() {
        return 'doc_' + Math.random().toString(36).slice(2, 10);
    }

    function today() {
        return new Date().toISOString().split('T')[0];
    }

    function escapeHtml(text) {
        return (text || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function inline(text) {
        let out = escapeHtml(text);
        out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
        out = out.replace(/`(.+?)`/g, '<code>$1</code>');
        return out;
    }

    function parseTable(lines, index) {
        const header = lines[index];
        const separator = lines[index + 1] || '';
        if (!header.includes('|') || !/^\s*\|?[-:|\s]+\|?\s*$/.test(separator)) {
            return null;
        }

        const toCells = (line) => line.split('|').map(s => s.trim()).filter(Boolean);
        const headers = toCells(header);
        const rows = [];
        let i = index + 2;

        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
            rows.push(toCells(lines[i]));
            i += 1;
        }

        let html = '<table><thead><tr>';
        headers.forEach((h) => { html += '<th>' + inline(h) + '</th>'; });
        html += '</tr></thead><tbody>';
        rows.forEach((r) => {
            html += '<tr>';
            headers.forEach((_, idx) => {
                html += '<td>' + inline(r[idx] || '') + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table>';

        return { html, nextIndex: i };
    }

    function parseMarkdown(md) {
        const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
        let i = 0;
        let html = '';

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
                i += 1;
                continue;
            }

            if (/^<\/?[a-z][^>]*>/i.test(trimmed)) {
                html += trimmed;
                i += 1;
                continue;
            }

            const table = parseTable(lines, i);
            if (table) {
                html += table.html;
                i = table.nextIndex;
                continue;
            }

            if (/^#{1,3}\s+/.test(trimmed)) {
                const level = trimmed.match(/^#+/)[0].length;
                const text = trimmed.replace(/^#{1,3}\s+/, '');
                html += '<h' + level + '>' + inline(text) + '</h' + level + '>';
                i += 1;
                continue;
            }

            if (/^---+$/.test(trimmed)) {
                html += '<hr>';
                i += 1;
                continue;
            }

            if (/^[-*]\s+/.test(trimmed)) {
                html += '<ul>';
                while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                    html += '<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>';
                    i += 1;
                }
                html += '</ul>';
                continue;
            }

            let paragraph = trimmed;
            i += 1;
            while (i < lines.length && lines[i].trim() && !/^#{1,3}\s+/.test(lines[i].trim()) && !/^[-*]\s+/.test(lines[i].trim())) {
                paragraph += ' ' + lines[i].trim();
                i += 1;
            }
            html += '<p>' + inline(paragraph) + '</p>';
        }

        return html;
    }

    function extractVariables(text) {
        let vars = {};
        const next = text.replace(/:::variables\s*\n([\s\S]*?)\n:::/g, function (_, body) {
            body.split('\n').forEach((line) => {
                const sep = line.indexOf(':');
                if (sep > 0) {
                    const key = line.slice(0, sep).trim();
                    const value = line.slice(sep + 1).trim();
                    vars[key] = value;
                }
            });
            return '';
        });
        return { text: next, vars };
    }

    function substitute(text, vars) {
        return text.replace(/\{\{\s*([\w_]+)\s*\}\}/g, function (m, key) {
            return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m;
        });
    }

    function renderSignatureBlock(body) {
        const groups = body.trim().split('\n---\n');
        let html = '<div class="sow-signatures">';
        groups.forEach((group) => {
            html += '<div class="sig-block">';
            group.split('\n').forEach((line) => {
                const sep = line.indexOf(':');
                if (sep > 0) {
                    const k = line.slice(0, sep).trim();
                    const v = line.slice(sep + 1).trim();
                    html += '<div><strong class="sig-label">' + inline(k) + ':</strong> ' + inline(v) + '<div class="sig-line"></div></div>';
                }
            });
            html += '</div>';
        });
        html += '</div>';
        return html;
    }

    function applyCustomBlocks(md) {
        let out = md;
        out = out.replace(/:::pricing\s*\n([\s\S]*?)\n:::/g, function (_, body) {
            return '\n<div class="sow-pricing">' + parseMarkdown(body) + '</div>\n';
        });
        out = out.replace(/:::timeline\s*\n([\s\S]*?)\n:::/g, function (_, body) {
            return '\n<div class="sow-timeline"><h3>Project Timeline</h3>' + parseMarkdown(body) + '</div>\n';
        });
        out = out.replace(/:::signature\s*\n([\s\S]*?)\n:::/g, function (_, body) {
            return '\n' + renderSignatureBlock(body) + '\n';
        });
        return out;
    }

    function renderDocument(markdown, variables) {
        const extracted = extractVariables(markdown);
        const mergedVars = Object.assign({}, extracted.vars, variables || {});
        const substituted = substitute(extracted.text, mergedVars);
        const blocksApplied = applyCustomBlocks(substituted);
        return parseMarkdown(blocksApplied);
    }

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function () {
                const db = req.result;
                if (!db.objectStoreNames.contains(DOC_STORE)) {
                    db.createObjectStore(DOC_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(TEMPLATE_STORE)) {
                    db.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbPut(store, value) {
        return new Promise((resolve, reject) => {
            const tx = state.db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
        });
    }

    function dbGet(store, key) {
        return new Promise((resolve, reject) => {
            const tx = state.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(key);
            req.onsuccess = function () { resolve(req.result || null); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbGetAll(store) {
        return new Promise((resolve, reject) => {
            const tx = state.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = function () { resolve(req.result || []); };
            req.onerror = function () { reject(req.error); };
        });
    }

    async function ensureSeedDocument() {
        const docs = await dbGetAll(DOC_STORE);
        if (docs.length > 0) {
            const sorted = docs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
            return sorted[0];
        }

        const seed = {
            id: uid(),
            title: 'Untitled SOW',
            markdown: SAMPLE_MARKDOWN,
            variables: {
                client_name: 'Acme Corp',
                project_name: 'Website Redesign',
                consultant_name: 'Your Name',
                date: today(),
            },
            templateId: 'modern',
            pageSize: 'Letter',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revision: 1,
        };

        await dbPut(DOC_STORE, seed);
        return seed;
    }

    function bindDocToUi() {
        el.editor.value = state.currentDoc.markdown;
        el.templateSelect.value = state.currentDoc.templateId || 'modern';
        el.pageSize.value = state.currentDoc.pageSize || 'Letter';
        el.docName.textContent = state.currentDoc.title || 'Untitled SOW';

        el.varInputs.forEach((input) => {
            const key = input.dataset.var;
            input.value = state.currentDoc.variables[key] || '';
        });

        updateCharCount();
        renderPreview();
    }

    function updateCharCount() {
        el.charCount.textContent = String(el.editor.value.length) + ' chars';
    }

    function setSaveStatus(text) {
        el.saveStatus.textContent = text;
    }

    async function saveCurrentDoc() {
        if (!state.currentDoc) {
            return;
        }

        state.currentDoc.markdown = el.editor.value;
        state.currentDoc.templateId = el.templateSelect.value;
        state.currentDoc.pageSize = el.pageSize.value;
        state.currentDoc.variables = {};
        el.varInputs.forEach((input) => {
            state.currentDoc.variables[input.dataset.var] = input.value;
        });

        state.currentDoc.title = state.currentDoc.variables.project_name || 'Untitled SOW';
        state.currentDoc.updatedAt = new Date().toISOString();
        state.currentDoc.revision = (state.currentDoc.revision || 0) + 1;

        await dbPut(DOC_STORE, state.currentDoc);
        el.docName.textContent = state.currentDoc.title;
        await renderDocList();
        setSaveStatus('Saved locally at ' + new Date().toLocaleTimeString());
    }

    function queueSave() {
        setSaveStatus('Saving...');
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(function () {
            saveCurrentDoc().catch(function (err) {
                console.error(err);
                setSaveStatus('Save failed');
            });
        }, SAVE_DEBOUNCE_MS);
    }

    function renderPreview() {
        const html = renderDocument(el.editor.value, collectVariables());
        el.preview.className = 'preview theme-' + el.templateSelect.value;
        el.preview.innerHTML = html;
    }

    function collectVariables() {
        const vars = {};
        el.varInputs.forEach((input) => {
            vars[input.dataset.var] = input.value;
        });
        return vars;
    }

    function insertSnippet(name) {
        const snippets = {
            pricing: '\n:::pricing\n| Item | Hours | Rate | Total |\n|---|---:|---:|---:|\n| Build | 20 | $150 | $3000 |\n| QA | 10 | $150 | $1500 |\n| **Total** | **30** | | **$4500** |\n:::\n',
            timeline: '\n:::timeline\n- Week 1-2: Discovery\n- Week 3-6: Development\n- Week 7-8: Launch\n:::\n',
            signature: '\n:::signature\nClient: {{client_name}}\nDate: {{date}}\n---\nConsultant: {{consultant_name}}\nDate: {{date}}\n:::\n',
        };
        const snippet = snippets[name];
        if (!snippet) {
            return;
        }

        const start = el.editor.selectionStart;
        const end = el.editor.selectionEnd;
        el.editor.value = el.editor.value.slice(0, start) + snippet + el.editor.value.slice(end);
        el.editor.selectionStart = el.editor.selectionEnd = start + snippet.length;
        el.editor.focus();
        updateCharCount();
        renderPreview();
        queueSave();
    }

    function getThemeCss(theme) {
        if (theme === 'classic') {
            return 'body { font-family: Georgia, "Times New Roman", serif; } h1 { text-align: center; border-bottom: 2px solid #111; }';
        }
        if (theme === 'minimal') {
            return 'body { font-family: "Segoe UI", Arial, sans-serif; font-weight: 300; } h1 { letter-spacing: -0.5px; }';
        }
        return 'body { font-family: "Segoe UI", Arial, sans-serif; } h1 { color: #0369a1; }';
    }

    function openPrintWindow() {
        const title = escapeHtml(collectVariables().project_name || 'Statement of Work');
        const pageSize = el.pageSize.value.toLowerCase();
        const theme = el.templateSelect.value;

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
@page { size: ${pageSize}; margin: 1.8cm; }
body { color: #0f172a; line-height: 1.55; }
h1,h2,h3 { margin-top: 0.8rem; }
table { width: 100%; border-collapse: collapse; margin: 0.6rem 0; }
th,td { border: 1px solid #cbd5e1; padding: 0.4rem; text-align: left; }
.sow-timeline,.sow-pricing,.sow-signatures { margin: 0.8rem 0; padding: 0.6rem; border: 1px solid #dbe1ea; border-radius: 6px; }
.sig-block { display: inline-block; width: 45%; margin-right: 4%; vertical-align: top; }
.sig-line { border-bottom: 1px solid #111827; margin-top: 1.2rem; }
${getThemeCss(theme)}
</style>
</head>
<body>
${el.preview.innerHTML}
</body>
</html>`;

        const win = window.open('', '_blank');
        if (!win) {
            alert('Pop-up blocked. Allow pop-ups to print/export.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(function () {
            win.print();
        }, 220);
    }

    async function publishDocument() {
        const baseUrl = localStorage.getItem('sharing_plugin_url');
        if (!baseUrl) {
            alert('Set sharing plugin URL first.');
            return;
        }

        const response = await fetch(baseUrl.replace(/\/$/, '') + '/v1/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: collectVariables().project_name || 'Statement of Work',
                html: el.preview.innerHTML,
                expires_in_days: 30,
            }),
        });

        const payload = await response.json();
        if (!response.ok) {
            const message = payload.error || 'Publish failed';
            alert(message);
            return;
        }

        prompt('Published link (expires in 30 days):', payload.view_url);
    }

    function configureSharing() {
        const current = localStorage.getItem('sharing_plugin_url') || '';
        const value = prompt('Sharing plugin base URL (example: http://localhost:5000/plugin):', current);
        if (value === null) {
            return;
        }

        localStorage.setItem('sharing_plugin_url', value.trim());
        syncSharingState();
    }

    function syncSharingState() {
        const configured = Boolean((localStorage.getItem('sharing_plugin_url') || '').trim());
        el.btnPublish.disabled = !configured;
        el.btnPublish.title = configured ? 'Publish read-only link' : 'Configure sharing plugin URL first';
    }

    async function renderDocList() {
        const docs = (await dbGetAll(DOC_STORE)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        el.docList.innerHTML = '';
        docs.forEach((doc) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.textContent = doc.title || 'Untitled SOW';
            if (state.currentDoc && state.currentDoc.id === doc.id) {
                btn.classList.add('active');
            }
            btn.addEventListener('click', async function () {
                const next = await dbGet(DOC_STORE, doc.id);
                if (next) {
                    state.currentDoc = next;
                    bindDocToUi();
                    renderDocList();
                }
            });
            li.appendChild(btn);
            el.docList.appendChild(li);
        });
    }

    async function createNewDocument() {
        const doc = {
            id: uid(),
            title: 'Untitled SOW',
            markdown: SAMPLE_MARKDOWN,
            variables: {
                client_name: '',
                project_name: 'Untitled SOW',
                consultant_name: '',
                date: today(),
            },
            templateId: 'modern',
            pageSize: 'Letter',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revision: 1,
        };

        await dbPut(DOC_STORE, doc);
        state.currentDoc = doc;
        bindDocToUi();
        await renderDocList();
        setSaveStatus('Created new local document');
    }

    function setupEvents() {
        el.editor.addEventListener('input', function () {
            updateCharCount();
            renderPreview();
            queueSave();
        });

        el.templateSelect.addEventListener('change', function () {
            renderPreview();
            queueSave();
        });

        el.pageSize.addEventListener('change', queueSave);

        el.varInputs.forEach((input) => {
            input.addEventListener('input', function () {
                if (input.dataset.var === 'project_name') {
                    el.docName.textContent = input.value || 'Untitled SOW';
                }
                renderPreview();
                queueSave();
            });
        });

        el.snippetButtons.forEach((btn) => {
            btn.addEventListener('click', function () {
                insertSnippet(btn.dataset.snippet);
            });
        });

        el.btnSave.addEventListener('click', function () {
            saveCurrentDoc().catch(console.error);
        });
        el.btnNew.addEventListener('click', function () {
            createNewDocument().catch(console.error);
        });
        el.btnExport.addEventListener('click', openPrintWindow);
        el.btnPublish.addEventListener('click', function () {
            publishDocument().catch(function (err) {
                console.error(err);
                alert('Publish failed.');
            });
        });
        el.btnSettings.addEventListener('click', configureSharing);

        document.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                saveCurrentDoc().catch(console.error);
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
                event.preventDefault();
                openPrintWindow();
            }
        });
    }

    async function init() {
        state.db = await openDb();
        state.currentDoc = await ensureSeedDocument();
        bindDocToUi();
        await renderDocList();
        setupEvents();
        syncSharingState();
    }

    init().catch(function (err) {
        console.error(err);
        alert('Failed to initialize local storage.');
    });
})();
