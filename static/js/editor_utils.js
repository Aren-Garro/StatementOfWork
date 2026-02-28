(function () {
    'use strict';

    function uid(prefix) {
        return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 11);
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function todayIso() {
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

    function parseMoney(value) {
        const cleaned = String(value || '').replace(/[^0-9.\-]/g, '');
        const amount = Number(cleaned);
        return Number.isFinite(amount) ? amount : null;
    }

    function formatMoney(amount) {
        return '$' + amount.toFixed(2);
    }

    window.SowUtils = {
        uid: uid,
        nowIso: nowIso,
        todayIso: todayIso,
        escapeHtml: escapeHtml,
        inline: inline,
        parseMoney: parseMoney,
        formatMoney: formatMoney,
    };
})();
