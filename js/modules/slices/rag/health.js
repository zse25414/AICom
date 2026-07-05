/* Lumina: rag/health.js */

async function checkRagServiceHealth() {
    if (!S.enterpriseSession) {
        document.getElementById('rag-kb-selector-wrap')?.classList.add('hidden');
        return;
    }
    try {
        const res = await fetch(`${C.RAG_SERVICE_URL}/health`);
        if (res.ok) {
            const data = await res.json();
            if (data.service === 'lumina-rag-service') {
                S.ragRetrievalMode = data.retrieval || S.ragRetrievalMode;
                if (!S.ragServiceActive) {
                    S.ragServiceActive = true;
                    console.log(`[Lumina RAG] 已連線 — 檢索模式：${data.retrieval || 'hybrid'}，Embedding：${data.embedding || 'local'}`);
                    document.getElementById('rag-kb-selector-wrap')?.classList.remove('hidden');
                    await ensureEnterpriseDocsInRag({ toast: true, force: true });
                }
                await window.renderRagKbCheckboxes();
                return;
            }
        }
    } catch (_) {}

    if (S.ragServiceActive) {
        S.ragServiceActive = false;
        console.log('[Lumina RAG] RAG 服務中斷，自動切回本地離線/純文字模式。');
        document.getElementById('rag-kb-selector-wrap')?.classList.add('hidden');
    }
}

async function renderRagKbCheckboxes() {
    const container = document.getElementById('rag-kb-checkboxes');
    if (!container || !S.enterpriseSession) return;

    let kbIds = await fetchRagKbIds(S.enterpriseSession.groupCode).catch(() => null);
    if (!kbIds || !kbIds.length) {
        kbIds = Object.keys(C.RAG_KB_LABELS);
    }

    const available = new Set(kbIds);
    const kbs = [...available].map(id => ({ id, label: getRagKbLabel(id) }));
    S.checkedRagKbs = S.checkedRagKbs.filter(id => available.has(id));
    if (!S.checkedRagKbs.length) S.checkedRagKbs = [kbs[0]?.id || 'general'];

    container.innerHTML = kbs.map(kb => {
        const checked = S.checkedRagKbs.includes(kb.id) ? 'checked' : '';
        return `
            <label class="inline-flex items-center gap-1.5 cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700/80 px-2 py-1 rounded-lg text-[10px] text-slate-300">
                <input type="checkbox" name="rag-kb" value="${kb.id}" ${checked} ${luminaChange('onRagKbCheckboxChange', [])} class="accent-purple-500 w-3 h-3">
                <span>${escapeHtml(kb.label)}</span>
            </label>
        `;
    }).join('');
}

function onRagKbCheckboxChange() {
    const checkboxes = document.querySelectorAll('input[name="rag-kb"]:checked');
    S.checkedRagKbs = Array.from(checkboxes).map(cb => cb.value);
}

function setupRagHealthMonitoring() {
    window.checkRagServiceHealth = checkRagServiceHealth;
    window.renderRagKbCheckboxes = renderRagKbCheckboxes;
    window.onRagKbCheckboxChange = onRagKbCheckboxChange;
    checkRagServiceHealth();
    setInterval(checkRagServiceHealth, 10000);
}

function pregenerateExample() {
    document.getElementById('goal-input').value = '完成 Q3 產品路線圖並獲得團隊共識';
    decomposeGoal();
}