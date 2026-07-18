/* Lumina: rag/health.js */

/**
 * Prefer API `/ready` checks.rag (configurable enterprise base).
 * Fallback: direct RAG health only if `/ready` unreachable.
 */
async function probeRagServiceOnline() {
    try {
        const res = await fetch(getEnterpriseBaseUrl() + '/ready', { method: 'GET' });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (data && typeof data === 'object' && data.checks && 'rag' in data.checks) {
            return {
                online: !!data.checks.rag,
                via: 'ready',
                retrieval: null,
                embedding: null
            };
        }
    } catch (_) {}

    try {
        const base = typeof getRagServiceBase === 'function' ? getRagServiceBase() : getEnterpriseBaseUrl();
        const res = await fetch(`${base}/health`, { method: 'GET' });
        if (!res.ok) return { online: false, via: 'health', retrieval: null, embedding: null };
        const data = await res.json().catch(() => ({}));
        const online = data.service === 'lumina-rag-service' || data.ok === true;
        return {
            online,
            via: 'health',
            retrieval: data.retrieval || null,
            embedding: data.embedding || null
        };
    } catch (_) {
        return { online: false, via: 'none', retrieval: null, embedding: null };
    }
}

function updateRagSelectorChrome() {
    const wrap = document.getElementById('rag-kb-selector-wrap');
    const panel = document.getElementById('coach-tools-panel');
    const toolsOpen = panel && !panel.classList.contains('hidden');
    if (!wrap) return;

    if (!S.enterpriseSession) {
        wrap.classList.add('hidden');
        panel?.classList.add('hidden');
        updateRagQuerySummary();
        return;
    }

    // With team: show KB panel unless user explicitly collapsed it
    if (!S._coachKbToolsCollapsed && panel) {
        panel.classList.remove('hidden');
        document.getElementById('coach-tools-toggle')?.setAttribute('aria-expanded', 'true');
    }
    const open = panel ? !panel.classList.contains('hidden') : toolsOpen;
    wrap.classList.toggle('hidden', !open);
    wrap.classList.toggle('coach-rag-selector-offline', !S.ragServiceActive);
    // Preferable: always allow toggling KBs (offline = preference for when back online)
    wrap.setAttribute('aria-disabled', 'false');

    const banner = document.getElementById('rag-kb-offline-banner');
    if (banner) {
        banner.classList.toggle('hidden', S.ragServiceActive);
    }

    updateRagQuerySummary();
}

function updateRagQuerySummary() {
    const el = document.getElementById('rag-kb-query-summary');
    if (!el) return;

    if (!S.enterpriseSession) {
        el.textContent = '';
        el.classList.add('hidden');
        updateRagEmptyBanner([]);
        return;
    }

    el.classList.remove('hidden');

    if (!S.ragServiceActive) {
        el.innerHTML = '<i class="fa-solid fa-circle-info mr-1 opacity-70"></i>目前查：<strong>一般教練</strong>（知識庫離線）';
        updateRagEmptyBanner([]);
        return;
    }

    const ids = Array.isArray(S.checkedRagKbs) ? S.checkedRagKbs : [];
    if (!ids.length) {
        el.innerHTML = '<i class="fa-solid fa-comments mr-1 opacity-70"></i>目前查：<strong>純教練</strong>（未勾選 · 可用 <code class="coach-rag-at-hint">@庫名</code> 單則覆寫）';
        updateRagEmptyBanner([]);
        return;
    }

    const labels = ids.map(id => getRagKbLabel(id).replace(/\s*\([^)]*\)\s*$/, '').trim());
    const emptyIds = ids.filter(id => getKbDocCount(id) === 0);
    let html = `<i class="fa-solid fa-database mr-1 opacity-70"></i>目前查：<strong>${escapeHtml(labels.join('、'))}</strong>`;
    if (emptyIds.length) {
        const emptyLabels = emptyIds.map(id => getRagKbLabel(id).replace(/\s*\([^)]*\)\s*$/, '').trim());
        html += `<span class="coach-rag-query-empty-hint"> · 空庫：${escapeHtml(emptyLabels.join('、'))}</span>`;
    }
    el.innerHTML = html;
    updateRagEmptyBanner(emptyIds);
}

