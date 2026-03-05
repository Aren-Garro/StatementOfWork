
(function () {
    'use strict';

    const DB_NAME = 'sow_creator_db';
    const DB_VERSION = 4;
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

    const PIPELINE_STAGES = ['lead', 'proposal', 'contract', 'invoice', 'payment'];
    const PIPELINE_LABELS = {
        lead: 'Lead',
        proposal: 'Proposal',
        contract: 'Contract',
        invoice: 'Invoice',
        payment: 'Payment',
    };
    const AGING_BUCKETS = [
        { key: 'current', label: 'Current', min: -100000, max: 0 },
        { key: 'days_1_15', label: '1-15 days', min: 1, max: 15 },
        { key: 'days_16_30', label: '16-30 days', min: 16, max: 30 },
        { key: 'days_31_plus', label: '31+ days', min: 31, max: 100000 },
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
            btn_export: 'Print',
            btn_export_pdf: 'Download PDF',
            btn_export_md: 'Export .md',
            btn_export_json: 'Export .json',
            btn_import: 'Import',
            btn_help: 'Shortcuts',
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
            sidebar_filter_placeholder: 'Find panel (client, revisions, templates...)',
            btn_collapse_all: 'Collapse All',
            btn_expand_all: 'Expand All',
        },
        es: {
            btn_new: 'Nuevo',
            btn_new_revision: 'Nueva Revision',
            btn_save: 'Guardar',
            btn_change_order: 'Orden de Cambio',
            btn_sign_consultant: 'Firmar como Consultor',
            btn_sign_client: 'Firmar como Cliente',
            btn_export: 'Imprimir',
            btn_export_pdf: 'Descargar PDF',
            btn_export_md: 'Exportar .md',
            btn_export_json: 'Exportar .json',
            btn_import: 'Importar',
            btn_help: 'Atajos',
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
            sidebar_filter_placeholder: 'Buscar panel (cliente, revisiones, plantillas...)',
            btn_collapse_all: 'Contraer todo',
            btn_expand_all: 'Expandir todo',
        },
        fr: {
            btn_new: 'Nouveau',
            btn_new_revision: 'Nouvelle Revision',
            btn_save: 'Enregistrer',
            btn_change_order: 'Ordre de Changement',
            btn_sign_consultant: 'Signer comme Consultant',
            btn_sign_client: 'Signer comme Client',
            btn_export: 'Imprimer',
            btn_export_pdf: 'Telecharger PDF',
            btn_export_md: 'Exporter .md',
            btn_export_json: 'Exporter .json',
            btn_import: 'Importer',
            btn_help: 'Raccourcis',
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
            sidebar_filter_placeholder: 'Trouver un panneau (client, revisions, modeles...)',
            btn_collapse_all: 'Tout reduire',
            btn_expand_all: 'Tout ouvrir',
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
            authToken: '',
        },
        uiModal: {
            confirmResolver: null,
            emailResolver: null,
        },
        sidebar: {
            filter: '',
            collapsed: {},
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
        pipelineStage: document.getElementById('pipeline-stage'),
        btnPipelineAdvance: document.getElementById('btn-pipeline-advance'),
        pipelineCheckpoints: document.getElementById('pipeline-checkpoints'),
        pipelineRisk: document.getElementById('pipeline-risk'),
        changeTitle: document.getElementById('change-title'),
        changeScopeDelta: document.getElementById('change-scope-delta'),
        changeFeeImpact: document.getElementById('change-fee-impact'),
        changeMarginImpact: document.getElementById('change-margin-impact'),
        btnAddChangeRequest: document.getElementById('btn-add-change-request'),
        btnApproveChangeRequest: document.getElementById('btn-approve-change-request'),
        changeRequestList: document.getElementById('change-request-list'),
        invoiceNumber: document.getElementById('invoice-number'),
        invoiceAmount: document.getElementById('invoice-amount'),
        invoiceDueDate: document.getElementById('invoice-due-date'),
        btnAddInvoice: document.getElementById('btn-add-invoice'),
        btnRunReminders: document.getElementById('btn-run-reminders'),
        collectionsBuckets: document.getElementById('collections-buckets'),
        invoiceList: document.getElementById('invoice-list'),
        btnSendClientPack: document.getElementById('btn-send-client-pack'),
        clientPackStatus: document.getElementById('client-pack-status'),
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
        btnExportPdf: document.getElementById('btn-export-pdf'),
        btnExportMd: document.getElementById('btn-export-md'),
        btnExportJson: document.getElementById('btn-export-json'),
        btnImport: document.getElementById('btn-import'),
        btnHelp: document.getElementById('btn-help'),
        fileImport: document.getElementById('file-import'),
        btnPublish: document.getElementById('btn-publish'),
        btnSettings: document.getElementById('btn-settings'),
        toastStack: document.getElementById('toast-stack'),
        signatureModal: document.getElementById('signature-modal'),
        signatureSubtitle: document.getElementById('signature-subtitle'),
        signatureName: document.getElementById('signature-name'),
        signatureCanvas: document.getElementById('signature-canvas'),
        btnSignatureClear: document.getElementById('btn-signature-clear'),
        btnSignatureCancel: document.getElementById('btn-signature-cancel'),
        btnSignatureAccept: document.getElementById('btn-signature-accept'),
        setupModal: document.getElementById('setup-modal'),
        shortcutsModal: document.getElementById('shortcuts-modal'),
        btnShortcutsClose: document.getElementById('btn-shortcuts-close'),
        confirmModal: document.getElementById('confirm-modal'),
        confirmTitle: document.getElementById('confirm-title'),
        confirmMessage: document.getElementById('confirm-message'),
        btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
        btnConfirmAccept: document.getElementById('btn-confirm-accept'),
        emailModal: document.getElementById('email-modal'),
        emailTo: document.getElementById('email-to'),
        emailSubject: document.getElementById('email-subject'),
        emailMessage: document.getElementById('email-message'),
        emailAttachPdf: document.getElementById('email-attach-pdf'),
        btnEmailCancel: document.getElementById('btn-email-cancel'),
        btnEmailSend: document.getElementById('btn-email-send'),
        setupStatus: document.getElementById('setup-status'),
        setupPluginUrl: document.getElementById('setup-plugin-url'),
        setupPluginAuthToken: document.getElementById('setup-plugin-auth-token'),
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
        sidebarFilter: document.getElementById('sidebar-filter'),
        btnCollapseAll: document.getElementById('btn-collapse-all'),
        btnExpandAll: document.getElementById('btn-expand-all'),
        quickSave: document.getElementById('btn-quick-save'),
        quickPrint: document.getElementById('btn-quick-print'),
        quickPdf: document.getElementById('btn-quick-pdf'),
        quickShare: document.getElementById('btn-quick-share'),
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

    function notify(message, kind) {
        if (!el.toastStack) {
            return;
        }
        const toast = document.createElement('div');
        toast.className = 'toast ' + (kind || 'info');
        toast.textContent = String(message || '').trim();
        el.toastStack.appendChild(toast);
        window.setTimeout(function () {
            toast.remove();
        }, 3200);
    }

    function openShortcutsModal() {
        if (el.shortcutsModal) {
            el.shortcutsModal.classList.remove('hidden');
        }
    }

    function closeShortcutsModal() {
        if (el.shortcutsModal) {
            el.shortcutsModal.classList.add('hidden');
        }
    }

    async function copyText(text) {
        const value = String(text || '');
        if (!value) {
            return false;
        }
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch (_) {
            // Fallback to manual copy below.
        }
        const input = document.createElement('textarea');
        input.value = value;
        input.setAttribute('readonly', '');
        input.style.position = 'absolute';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand('copy');
        input.remove();
        return ok;
    }

    function normalizeRequestError(err, fallback) {
        if (err && typeof err === 'object' && err.name === 'AbortError') {
            return err;
        }
        const message = (err && err.message) ? err.message : (fallback || 'Request failed');
        const normalized = new Error(message);
        if (err && typeof err === 'object') {
            normalized.status = err.status;
            normalized.payload = err.payload;
            normalized.name = err.name || normalized.name;
        }
        return normalized;
    }

    async function requestJson(url, options) {
        const requestOptions = Object.assign({}, options || {});
        const timeoutMs = Number(requestOptions.timeoutMs || 10000);
        delete requestOptions.timeoutMs;

        let timeoutId = null;
        let timeoutController = null;
        if (!requestOptions.signal && timeoutMs > 0) {
            timeoutController = new AbortController();
            requestOptions.signal = timeoutController.signal;
            timeoutId = window.setTimeout(function () {
                timeoutController.abort();
            }, timeoutMs);
        }

        try {
            const response = await fetch(url, requestOptions);
            let payload = null;
            try {
                payload = await response.json();
            } catch (_) {
                payload = null;
            }
            if (!response.ok) {
                const err = new Error((payload && payload.error) || ('Request failed (' + response.status + ')'));
                err.status = response.status;
                err.payload = payload;
                throw err;
            }
            return payload || {};
        } catch (err) {
            throw normalizeRequestError(err);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    async function requestBlob(url, options) {
        const requestOptions = Object.assign({}, options || {});
        const timeoutMs = Number(requestOptions.timeoutMs || 15000);
        delete requestOptions.timeoutMs;
        let timeoutId = null;
        let timeoutController = null;
        if (!requestOptions.signal && timeoutMs > 0) {
            timeoutController = new AbortController();
            requestOptions.signal = timeoutController.signal;
            timeoutId = window.setTimeout(function () {
                timeoutController.abort();
            }, timeoutMs);
        }

        try {
            const response = await fetch(url, requestOptions);
            if (!response.ok) {
                let payload = null;
                try {
                    payload = await response.json();
                } catch (_) {
                    payload = null;
                }
                const err = new Error((payload && payload.error) || ('Request failed (' + response.status + ')'));
                err.status = response.status;
                err.payload = payload;
                throw err;
            }
            return response.blob();
        } catch (err) {
            throw normalizeRequestError(err);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    function closeConfirmModal(accepted) {
        if (el.confirmModal) {
            el.confirmModal.classList.add('hidden');
        }
        const resolver = state.uiModal.confirmResolver;
        state.uiModal.confirmResolver = null;
        if (resolver) {
            resolver(Boolean(accepted));
        }
    }

    function openConfirmModal(config) {
        if (!el.confirmModal) {
            return Promise.resolve(true);
        }
        const cfg = config || {};
        el.confirmTitle.textContent = cfg.title || 'Confirm Action';
        el.confirmMessage.textContent = cfg.message || 'Are you sure you want to continue?';
        el.btnConfirmAccept.textContent = cfg.confirmLabel || 'Continue';
        el.btnConfirmCancel.textContent = cfg.cancelLabel || 'Cancel';
        el.confirmModal.classList.remove('hidden');
        return new Promise((resolve) => {
            state.uiModal.confirmResolver = resolve;
        });
    }

    function closeEmailModal(result) {
        if (el.emailModal) {
            el.emailModal.classList.add('hidden');
        }
        const resolver = state.uiModal.emailResolver;
        state.uiModal.emailResolver = null;
        if (resolver) {
            resolver(result || null);
        }
    }

    function openEmailModal(defaults) {
        if (!el.emailModal) {
            return Promise.resolve(null);
        }
        const cfg = defaults || {};
        el.emailTo.value = cfg.toEmail || '';
        el.emailSubject.value = cfg.subject || '';
        el.emailMessage.value = cfg.message || '';
        el.emailAttachPdf.checked = cfg.attachPdf !== false;
        el.emailModal.classList.remove('hidden');
        return new Promise((resolve) => {
            state.uiModal.emailResolver = resolve;
        });
    }

    function applyLocaleToUi() {
        el.btnNew.textContent = t('btn_new');
        el.btnNewRevision.textContent = t('btn_new_revision');
        el.btnSave.textContent = t('btn_save');
        el.btnChangeOrder.textContent = t('btn_change_order');
        el.btnSignConsultant.textContent = t('btn_sign_consultant');
        el.btnSignClient.textContent = t('btn_sign_client');
        el.btnExport.textContent = t('btn_export');
        el.btnExportPdf.textContent = t('btn_export_pdf');
        el.btnExportMd.textContent = t('btn_export_md');
        el.btnExportJson.textContent = t('btn_export_json');
        el.btnImport.textContent = t('btn_import');
        if (el.btnHelp) {
            el.btnHelp.textContent = t('btn_help');
        }
        el.btnSettings.textContent = t('btn_settings');
        el.btnPublish.textContent = t('btn_publish');
        el.librarySearch.placeholder = t('library_search_placeholder');
        if (el.sidebarFilter) {
            el.sidebarFilter.placeholder = t('sidebar_filter_placeholder');
        }
        if (el.btnCollapseAll) {
            el.btnCollapseAll.textContent = t('btn_collapse_all');
        }
        if (el.btnExpandAll) {
            el.btnExpandAll.textContent = t('btn_expand_all');
        }
        if (el.quickSave) {
            el.quickSave.textContent = t('btn_save');
        }
        if (el.quickPrint) {
            el.quickPrint.textContent = t('btn_export');
        }
        if (el.quickPdf) {
            el.quickPdf.textContent = t('btn_export_pdf');
        }
        if (el.quickShare) {
            el.quickShare.textContent = t('btn_publish');
        }
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

    function defaultPipeline() {
        return {
            stage: 'lead',
            checkpoints: {
                proposalReady: false,
                contractSigned: false,
                invoiceSent: false,
                paymentReceived: false,
            },
        };
    }

    function defaultContractVersions() {
        return [
            {
                version: 1,
                createdAt: nowIso(),
                reason: 'Initial engagement terms',
            },
        ];
    }

    function defaultReminderRules() {
        return [
            { key: 'pre_due', label: '2 days before due date', offsetDays: -2, enabled: true },
            { key: 'due_day', label: 'On due date', offsetDays: 0, enabled: true },
            { key: 'overdue_7', label: '7 days overdue', offsetDays: 7, enabled: true },
        ];
    }

    function normalizeBusinessFields(doc) {
        if (!doc.pipeline || typeof doc.pipeline !== 'object') {
            doc.pipeline = defaultPipeline();
        }
        if (!PIPELINE_STAGES.includes(doc.pipeline.stage)) {
            doc.pipeline.stage = 'lead';
        }
        if (!doc.pipeline.checkpoints || typeof doc.pipeline.checkpoints !== 'object') {
            doc.pipeline.checkpoints = defaultPipeline().checkpoints;
        }
        doc.pipeline.checkpoints.proposalReady = Boolean(doc.pipeline.checkpoints.proposalReady);
        doc.pipeline.checkpoints.contractSigned = Boolean(doc.pipeline.checkpoints.contractSigned);
        doc.pipeline.checkpoints.invoiceSent = Boolean(doc.pipeline.checkpoints.invoiceSent);
        doc.pipeline.checkpoints.paymentReceived = Boolean(doc.pipeline.checkpoints.paymentReceived);

        if (!Array.isArray(doc.changeRequests)) {
            doc.changeRequests = [];
        }
        if (!Array.isArray(doc.contractVersions) || doc.contractVersions.length === 0) {
            doc.contractVersions = defaultContractVersions();
        }
        if (!Array.isArray(doc.invoices)) {
            doc.invoices = [];
        }
        if (!Array.isArray(doc.reminderRules) || doc.reminderRules.length === 0) {
            doc.reminderRules = defaultReminderRules();
        }
        if (!doc.clientPack || typeof doc.clientPack !== 'object') {
            doc.clientPack = {
                proposalSentAt: null,
                contractSentAt: null,
                firstInvoiceSentAt: null,
            };
        }
    }

    function normalizeAndValidateCurrentDoc(doc) {
        if (!doc || typeof doc !== 'object') {
            return false;
        }
        if (!Array.isArray(doc.revisions) || doc.revisions.length === 0) {
            return false;
        }
        normalizeBusinessFields(doc);
        if (!doc.currentRevision) {
            doc.currentRevision = doc.revisions[doc.revisions.length - 1].revision;
        }
        return true;
    }

    function validImportedClient(client) {
        if (!client || typeof client !== 'object') {
            return false;
        }
        const id = String(client.id || '').trim();
        const legalName = String(client.legalName || '').trim();
        return Boolean(id && legalName);
    }

    function validImportedClause(clause) {
        if (!clause || typeof clause !== 'object') {
            return false;
        }
        const id = String(clause.id || '').trim();
        const name = String(clause.name || '').trim();
        const body = String(clause.body || '').trim();
        return Boolean(id && name && body);
    }

    function validateStageTransition(doc, fromStage, toStage) {
        const fromIndex = PIPELINE_STAGES.indexOf(fromStage);
        const toIndex = PIPELINE_STAGES.indexOf(toStage);
        if (fromIndex < 0 || toIndex < 0) {
            return { ok: false, reason: 'Invalid pipeline stage.' };
        }
        if (toIndex <= fromIndex) {
            return { ok: true };
        }
        const checkpoints = doc.pipeline.checkpoints || {};
        const blockers = [];
        if (!checkpoints.proposalReady) {
            blockers.push('proposal');
        }
        if (toIndex >= PIPELINE_STAGES.indexOf('contract') && !checkpoints.contractSigned) {
            blockers.push('contract');
        }
        if (toIndex >= PIPELINE_STAGES.indexOf('invoice') && !checkpoints.invoiceSent) {
            blockers.push('invoice');
        }
        if (toIndex >= PIPELINE_STAGES.indexOf('payment') && !checkpoints.paymentReceived) {
            blockers.push('payment');
        }
        if (blockers.length) {
            return { ok: false, reason: 'Missing required checkpoint(s): ' + blockers.join(', ') + '.' };
        }
        return { ok: true };
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
            const payload = await requestJson(
                '/api/templates/library?q=' + q + '&industry=' + industry + '&limit=40&offset=0',
                { signal: controller.signal, timeoutMs: 8000 }
            );
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
            normalizeBusinessFields(doc);
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

        const migrated = {
            id: doc.id || uid('doc'),
            title: doc.title || revision.variables.project_name || 'Untitled SOW',
            clientId: doc.clientId || '',
            clausePack: 'US_BASE',
            currentRevision: 1,
            revisions: [revision],
            createdAt: doc.createdAt || nowIso(),
            updatedAt: doc.updatedAt || nowIso(),
        };
        normalizeBusinessFields(migrated);
        return migrated;
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
        normalizeBusinessFields(seed);

        await dbPut(DOC_STORE, seed);
        return seed;
    }

    function getActiveRevision() {
        if (!normalizeAndValidateCurrentDoc(state.currentDoc)) {
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

        requestJson('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                markdown: markdown,
                variables: variables,
                template: template,
            }),
            signal: controller.signal,
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
            notify('Clause name is required.', 'error');
            return;
        }
        if (!body) {
            notify('Clause body is required.', 'error');
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
            notify('Select or draft a custom clause to insert.', 'error');
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

    function pipelineBlockers(doc) {
        const revision = getActiveRevision();
        if (!revision || !doc) {
            return [];
        }
        const checkpoints = doc.pipeline.checkpoints || {};
        return [
            {
                key: 'proposalReady',
                label: 'Proposal prepared and reviewed',
                done: Boolean(checkpoints.proposalReady),
            },
            {
                key: 'contractSigned',
                label: 'Contract signed',
                done: Boolean(checkpoints.contractSigned),
            },
            {
                key: 'invoiceSent',
                label: 'Initial invoice sent',
                done: Boolean(checkpoints.invoiceSent),
            },
            {
                key: 'paymentReceived',
                label: 'Initial payment received',
                done: Boolean(checkpoints.paymentReceived),
            },
        ];
    }

    function renderPipelinePanel() {
        const doc = state.currentDoc;
        if (!doc || !el.pipelineStage) {
            return;
        }
        normalizeBusinessFields(doc);
        el.pipelineStage.value = doc.pipeline.stage;
        const blockers = pipelineBlockers(doc);
        el.pipelineCheckpoints.innerHTML = '';
        blockers.forEach((item) => {
            const li = document.createElement('li');
            li.className = item.done ? 'done' : 'todo';
            li.textContent = (item.done ? 'OK: ' : 'Missing: ') + item.label;
            el.pipelineCheckpoints.appendChild(li);
        });
        const blocked = blockers.some((item) => !item.done);
        el.pipelineRisk.textContent = blocked
            ? 'At-risk: unresolved checkpoint(s) are slowing conversion to paid work.'
            : 'Healthy: all checkpoints clear.';
    }

    function advancePipelineStage() {
        const doc = state.currentDoc;
        if (!doc) {
            return;
        }
        const stageFromUi = el.pipelineStage.value;
        const currentIndex = PIPELINE_STAGES.indexOf(doc.pipeline.stage);
        const desiredIndex = PIPELINE_STAGES.indexOf(stageFromUi);
        if (desiredIndex < 0) {
            return;
        }

        const decision = validateStageTransition(doc, doc.pipeline.stage, stageFromUi);
        if (!decision.ok) {
            notify(decision.reason || 'Cannot advance stage yet.', 'error');
            renderPipelinePanel();
            return;
        }
        doc.pipeline.stage = stageFromUi;
        doc.updatedAt = nowIso();
        renderPipelinePanel();
        queueSave();
    }

    function renderChangeRequestList() {
        if (!state.currentDoc || !el.changeRequestList) {
            return;
        }
        const requests = state.currentDoc.changeRequests.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        el.changeRequestList.innerHTML = '';
        if (requests.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No change requests yet.';
            el.changeRequestList.appendChild(li);
            return;
        }
        requests.forEach((item) => {
            const li = document.createElement('li');
            li.innerHTML = '<strong>' + escapeHtml(item.title) + '</strong>'
                + ' [' + escapeHtml(item.status || 'pending') + ']'
                + '<br><span class="revision-meta">Fee: $' + Number(item.feeImpact || 0).toFixed(2)
                + ' | Margin: ' + Number(item.marginImpact || 0).toFixed(1) + '%</span>';
            el.changeRequestList.appendChild(li);
        });
    }

    function addChangeRequestRecord() {
        const doc = state.currentDoc;
        if (!doc) {
            return;
        }
        const title = (el.changeTitle.value || '').trim();
        const scopeDelta = (el.changeScopeDelta.value || '').trim();
        const feeImpact = Number(el.changeFeeImpact.value || 0);
        const marginImpact = Number(el.changeMarginImpact.value || 0);
        if (!title || !scopeDelta) {
            notify('Change request title and scope delta are required.', 'error');
            return;
        }
        doc.changeRequests.push({
            id: uid('cr'),
            title: title,
            scopeDelta: scopeDelta,
            feeImpact: Number.isFinite(feeImpact) ? feeImpact : 0,
            marginImpact: Number.isFinite(marginImpact) ? marginImpact : 0,
            status: 'pending',
            createdAt: nowIso(),
        });
        el.changeTitle.value = '';
        el.changeScopeDelta.value = '';
        el.changeFeeImpact.value = '';
        el.changeMarginImpact.value = '';
        renderChangeRequestList();
        queueSave();
    }

    function approveLatestChangeRequest() {
        const doc = state.currentDoc;
        if (!doc || !doc.changeRequests.length) {
            notify('No pending change request to approve.', 'error');
            return;
        }
        const pending = doc.changeRequests.find((item) => item.status === 'pending');
        if (!pending) {
            notify('All change requests are already resolved.', 'error');
            return;
        }
        pending.status = 'approved';
        pending.approvedAt = nowIso();
        const latestVersion = doc.contractVersions.reduce((max, item) => Math.max(max, Number(item.version || 0)), 0) || 1;
        doc.contractVersions.push({
            version: latestVersion + 1,
            createdAt: nowIso(),
            reason: 'Approved change request: ' + pending.title,
            changeRequestId: pending.id,
        });
        const revision = ensureEditableCurrent();
        if (revision) {
            const note = '\n## Approved Change Request\n'
                + '- Title: ' + pending.title + '\n'
                + '- Scope Delta: ' + pending.scopeDelta + '\n'
                + '- Fee Impact: $' + Number(pending.feeImpact || 0).toFixed(2) + '\n'
                + '- Margin Impact: ' + Number(pending.marginImpact || 0).toFixed(1) + '%\n';
            el.editor.value += note;
            setRevisionFromUi(revision);
            renderPreview();
        }
        renderChangeRequestList();
        queueSave();
    }

    function daysPastDue(dueDate) {
        if (!dueDate) {
            return 0;
        }
        const due = new Date(dueDate + 'T00:00:00');
        const now = new Date(today() + 'T00:00:00');
        const diffMs = now.getTime() - due.getTime();
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    function computeAging(doc) {
        const totals = {
            current: 0,
            days_1_15: 0,
            days_16_30: 0,
            days_31_plus: 0,
        };
        doc.invoices.forEach((invoice) => {
            if (invoice.status === 'paid') {
                return;
            }
            const delta = daysPastDue(invoice.dueDate);
            const amount = Number(invoice.amount || 0);
            AGING_BUCKETS.forEach((bucket) => {
                if (delta >= bucket.min && delta <= bucket.max) {
                    totals[bucket.key] += amount;
                }
            });
        });
        return totals;
    }

    function renderCollectionsPanel() {
        const doc = state.currentDoc;
        if (!doc || !el.collectionsBuckets || !el.invoiceList) {
            return;
        }
        const hasOpenInvoices = doc.invoices.some((invoice) => invoice.status !== 'paid');
        if (doc.invoices.length > 0 && !hasOpenInvoices) {
            doc.pipeline.checkpoints.paymentReceived = true;
            if (PIPELINE_STAGES.indexOf(doc.pipeline.stage) < PIPELINE_STAGES.indexOf('payment')) {
                doc.pipeline.stage = 'payment';
            }
        } else if (hasOpenInvoices) {
            doc.pipeline.checkpoints.paymentReceived = false;
        }
        const aging = computeAging(doc);
        el.collectionsBuckets.innerHTML = '';
        AGING_BUCKETS.forEach((bucket) => {
            const card = document.createElement('div');
            card.className = 'bucket-card';
            card.innerHTML = '<strong>$' + Number(aging[bucket.key] || 0).toFixed(2)
                + '</strong><span>' + bucket.label + '</span>';
            el.collectionsBuckets.appendChild(card);
        });

        const invoices = doc.invoices.slice().sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
        el.invoiceList.innerHTML = '';
        if (invoices.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No invoices tracked yet.';
            el.invoiceList.appendChild(li);
            return;
        }
        invoices.forEach((invoice) => {
            const overdue = daysPastDue(invoice.dueDate);
            const overdueText = overdue > 0 ? ' | ' + overdue + 'd overdue' : '';
            const li = document.createElement('li');
            li.innerHTML = '<strong>' + escapeHtml(invoice.number) + '</strong> - $'
                + Number(invoice.amount || 0).toFixed(2)
                + '<br><span class="revision-meta">Due ' + escapeHtml(invoice.dueDate || 'n/a')
                + ' | Status: ' + escapeHtml(invoice.status || 'open') + overdueText + '</span>';
            el.invoiceList.appendChild(li);
        });
    }

    function addInvoiceRecord() {
        const doc = state.currentDoc;
        if (!doc) {
            return;
        }
        const number = (el.invoiceNumber.value || '').trim();
        const amount = Number(el.invoiceAmount.value || 0);
        const dueDate = (el.invoiceDueDate.value || '').trim();
        if (!number || !dueDate || !Number.isFinite(amount) || amount <= 0) {
            notify('Invoice number, due date, and positive amount are required.', 'error');
            return;
        }
        doc.invoices.push({
            id: uid('inv'),
            number: number,
            amount: amount,
            dueDate: dueDate,
            status: 'open',
            createdAt: nowIso(),
        });
        doc.pipeline.checkpoints.invoiceSent = true;
        if (PIPELINE_STAGES.indexOf(doc.pipeline.stage) < PIPELINE_STAGES.indexOf('invoice')) {
            doc.pipeline.stage = 'invoice';
        }
        el.invoiceNumber.value = '';
        el.invoiceAmount.value = '';
        el.invoiceDueDate.value = '';
        renderCollectionsPanel();
        renderPipelinePanel();
        queueSave();
    }

    async function runReminderCheck() {
        const doc = state.currentDoc;
        if (!doc) {
            return;
        }
        const openInvoices = doc.invoices.filter((invoice) => invoice.status !== 'paid');
        if (openInvoices.length === 0) {
            notify('No open invoices for reminder run.', 'success');
            return;
        }
        let reminderHits = 0;
        openInvoices.forEach((invoice) => {
            const overdueDays = daysPastDue(invoice.dueDate);
            doc.reminderRules.forEach((rule) => {
                if (rule.enabled && overdueDays === rule.offsetDays) {
                    reminderHits += 1;
                }
            });
        });
        notify(
            reminderHits > 0
                ? 'Reminder check complete: ' + reminderHits + ' reminder(s) due now.'
                : 'Reminder check complete: no reminders due today.',
            'success'
        );

        try {
            const payload = await requestJson('/api/integrations/billing/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'stripe',
                    invoices: openInvoices.map((invoice) => ({
                        number: invoice.number,
                        amount: invoice.amount,
                        due_date: invoice.dueDate,
                        status: invoice.status,
                    })),
                }),
            });
            notify(
                'Billing sync: $' + Number(payload.total_outstanding || 0).toFixed(2)
                + ' outstanding across ' + Number(payload.outstanding_count || 0) + ' invoice(s).',
                'success'
            );
        } catch (err) {
            console.error(err);
        }
    }

    function renderClientPackPanel() {
        const doc = state.currentDoc;
        if (!doc || !el.clientPackStatus) {
            return;
        }
        const pack = doc.clientPack;
        const items = [
            { label: 'Proposal sent', value: pack.proposalSentAt },
            { label: 'Contract sent', value: pack.contractSentAt },
            { label: 'First invoice sent', value: pack.firstInvoiceSentAt },
        ];
        el.clientPackStatus.innerHTML = '';
        items.forEach((item) => {
            const li = document.createElement('li');
            li.className = item.value ? 'done' : 'todo';
            li.textContent = item.value
                ? 'OK: ' + item.label + ' (' + new Date(item.value).toLocaleDateString() + ')'
                : 'Missing: ' + item.label;
            el.clientPackStatus.appendChild(li);
        });
    }

    function sendClientPack() {
        const doc = state.currentDoc;
        if (!doc) {
            return;
        }
        const revision = getActiveRevision();
        const hasClient = Boolean((el.clientEmail.value || '').trim());
        if (!revision || !hasClient) {
            notify('Client email and active draft are required to send client pack.', 'error');
            return;
        }
        const now = nowIso();
        doc.clientPack.proposalSentAt = doc.clientPack.proposalSentAt || now;
        doc.clientPack.contractSentAt = doc.clientPack.contractSentAt || now;
        doc.clientPack.firstInvoiceSentAt = doc.clientPack.firstInvoiceSentAt || now;
        doc.pipeline.checkpoints.proposalReady = true;
        doc.pipeline.checkpoints.contractSigned = revision.status === 'signed';
        if (doc.invoices.length > 0) {
            doc.pipeline.checkpoints.invoiceSent = true;
        }
        renderClientPackPanel();
        renderPipelinePanel();
        queueSave();
        notify('Client pack staged: proposal, contract, and first-invoice steps are tracked.', 'success');
    }

    function bindDocToUi() {
        if (!normalizeAndValidateCurrentDoc(state.currentDoc)) {
            notify('Current document is invalid. Try importing from a valid export package.', 'error');
            return;
        }
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
        renderPipelinePanel();
        renderChangeRequestList();
        renderCollectionsPanel();
        renderClientPackPanel();
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
        if (state.currentDoc && state.currentDoc.pipeline && state.currentDoc.pipeline.checkpoints) {
            state.currentDoc.pipeline.checkpoints.proposalReady = Boolean(revision.markdown.trim());
            if (revision.status === 'signed') {
                state.currentDoc.pipeline.checkpoints.contractSigned = true;
            }
        }
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
            notify('Switched to the current editable revision.', 'success');
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
        if (!normalizeAndValidateCurrentDoc(state.currentDoc)) {
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
            notify('You can only sign the current revision.', 'error');
            return;
        }

        if (revision.status === 'signed') {
            notify('This revision is already fully signed. Create a new revision to change it.', 'error');
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
            notify('Draw a signature before accepting.', 'error');
            return;
        }

        const signerName = (el.signatureName.value || '').trim();
        if (!signerName) {
            notify('Signer name is required.', 'error');
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
        if (state.currentDoc && state.currentDoc.pipeline && hasConsultant && hasClient) {
            state.currentDoc.pipeline.checkpoints.contractSigned = true;
            if (PIPELINE_STAGES.indexOf(state.currentDoc.pipeline.stage) < PIPELINE_STAGES.indexOf('contract')) {
                state.currentDoc.pipeline.stage = 'contract';
            }
        }

        closeSignatureModal();
        renderPreview();
        syncStatusUi(revision);
        renderPipelinePanel();
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
            notify('Client legal name is required.', 'error');
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

    async function downloadPdfExport() {
        const revision = getActiveRevision();
        if (!revision) {
            return;
        }
        let blob = null;
        try {
            blob = await requestBlob('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                markdown: revision.markdown || '',
                variables: collectVariables(),
                template: el.templateSelect.value || 'modern',
                page_size: el.pageSize.value || 'Letter',
            }),
            });
        } catch (err) {
            notify(err.message || 'PDF export failed.', 'error');
            return;
        }
        const filename = (state.currentDoc.title || 'sow').replace(/\s+/g, '_') + '.pdf';
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
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
                    notify('Import complete: 1 document imported from markdown.', 'success');
                    return;
                }

                const parsed = JSON.parse(text);

                if (Array.isArray(parsed.packages)) {
                    let firstDoc = null;
                    for (let i = 0; i < parsed.packages.length; i += 1) {
                        const pkg = parsed.packages[i] || {};
                        const migrated = migrateDoc(pkg.doc || {});
                        if (migrated && migrated.id && normalizeAndValidateCurrentDoc(migrated)) {
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
                            if (validImportedClient(client)) {
                                await dbPut(CLIENT_STORE, client);
                                importSummary.clientsImported += 1;
                            } else {
                                importSummary.errors.push(`Package ${i + 1}: skipped invalid client at index ${j}`);
                            }
                        }
                        const pkgClauses = Array.isArray(pkg.customClauses) ? pkg.customClauses : [];
                        for (let j = 0; j < pkgClauses.length; j += 1) {
                            const clause = pkgClauses[j];
                            if (validImportedClause(clause)) {
                                await dbPut(CLAUSE_STORE, clause);
                            } else {
                                importSummary.errors.push(`Package ${i + 1}: skipped invalid clause at index ${j}`);
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
                    notify(
                        `Import complete: ${importSummary.docsImported} docs, ${importSummary.clientsImported} clients.` +
                        (importSummary.errors.length ? ` Issues: ${importSummary.errors.join('; ')}` : ''),
                        importSummary.errors.length ? 'error' : 'success'
                    );
                    return;
                }

                const incomingDoc = migrateDoc(parsed.doc || parsed);
                if (!normalizeAndValidateCurrentDoc(incomingDoc)) {
                    notify('Import failed: document payload is incomplete or invalid.', 'error');
                    return;
                }
                await dbPut(DOC_STORE, incomingDoc);
                importSummary.docsImported += 1;

                if (Array.isArray(parsed.clients)) {
                    for (let i = 0; i < parsed.clients.length; i += 1) {
                        const client = parsed.clients[i];
                        if (validImportedClient(client)) {
                            await dbPut(CLIENT_STORE, client);
                            importSummary.clientsImported += 1;
                        } else {
                            importSummary.errors.push(`Skipped invalid client at index ${i}`);
                        }
                    }
                }
                if (Array.isArray(parsed.customClauses)) {
                    for (let i = 0; i < parsed.customClauses.length; i += 1) {
                        const clause = parsed.customClauses[i];
                        if (validImportedClause(clause)) {
                            await dbPut(CLAUSE_STORE, clause);
                        } else {
                            importSummary.errors.push(`Skipped invalid clause at index ${i}`);
                        }
                    }
                }

                state.clients = await dbGetAll(CLIENT_STORE);
                state.customClauses = await dbGetAll(CLAUSE_STORE);
                state.currentDoc = incomingDoc;
                state.activeRevision = incomingDoc.currentRevision;
                bindDocToUi();
                renderDocList();
                notify(
                    `Import complete: ${importSummary.docsImported} docs, ${importSummary.clientsImported} clients.` +
                    (importSummary.errors.length ? ` Issues: ${importSummary.errors.join('; ')}` : ''),
                    importSummary.errors.length ? 'error' : 'success'
                );
            } catch (err) {
                console.error(err);
                notify('Import failed. Check file format.', 'error');
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
        normalizeBusinessFields(doc);

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
            downloadPdfExport().catch(function (err) {
                console.error(err);
                notify('Pop-up blocked and PDF fallback failed.', 'error');
            });
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
            notify('Run setup first to configure sharing.', 'error');
            return;
        }

        const revision = getActiveRevision();
        if (revision && revision.status !== 'signed') {
            const continueUnsigned = await openConfirmModal({
                title: 'Publish Unsigned Draft?',
                message: 'This revision is unsigned. Publish anyway as an unsigned read-only draft?',
                confirmLabel: 'Publish Draft',
            });
            if (!continueUnsigned) {
                return;
            }
        }
        let payload = null;
        try {
            payload = await requestJson(baseUrl.replace(/\/$/, '') + '/v1/publish', {
            method: 'POST',
            headers: withMutationAuthHeaders({ 'Content-Type': 'application/json' }),
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
        } catch (err) {
            notify(err.message || 'Publish failed', 'error');
            return;
        }

        const copied = await copyText(payload.view_url);
        notify(
            copied
                ? 'Published. Link copied to clipboard (30-day expiry).'
                : 'Published. Copy the link from your browser address bar or metadata view.',
            'success'
        );
        const shouldSendEmail = await openConfirmModal({
            title: 'Send Client Email?',
            message: 'Published successfully. Send this SOW by email now?',
            confirmLabel: 'Open Email Form',
        });
        if (shouldSendEmail) {
            await promptAndSendPublishedEmail(baseUrl.replace(/\/$/, ''), payload).catch(function (err) {
                console.error(err);
                notify('Email send failed.', 'error');
            });
        }
    }

    async function promptAndSendPublishedEmail(basePluginUrl, publishPayload) {
        const defaultRecipient = (el.clientEmail.value || '').trim();
        const defaultSubject = 'Statement of Work: ' + (collectVariables().project_name || 'Statement of Work');
        const formResult = await openEmailModal({
            toEmail: defaultRecipient,
            subject: defaultSubject,
            message: '',
            attachPdf: true,
        });
        if (!formResult) {
            return;
        }
        const normalizedEmail = formResult.toEmail.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
            notify('Please enter a valid recipient email.', 'error');
            return;
        }

        let payload = null;
        try {
            payload = await requestJson(
            basePluginUrl + '/v1/p/' + encodeURIComponent(publishPayload.publish_id) + '/email',
            {
                method: 'POST',
                headers: withMutationAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    to_email: normalizedEmail,
                    subject: formResult.subject.trim() || defaultSubject,
                    message: formResult.message.trim(),
                    attach_pdf: Boolean(formResult.attachPdf),
                }),
            },
            );
        } catch (err) {
            notify(err.message || 'Email send failed', 'error');
            return;
        }
        notify('Email sent to ' + payload.to_email + (payload.attached_pdf ? ' with PDF attachment.' : '.'), 'success');
    }

    function buildDefaultPluginUrl() {
        return window.location.origin.replace(/\/$/, '') + '/plugin';
    }

    function getPluginAuthToken() {
        if (el.setupPluginAuthToken && el.setupPluginAuthToken.value.trim()) {
            return el.setupPluginAuthToken.value.trim();
        }
        return (localStorage.getItem('plugin_auth_token') || '').trim();
    }

    function withMutationAuthHeaders(baseHeaders) {
        const headers = Object.assign({}, baseHeaders || {});
        const token = getPluginAuthToken();
        if (token) {
            headers['X-Plugin-Auth'] = token;
        }
        return headers;
    }

    function collectSetupPayload() {
        return {
            sharing_plugin_url: (el.setupPluginUrl.value || '').trim() || buildDefaultPluginUrl(),
            check_plugin_health: Boolean(el.setupCheckPluginHealth.checked),
            check_smtp_connection: Boolean(el.setupCheckSmtpConnection.checked),
            auth: {
                plugin_auth_token: getPluginAuthToken(),
            },
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
        const payload = await requestJson('/api/setup/status', { timeoutMs: 8000 });
        state.setup.statusLoaded = true;
        state.setup.completed = Boolean(payload.setup_completed);

        const savedPlugin = (localStorage.getItem('sharing_plugin_url') || '').trim();
        el.setupPluginUrl.value = savedPlugin || payload.sharing.configured_plugin_url || payload.sharing.default_plugin_url;
        const savedAuthToken = (localStorage.getItem('plugin_auth_token') || '').trim();
        if (el.setupPluginAuthToken && savedAuthToken && !el.setupPluginAuthToken.value) {
            el.setupPluginAuthToken.value = savedAuthToken;
        }
        state.setup.authToken = savedAuthToken;
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
            const statusLines = ['Setup status loaded. Run "Check Setup" to validate connectivity.'];
            if (payload.auth && payload.auth.token_configured && !savedAuthToken) {
                statusLines.push('Server requires plugin auth token for mutation endpoints.');
            }
            renderSetupStatus(statusLines, false);
        }
    }

    async function runSetupCheck() {
        const payload = collectSetupPayload();
        let result = null;
        try {
            result = await requestJson('/api/setup/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeoutMs: 12000,
            });
        } catch (err) {
            renderSetupStatus([err.message || 'Setup check failed'], true);
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
        if (result.auth) {
            if (result.auth.valid) {
                lines.push('Mutation auth: ready');
            } else {
                hasError = true;
                lines.push('Mutation auth: token required for non-local access');
            }
        }
        lines.push(result.ready_to_save ? 'Ready to save setup.' : 'Resolve issues before saving setup.');
        renderSetupStatus(lines, hasError);
        return !hasError;
    }

    async function saveSetup() {
        const payload = collectSetupPayload();
        let result = null;
        try {
            result = await requestJson('/api/setup/save', {
            method: 'POST',
            headers: withMutationAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload),
            timeoutMs: 12000,
            });
        } catch (err) {
            renderSetupStatus([err.message || 'Setup save failed'], true);
            return false;
        }

        localStorage.setItem('sharing_plugin_url', payload.sharing_plugin_url);
        if (payload.auth && payload.auth.plugin_auth_token) {
            localStorage.setItem('plugin_auth_token', payload.auth.plugin_auth_token);
            state.setup.authToken = payload.auth.plugin_auth_token;
        } else {
            localStorage.removeItem('plugin_auth_token');
            state.setup.authToken = '';
        }
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

    function getSidebarSections() {
        return Array.from(document.querySelectorAll('.sidebar .sidebar-section'));
    }

    function sectionStorageKey(sectionId) {
        return 'sidebar_section_' + sectionId;
    }

    function setSectionCollapsed(section, collapsed) {
        const sectionId = section.dataset.sectionId;
        section.classList.toggle('collapsed', Boolean(collapsed));
        const toggle = section.querySelector('.section-toggle');
        if (toggle) {
            toggle.textContent = collapsed ? '+' : '-';
            toggle.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
        }
        if (sectionId) {
            state.sidebar.collapsed[sectionId] = Boolean(collapsed);
            localStorage.setItem(sectionStorageKey(sectionId), collapsed ? '1' : '0');
        }
    }

    function setAllSectionsCollapsed(collapsed) {
        getSidebarSections().forEach((section) => {
            setSectionCollapsed(section, collapsed);
        });
    }

    function applySidebarFilter(query) {
        const normalized = (query || '').trim().toLowerCase();
        state.sidebar.filter = normalized;
        getSidebarSections().forEach((section) => {
            const title = String(section.dataset.sectionTitle || '').toLowerCase();
            const hide = normalized && !title.includes(normalized);
            section.classList.toggle('filtered-out', hide);
        });
    }

    function initSidebarPanels() {
        const sections = Array.from(document.querySelectorAll('.sidebar > section'));
        sections.forEach((section, index) => {
            section.classList.add('sidebar-section');
            if (!section.dataset.sectionId) {
                section.dataset.sectionId = 'section_' + (index + 1);
            }

            const heading = section.querySelector('h2');
            if (!heading) {
                return;
            }
            const title = heading.textContent.trim();
            section.dataset.sectionTitle = title;

            const body = document.createElement('div');
            body.className = 'section-body';

            while (heading.nextSibling) {
                body.appendChild(heading.nextSibling);
            }

            const header = document.createElement('div');
            header.className = 'section-header';
            heading.parentNode.insertBefore(header, heading);
            header.appendChild(heading);

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'section-toggle';
            toggle.textContent = '-';
            toggle.setAttribute('aria-label', 'Collapse panel');
            header.appendChild(toggle);
            toggle.addEventListener('click', function () {
                const nextCollapsed = !section.classList.contains('collapsed');
                setSectionCollapsed(section, nextCollapsed);
            });

            section.appendChild(body);

            const persisted = localStorage.getItem(sectionStorageKey(section.dataset.sectionId));
            if (persisted === '1') {
                setSectionCollapsed(section, true);
            }
        });

        if (el.sidebarFilter) {
            const savedFilter = (localStorage.getItem('sidebar_filter') || '').trim();
            if (savedFilter) {
                el.sidebarFilter.value = savedFilter;
                applySidebarFilter(savedFilter);
            }
        }
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
        if (el.sidebarFilter) {
            el.sidebarFilter.addEventListener('input', function () {
                const value = el.sidebarFilter.value || '';
                localStorage.setItem('sidebar_filter', value);
                applySidebarFilter(value);
            });
        }
        if (el.btnCollapseAll) {
            el.btnCollapseAll.addEventListener('click', function () {
                setAllSectionsCollapsed(true);
            });
        }
        if (el.btnExpandAll) {
            el.btnExpandAll.addEventListener('click', function () {
                setAllSectionsCollapsed(false);
            });
        }
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
        if (el.btnPipelineAdvance) {
            el.btnPipelineAdvance.addEventListener('click', advancePipelineStage);
        }
        if (el.pipelineStage) {
            el.pipelineStage.addEventListener('change', function () {
                advancePipelineStage();
            });
        }
        if (el.btnAddChangeRequest) {
            el.btnAddChangeRequest.addEventListener('click', addChangeRequestRecord);
        }
        if (el.btnApproveChangeRequest) {
            el.btnApproveChangeRequest.addEventListener('click', approveLatestChangeRequest);
        }
        if (el.btnAddInvoice) {
            el.btnAddInvoice.addEventListener('click', addInvoiceRecord);
        }
        if (el.btnRunReminders) {
            el.btnRunReminders.addEventListener('click', function () {
                runReminderCheck().catch(console.error);
            });
        }
        if (el.btnSendClientPack) {
            el.btnSendClientPack.addEventListener('click', sendClientPack);
        }
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
        el.btnExportPdf.addEventListener('click', function () {
            downloadPdfExport().catch(function (err) {
                console.error(err);
                notify('PDF export failed.', 'error');
            });
        });
        el.btnExportMd.addEventListener('click', exportMarkdown);
        el.btnExportJson.addEventListener('click', exportJson);
        if (el.quickSave) {
            el.quickSave.addEventListener('click', function () {
                saveCurrentDoc().catch(console.error);
            });
        }
        if (el.quickPrint) {
            el.quickPrint.addEventListener('click', function () {
                openPrintWindow();
            });
        }
        if (el.quickPdf) {
            el.quickPdf.addEventListener('click', function () {
                downloadPdfExport().catch(function (err) {
                    console.error(err);
                    notify('PDF export failed.', 'error');
                });
            });
        }
        if (el.quickShare) {
            el.quickShare.addEventListener('click', function () {
                publishDocument().catch(function (err) {
                    console.error(err);
                    notify('Publish failed.', 'error');
                });
            });
        }

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
                notify('Publish failed.', 'error');
            });
        });

        el.btnSettings.addEventListener('click', function () {
            openSetupModal(true);
        });
        if (el.btnHelp) {
            el.btnHelp.addEventListener('click', function () {
                openShortcutsModal();
            });
        }
        if (el.btnShortcutsClose) {
            el.btnShortcutsClose.addEventListener('click', function () {
                closeShortcutsModal();
            });
        }
        if (el.shortcutsModal) {
            el.shortcutsModal.addEventListener('click', function (event) {
                if (event.target === el.shortcutsModal) {
                    closeShortcutsModal();
                }
            });
        }
        if (el.btnConfirmCancel) {
            el.btnConfirmCancel.addEventListener('click', function () {
                closeConfirmModal(false);
            });
        }
        if (el.btnConfirmAccept) {
            el.btnConfirmAccept.addEventListener('click', function () {
                closeConfirmModal(true);
            });
        }
        if (el.confirmModal) {
            el.confirmModal.addEventListener('click', function (event) {
                if (event.target === el.confirmModal) {
                    closeConfirmModal(false);
                }
            });
        }
        if (el.btnEmailCancel) {
            el.btnEmailCancel.addEventListener('click', function () {
                closeEmailModal(null);
            });
        }
        if (el.btnEmailSend) {
            el.btnEmailSend.addEventListener('click', function () {
                closeEmailModal({
                    toEmail: (el.emailTo.value || '').trim(),
                    subject: (el.emailSubject.value || '').trim(),
                    message: (el.emailMessage.value || '').trim(),
                    attachPdf: Boolean(el.emailAttachPdf.checked),
                });
            });
        }
        if (el.emailModal) {
            el.emailModal.addEventListener('click', function (event) {
                if (event.target === el.emailModal) {
                    closeEmailModal(null);
                }
            });
        }
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
            if (event.key === 'Escape' && el.shortcutsModal && !el.shortcutsModal.classList.contains('hidden')) {
                closeShortcutsModal();
                return;
            }
            if (event.key === 'Escape' && el.confirmModal && !el.confirmModal.classList.contains('hidden')) {
                closeConfirmModal(false);
                return;
            }
            if (event.key === 'Escape' && el.emailModal && !el.emailModal.classList.contains('hidden')) {
                closeEmailModal(null);
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
            if (event.key === '/' && document.activeElement !== el.editor && document.activeElement !== el.sidebarFilter) {
                event.preventDefault();
                if (el.sidebarFilter) {
                    el.sidebarFilter.focus();
                    el.sidebarFilter.select();
                }
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
        initSidebarPanels();
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
        notify('Failed to initialize local storage.', 'error');
    });
})();
