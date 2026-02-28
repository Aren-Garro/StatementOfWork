(function () {
    'use strict';

    function summarizeTextDiff(previousText, currentText) {
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

    function buildLineDiff(baseText, targetText) {
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

    function hashSignature(data) {
        let hash = 2166136261;
        for (let i = 0; i < data.length; i += 1) {
            hash ^= data.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(16);
    }

    function normalizeSignatures(signatures, nowIsoFn) {
        if (!Array.isArray(signatures)) {
            return [];
        }
        const nowIso = typeof nowIsoFn === 'function'
            ? nowIsoFn
            : function () { return new Date().toISOString(); };
        return signatures.map((sig) => ({
            role: sig.role || 'unknown',
            signerName: sig.signerName || '',
            signedAt: sig.signedAt || nowIso(),
            method: sig.method || 'native_esign',
            imageDataUrl: sig.imageDataUrl || '',
            hash: sig.hash || '',
        }));
    }

    window.SowRevisionUtils = {
        summarizeTextDiff: summarizeTextDiff,
        buildLineDiff: buildLineDiff,
        hashSignature: hashSignature,
        normalizeSignatures: normalizeSignatures,
    };
})();