function updateRagEmptyBanner(emptyIds) {
    const banner = document.getElementById('rag-kb-empty-banner');
    const textEl = document.getElementById('rag-kb-empty-banner-text');
    if (!banner) return;

    const show = S.enterpriseSession && S.ragServiceActive && Array.isArray(emptyIds) && emptyIds.length > 0;
    banner.classList.toggle('hidden', !show);
    if (!show || !textEl) return;

    const names = emptyIds.map(id => getRagKbLabel(id).replace(/\s*\([^)]*\)\s*$/, '').trim());
    textEl.innerHTML = `所選「${escapeHtml(names.join('、'))}」尚無文件，檢索可能無結果。` +
        `請至<button type="button" class="coach-rag-empty-link" data-lumina-action="openTeamKnowledgeTab">團隊 → 知識庫</button>上傳。`;
}

function getKbDocCount(kbId) {
    // Prefer live enterprise documents when group payload is loaded
    if (S.enterpriseGroupData) {
        const docs = S.enterpriseGroupData.documents || [];
        return docs.filter(d => (d.kbId || 'general') === kbId && d.status !== 'deleted').length;
    }
    const meta = S.ragKbItemsById?.[kbId];
    if (meta && typeof meta.docCount === 'number') return meta.docCount;
    return 0;
}

function openTeamKnowledgeTab() {
    if (typeof showSection === 'function') showSection('team');
    if (typeof switchTeamWorkspaceTab === 'function') switchTeamWorkspaceTab('knowledge');
}

async function checkRagServiceHealth() {
    if (!S.enterpriseSession) {
        document.getElementById('rag-kb-selector-wrap')?.classList.add('hidden');
        return;
    }

    const probe = await probeRagServiceOnline();

    if (probe.online) {
        if (probe.retrieval) S.ragRetrievalMode = probe.retrieval;
        if (!S.ragServiceActive) {
            S.ragServiceActive = true;
            console.debug(`[Lumina RAG] 已連線（via ${probe.via}）${probe.retrieval ? ' — 檢索：' + probe.retrieval : ''}`);
            await ensureEnterpriseDocsInRag({ toast: true, force: true });
        }
        updateRagSelectorChrome();
        await window.renderRagKbCheckboxes();
        return;
    }

    if (S.ragServiceActive) {
        S.ragServiceActive = false;
        console.debug('[Lumina RAG] RAG 服務中斷，自動切回本地離線/純文字模式。');
    }
    updateRagSelectorChrome();
    await window.renderRagKbCheckboxes();
}

async function renderRagKbCheckboxes() {
    const container = document.getElementById('rag-kb-checkboxes');
    if (!container || !S.enterpriseSession) return;

    let kbIds = null;
    if (S.ragServiceActive) {
        const list = await fetchRagKbList(S.enterpriseSession.groupCode).catch(() => null);
        if (list?.items?.length) rememberRagKbItems(list.items);
        kbIds = list?.kb_ids || null;
    }
    // Prefer team knowledgeBases map when list empty
    if ((!kbIds || !kbIds.length) && S.enterpriseGroupData?.knowledgeBases) {
        kbIds = Object.keys(S.enterpriseGroupData.knowledgeBases);
    }
    if (!kbIds || !kbIds.length) {
        // Fallback labels when list API unavailable; still show for offline (W1)
        kbIds = Object.keys(C.RAG_KB_LABELS);
    }

    const available = new Set(kbIds);
    const kbs = [...available].map(id => ({ id, label: getRagKbLabel(id) }));

    // Keep selection intersection; allow empty = pure coach (do NOT force-check)
    S.checkedRagKbs = (S.checkedRagKbs || []).filter(id => available.has(id));

    const pureActive = !S.checkedRagKbs.length;
    const offline = !S.ragServiceActive;
    const pureChip = `
        <button type="button" class="coach-rag-kb-chip coach-rag-pure-chip ${pureActive ? 'coach-rag-kb-chip-active' : ''}"
                data-lumina-action="clearRagKbSelection"
                title="不查知識庫，只用一般教練／DeepSeek"
                aria-pressed="${pureActive ? 'true' : 'false'}">
            <span class="coach-rag-kb-chip-text">
                <span class="coach-rag-kb-chip-name"><i class="fa-solid fa-comments mr-1 opacity-80"></i>純教練</span>
                <span class="coach-rag-kb-chip-count">不查庫</span>
            </span>
        </button>`;

    container.innerHTML = pureChip + kbs.map(kb => {
        const checked = S.checkedRagKbs.includes(kb.id) ? 'checked' : '';
        const count = getKbDocCount(kb.id);
        const countLabel = count > 0 ? `${count} 份` : '空庫';
        const shortLabel = kb.label.replace(/\s*\([^)]*\)\s*$/, '').trim();
        // Always selectable — offline only dims, does not block (preference for later)
        const disabledClass = offline ? 'coach-rag-kb-chip-dim' : '';
        const emptyClass = count === 0 ? 'is-empty' : '';
        return `
            <label class="coach-rag-kb-chip ${disabledClass} ${checked ? 'coach-rag-kb-chip-active' : ''}">
                <input type="checkbox" name="rag-kb" value="${escapeHtml(kb.id)}" ${checked}
                       ${luminaChange('onRagKbCheckboxChange', [])}
                       class="coach-rag-kb-input accent-purple-500"
                       aria-label="${escapeHtml(shortLabel)}，${countLabel}">
                <span class="coach-rag-kb-chip-text">
                    <span class="coach-rag-kb-chip-name">${escapeHtml(shortLabel)}</span>
                    <span class="coach-rag-kb-chip-count ${emptyClass}">${countLabel}</span>
                </span>
            </label>
        `;
    }).join('');

    updateRagQuerySummary();
}

