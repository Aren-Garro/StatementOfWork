
(function () {
    'use strict';

    const DB_NAME = 'sow_creator_db';
    const DB_VERSION = 3;
    const DOC_STORE = 'documents';
    const CLIENT_STORE = 'clients';
    const CLAUSE_STORE = 'custom_clauses';
    const SAVE_DEBOUNCE_MS = 500;
    const SEARCH_DEBOUNCE_MS = 220;
    const PREVIEW_DEBOUNCE_MS = 140;
    const SUPPORTED_LOCALES = ['en', 'es', 'fr'];
    const utils = window.SowUtils || {};
    const revisionUtils = window.SowRevisionUtils || {};

    const CLAUSE_MARKER_START = '<!-- CLAUSE_PACK_START -->';
    const CLAUSE_MARKER_END = '<!-- CLAUSE_PACK_END -->';

    const CLAUSE_PACKS = {
        US_BASE: `## Legal Terms

- Independent contractor relationship only; no employment benefits are implied.
- Confidential information must be protected by both parties.
- Intellectual property transfers upon final payment unless otherwise stated.
- Payment due within 15 days unless amended in writing.
- Scope changes require a signed change order.
`,
        US_NY: `## Legal Terms (US + New York)

- Includes US baseline independent contractor, confidentiality, IP, and payment terms.
- Written contract and compensation terms should align with New York freelance protections.
- Late payment risk and non-payment remedies should be documented in writing.
- Scope changes require written approval and updated schedule/fees.
`,
        US_CA: `## Legal Terms (US + California)

- Includes US baseline independent contractor, confidentiality, IP, and payment terms.
- Contractor classification, deliverable ownership, and payment timing must be explicit.
- Reimbursements and acceptance criteria should be listed to reduce disputes.
- Scope changes require written approval and updated schedule/fees.
`,
        EU_BASE: `## Legal Terms (EU Baseline)

- Personal data handling must comply with GDPR and agreed data processing terms.
- Confidential information and customer data must be protected with appropriate controls.
- Intellectual property ownership and license boundaries must be explicit in writing.
- Scope changes require written approval and updated schedule/fees.
`,
        UK_BASE: `## Legal Terms (United Kingdom)

- Engagement terms should align with UK contractor and service agreement practices.
- Data handling must comply with UK GDPR and applicable data protection obligations.
- Payment timing, acceptance criteria, and late-payment remedies should be explicit.
- Scope changes require written approval and updated schedule/fees.
`,
        CA_BASE: `## Legal Terms (Canada)

- Engagement terms should define deliverables, acceptance criteria, and payment timelines.
- Privacy and personal information handling must align with applicable Canadian requirements.
- Intellectual property transfer and retained rights must be documented clearly.
- Scope changes require written approval and updated schedule/fees.
`,
        AU_BASE: `## Legal Terms (Australia)

- Service terms should define scope, milestones, and acceptance criteria in writing.
- Privacy obligations should align with applicable Australian privacy requirements.
- IP ownership, licensing, and moral-right considerations should be documented.
- Scope changes require written approval and updated schedule/fees.
`,
    };

    const REQUIRED_GUARDRAILS = [
        { key: 'scope', label: 'Scope section', test: (t) => t.includes('## scope') },
        { key: 'deliverables', label: 'Deliverables section', test: (t) => t.includes('## deliverables') },
        { key: 'timeline', label: 'Timeline section', test: (t) => t.includes('## timeline') || t.includes(':::timeline') },
        { key: 'acceptance', label: 'Acceptance criteria', test: (t) => t.includes('acceptance criteria') },
        { key: 'payment', label: 'Payment terms', test: (t) => t.includes('payment terms') || t.includes('net 15') || t.includes('net 30') },
        { key: 'out_of_scope', label: 'Out of scope / exclusions', test: (t) => t.includes('out of scope') || t.includes('exclusions') },
        { key: 'change_order', label: 'Change-order clause', test: (t) => t.includes('change order') },
        { key: 'signatures', label: 'Signature block', test: (t) => t.includes(':::signature') || t.includes('## signatures') },
    ];

    const SAMPLE_MARKDOWN_BY_LOCALE = {
        en: `# {{project_name}}
## Statement of Work

**Prepared for:** {{client_name}}
**Prepared by:** {{consultant_name}}
**Date:** {{date}}

---

## Scope

### In Scope
- Discovery and planning
- Implementation
- QA and launch support

### Out of Scope
- Ongoing maintenance beyond 14 days

## Deliverables

- Requirements summary
- Working implementation
- Launch checklist

## Timeline

:::timeline
- Week 1-2: Discovery
- Week 3-6: Implementation
- Week 7: QA and launch
:::

## Acceptance Criteria

- Core requirements implemented as described
- Defects above severity-2 resolved before final acceptance

## Payment Terms

- 30% deposit to start
- 40% on implementation completion
- 30% on final acceptance

## Change Order

Any scope change requires written approval with adjusted schedule and fees.

:::pricing
| Phase | Hours | Rate | Total |
|---|---:|---:|---:|
| Discovery | 8 | $150 | $1200 |
| Build | 40 | $150 | $6000 |
| QA | 12 | $150 | $1800 |
| **Total** | **60** |  | **$9000** |
:::

:::signature
Client: {{client_name}}
Date: {{date}}
---
Consultant: {{consultant_name}}
Date: {{date}}
:::
`,
        es: `# {{project_name}}
## Declaracion de Trabajo

**Preparado para:** {{client_name}}
**Preparado por:** {{consultant_name}}
**Fecha:** {{date}}

---

## Alcance

### Incluido
- Descubrimiento y planificacion
- Implementacion
- QA y soporte de lanzamiento

### Fuera de alcance
- Mantenimiento continuo mas alla de 14 dias

## Entregables

- Resumen de requisitos
- Implementacion funcional
- Lista de verificacion de lanzamiento

## Cronograma

:::timeline
- Semana 1-2: Descubrimiento
- Semana 3-6: Implementacion
- Semana 7: QA y lanzamiento
:::

## Criterios de Aceptacion

- Requisitos principales implementados como se describio
- Defectos por encima de severidad-2 resueltos antes de la aceptacion final

## Terminos de Pago

- 30% de anticipo para iniciar
- 40% al completar implementacion
- 30% en la aceptacion final

## Orden de Cambio

Cualquier cambio de alcance requiere aprobacion escrita con ajustes de cronograma y tarifas.

:::pricing
| Fase | Horas | Tarifa | Total |
|---|---:|---:|---:|
| Descubrimiento | 8 | $150 | $1200 |
| Construccion | 40 | $150 | $6000 |
| QA | 12 | $150 | $1800 |
| **Total** | **60** |  | **$9000** |
:::

:::signature
Cliente: {{client_name}}
Fecha: {{date}}
---
Consultor: {{consultant_name}}
Fecha: {{date}}
:::
`,
        fr: `# {{project_name}}
## Statement des Travaux

**Prepare pour:** {{client_name}}
**Prepare par:** {{consultant_name}}
**Date:** {{date}}

---

## Portee

### Inclus
- Decouverte et planification
- Mise en oeuvre
- QA et support de lancement

### Hors Portee
- Maintenance continue au-dela de 14 jours

## Livrables

- Resume des exigences
- Mise en oeuvre fonctionnelle
- Checklist de lancement

## Calendrier

:::timeline
- Semaine 1-2: Decouverte
- Semaine 3-6: Mise en oeuvre
- Semaine 7: QA et lancement
:::

## Criteres d'Acceptation

- Exigences principales implementees comme decrit
- Defauts au-dessus de severite-2 resolus avant acceptation finale

## Conditions de Paiement

- 30% d'acompte pour commencer
- 40% a la fin de la mise en oeuvre
- 30% a l'acceptation finale

## Ordre de Changement

Tout changement de portee requiert une approbation ecrite avec ajustement du calendrier et des frais.

:::pricing
| Phase | Heures | Tarif | Total |
|---|---:|---:|---:|
| Decouverte | 8 | $150 | $1200 |
| Build | 40 | $150 | $6000 |
| QA | 12 | $150 | $1800 |
| **Total** | **60** |  | **$9000** |
:::

:::signature
Client: {{client_name}}
Date: {{date}}
---
Consultant: {{consultant_name}}
Date: {{date}}
:::
`,
    };

    const I18N = {
        en: {
            btn_new: 'New',
            btn_new_revision: 'New Revision',
            btn_save: 'Save',
            btn_change_order: 'Change Order',
            btn_sign_consultant: 'Sign as Consultant',
            btn_sign_client: 'Sign as Client',
            btn_export: 'Print / PDF',
            btn_export_md: 'Export .md',
            btn_export_json: 'Export .json',
            btn_import: 'Import',
            btn_settings: 'Sharing',
            btn_publish: 'Publish',
            compare_none: 'No comparison selected.',
            save_signed_locked: 'Signed revisions are locked. Create a new revision to edit.',
            save_viewing_previous: 'Viewing previous revision (read-only).',
            ready_sign_export: 'Ready to sign and export',
            no_client_selected: 'No client selected',
            new_custom_clause: 'New custom clause',
            signature_as: 'Signing as {role}. Draw your signature below.',
            library_search_placeholder: 'Search templates',
        },
        es: {
            btn_new: 'Nuevo',
            btn_new_revision: 'Nueva Revision',
            btn_save: 'Guardar',
            btn_change_order: 'Orden de Cambio',
            btn_sign_consultant: 'Firmar como Consultor',
            btn_sign_client: 'Firmar como Cliente',
            btn_export: 'Imprimir / PDF',
            btn_export_md: 'Exportar .md',
            btn_export_json: 'Exportar .json',
            btn_import: 'Importar',
            btn_settings: 'Compartir',
            btn_publish: 'Publicar',
            compare_none: 'Sin comparacion seleccionada.',
            save_signed_locked: 'Las revisiones firmadas estan bloqueadas. Cree una nueva revision para editar.',
            save_viewing_previous: 'Viendo revision anterior (solo lectura).',
            ready_sign_export: 'Listo para firmar y exportar',
            no_client_selected: 'Ningun cliente seleccionado',
            new_custom_clause: 'Nueva clausula personalizada',
            signature_as: 'Firmando como {role}. Dibuje su firma abajo.',
            library_search_placeholder: 'Buscar plantillas',
        },
        fr: {
            btn_new: 'Nouveau',
            btn_new_revision: 'Nouvelle Revision',
            btn_save: 'Enregistrer',
            btn_change_order: 'Ordre de Changement',
            btn_sign_consultant: 'Signer comme Consultant',
            btn_sign_client: 'Signer comme Client',
            btn_export: 'Imprimer / PDF',
            btn_export_md: 'Exporter .md',
            btn_export_json: 'Exporter .json',
            btn_import: 'Importer',
            btn_settings: 'Partage',
            btn_publish: 'Publier',
            compare_none: 'Aucune comparaison selectionnee.',
            save_signed_locked: 'Les revisions signees sont verrouillees. Creez une nouvelle revision pour modifier.',
            save_viewing_previous: 'Affichage d une revision precedente (lecture seule).',
            ready_sign_export: 'Pret a signer et exporter',
            no_client_selected: 'Aucun client selectionne',
            new_custom_clause: 'Nouvelle clause personnalisee',
            signature_as: 'Signature en tant que {role}. Dessinez votre signature ci-dessous.',
            library_search_placeholder: 'Rechercher des modeles',
        },
    };

    const state = {
        db: null,
        currentDoc: null,
        lastDocId: null,
        locale: 'en',
        activeRevision: null,
        clients: [],
        customClauses: [],
        saveTimer: null,
        libraryTemplates: [],
        compare: {
            baseRevision: null,
            targetRevision: null,
        },
        signatureCapture: {
            role: null,
            drawing: false,
            hasStroke: false,
            pointerId: null,
            lastX: 0,
            lastY: 0,
        },
        librarySearchTimer: null,
        libraryFetchController: null,
        previewFetchController: null,
        previewRequestSeq: 0,
        previewTimer: null,
        setup: {
            statusLoaded: false,
            completed: false,
        },
    };

    const el = {
        editor: document.getElementById('markdown-editor'),
        preview: document.getElementById('preview-content'),
        charCount: document.getElementById('char-count'),
        saveStatus: document.getElementById('save-status'),
        docName: document.getElementById('doc-name'),
        docStatus: document.getElementById('doc-status'),
        revisionLabel: document.getElementById('revision-label'),
        guardrailList: document.getElementById('guardrail-list'),
        revisionList: document.getElementById('revision-list'),
        docList: document.getElementById('doc-list'),
        librarySearch: document.getElementById('library-search'),
        libraryIndustry: document.getElementById('library-industry'),
        libraryList: document.getElementById('library-list'),
        compareBase: document.getElementById('compare-base'),
        compareTarget: document.getElementById('compare-target'),
        btnCompare: document.getElementById('btn-compare'),
        btnClearCompare: document.getElementById('btn-clear-compare'),
        compareOutput: document.getElementById('compare-output'),
        languageSelect: document.getElementById('language-select'),
        templateSelect: document.getElementById('template-select'),
        pageSize: document.getElementById('page-size'),
        clausePack: document.getElementById('clause-pack'),
        clientSelect: document.getElementById('client-select'),
        clientLegalName: document.getElementById('client-legal-name'),
        clientContactName: document.getElementById('client-contact-name'),
        clientEmail: document.getElementById('client-email'),
        clientState: document.getElementById('client-state'),
        customClauseSelect: document.getElementById('custom-clause-select'),
        customClauseName: document.getElementById('custom-clause-name'),
        customClauseDescription: document.getElementById('custom-clause-description'),
        customClauseBody: document.getElementById('custom-clause-body'),
        btnSaveClient: document.getElementById('btn-save-client'),
        btnApplyClausePack: document.getElementById('btn-apply-clause-pack'),
        btnSaveCustomClause: document.getElementById('btn-save-custom-clause'),
        btnInsertCustomClause: document.getElementById('btn-insert-custom-clause'),
        btnSave: document.getElementById('btn-save'),
        btnNew: document.getElementById('btn-new'),
        btnNewRevision: document.getElementById('btn-new-revision'),
        btnChangeOrder: document.getElementById('btn-change-order'),
        btnSignConsultant: document.getElementById('btn-sign-consultant'),
        btnSignClient: document.getElementById('btn-sign-client'),
        btnExport: document.getElementById('btn-export'),
        btnExportMd: document.getElementById('btn-export-md'),
        btnExportJson: document.getElementById('btn-export-json'),
        btnImport: document.getElementById('btn-import'),
        fileImport: document.getElementById('file-import'),
        btnPublish: document.getElementById('btn-publish'),
        btnSettings: document.getElementById('btn-settings'),
        signatureModal: document.getElementById('signature-modal'),
        signatureSubtitle: document.getElementById('signature-subtitle'),
        signatureName: document.getElementById('signature-name'),
        signatureCanvas: document.getElementById('signature-canvas'),
        btnSignatureClear: document.getElementById('btn-signature-clear'),
        btnSignatureCancel: document.getElementById('btn-signature-cancel'),
        btnSignatureAccept: document.getElementById('btn-signature-accept'),
        setupModal: document.getElementById('setup-modal'),
        setupStatus: document.getElementById('setup-status'),
        setupPluginUrl: document.getElementById('setup-plugin-url'),
        setupCheckPluginHealth: document.getElementById('setup-check-plugin-health'),
        setupSmtpHost: document.getElementById('setup-smtp-host'),
        setupSmtpPort: document.getElementById('setup-smtp-port'),
        setupSmtpUsername: document.getElementById('setup-smtp-username'),
        setupSmtpPassword: document.getElementById('setup-smtp-password'),
        setupSmtpFromEmail: document.getElementById('setup-smtp-from-email'),
        setupSmtpFromName: document.getElementById('setup-smtp-from-name'),
        setupSmtpTimeout: document.getElementById('setup-smtp-timeout'),
        setupSmtpStarttls: document.getElementById('setup-smtp-starttls'),
        setupSmtpSsl: document.getElementById('setup-smtp-ssl'),
        setupCheckSmtpConnection: document.getElementById('setup-check-smtp-connection'),
        btnSetupCheck: document.getElementById('btn-setup-check'),
        btnSetupSave: document.getElementById('btn-setup-save'),
        btnSetupSkip: document.getElementById('btn-setup-skip'),
        varInputs: document.querySelectorAll('[data-var]'),
        snippetButtons: document.querySelectorAll('[data-snippet]'),
    };

    function uid(prefix) {
        if (typeof utils.uid === 'function') {
            return utils.uid(prefix);
        }
        return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 11);
    }

    function currentLocale() {
        return SUPPORTED_LOCALES.includes(state.locale) ? state.locale : 'en';
    }

    function t(key, replacements) {
        const locale = currentLocale();
        const catalog = I18N[locale] || I18N.en;
        const fallback = I18N.en[key] || key;
        let text = catalog[key] || fallback;
        if (replacements) {
            Object.keys(replacements).forEach((token) => {
                text = text.replaceAll('{' + token + '}', replacements[token]);
            });
        }
        return text;
    }

    function getSampleMarkdown() {
        return SAMPLE_MARKDOWN_BY_LOCALE[currentLocale()] || SAMPLE_MARKDOWN_BY_LOCALE.en;
    }

    function applyLocaleToUi() {
        el.btnNew.textContent = t('btn_new');
        el.btnNewRevision.textContent = t('btn_new_revision');
        el.btnSave.textContent = t('btn_save');
        el.btnChangeOrder.textContent = t('btn_change_order');
        el.btnSignConsultant.textContent = t('btn_sign_consultant');
        el.btnSignClient.textContent = t('btn_sign_client');
        el.btnExport.textContent = t('btn_export');
        el.btnExportMd.textContent = t('btn_export_md');
        el.btnExportJson.textContent = t('btn_export_json');
        el.btnImport.textContent = t('btn_import');
        el.btnSettings.textContent = t('btn_settings');
        el.btnPublish.textContent = t('btn_publish');
        el.librarySearch.placeholder = t('library_search_placeholder');
    }

    function setLocale(locale) {
        state.locale = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
        localStorage.setItem('ui_locale', state.locale);
        if (el.languageSelect) {
            el.languageSelect.value = state.locale;
        }
        applyLocaleToUi();
        renderClientSelect();
        renderCustomClauseSelect();
        clearComparison();
    }

    function nowIso() {
        if (typeof utils.nowIso === 'function') {
            return utils.nowIso();
        }
        return new Date().toISOString();
    }

    function today() {
        if (typeof utils.todayIso === 'function') {
            return utils.todayIso();
        }
        return new Date().toISOString().split('T')[0];
    }

    function escapeHtml(text) {
        if (typeof utils.escapeHtml === 'function') {
            return utils.escapeHtml(text);
        }
        return (text || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function inline(text) {
        if (typeof utils.inline === 'function') {
            return utils.inline(text);
        }
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

        const toCells = (line) => line.split('|').map((s) => s.trim()).filter(Boolean);
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

        return { html: html, nextIndex: i };
    }

    function parseMoney(value) {
        if (typeof utils.parseMoney === 'function') {
            return utils.parseMoney(value);
        }
        const cleaned = String(value || '').replace(/[^0-9.\-]/g, '');
        const amount = Number(cleaned);
        return Number.isFinite(amount) ? amount : null;
    }

    function formatMoney(amount) {
        if (typeof utils.formatMoney === 'function') {
            return utils.formatMoney(amount);
        }
        return '$' + amount.toFixed(2);
    }

    function buildPricingSummary(pricingBody) {
        const lines = (pricingBody || '').replace(/\r\n/g, '\n').split('\n');
        const metric = { subtotal: 0, discountPct: 0, taxPct: 0 };

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (/^discount\s*:/i.test(trimmed)) {
                const match = trimmed.match(/(-?\d+(\.\d+)?)\s*%?/);
                if (match) {
                    metric.discountPct = Number(match[1]);
                }
                return;
            }
            if (/^tax\s*:/i.test(trimmed)) {
                const match = trimmed.match(/(-?\d+(\.\d+)?)\s*%?/);
                if (match) {
                    metric.taxPct = Number(match[1]);
                }
                return;
            }

            if (!trimmed.includes('|') || /^\s*\|?[-:|\s]+\|?\s*$/.test(trimmed)) {
                return;
            }
            const cells = trimmed.split('|').map((s) => s.trim()).filter(Boolean);
            if (cells.length < 2) {
                return;
            }
            const maybeAmount = parseMoney(cells[cells.length - 1]);
            if (maybeAmount === null) {
                return;
            }
            if ((cells[0] || '').toLowerCase().includes('total')) {
                return;
            }
            metric.subtotal += maybeAmount;
        });

        const discountAmount = metric.subtotal * (metric.discountPct / 100);
        const discounted = metric.subtotal - discountAmount;
        const taxAmount = discounted * (metric.taxPct / 100);
        const grandTotal = discounted + taxAmount;

        return {
            subtotal: metric.subtotal,
            discountPct: metric.discountPct,
            discountAmount: discountAmount,
            taxPct: metric.taxPct,
            taxAmount: taxAmount,
            grandTotal: grandTotal,
        };
    }

    function buildTimelineGantt(timelineBody) {
        const lines = (timelineBody || '').replace(/\r\n/g, '\n').split('\n');
        const rows = [];

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!/^[-*]\s+/.test(trimmed)) {
                return;
            }
            const content = trimmed.replace(/^[-*]\s+/, '');
            let match = content.match(/(?:week|wk)?\s*(\d+)\s*-\s*(\d+)\s*:\s*(.+)$/i);
            if (match) {
                rows.push({
                    start: Number(match[1]),
                    end: Number(match[2]),
                    label: match[3].trim(),
                });
                return;
            }
            match = content.match(/(?:week|wk)?\s*(\d+)\s*:\s*(.+)$/i);
            if (match) {
                const point = Number(match[1]);
                rows.push({
                    start: point,
                    end: point,
                    label: match[2].trim(),
                });
            }
        });

        if (rows.length === 0) {
            return '';
        }

        const minStart = rows.reduce((min, row) => Math.min(min, row.start), rows[0].start);
        const maxEnd = rows.reduce((max, row) => Math.max(max, row.end), rows[0].end);
        const span = Math.max(1, (maxEnd - minStart + 1));

        let html = '<div class="sow-gantt"><h4>Gantt View</h4>';
        rows.forEach((row) => {
            const offset = ((row.start - minStart) / span) * 100;
            const width = (((row.end - row.start + 1) / span) * 100);
            html += '<div class="gantt-row">' +
                '<div class="gantt-label">' + inline(row.label) + ' <span class="muted">(W' + row.start + '-W' + row.end + ')</span></div>' +
                '<div class="gantt-track"><div class="gantt-bar" style="margin-left:' + offset.toFixed(2) + '%;width:' + width.toFixed(2) + '%;"></div></div>' +
                '</div>';
        });
        html += '</div>';
        return html;
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
        const vars = {};
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
        return { text: next, vars: vars };
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
            const summary = buildPricingSummary(body);
            let summaryHtml =
                '<div class="pricing-summary">' +
                '<div><strong>Subtotal:</strong> ' + formatMoney(summary.subtotal) + '</div>';
            if (summary.discountPct !== 0) {
                summaryHtml += '<div><strong>Discount (' + summary.discountPct + '%):</strong> -' + formatMoney(summary.discountAmount) + '</div>';
            }
            if (summary.taxPct !== 0) {
                summaryHtml += '<div><strong>Tax (' + summary.taxPct + '%):</strong> ' + formatMoney(summary.taxAmount) + '</div>';
            }
            summaryHtml += '<div class="pricing-grand-total"><strong>Total:</strong> ' + formatMoney(summary.grandTotal) + '</div></div>';
            return '\n<div class="sow-pricing">' + parseMarkdown(body) + summaryHtml + '</div>\n';
        });
        out = out.replace(/:::timeline\s*\n([\s\S]*?)\n:::/g, function (_, body) {
            return '\n<div class="sow-timeline"><h3>Project Timeline</h3>' + parseMarkdown(body) + buildTimelineGantt(body) + '</div>\n';
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
        const withBlocks = applyCustomBlocks(substituted);
        return parseMarkdown(withBlocks);
    }

    function renderSignatureSummary(signatures) {
        if (!signatures || signatures.length === 0) {
            return '<div class="sow-signatures"><p><strong>Signature status:</strong> Unsigned draft</p></div>';
        }
        let html = '<div class="sow-signatures"><h3>Recorded Signatures</h3><ul>';
        signatures.forEach((sig) => {
            html += '<li><strong>' + inline(sig.role) + ':</strong> ' + inline(sig.signerName) +
                ' (' + inline(new Date(sig.signedAt).toLocaleString()) + ')' +
                ' <em>via ' + inline(sig.method || 'native_esign') + '</em>';
            if (sig.imageDataUrl) {
                html += '<div><img class="sig-image" src="' + sig.imageDataUrl + '" alt="Captured signature"></div>';
            }
            html += '</li>';
        });
        html += '</ul></div>';
        return html;
    }

    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function summarizeTextDiff(previousText, currentText) {
        if (typeof revisionUtils.summarizeTextDiff === 'function') {
            return revisionUtils.summarizeTextDiff(previousText, currentText);
        }
        const previousLines = (previousText || '').split('\n');
        const currentLines = (currentText || '').split('\n');
        const previousSet = new Set(previousLines);
        const currentSet = new Set(currentLines);

        let added = 0;
        let removed = 0;
        currentSet.forEach((line) => {
            if (!previousSet.has(line)) {
                added += 1;
            }
        });
        previousSet.forEach((line) => {
            if (!currentSet.has(line)) {
                removed += 1;
            }
        });
        return { added: added, removed: removed };
    }

    function hashSignature(data) {
        if (typeof revisionUtils.hashSignature === 'function') {
            return revisionUtils.hashSignature(data);
        }
        let hash = 2166136261;
        for (let i = 0; i < data.length; i += 1) {
            hash ^= data.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(16);
    }

    function normalizeSignatures(signatures) {
        if (typeof revisionUtils.normalizeSignatures === 'function') {
            return revisionUtils.normalizeSignatures(signatures, nowIso);
        }
        if (!Array.isArray(signatures)) {
            return [];
        }
        return signatures.map((sig) => ({
            role: sig.role || 'unknown',
            signerName: sig.signerName || '',
            signedAt: sig.signedAt || nowIso(),
            method: sig.method || 'native_esign',
            imageDataUrl: sig.imageDataUrl || '',
            hash: sig.hash || '',
        }));
    }

    function buildLineDiff(baseText, targetText) {
        if (typeof revisionUtils.buildLineDiff === 'function') {
            return revisionUtils.buildLineDiff(baseText, targetText);
        }
        const base = (baseText || '').split('\n');
        const target = (targetText || '').split('\n');
        const max = Math.max(base.length, target.length);
        const rows = [];
        let added = 0;
        let removed = 0;
        let changed = 0;

        for (let i = 0; i < max; i += 1) {
            const left = base[i];
            const right = target[i];

            if (left === right) {
                rows.push({ left: left || '', right: right || '', cls: 'diff-unchanged' });
                continue;
            }

            if (typeof left === 'undefined') {
                added += 1;
                rows.push({ left: '', right: right || '', cls: 'diff-added' });
                continue;
            }

            if (typeof right === 'undefined') {
                removed += 1;
                rows.push({ left: left || '', right: '', cls: 'diff-removed' });
                continue;
            }

            changed += 1;
            rows.push({ left: left, right: right, cls: 'diff-changed' });
        }

        return { rows: rows, added: added, removed: removed, changed: changed };
    }

    function renderComparison() {
        const doc = state.currentDoc;
        if (!doc) {
            return;
        }
        const baseNum = Number(el.compareBase.value || 0);
        const targetNum = Number(el.compareTarget.value || 0);
        if (!baseNum || !targetNum) {
            el.compareOutput.textContent = 'Select two revisions to compare.';
            return;
        }

        const baseRev = getRevisionByNumber(doc, baseNum);
        const targetRev = getRevisionByNumber(doc, targetNum);
        if (!baseRev || !targetRev) {
            el.compareOutput.textContent = 'Unable to load one or both revisions.';
            return;
        }

        state.compare.baseRevision = baseRev.revision;
        state.compare.targetRevision = targetRev.revision;

        const diff = buildLineDiff(baseRev.markdown, targetRev.markdown);
        const columns = (typeof revisionUtils.renderDiffColumns === 'function')
            ? revisionUtils.renderDiffColumns(diff.rows, escapeHtml)
            : { leftHtml: '', rightHtml: '' };
        if (!columns.leftHtml && !columns.rightHtml) {
            diff.rows.forEach((row) => {
                columns.leftHtml += '<div class="diff-line ' + row.cls + '">' + escapeHtml(row.left || ' ') + '</div>';
                columns.rightHtml += '<div class="diff-line ' + row.cls + '">' + escapeHtml(row.right || ' ') + '</div>';
            });
        }
        if (typeof revisionUtils.renderDiffOutput === 'function') {
            el.compareOutput.innerHTML = revisionUtils.renderDiffOutput(
                baseRev.revision,
                targetRev.revision,
                diff,
                columns,
            );
            return;
        }
        el.compareOutput.innerHTML =
            '<p><strong>Revision ' + baseRev.revision + ' vs Revision ' + targetRev.revision + '</strong>' +
            ' | +' + diff.added + ' -' + diff.removed + ' ~' + diff.changed + '</p>' +
            '<div class="diff-grid">' +
            '<div class="diff-col"><p class="muted">Base (R' + baseRev.revision + ')</p>' + columns.leftHtml + '</div>' +
            '<div class="diff-col"><p class="muted">Target (R' + targetRev.revision + ')</p>' + columns.rightHtml + '</div>' +
            '</div>';
    }

    function clearComparison() {
        state.compare.baseRevision = null;
        state.compare.targetRevision = null;
        el.compareOutput.textContent = t('compare_none');
    }

    function refreshCompareSelectors() {
        if (!state.currentDoc) {
            return;
        }
        const revisions = state.currentDoc.revisions.slice().sort((a, b) => a.revision - b.revision);
        const currentBase = Number(el.compareBase.value || 0);
        const currentTarget = Number(el.compareTarget.value || 0);
        el.compareBase.innerHTML = '';
        el.compareTarget.innerHTML = '';

        revisions.forEach((rev) => {
            const optBase = document.createElement('option');
            optBase.value = String(rev.revision);
            optBase.textContent = 'Revision ' + rev.revision;
            if (currentBase === rev.revision) {
                optBase.selected = true;
            }
            el.compareBase.appendChild(optBase);

            const optTarget = document.createElement('option');
            optTarget.value = String(rev.revision);
            optTarget.textContent = 'Revision ' + rev.revision;
            if (currentTarget === rev.revision) {
                optTarget.selected = true;
            }
            el.compareTarget.appendChild(optTarget);
        });

        if (!el.compareBase.value && revisions.length > 1) {
            el.compareBase.value = String(revisions[revisions.length - 2].revision);
        }
        if (!el.compareTarget.value && revisions.length > 0) {
            el.compareTarget.value = String(revisions[revisions.length - 1].revision);
        }
    }

    async function loadLibraryTemplates() {
        try {
            if (state.libraryFetchController) {
                state.libraryFetchController.abort();
            }
            const controller = new AbortController();
            state.libraryFetchController = controller;
            const q = encodeURIComponent((el.librarySearch.value || '').trim());
            const industry = encodeURIComponent((el.libraryIndustry.value || '').trim());
            const response = await fetch(
                '/api/templates/library?q=' + q + '&industry=' + industry + '&limit=40&offset=0',
                { signal: controller.signal }
            );
            if (!response.ok) {
                throw new Error('library fetch failed');
            }
            const payload = await response.json();
            state.libraryTemplates = Array.isArray(payload.templates) ? payload.templates : [];
            renderLibraryIndustryOptions(payload.industries || []);
            renderLibraryList();
        } catch (err) {
            if (err && err.name === 'AbortError') {
                return;
            }
            console.error(err);
            el.libraryList.innerHTML = '<p class="muted">Template library unavailable.</p>';
        }
    }

    function scheduleLibraryRefresh() {
        clearTimeout(state.librarySearchTimer);
        state.librarySearchTimer = setTimeout(function () {
            loadLibraryTemplates().catch(console.error);
        }, SEARCH_DEBOUNCE_MS);
    }

    function renderLibraryIndustryOptions(industries) {
        const current = el.libraryIndustry.value || '';
        const normalized = [''].concat((industries || []).filter(Boolean));
        el.libraryIndustry.innerHTML = '';
        normalized.forEach((industry) => {
            const option = document.createElement('option');
            option.value = industry;
            option.textContent = industry || 'All industries';
            if (industry === current) {
                option.selected = true;
            }
            el.libraryIndustry.appendChild(option);
        });
    }

    function renderLibraryList() {
        el.libraryList.innerHTML = '';
        if (!state.libraryTemplates.length) {
            el.libraryList.innerHTML = '<p class="muted">No templates match this filter.</p>';
            return;
        }

        state.libraryTemplates.forEach((tpl) => {
            const card = document.createElement('article');
            card.className = 'library-item';

            const title = document.createElement('h3');
            title.textContent = tpl.name || 'Untitled template';
            card.appendChild(title);

            const meta = document.createElement('span');
            meta.className = 'library-meta';
            meta.textContent = (tpl.industry || 'General') + ' | ' + (tpl.source || 'curated');
            card.appendChild(meta);

            const desc = document.createElement('p');
            desc.textContent = tpl.description || '';
            card.appendChild(desc);

            const actions = document.createElement('div');
            actions.className = 'library-actions';

            const applyBtn = document.createElement('button');
            applyBtn.className = 'btn';
            applyBtn.textContent = 'Apply Here';
            applyBtn.addEventListener('click', function () {
                applyLibraryTemplate(tpl, false).catch(console.error);
            });
            actions.appendChild(applyBtn);

            const newBtn = document.createElement('button');
            newBtn.className = 'btn';
            newBtn.textContent = 'Apply New Doc';
            newBtn.addEventListener('click', function () {
                applyLibraryTemplate(tpl, true).catch(console.error);
            });
            actions.appendChild(newBtn);

            card.appendChild(actions);
            el.libraryList.appendChild(card);
        });
    }

    async function applyLibraryTemplate(template, asNewDocument) {
        if (!template || !template.markdown) {
            return;
        }
        const templateVariables = Object.assign(
            {
                client_name: '',
                project_name: template.name || 'Untitled SOW',
                consultant_name: '',
                date: today(),
            },
            template.variables || {}
        );

        if (asNewDocument) {
            const doc = {
                id: uid('doc'),
                title: templateVariables.project_name || template.name || 'Untitled SOW',
                clientId: '',
                clausePack: state.currentDoc ? state.currentDoc.clausePack : 'US_BASE',
                currentRevision: 1,
                revisions: [{
                    revision: 1,
                    markdown: template.markdown,
                    variables: templateVariables,
                    templateId: template.templateId || 'modern',
                    pageSize: 'Letter',
                    status: 'draft',
                    signatures: [],
                    changeSummary: 'Created from template library',
                    createdAt: nowIso(),
                }],
                createdAt: nowIso(),
                updatedAt: nowIso(),
            };
            await dbPut(DOC_STORE, doc);
            state.currentDoc = doc;
            state.activeRevision = doc.currentRevision;
            bindDocToUi();
            renderDocList();
            setSaveStatus('Created document from template library');
            return;
        }

        const revision = ensureEditableCurrent();
        if (!revision) {
            return;
        }
        el.editor.value = template.markdown;
        el.varInputs.forEach((input) => {
            const key = input.dataset.var;
            input.value = templateVariables[key] || '';
        });
        el.templateSelect.value = template.templateId || 'modern';
        setRevisionFromUi(revision);
        state.currentDoc.title = templateVariables.project_name || template.name || 'Untitled SOW';
        el.docName.textContent = state.currentDoc.title;
        updateCharCount();
        renderPreview();
        queueSave();
    }

    function resizeSignatureCanvas() {
        const canvas = el.signatureCanvas;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const bounds = canvas.getBoundingClientRect();
        const width = Math.max(240, Math.floor(bounds.width * ratio));
        const height = Math.max(120, Math.floor(bounds.height * ratio));
        const existing = canvas.toDataURL('image/png');
        canvas.width = width;
        canvas.height = height;
        resetSignatureCanvas(false);

        // Preserve a prior drawing when resizing while modal is open.
        if (state.signatureCapture.hasStroke && existing) {
            const img = new Image();
            img.onload = function () {
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = existing;
        }
    }

    function resetSignatureCanvas(resetStroke) {
        const shouldResetStroke = resetStroke !== false;
        const canvas = el.signatureCanvas;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f172a';
        if (shouldResetStroke) {
            state.signatureCapture.hasStroke = false;
        }
    }

    function openSignatureModal(role) {
        state.signatureCapture.role = role;
        state.signatureCapture.drawing = false;
        state.signatureCapture.pointerId = null;
        const defaultName = role === 'consultant'
            ? (collectVariables().consultant_name || '')
            : (collectVariables().client_name || '');
        el.signatureName.value = defaultName;
        el.signatureSubtitle.textContent = t('signature_as', { role: role });
        resizeSignatureCanvas();
        resetSignatureCanvas();
        el.signatureModal.classList.remove('hidden');
    }

    function closeSignatureModal() {
        el.signatureModal.classList.add('hidden');
        state.signatureCapture.role = null;
    }

    function canvasPosition(ev) {
        const rect = el.signatureCanvas.getBoundingClientRect();
        return {
            x: (ev.clientX - rect.left) * (el.signatureCanvas.width / rect.width),
            y: (ev.clientY - rect.top) * (el.signatureCanvas.height / rect.height),
        };
    }

    function signaturePointerDown(ev) {
        ev.preventDefault();
        const pos = canvasPosition(ev);
        const ctx = el.signatureCanvas.getContext('2d');
        state.signatureCapture.drawing = true;
        state.signatureCapture.pointerId = ev.pointerId;
        state.signatureCapture.lastX = pos.x;
        state.signatureCapture.lastY = pos.y;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    }

    function signaturePointerMove(ev) {
        if (!state.signatureCapture.drawing || state.signatureCapture.pointerId !== ev.pointerId) {
            return;
        }
        ev.preventDefault();
        const pos = canvasPosition(ev);
        const ctx = el.signatureCanvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(state.signatureCapture.lastX, state.signatureCapture.lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        state.signatureCapture.lastX = pos.x;
        state.signatureCapture.lastY = pos.y;
        state.signatureCapture.hasStroke = true;
    }

    function signaturePointerUp(ev) {
        if (state.signatureCapture.pointerId !== ev.pointerId) {
            return;
        }
        state.signatureCapture.drawing = false;
        state.signatureCapture.pointerId = null;
    }

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function () {
                const db = req.result;
                if (!db.objectStoreNames.contains(DOC_STORE)) {
                    db.createObjectStore(DOC_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(CLIENT_STORE)) {
                    db.createObjectStore(CLIENT_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(CLAUSE_STORE)) {
                    db.createObjectStore(CLAUSE_STORE, { keyPath: 'id' });
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

    function getRevisionByNumber(doc, revisionNumber) {
        return doc.revisions.find((rev) => rev.revision === revisionNumber) || null;
    }
    function migrateDoc(doc) {
        if (doc.revisions && Array.isArray(doc.revisions)) {
            doc.revisions = doc.revisions.map((rev) => {
                const normalized = Object.assign({}, rev);
                normalized.signatures = normalizeSignatures(rev.signatures);
                return normalized;
            });
            if (!doc.clausePack) {
                doc.clausePack = 'US_BASE';
            }
            if (!doc.currentRevision) {
                doc.currentRevision = doc.revisions[doc.revisions.length - 1].revision;
            }
            return doc;
        }

        const revision = {
            revision: 1,
            markdown: doc.markdown || getSampleMarkdown(),
            variables: doc.variables || {
                client_name: '',
                project_name: 'Untitled SOW',
                consultant_name: '',
                date: today(),
            },
            templateId: doc.templateId || 'modern',
            pageSize: doc.pageSize || 'Letter',
            status: 'draft',
            signatures: [],
            changeSummary: '',
            createdAt: doc.createdAt || nowIso(),
        };

        return {
            id: doc.id || uid('doc'),
            title: doc.title || revision.variables.project_name || 'Untitled SOW',
            clientId: doc.clientId || '',
            clausePack: 'US_BASE',
            currentRevision: 1,
            revisions: [revision],
            createdAt: doc.createdAt || nowIso(),
            updatedAt: doc.updatedAt || nowIso(),
        };
    }

    async function ensureSeedDocument() {
        const docs = (await dbGetAll(DOC_STORE)).map(migrateDoc);
        if (docs.length > 0) {
            docs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
            await dbPut(DOC_STORE, docs[0]);
            return docs[0];
        }

        const seed = {
            id: uid('doc'),
            title: 'Website Redesign SOW',
            clientId: '',
            clausePack: 'US_BASE',
            currentRevision: 1,
            revisions: [
                {
                    revision: 1,
                    markdown: getSampleMarkdown(),
                    variables: {
                        client_name: 'Acme Corp',
                        project_name: 'Website Redesign',
                        consultant_name: 'Your Name',
                        date: today(),
                    },
                    templateId: 'modern',
                    pageSize: 'Letter',
                    status: 'draft',
                    signatures: [],
                    changeSummary: '',
                    createdAt: nowIso(),
                },
            ],
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };

        await dbPut(DOC_STORE, seed);
        return seed;
    }

    function getActiveRevision() {
        if (!state.currentDoc) {
            return null;
        }
        return getRevisionByNumber(state.currentDoc, state.activeRevision || state.currentDoc.currentRevision);
    }

    function setSaveStatus(text) {
        el.saveStatus.textContent = text;
    }

    function updateCharCount() {
        el.charCount.textContent = String(el.editor.value.length) + ' chars';
    }

    function collectVariables() {
        const vars = {};
        el.varInputs.forEach((input) => {
            vars[input.dataset.var] = input.value;
        });
        return vars;
    }

    function syncStatusUi(revision) {
        el.revisionLabel.textContent = 'Revision ' + revision.revision;
        el.docStatus.textContent = revision.status;
        el.docStatus.className = 'status status-' + revision.status;

        const readOnly = revision.revision !== state.currentDoc.currentRevision || revision.status === 'signed';
        el.editor.readOnly = readOnly;
        if (readOnly) {
            el.saveStatus.textContent = revision.status === 'signed'
                ? t('save_signed_locked')
                : t('save_viewing_previous');
        }
    }

    function renderGuardrails(markdown, revision) {
        const lower = (markdown || '').toLowerCase();
        el.guardrailList.innerHTML = '';
        let missing = 0;

        REQUIRED_GUARDRAILS.forEach((item) => {
            const ok = item.test(lower);
            if (!ok) {
                missing += 1;
            }
            const li = document.createElement('li');
            li.className = ok ? 'guardrail-ok' : 'guardrail-missing';
            li.textContent = (ok ? 'OK: ' : 'Missing: ') + item.label;
            el.guardrailList.appendChild(li);
        });

        const hasConsultantSignature = revision.signatures.some((sig) => sig.role === 'consultant');
        const sigLi = document.createElement('li');
        const sigOk = hasConsultantSignature;
        sigLi.className = sigOk ? 'guardrail-ok' : 'guardrail-missing';
        sigLi.textContent = (sigOk ? 'OK: ' : 'Missing: ') + 'Consultant signature';
        el.guardrailList.appendChild(sigLi);
        if (!sigOk) {
            missing += 1;
        }

        if (missing === 0) {
            const allGood = document.createElement('li');
            allGood.className = 'guardrail-ok';
            allGood.textContent = t('ready_sign_export');
            el.guardrailList.appendChild(allGood);
        }
    }

    function renderRevisionList() {
        const doc = state.currentDoc;
        const active = getActiveRevision();
        el.revisionList.innerHTML = '';

        const revisions = doc.revisions.slice().sort((a, b) => b.revision - a.revision);
        revisions.forEach((rev) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            if (active && active.revision === rev.revision) {
                btn.classList.add('active');
            }
            btn.innerHTML = 'R' + rev.revision + ' - ' + rev.status + '<span class="revision-meta">' + new Date(rev.createdAt).toLocaleString() + '</span>';
            btn.addEventListener('click', function () {
                state.activeRevision = rev.revision;
                bindDocToUi();
            });
            li.appendChild(btn);
            el.revisionList.appendChild(li);
        });
        refreshCompareSelectors();
    }

    function renderDocList() {
        dbGetAll(DOC_STORE).then((docs) => {
            const normalized = docs.map(migrateDoc).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
            el.docList.innerHTML = '';
            normalized.forEach((doc) => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                if (state.currentDoc && state.currentDoc.id === doc.id) {
                    btn.classList.add('active');
                }
                btn.textContent = doc.title || 'Untitled SOW';
                btn.addEventListener('click', function () {
                    state.currentDoc = doc;
                    state.activeRevision = doc.currentRevision;
                    bindDocToUi();
                    dbPut(DOC_STORE, state.currentDoc).catch(console.error);
                });
                li.appendChild(btn);
                el.docList.appendChild(li);
            });
        }).catch(console.error);
    }

    function applyPreviewHtml(html, revision, theme) {
        const signatureHtml = renderSignatureSummary(revision.signatures);
        el.preview.className = 'preview theme-' + theme;
        el.preview.innerHTML = html + signatureHtml;
        renderGuardrails(el.editor.value, revision);
    }

    function renderPreview() {
        const revision = getActiveRevision();
        if (!revision) {
            return;
        }

        const markdown = el.editor.value;
        const variables = collectVariables();
        const template = el.templateSelect.value;
        const requestSeq = state.previewRequestSeq + 1;
        state.previewRequestSeq = requestSeq;

        if (state.previewFetchController) {
            state.previewFetchController.abort();
        }
        const controller = new AbortController();
        state.previewFetchController = controller;

        fetch('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                markdown: markdown,
                variables: variables,
                template: template,
            }),
            signal: controller.signal,
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('preview fetch failed');
                }
                return response.json();
            })
            .then((payload) => {
                if (requestSeq !== state.previewRequestSeq) {
                    return;
                }
                applyPreviewHtml(payload.html || '', revision, template);
            })
            .catch((err) => {
                if (err && err.name === 'AbortError') {
                    return;
                }
                // Safe fallback: avoid rendering unsanitized local HTML.
                const fallbackHtml =
                    '<p><strong>Preview unavailable.</strong> Showing raw markdown fallback.</p>' +
                    '<pre>' + escapeHtml(markdown) + '</pre>';
                applyPreviewHtml(fallbackHtml, revision, template);
            });
    }

    function schedulePreviewRender(immediate) {
        clearTimeout(state.previewTimer);
        if (immediate) {
            renderPreview();
            return;
        }
        state.previewTimer = setTimeout(function () {
            renderPreview();
        }, PREVIEW_DEBOUNCE_MS);
    }

    function bindClientForm(clientId) {
        const client = state.clients.find((c) => c.id === clientId) || null;
        if (!client) {
            el.clientLegalName.value = '';
            el.clientContactName.value = '';
            el.clientEmail.value = '';
            el.clientState.value = 'OTHER';
            return;
        }

        el.clientLegalName.value = client.legalName || '';
        el.clientContactName.value = client.contactName || '';
        el.clientEmail.value = client.email || '';
        el.clientState.value = client.state || 'OTHER';
    }

    function renderClientSelect() {
        const currentId = state.currentDoc ? (state.currentDoc.clientId || '') : '';
        el.clientSelect.innerHTML = '<option value="">' + t('no_client_selected') + '</option>';
        state.clients.sort((a, b) => (a.legalName || '').localeCompare(b.legalName || '')).forEach((client) => {
            const option = document.createElement('option');
            option.value = client.id;
            option.textContent = client.legalName;
            if (client.id === currentId) {
                option.selected = true;
            }
            el.clientSelect.appendChild(option);
        });
        bindClientForm(currentId);
    }

    function bindCustomClauseForm(clauseId) {
        const clause = state.customClauses.find((c) => c.id === clauseId) || null;
        if (!clause) {
            el.customClauseName.value = '';
            el.customClauseDescription.value = '';
            el.customClauseBody.value = '';
            return;
        }
        el.customClauseName.value = clause.name || '';
        el.customClauseDescription.value = clause.description || '';
        el.customClauseBody.value = clause.body || '';
    }

    function renderCustomClauseSelect() {
        const currentId = el.customClauseSelect.value || '';
        el.customClauseSelect.innerHTML = '<option value="">' + t('new_custom_clause') + '</option>';
        state.customClauses
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .forEach((clause) => {
                const option = document.createElement('option');
                option.value = clause.id;
                option.textContent = clause.name || 'Unnamed clause';
                if (clause.id === currentId) {
                    option.selected = true;
                }
                el.customClauseSelect.appendChild(option);
            });
        bindCustomClauseForm(el.customClauseSelect.value || '');
    }

    async function onCustomClauseSelected() {
        bindCustomClauseForm(el.customClauseSelect.value || '');
    }

    async function saveCustomClause() {
        const name = (el.customClauseName.value || '').trim();
        const body = (el.customClauseBody.value || '').trim();
        if (!name) {
            alert('Clause name is required.');
            return;
        }
        if (!body) {
            alert('Clause body is required.');
            return;
        }

        let clauseId = el.customClauseSelect.value || '';
        let existing = clauseId ? await dbGet(CLAUSE_STORE, clauseId) : null;
        if (!existing) {
            clauseId = uid('clause');
            existing = { id: clauseId, createdAt: nowIso() };
        }

        const clause = {
            id: clauseId,
            name: name,
            description: (el.customClauseDescription.value || '').trim(),
            body: body,
            createdAt: existing.createdAt || nowIso(),
            updatedAt: nowIso(),
        };
        await dbPut(CLAUSE_STORE, clause);
        state.customClauses = await dbGetAll(CLAUSE_STORE);
        el.customClauseSelect.value = clause.id;
        renderCustomClauseSelect();
        setSaveStatus('Saved custom clause locally');
    }

    function insertCustomClause() {
        const revision = ensureEditableCurrent();
        if (!revision) {
            return;
        }

        const selectedId = el.customClauseSelect.value || '';
        const clause = state.customClauses.find((c) => c.id === selectedId);
        const title = clause ? clause.name : (el.customClauseName.value || '').trim();
        const body = clause ? clause.body : (el.customClauseBody.value || '').trim();
        if (!title || !body) {
            alert('Select or draft a custom clause to insert.');
            return;
        }

        const block = '\n## Custom Clause: ' + title + '\n\n' + body + '\n';
        const start = el.editor.selectionStart;
        const end = el.editor.selectionEnd;
        el.editor.value = el.editor.value.slice(0, start) + block + el.editor.value.slice(end);
        el.editor.selectionStart = el.editor.selectionEnd = start + block.length;
        el.editor.focus();
        setRevisionFromUi(revision);
        updateCharCount();
        renderPreview();
        queueSave();
    }

    function bindDocToUi() {
        const revision = getActiveRevision();
        if (!revision) {
            return;
        }
        const previousDocId = state.lastDocId;
        const currentDocId = state.currentDoc ? state.currentDoc.id : null;
        const docChanged = Boolean(previousDocId && currentDocId && previousDocId !== currentDocId);

        el.editor.value = revision.markdown;
        el.templateSelect.value = revision.templateId || 'modern';
        el.pageSize.value = revision.pageSize || 'Letter';
        el.clausePack.value = state.currentDoc.clausePack || 'US_BASE';
        el.docName.textContent = state.currentDoc.title || 'Untitled SOW';

        el.varInputs.forEach((input) => {
            const key = input.dataset.var;
            input.value = revision.variables[key] || '';
        });

        updateCharCount();
        syncStatusUi(revision);
        renderPreview();
        renderRevisionList();
        renderClientSelect();
        renderCustomClauseSelect();
        if (docChanged) {
            clearComparison();
        }
        state.lastDocId = currentDocId;
    }

    function normalizeClausePackBlock(markdown, clausePackKey) {
        const clauseBody = CLAUSE_PACKS[clausePackKey] || CLAUSE_PACKS.US_BASE;
        const wrapped = CLAUSE_MARKER_START + '\n' + clauseBody + '\n' + CLAUSE_MARKER_END;
        const re = new RegExp(CLAUSE_MARKER_START + '[\\s\\S]*?' + CLAUSE_MARKER_END, 'm');

        if (re.test(markdown)) {
            return markdown.replace(re, wrapped);
        }
        return markdown + '\n\n' + wrapped + '\n';
    }

    function setRevisionFromUi(revision) {
        revision.markdown = el.editor.value;
        revision.variables = collectVariables();
        revision.templateId = el.templateSelect.value;
        revision.pageSize = el.pageSize.value;
    }

    function createRevisionFromCurrent(reason) {
        const doc = state.currentDoc;
        const current = getRevisionByNumber(doc, doc.currentRevision);
        if (!current) {
            return null;
        }

        if (current.status === 'draft') {
            current.status = 'superseded';
        }

        const nextRevisionNumber = doc.revisions.reduce((max, rev) => Math.max(max, rev.revision), 0) + 1;
        const next = {
            revision: nextRevisionNumber,
            markdown: current.markdown,
            variables: Object.assign({}, current.variables),
            templateId: current.templateId,
            pageSize: current.pageSize,
            status: 'draft',
            signatures: [],
            changeSummary: reason || 'New revision',
            createdAt: nowIso(),
        };

        doc.revisions.push(next);
        doc.currentRevision = next.revision;
        doc.updatedAt = nowIso();
        state.activeRevision = next.revision;

        bindDocToUi();
        queueSave();
        return next;
    }

    function ensureEditableCurrent() {
        const doc = state.currentDoc;
        const active = getActiveRevision();
        if (!doc || !active) {
            return null;
        }

        if (active.revision !== doc.currentRevision) {
            const shouldSwitch = window.confirm('This revision is read-only. Switch to the current revision?');
            if (!shouldSwitch) {
                return null;
            }
            state.activeRevision = doc.currentRevision;
            bindDocToUi();
        }

        const current = getRevisionByNumber(doc, doc.currentRevision);
        if (!current) {
            return null;
        }

        if (current.status === 'signed') {
            return createRevisionFromCurrent('Auto-created from signed revision for editing');
        }

        return current;
    }
    async function saveCurrentDoc() {
        if (!state.currentDoc) {
            return;
        }

        const active = getActiveRevision();
        if (!active) {
            return;
        }

        if (active.revision === state.currentDoc.currentRevision && active.status !== 'signed') {
            setRevisionFromUi(active);
            state.currentDoc.title = active.variables.project_name || 'Untitled SOW';
            state.currentDoc.updatedAt = nowIso();
            el.docName.textContent = state.currentDoc.title;
        }

        await dbPut(DOC_STORE, state.currentDoc);
        renderDocList();
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

    function insertSnippet(name) {
        const revision = ensureEditableCurrent();
        if (!revision) {
            return;
        }

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
        setRevisionFromUi(revision);
        updateCharCount();
        renderPreview();
        queueSave();
    }

    function applyClausePack() {
        const revision = ensureEditableCurrent();
        if (!revision) {
            return;
        }

        const pack = el.clausePack.value;
        const nextMarkdown = normalizeClausePackBlock(el.editor.value, pack);
        state.currentDoc.clausePack = pack;

        el.editor.value = nextMarkdown;
        setRevisionFromUi(revision);
        renderPreview();
        queueSave();
    }

    function signRevision(role) {
        const revision = getActiveRevision();
        if (!revision) {
            return;
        }

        if (revision.revision !== state.currentDoc.currentRevision) {
            alert('You can only sign the current revision.');
            return;
        }

        if (revision.status === 'signed') {
            alert('This revision is already fully signed. Create a new revision to change it.');
            return;
        }
        openSignatureModal(role);
    }

    function acceptSignatureFromModal() {
        const revision = getActiveRevision();
        if (!revision || !state.signatureCapture.role) {
            return;
        }
        if (!state.signatureCapture.hasStroke) {
            alert('Draw a signature before accepting.');
            return;
        }

        const signerName = (el.signatureName.value || '').trim();
        if (!signerName) {
            alert('Signer name is required.');
            return;
        }

        const imageDataUrl = el.signatureCanvas.toDataURL('image/png');
        const signatureHash = hashSignature(imageDataUrl + '|' + signerName + '|' + state.signatureCapture.role);

        revision.signatures = revision.signatures.filter((sig) => sig.role !== state.signatureCapture.role);
        revision.signatures.push({
            role: state.signatureCapture.role,
            signerName: signerName,
            signedAt: nowIso(),
            method: 'signature_pad',
            imageDataUrl: imageDataUrl,
            hash: signatureHash,
        });

        const hasConsultant = revision.signatures.some((sig) => sig.role === 'consultant');
        const hasClient = revision.signatures.some((sig) => sig.role === 'client');
        revision.status = hasConsultant && hasClient ? 'signed' : 'draft';

        closeSignatureModal();
        renderPreview();
        syncStatusUi(revision);
        queueSave();
    }

    function addChangeOrder() {
        const revision = ensureEditableCurrent();
        if (!revision) {
            return;
        }

        const selectedBase = state.compare.baseRevision
            ? getRevisionByNumber(state.currentDoc, state.compare.baseRevision)
            : null;
        const selectedTarget = state.compare.targetRevision
            ? getRevisionByNumber(state.currentDoc, state.compare.targetRevision)
            : null;
        const previousRevisionNumber = Math.max(1, state.currentDoc.currentRevision - 1);
        const previousRevision = selectedBase || getRevisionByNumber(state.currentDoc, previousRevisionNumber) || revision;
        const targetRevision = selectedTarget || revision;
        const diff = summarizeTextDiff(previousRevision.markdown, targetRevision.markdown);
        const template = `\n## Change Order ${state.currentDoc.currentRevision}\n\n- Requested by:\n- Date: ${today()}\n- Scope Delta:\n- Schedule Impact:\n- Fee Impact:\n- Diff Baseline: Revision ${previousRevision.revision}\n- Diff Target: Revision ${targetRevision.revision}\n- Draft Diff Summary: +${diff.added} lines / -${diff.removed} lines\n\nApproved by written confirmation from both parties.\n`;
        el.editor.value += template;
        setRevisionFromUi(revision);
        renderPreview();
        queueSave();
    }

    async function saveClient() {
        const legalName = (el.clientLegalName.value || '').trim();
        if (!legalName) {
            alert('Client legal name is required.');
            return;
        }

        let clientId = el.clientSelect.value;
        let existing = clientId ? await dbGet(CLIENT_STORE, clientId) : null;
        if (!existing) {
            clientId = uid('client');
            existing = { id: clientId, createdAt: nowIso() };
        }

        const client = {
            id: clientId,
            legalName: legalName,
            contactName: (el.clientContactName.value || '').trim(),
            email: (el.clientEmail.value || '').trim(),
            state: el.clientState.value || 'OTHER',
            updatedAt: nowIso(),
            createdAt: existing.createdAt || nowIso(),
        };

        await dbPut(CLIENT_STORE, client);
        state.clients = await dbGetAll(CLIENT_STORE);

        state.currentDoc.clientId = client.id;
        const revision = ensureEditableCurrent();
        if (revision) {
            revision.variables.client_name = client.legalName;
            el.varInputs.forEach((input) => {
                if (input.dataset.var === 'client_name') {
                    input.value = client.legalName;
                }
            });
        }

        renderClientSelect();
        bindClientForm(client.id);
        renderPreview();
        queueSave();
    }

    async function onClientSelected() {
        const clientId = el.clientSelect.value;
        state.currentDoc.clientId = clientId;
        bindClientForm(clientId);

        const revision = ensureEditableCurrent();
        if (revision && clientId) {
            const client = state.clients.find((c) => c.id === clientId);
            if (client) {
                revision.variables.client_name = client.legalName;
                el.varInputs.forEach((input) => {
                    if (input.dataset.var === 'client_name') {
                        input.value = client.legalName;
                    }
                });
                renderPreview();
            }
        }

        queueSave();
    }

    function exportMarkdown() {
        const revision = getActiveRevision();
        if (!revision) {
            return;
        }
        const filename = (state.currentDoc.title || 'sow').replace(/\s+/g, '_') + '_R' + revision.revision + '.md';
        downloadFile(filename, revision.markdown, 'text/markdown;charset=utf-8');
    }

    function exportJson() {
        const packageObj = {
            exportedAt: nowIso(),
            doc: state.currentDoc,
            clients: state.clients,
            customClauses: state.customClauses,
        };
        const filename = (state.currentDoc.title || 'sow').replace(/\s+/g, '_') + '.json';
        downloadFile(filename, JSON.stringify(packageObj, null, 2), 'application/json;charset=utf-8');
    }

    function importFile(file) {
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = async function () {
            try {
                const text = String(reader.result || '');
                const importSummary = {
                    docsImported: 0,
                    clientsImported: 0,
                    errors: [],
                };
                if (file.name.toLowerCase().endsWith('.md')) {
                    const doc = {
                        id: uid('doc'),
                        title: file.name.replace(/\.md$/i, ''),
                        clientId: '',
                        clausePack: 'US_BASE',
                        currentRevision: 1,
                        revisions: [{
                            revision: 1,
                            markdown: text,
                            variables: {
                                client_name: '',
                                project_name: file.name.replace(/\.md$/i, ''),
                                consultant_name: '',
                                date: today(),
                            },
                            templateId: 'modern',
                            pageSize: 'Letter',
                            status: 'draft',
                            signatures: [],
                            changeSummary: 'Imported from markdown',
                            createdAt: nowIso(),
                        }],
                        createdAt: nowIso(),
                        updatedAt: nowIso(),
                    };
                    await dbPut(DOC_STORE, doc);
                    importSummary.docsImported += 1;
                    state.currentDoc = doc;
                    state.activeRevision = 1;
                    bindDocToUi();
                    renderDocList();
                    alert('Import complete: 1 document imported from markdown.');
                    return;
                }

                const parsed = JSON.parse(text);

                if (Array.isArray(parsed.packages)) {
                    let firstDoc = null;
                    for (let i = 0; i < parsed.packages.length; i += 1) {
                        const pkg = parsed.packages[i] || {};
                        const migrated = migrateDoc(pkg.doc || {});
                        if (migrated && migrated.id) {
                            await dbPut(DOC_STORE, migrated);
                            importSummary.docsImported += 1;
                            if (!firstDoc) {
                                firstDoc = migrated;
                            }
                        } else {
                            importSummary.errors.push(`Package ${i + 1}: missing valid doc payload`);
                        }
                        const pkgClients = Array.isArray(pkg.clients) ? pkg.clients : [];
                        for (let j = 0; j < pkgClients.length; j += 1) {
                            const client = pkgClients[j];
                            if (client && client.id) {
                                await dbPut(CLIENT_STORE, client);
                                importSummary.clientsImported += 1;
                            }
                        }
                        const pkgClauses = Array.isArray(pkg.customClauses) ? pkg.customClauses : [];
                        for (let j = 0; j < pkgClauses.length; j += 1) {
                            const clause = pkgClauses[j];
                            if (clause && clause.id) {
                                await dbPut(CLAUSE_STORE, clause);
                            }
                        }
                    }
                    if (firstDoc) {
                        state.clients = await dbGetAll(CLIENT_STORE);
                        state.customClauses = await dbGetAll(CLAUSE_STORE);
                        state.currentDoc = firstDoc;
                        state.activeRevision = firstDoc.currentRevision;
                        bindDocToUi();
                        renderDocList();
                    } else {
                        importSummary.errors.push('No valid document packages found in JSON.');
                    }
                    alert(
                        `Import complete: ${importSummary.docsImported} docs, ${importSummary.clientsImported} clients.` +
                        (importSummary.errors.length ? ` Issues: ${importSummary.errors.join('; ')}` : '')
                    );
                    return;
                }

                const incomingDoc = migrateDoc(parsed.doc || parsed);
                await dbPut(DOC_STORE, incomingDoc);
                importSummary.docsImported += 1;

                if (Array.isArray(parsed.clients)) {
                    for (let i = 0; i < parsed.clients.length; i += 1) {
                        const client = parsed.clients[i];
                        if (client && client.id) {
                            await dbPut(CLIENT_STORE, client);
                            importSummary.clientsImported += 1;
                        }
                    }
                }
                if (Array.isArray(parsed.customClauses)) {
                    for (let i = 0; i < parsed.customClauses.length; i += 1) {
                        const clause = parsed.customClauses[i];
                        if (clause && clause.id) {
                            await dbPut(CLAUSE_STORE, clause);
                        }
                    }
                }

                state.clients = await dbGetAll(CLIENT_STORE);
                state.customClauses = await dbGetAll(CLAUSE_STORE);
                state.currentDoc = incomingDoc;
                state.activeRevision = incomingDoc.currentRevision;
                bindDocToUi();
                renderDocList();
                alert(
                    `Import complete: ${importSummary.docsImported} docs, ${importSummary.clientsImported} clients.` +
                    (importSummary.errors.length ? ` Issues: ${importSummary.errors.join('; ')}` : '')
                );
            } catch (err) {
                console.error(err);
                alert('Import failed. Check file format.');
            }
        };

        reader.readAsText(file);
    }

    async function createNewDocument() {
        const doc = {
            id: uid('doc'),
            title: 'Untitled SOW',
            clientId: '',
            clausePack: 'US_BASE',
            currentRevision: 1,
            revisions: [{
                revision: 1,
                markdown: getSampleMarkdown(),
                variables: {
                    client_name: '',
                    project_name: 'Untitled SOW',
                    consultant_name: '',
                    date: today(),
                },
                templateId: 'modern',
                pageSize: 'Letter',
                status: 'draft',
                signatures: [],
                changeSummary: '',
                createdAt: nowIso(),
            }],
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };

        await dbPut(DOC_STORE, doc);
        state.currentDoc = doc;
        state.activeRevision = doc.currentRevision;
        bindDocToUi();
        renderDocList();
        setSaveStatus('Created new local document');
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
.sow-timeline,.sow-pricing,.sow-signatures,.sow-legal { margin: 0.8rem 0; padding: 0.6rem; border: 1px solid #dbe1ea; border-radius: 6px; }
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
        let baseUrl = (localStorage.getItem('sharing_plugin_url') || '').trim();
        if (!baseUrl) {
            baseUrl = buildDefaultPluginUrl();
            localStorage.setItem('sharing_plugin_url', baseUrl);
            syncSharingState();
        }
        if (!baseUrl) {
            alert('Run setup first to configure sharing.');
            return;
        }

        const revision = getActiveRevision();
        if (revision && revision.status !== 'signed') {
            const continueUnsigned = window.confirm(
                'This revision is unsigned. Publish anyway as unsigned read-only draft?'
            );
            if (!continueUnsigned) {
                return;
            }
        }
        const response = await fetch(baseUrl.replace(/\/$/, '') + '/v1/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: collectVariables().project_name || 'Statement of Work',
                html: el.preview.innerHTML,
                expires_in_days: 30,
                revision: revision ? revision.revision : null,
                signed_only: revision ? revision.status === 'signed' : false,
                signed: revision ? revision.status === 'signed' : false,
                jurisdiction: state.currentDoc ? state.currentDoc.clausePack : 'US_BASE',
                template: el.templateSelect.value || 'modern',
                page_size: el.pageSize.value || 'Letter',
            }),
        });

        const payload = await response.json();
        if (!response.ok) {
            const message = payload.error || 'Publish failed';
            alert(message);
            return;
        }

        const shouldSendEmail = window.confirm('Published successfully. Send email to the client now?');
        if (shouldSendEmail) {
            await promptAndSendPublishedEmail(baseUrl.replace(/\/$/, ''), payload).catch(function (err) {
                console.error(err);
                alert('Email send failed.');
            });
        }
        prompt('Published link (expires in 30 days):', payload.view_url);
    }

    async function promptAndSendPublishedEmail(basePluginUrl, publishPayload) {
        const defaultRecipient = (el.clientEmail.value || '').trim();
        const toEmail = prompt('Recipient email:', defaultRecipient);
        if (toEmail === null) {
            return;
        }
        const normalizedEmail = toEmail.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
            alert('Please enter a valid recipient email.');
            return;
        }

        const defaultSubject = 'Statement of Work: ' + (collectVariables().project_name || 'Statement of Work');
        const subject = prompt('Email subject:', defaultSubject);
        if (subject === null) {
            return;
        }
        const message = prompt('Optional message (leave blank for none):', '') || '';
        const attachPdf = window.confirm('Attach PDF to the email? Click Cancel for link-only email.');

        const response = await fetch(
            basePluginUrl + '/v1/p/' + encodeURIComponent(publishPayload.publish_id) + '/email',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to_email: normalizedEmail,
                    subject: subject.trim() || defaultSubject,
                    message: message.trim(),
                    attach_pdf: attachPdf,
                }),
            }
        );
        const payload = await response.json();
        if (!response.ok) {
            alert(payload.error || 'Email send failed');
            return;
        }
        alert('Email sent to ' + payload.to_email + (payload.attached_pdf ? ' with PDF attachment.' : '.'));
    }

    function buildDefaultPluginUrl() {
        return window.location.origin.replace(/\/$/, '') + '/plugin';
    }

    function collectSetupPayload() {
        return {
            sharing_plugin_url: (el.setupPluginUrl.value || '').trim() || buildDefaultPluginUrl(),
            check_plugin_health: Boolean(el.setupCheckPluginHealth.checked),
            check_smtp_connection: Boolean(el.setupCheckSmtpConnection.checked),
            smtp: {
                host: (el.setupSmtpHost.value || '').trim(),
                port: Number(el.setupSmtpPort.value || 587),
                username: (el.setupSmtpUsername.value || '').trim(),
                password: (el.setupSmtpPassword.value || '').trim(),
                from_email: (el.setupSmtpFromEmail.value || '').trim(),
                from_name: (el.setupSmtpFromName.value || '').trim(),
                timeout_seconds: Number(el.setupSmtpTimeout.value || 10),
                use_starttls: Boolean(el.setupSmtpStarttls.checked),
                use_ssl: Boolean(el.setupSmtpSsl.checked),
            },
        };
    }

    function renderSetupStatus(lines, isError) {
        el.setupStatus.textContent = lines.join('\n');
        el.setupStatus.style.borderColor = isError ? '#fca5a5' : '#86efac';
        el.setupStatus.style.background = isError ? '#fef2f2' : '#f0fdf4';
    }

    async function loadSetupStatus() {
        const response = await fetch('/api/setup/status');
        if (!response.ok) {
            throw new Error('Failed to load setup status');
        }
        const payload = await response.json();
        state.setup.statusLoaded = true;
        state.setup.completed = Boolean(payload.setup_completed);

        const savedPlugin = (localStorage.getItem('sharing_plugin_url') || '').trim();
        el.setupPluginUrl.value = savedPlugin || payload.sharing.configured_plugin_url || payload.sharing.default_plugin_url;
        if (payload.smtp && payload.smtp.host && !el.setupSmtpHost.value) {
            el.setupSmtpHost.value = payload.smtp.host;
        }
        if (payload.smtp && payload.smtp.from_email && !el.setupSmtpFromEmail.value) {
            el.setupSmtpFromEmail.value = payload.smtp.from_email;
        }

        const depLines = [];
        if (payload.dependencies && payload.dependencies.weasyprint === false) {
            depLines.push('PDF export dependency missing: weasyprint');
        }
        if (payload.dependencies && payload.dependencies.gunicorn === false) {
            depLines.push('Production server dependency missing: gunicorn');
        }
        if (depLines.length) {
            renderSetupStatus(depLines, true);
        } else {
            renderSetupStatus(['Setup status loaded. Run "Check Setup" to validate connectivity.'], false);
        }
    }

    async function runSetupCheck() {
        const payload = collectSetupPayload();
        const response = await fetch('/api/setup/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
            renderSetupStatus([result.error || 'Setup check failed'], true);
            return false;
        }

        const lines = [];
        let hasError = false;
        if (result.plugin && result.plugin.health) {
            const health = result.plugin.health;
            if (health.ok === false) {
                hasError = true;
                lines.push('Plugin health check failed: ' + health.message);
            } else if (health.ok === true) {
                lines.push('Plugin health check: OK');
            } else {
                lines.push('Plugin health check: skipped');
            }
        }
        if (result.smtp) {
            if (Array.isArray(result.smtp.issues) && result.smtp.issues.length) {
                hasError = true;
                lines.push('SMTP issues: ' + result.smtp.issues.join('; '));
            } else {
                lines.push('SMTP settings: valid');
            }
            if (result.smtp.connection && result.smtp.connection.ok === false) {
                hasError = true;
                lines.push('SMTP connection failed: ' + result.smtp.connection.message);
            } else if (result.smtp.connection && result.smtp.connection.ok === true) {
                lines.push('SMTP connection: OK');
            }
        }
        lines.push(result.ready_to_save ? 'Ready to save setup.' : 'Resolve issues before saving setup.');
        renderSetupStatus(lines, hasError);
        return !hasError;
    }

    async function saveSetup() {
        const payload = collectSetupPayload();
        const response = await fetch('/api/setup/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
            renderSetupStatus([result.error || 'Setup save failed'], true);
            return false;
        }

        localStorage.setItem('sharing_plugin_url', payload.sharing_plugin_url);
        localStorage.setItem('setup_completed', 'true');
        state.setup.completed = true;
        syncSharingState();
        renderSetupStatus(['Setup saved successfully. Sharing and email are ready.'], false);
        setSaveStatus('Setup saved');
        return true;
    }

    function openSetupModal(force) {
        if (!force && state.setup.completed) {
            return;
        }
        el.setupModal.classList.remove('hidden');
    }

    function closeSetupModal() {
        el.setupModal.classList.add('hidden');
    }

    function syncSharingState() {
        const configured = Boolean((localStorage.getItem('sharing_plugin_url') || '').trim());
        el.btnPublish.disabled = !configured;
        el.btnPublish.title = configured ? 'Publish read-only link' : 'Run setup to configure sharing first';
    }

    function setupEvents() {
        el.editor.addEventListener('input', function () {
            const revision = ensureEditableCurrent();
            if (!revision) {
                bindDocToUi();
                return;
            }

            setRevisionFromUi(revision);
            updateCharCount();
            schedulePreviewRender(false);
            queueSave();
        });

        el.templateSelect.addEventListener('change', function () {
            const revision = ensureEditableCurrent();
            if (!revision) {
                bindDocToUi();
                return;
            }
            setRevisionFromUi(revision);
            schedulePreviewRender(true);
            queueSave();
        });

        el.pageSize.addEventListener('change', function () {
            const revision = ensureEditableCurrent();
            if (!revision) {
                bindDocToUi();
                return;
            }
            setRevisionFromUi(revision);
            queueSave();
        });

        el.varInputs.forEach((input) => {
            input.addEventListener('input', function () {
                const revision = ensureEditableCurrent();
                if (!revision) {
                    bindDocToUi();
                    return;
                }
                setRevisionFromUi(revision);
                if (input.dataset.var === 'project_name') {
                    state.currentDoc.title = input.value || 'Untitled SOW';
                    el.docName.textContent = state.currentDoc.title;
                }
                schedulePreviewRender(false);
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

        el.btnNewRevision.addEventListener('click', function () {
            createRevisionFromCurrent('Manual new revision');
        });

        el.btnApplyClausePack.addEventListener('click', applyClausePack);
        el.btnChangeOrder.addEventListener('click', addChangeOrder);
        el.btnSignConsultant.addEventListener('click', function () { signRevision('consultant'); });
        el.btnSignClient.addEventListener('click', function () { signRevision('client'); });
        el.btnCompare.addEventListener('click', renderComparison);
        el.btnClearCompare.addEventListener('click', clearComparison);
        el.compareBase.addEventListener('change', renderComparison);
        el.compareTarget.addEventListener('change', renderComparison);
        el.languageSelect.addEventListener('change', function () {
            setLocale(el.languageSelect.value);
        });
        el.librarySearch.addEventListener('input', function () {
            scheduleLibraryRefresh();
        });
        el.libraryIndustry.addEventListener('change', function () {
            scheduleLibraryRefresh();
        });
        el.btnSignatureClear.addEventListener('click', resetSignatureCanvas);
        el.btnSignatureCancel.addEventListener('click', closeSignatureModal);
        el.btnSignatureAccept.addEventListener('click', acceptSignatureFromModal);
        el.signatureModal.addEventListener('click', function (event) {
            if (event.target === el.signatureModal) {
                closeSignatureModal();
            }
        });
        el.signatureCanvas.addEventListener('pointerdown', signaturePointerDown);
        el.signatureCanvas.addEventListener('pointermove', signaturePointerMove);
        el.signatureCanvas.addEventListener('pointerup', signaturePointerUp);
        el.signatureCanvas.addEventListener('pointercancel', signaturePointerUp);
        window.addEventListener('resize', function () {
            if (!el.signatureModal.classList.contains('hidden')) {
                resizeSignatureCanvas();
            }
        });

        el.btnSaveClient.addEventListener('click', function () {
            saveClient().catch(console.error);
        });
        el.btnSaveCustomClause.addEventListener('click', function () {
            saveCustomClause().catch(console.error);
        });
        el.btnInsertCustomClause.addEventListener('click', insertCustomClause);
        el.customClauseSelect.addEventListener('change', function () {
            onCustomClauseSelected().catch(console.error);
        });

        el.clientSelect.addEventListener('change', function () {
            onClientSelected().catch(console.error);
        });

        el.btnExport.addEventListener('click', openPrintWindow);
        el.btnExportMd.addEventListener('click', exportMarkdown);
        el.btnExportJson.addEventListener('click', exportJson);

        el.btnImport.addEventListener('click', function () {
            el.fileImport.value = '';
            el.fileImport.click();
        });

        el.fileImport.addEventListener('change', function () {
            const file = el.fileImport.files && el.fileImport.files[0];
            importFile(file);
        });

        el.btnPublish.addEventListener('click', function () {
            publishDocument().catch(function (err) {
                console.error(err);
                alert('Publish failed.');
            });
        });

        el.btnSettings.addEventListener('click', function () {
            openSetupModal(true);
        });
        el.btnSetupCheck.addEventListener('click', function () {
            runSetupCheck().catch(function (err) {
                console.error(err);
                renderSetupStatus(['Setup check failed unexpectedly.'], true);
            });
        });
        el.btnSetupSave.addEventListener('click', function () {
            saveSetup().then(function (ok) {
                if (ok) {
                    closeSetupModal();
                }
            }).catch(function (err) {
                console.error(err);
                renderSetupStatus(['Setup save failed unexpectedly.'], true);
            });
        });
        el.btnSetupSkip.addEventListener('click', function () {
            closeSetupModal();
            setSaveStatus('Setup skipped. You can configure Sharing later.');
        });
        el.setupModal.addEventListener('click', function (event) {
            if (event.target === el.setupModal) {
                closeSetupModal();
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !el.signatureModal.classList.contains('hidden')) {
                closeSignatureModal();
                return;
            }
            if (event.key === 'Escape' && !el.setupModal.classList.contains('hidden')) {
                closeSetupModal();
                return;
            }
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
        state.locale = (localStorage.getItem('ui_locale') || 'en').trim().toLowerCase();
        if (!SUPPORTED_LOCALES.includes(state.locale)) {
            state.locale = 'en';
        }
        state.db = await openDb();
        state.clients = await dbGetAll(CLIENT_STORE);
        state.customClauses = await dbGetAll(CLAUSE_STORE);
        state.currentDoc = await ensureSeedDocument();
        state.activeRevision = state.currentDoc.currentRevision;
        applyLocaleToUi();
        if (el.languageSelect) {
            el.languageSelect.value = state.locale;
        }
        clearComparison();
        bindDocToUi();
        renderDocList();
        setupEvents();
        syncSharingState();
        try {
            await loadSetupStatus();
        } catch (err) {
            console.error(err);
            renderSetupStatus(['Unable to load setup status. You can still configure manually.'], true);
        }
        const setupDone = (localStorage.getItem('setup_completed') || '').trim().toLowerCase() === 'true';
        if (!setupDone) {
            openSetupModal(true);
        }
        await loadLibraryTemplates();
        resizeSignatureCanvas();
        resetSignatureCanvas();
    }

    init().catch(function (err) {
        console.error(err);
        alert('Failed to initialize local storage.');
    });
})();
