/* Lumina: ui/confirm.js — App confirm modal (replaces window.confirm; mobile-friendly) */

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} opts.message
 * @param {string} [opts.confirmLabel]
 * @param {string} [opts.cancelLabel]
 * @param {boolean} [opts.danger] — red confirm button
 * @returns {Promise<boolean>}
 */
function showConfirmDialog(opts = {}) {
    const message = String(opts.message || opts.title || '確定執行此操作？');
    const title = opts.title != null ? String(opts.title) : '請確認';
    const confirmLabel = opts.confirmLabel || '確定';
    const cancelLabel = opts.cancelLabel || '取消';
    const danger = !!opts.danger;

    return new Promise((resolve) => {
        let overlay = document.getElementById('app-confirm-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'app-confirm-overlay';
            overlay.className = 'auth-overlay hidden';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'app-confirm-title');
            document.body.appendChild(overlay);
        }

        const finish = (value) => {
            overlay.classList.add('hidden');
            overlay.innerHTML = '';
            document.removeEventListener('keydown', onKey);
            resolve(!!value);
        };

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            } else if (e.key === 'Enter' && !e.shiftKey) {
                const t = e.target;
                if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
                e.preventDefault();
                finish(true);
            }
        };

        const confBtnClass = danger
            ? 'flex-1 text-sm px-4 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-medium'
            : 'flex-1 text-sm px-4 py-2.5 rounded-2xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium';

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        overlay.innerHTML = `
            <div class="auth-card max-w-sm w-full" data-lumina-stop>
                <h2 id="app-confirm-title" class="text-lg font-semibold tracking-tight mb-2">${esc(title)}</h2>
                <p class="text-sm text-slate-300 leading-relaxed whitespace-pre-line">${esc(message)}</p>
                <div class="flex items-center gap-x-2 mt-5">
                    <button type="button" id="app-confirm-cancel" class="text-sm px-4 py-2.5 rounded-2xl border border-slate-700 text-slate-300 hover:bg-slate-800">${esc(cancelLabel)}</button>
                    <button type="button" id="app-confirm-ok" class="${confBtnClass}">${esc(confirmLabel)}</button>
                </div>
            </div>`;

        overlay.classList.remove('hidden');
        document.addEventListener('keydown', onKey);

        overlay.querySelector('#app-confirm-cancel')?.addEventListener('click', () => finish(false));
        overlay.querySelector('#app-confirm-ok')?.addEventListener('click', () => finish(true));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) finish(false);
        });

        // Focus confirm for keyboard; mobile users still see large tap targets
        setTimeout(() => overlay.querySelector('#app-confirm-ok')?.focus(), 30);
    });
}

/** Sync-style helper for rare call sites that cannot await (prefer showConfirmDialog). */
function confirmAsync(message, opts = {}) {
    return showConfirmDialog({ message, ...opts });
}

if (typeof window !== 'undefined') {
    window.showConfirmDialog = showConfirmDialog;
}