function clearRagKbSelection() {
    S.checkedRagKbs = [];
    document.querySelectorAll('input[name="rag-kb"]').forEach((cb) => { cb.checked = false; });
    document.querySelectorAll('.coach-rag-kb-chip').forEach((label) => {
        const input = label.querySelector('input[name="rag-kb"]');
        if (input) label.classList.toggle('coach-rag-kb-chip-active', false);
        if (label.classList.contains('coach-rag-pure-chip')) {
            label.classList.add('coach-rag-kb-chip-active');
            label.setAttribute('aria-pressed', 'true');
        }
    });
    updateRagQuerySummary();
    try {
        if (typeof track === 'function') track('rag_mode_pure_coach', {});
    } catch (_) {}
    showToast('已切換為純教練（不查知識庫）', 'success');
}

function onRagKbCheckboxChange() {
    const checkboxes = document.querySelectorAll('input[name="rag-kb"]:checked');
    S.checkedRagKbs = Array.from(checkboxes).map(cb => cb.value);
    // Refresh active chip styles
    document.querySelectorAll('.coach-rag-kb-chip').forEach(label => {
        const input = label.querySelector('input[name="rag-kb"]');
        if (input) {
            label.classList.toggle('coach-rag-kb-chip-active', !!(input && input.checked));
        } else if (label.classList.contains('coach-rag-pure-chip')) {
            const pure = !S.checkedRagKbs.length;
            label.classList.toggle('coach-rag-kb-chip-active', pure);
            label.setAttribute('aria-pressed', pure ? 'true' : 'false');
        }
    });
    updateRagQuerySummary();
    try {
        if (typeof track === 'function') {
            track('rag_kb_selection', { count: S.checkedRagKbs.length, ids: S.checkedRagKbs.slice(0, 8) });
        }
    } catch (_) {}
}

function setupRagHealthMonitoring() {
    window.checkRagServiceHealth = checkRagServiceHealth;
    window.renderRagKbCheckboxes = renderRagKbCheckboxes;
    window.onRagKbCheckboxChange = onRagKbCheckboxChange;
    window.clearRagKbSelection = clearRagKbSelection;
    window.updateRagQuerySummary = updateRagQuerySummary;
    window.updateRagSelectorChrome = updateRagSelectorChrome;
    window.openTeamKnowledgeTab = openTeamKnowledgeTab;
    window.registerLuminaAction?.('openTeamKnowledgeTab', openTeamKnowledgeTab);
    window.registerLuminaAction?.('clearRagKbSelection', clearRagKbSelection);
    checkRagServiceHealth();
    setInterval(checkRagServiceHealth, 10000);
}

/** Demo helper for goal decomposer sample (console / advanced demos). */
function pregenerateExample() {
    const el = document.getElementById('goal-input');
    if (el) el.value = '完成 Q3 產品路線圖並準備簡報';
    if (typeof decomposeGoal === 'function') decomposeGoal();
}
