/* Lumina: utils/chunk-errors.js — lazy chunk failure UI (Phase 3) */

/**
 * Called from generated lazy loader on script error / register failure.
 * @param {string} chunk  e.g. 'coach' | 'enterprise-docs'
 * @param {Error} [err]
 */
function __luminaOnChunkError(chunk, err) {
    const name = String(chunk || 'unknown');
    console.error('[Lumina] chunk load failed:', name, err);

    try {
        if (typeof track === 'function') {
            track('chunk_error', { chunk: name, message: String(err?.message || '').slice(0, 120) });
        }
    } catch (_) {}

    if (name === 'coach' || name.includes('coach')) {
        showCoachChunkError(err);
        return;
    }
    if (name.includes('enterprise')) {
        if (typeof showToast === 'function') {
            showToast('團隊模組載入失敗，請重新整理後再試', 'error');
        }
    }
}

function showCoachChunkError(err) {
    const thread = document.getElementById('coach-agent-thread');
    const msg = String(err?.message || '教練模組載入失敗');
    if (thread) {
        thread.innerHTML = `
            <div class="coach-chunk-error" role="alert">
                <div class="coach-chunk-error-title">教練暫時無法載入</div>
                <p class="coach-chunk-error-desc">${typeof escapeHtml === 'function' ? escapeHtml(msg) : msg}</p>
                <div class="coach-chunk-error-actions">
                    <button type="button" class="coach-chunk-error-btn" data-lumina-action="retryCoachChunk">
                        重試載入
                    </button>
                    <button type="button" class="coach-chunk-error-btn ghost" data-lumina-action="showSection" data-lumina-arg="dashboard">
                        回今日
                    </button>
                </div>
            </div>`;
    }
    if (typeof showToast === 'function') {
        showToast('教練模組載入失敗，請重試或重新整理', 'error');
    }
}

async function retryCoachChunk() {
    try {
        if (typeof window.__luminaEnsureCoach === 'function') {
            // Clear failed cache entry if loader supports re-fetch
            await window.__luminaEnsureCoach();
        }
        if (typeof refreshCoachView === 'function') refreshCoachView();
        else if (typeof renderCoachAgentView === 'function') renderCoachAgentView();
        if (typeof showToast === 'function') showToast('教練已重新載入', 'success');
    } catch (e) {
        showCoachChunkError(e);
    }
}

if (typeof window !== 'undefined') {
    window.__luminaOnChunkError = __luminaOnChunkError;
    window.showCoachChunkError = showCoachChunkError;
    window.retryCoachChunk = retryCoachChunk;
    // Defer action registry: bridge/actions may load after this file
    try {
        if (typeof window.registerLuminaAction === 'function') {
            window.registerLuminaAction('retryCoachChunk', retryCoachChunk);
        }
    } catch (_) { /* ignore — window[fn] still works via data-lumina-action */ }
}
