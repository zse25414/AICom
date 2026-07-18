/* Lumina: coach/agent.js */
function pushCoachAgentMessage(role, content, sources, meta) {
    S.coachAgentMessages.push({
        role,
        content,
        ts: Date.now(),
        sources: sources || null,
        meta: meta || null,
        expanded: false
    });
    // Keep thread short so the panel never balloons in DOM size
    if (S.coachAgentMessages.length > 16) S.coachAgentMessages = S.coachAgentMessages.slice(-16);
    S.chatHistory.push({ role: role === 'coach' ? 'assistant' : 'user', content });
    if (S.chatHistory.length > 16) S.chatHistory = S.chatHistory.slice(-16);
}

/** Long coach replies stay collapsed inside the fixed-height thread. */
function toggleCoachMessageExpand(msgIndex) {
    const m = S.coachAgentMessages[msgIndex];
    if (!m) return;
    m.expanded = !m.expanded;
    renderCoachAgentThread();
}

function shouldCollapseCoachText(text) {
    const t = String(text || '');
    if (t.length > 420) return true;
    return (t.match(/\n/g) || []).length >= 8;
}

/** Map retrieval score → 高 / 中 / 低 (never show misleading %) */
function getSourceRelevanceLevel(score) {
    const raw = Number(score);
    if (!Number.isFinite(raw)) return { key: 'mid', label: '中' };
    const n = raw > 1 ? raw / 100 : raw;
    if (n >= 0.55) return { key: 'high', label: '高' };
    if (n >= 0.3) return { key: 'mid', label: '中' };
    return { key: 'low', label: '低' };
}

function enrichCoachSource(s) {
    if (!s || typeof s !== 'object') return s;
    const filename = s.filename || s.file_name || '';
    const docs = S.enterpriseGroupData?.documents || [];
    const match = docs.find(d => {
        if (s.document_id && d.id === s.document_id) return true;
        const ragName = typeof getRagFilenameForDoc === 'function' ? getRagFilenameForDoc(d) : (d.filename || '');
        if (filename && (d.filename === filename || ragName === filename)) return true;
        if (filename && d.title && filename.includes(d.title)) return true;
        return false;
    });
    // Keep path only — never append JWT to URL (Referer/log leak). Open via Authorization fetch.
    let fileUrl = s.fileUrl || s.file_url || match?.fileUrl || null;
    if (fileUrl && fileUrl.startsWith('/uploads/')) {
        fileUrl = getEnterpriseBaseUrl() + fileUrl.split('?')[0];
    } else if (fileUrl && typeof fileUrl === 'string' && fileUrl.includes('token=')) {
        try {
            const u = new URL(fileUrl, getEnterpriseBaseUrl());
            u.searchParams.delete('token');
            fileUrl = u.toString();
        } catch (_) { /* keep */ }
    }
    const snippet = s.snippet || s.text || s.chunk_text
        || (match?.content ? String(match.content).slice(0, 400) : null);
    return {
        ...s,
        filename: filename || match?.filename || '未知檔案',
        title: s.title || match?.title || null,
        document_id: s.document_id || match?.id || null,
        kb_id: s.kb_id || s.kbId || match?.kbId || 'general',
        score: typeof s.score === 'number' ? s.score : null,
        snippet,
        fileUrl
    };
}

/** Open coach source file with Bearer auth → blob URL (no token in address bar). */
async function openCoachSourceFileSecure(msgIndex, srcIndex) {
    const m = S.coachAgentMessages[msgIndex];
    const raw = m?.sources?.[srcIndex];
    if (!raw) return showToast('找不到來源檔案', 'error');
    const s = enrichCoachSource(raw);
    let url = s.fileUrl;
    if (!url) return showToast('此來源沒有可開啟的檔案連結', 'error');

    // Relative or absolute uploads path
    if (url.startsWith('/uploads/')) url = getEnterpriseBaseUrl() + url;

    try {
        if (url.startsWith('blob:') || url.startsWith('data:')) {
            if (typeof openSafeUrl === 'function') openSafeUrl(url);
            else window.open(url, '_blank', 'noopener,noreferrer');
            return;
        }
        const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders(false) : {};
        const res = await fetch(url, { headers, credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
    } catch (err) {
        console.warn('[Lumina Coach] secure open failed', err);
        // Last resort: open without token (may 401) — better than leaking JWT
        if (typeof openSafeUrl === 'function') openSafeUrl(url);
        else showToast('無法開啟檔案，請至知識庫查看', 'error');
    }
}

function closeCoachSourcePreview() {
    document.getElementById('coach-source-drawer')?.remove();
}

function openCoachSourcePreview(msgIndex, srcIndex) {
    closeCoachSourcePreview();
    const m = S.coachAgentMessages[msgIndex];
    const raw = m?.sources?.[srcIndex];
    if (!raw) return;
    const s = enrichCoachSource(raw);
    const rel = getSourceRelevanceLevel(s.score);
    const displayName = s.title || s.filename || '來源';
    const kbLabel = typeof getRagKbLabel === 'function' ? getRagKbLabel(s.kb_id) : s.kb_id;
    const drawer = document.createElement('div');
    drawer.id = 'coach-source-drawer';
    drawer.className = 'coach-source-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', '資料來源預覽');
    drawer.innerHTML = `
        <div class="coach-source-drawer-backdrop" data-lumina-action="closeCoachSourcePreview"></div>
        <div class="coach-source-drawer-panel">
            <div class="coach-source-drawer-header">
                <div>
                    <div class="coach-source-drawer-kicker">來源 [${s.ref_id != null ? s.ref_id : srcIndex + 1}] · 相關度 ${rel.label}</div>
                    <h3 class="coach-source-drawer-title">${escapeHtml(displayName)}</h3>
                    <div class="coach-source-drawer-meta">
                        ${s.kb_id ? `<span><i class="fa-solid fa-tag"></i> ${escapeHtml(kbLabel)}</span>` : ''}
                        ${s.filename ? `<span><i class="fa-solid fa-file"></i> ${escapeHtml(s.filename)}</span>` : ''}
                    </div>
                </div>
                <button type="button" class="coach-source-drawer-close focus-ring" data-lumina-action="closeCoachSourcePreview" aria-label="關閉">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="coach-source-drawer-body custom-scroll">
                ${s.snippet
                    ? `<p class="coach-source-snippet">${escapeHtml(s.snippet)}</p>`
                    : `<p class="coach-source-snippet coach-source-snippet-empty">此來源未附段落摘要。可開啟原檔或至團隊知識庫查看全文。</p>`}
            </div>
            <div class="coach-source-drawer-footer">
                ${s.fileUrl
                    ? `<button type="button" class="coach-source-open-btn focus-ring"
                        data-lumina-action="openCoachSourceFileSecure"
                        data-lumina-arg="${msgIndex}"
                        data-lumina-arg-type="number"
                        data-lumina-arg2="${srcIndex}"
                        data-lumina-arg2-type="number"
                        title="以授權請求開啟（不把 token 放進網址）">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> 開啟檔案
                       </button>`
                    : ''}
                ${s.document_id
                    ? `<button type="button" class="coach-source-open-btn focus-ring" data-lumina-action="openCoachSourceInTeamDocs" data-lumina-arg="${escapeHtml(s.document_id)}" title="在團隊知識庫定位此文件">
                        <i class="fa-solid fa-folder-open"></i> 在知識庫中查看
                       </button>`
                    : ''}
                <button type="button" class="coach-source-secondary-btn focus-ring" data-lumina-action="closeCoachSourcePreview">關閉</button>
            </div>
        </div>
    `;
    document.body.appendChild(drawer);
    drawer.querySelector('.coach-source-drawer-close')?.focus();
}

function renderCoachSourceChips(sources, msgIndex) {
    if (!sources || !sources.length) return '';
    return `
        <div class="coach-sources mt-3 pt-2.5 border-t border-slate-800/80 text-xs text-slate-500">
            <div class="font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
                <i class="fa-solid fa-list-check text-purple-400"></i>
                <span>資料來源引用</span>
            </div>
            <div class="flex flex-wrap gap-2 mt-1">
                ${sources.map((raw, si) => {
                    const s = enrichCoachSource(raw);
                    const rel = getSourceRelevanceLevel(s.score);
                    const name = s.title || s.filename || '來源';
                    const shortName = name.length > 28 ? name.slice(0, 26) + '…' : name;
                    return `
                        <button type="button"
                            class="coach-source-chip coach-source-chip-${rel.key} focus-ring"
                            data-lumina-action="openCoachSourcePreview"
                            data-lumina-arg="${msgIndex}"
                            data-lumina-arg-type="number"
                            data-lumina-arg2="${si}"
                            data-lumina-arg2-type="number"
                            title="相關度 ${rel.label} · 點擊查看摘要">
                            <span class="font-mono text-purple-400">[${s.ref_id != null ? s.ref_id : si + 1}]</span>
                            ${s.kb_id ? `<span class="text-indigo-400/80">${escapeHtml(getRagKbLabel(s.kb_id).replace(/\s*\([^)]*\)\s*$/, ''))}</span>` : ''}
                            <span class="coach-source-chip-name">${escapeHtml(shortName)}</span>
                            <span class="coach-source-rel coach-source-rel-${rel.key}" aria-label="相關度 ${rel.label}">${rel.label}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function shortKbLabel(kbId) {
    const label = typeof getRagKbLabel === 'function' ? getRagKbLabel(kbId) : String(kbId || '');
    return label.replace(/\s*\([^)]*\)\s*$/, '').trim() || String(kbId || '');
}

/** Build alias → kbId map for @mention resolution (id + short display name). */
function getCoachKbAliasMap() {
    const map = new Map();
    const add = (alias, id) => {
        const k = String(alias || '').trim().toLowerCase();
        if (k) map.set(k, id);
    };
    const ids = new Set([
        ...Object.keys(C.RAG_KB_LABELS || {}),
        ...Object.keys(S.ragKbItemsById || {}),
        ...(S.checkedRagKbs || []),
        ...((S.enterpriseGroupData?.documents || []).map(d => d.kbId || 'general'))
    ]);
    for (const id of ids) {
        if (!id) continue;
        add(id, id);
        const short = shortKbLabel(id);
        add(short, id);
        add(short.replace(/\s+/g, ''), id);
    }
    return map;
}

/**
 * Parse @知識庫 mentions for one-shot KB override.
 * e.g. 「@新人培訓 環境怎麼裝」→ kbIds: [onboarding]
 */
function parseCoachKbMentions(userMsg) {
    const text = String(userMsg || '');
    const aliasMap = getCoachKbAliasMap();
    const aliases = [...aliasMap.keys()].sort((a, b) => b.length - a.length);
    const found = [];
    const spans = [];
    const re = /@([^\s@，,。.!！?？:：;；"'「」『』()（）\[\]{}<>]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const token = String(m[1] || '').toLowerCase();
        if (!token) continue;
        let id = aliasMap.get(token) || null;
        if (!id) {
            for (const a of aliases) {
                if (token === a || (a.length >= 2 && (token.startsWith(a) || a.startsWith(token)))) {
                    id = aliasMap.get(a);
                    break;
                }
            }
        }
        if (id) {
            found.push(id);
            spans.push({ start: m.index, end: m.index + m[0].length });
        }
    }
    let cleaned = text;
    for (let i = spans.length - 1; i >= 0; i--) {
        cleaned = cleaned.slice(0, spans[i].start) + cleaned.slice(spans[i].end);
    }
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    return {
        kbIds: [...new Set(found)],
        cleanedMsg: cleaned || text.trim(),
        hadMentions: found.length > 0
    };
}

function renderCoachKbUsageBadge(meta) {
    if (!meta) return '';

    // Success path: show which KBs answered this turn
    if (meta.usedKnowledge === true) {
        const kbIds = Array.isArray(meta.kbIds) ? meta.kbIds : [];
        const labels = kbIds.map(shortKbLabel).filter(Boolean);
        const srcN = typeof meta.sourceCount === 'number' ? meta.sourceCount : null;
        const scopeHint = meta.mentionOverride
            ? ' · 本則 @覆寫'
            : (meta.taskBound
                ? (meta.kbSource === 'task_docs' ? ' · 任務綁定文件' : ' · 任務綁定')
                : '');

        if (srcN === 0) {
            return `
                <div class="coach-kb-used-badge coach-kb-nohit-badge" role="status">
                    <div class="flex flex-col gap-1.5 w-full">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <span>已查知識庫但無相關段落</span>
                            <span class="coach-kb-unused-hint">${escapeHtml(scopeHint)}</span>
                        </div>
                        <div class="coach-kb-nohit-actions flex flex-wrap gap-1.5">
                            <button type="button" class="coach-kb-cta focus-ring" data-lumina-action="openTeamKnowledgeTab">
                                <i class="fa-solid fa-upload"></i> 上傳文件
                            </button>
                            <button type="button" class="coach-kb-cta focus-ring" data-lumina-action="showSection" data-lumina-arg="team">
                                <i class="fa-solid fa-database"></i> 換知識庫
                            </button>
                            <button type="button" class="coach-kb-cta focus-ring" data-lumina-action="askCoach" data-lumina-arg="@general 用白話說明這件事">
                                <i class="fa-solid fa-at"></i> 試 @庫名
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        const kbPart = labels.length
            ? `依 <strong>${escapeHtml(labels.join('、'))}</strong> 回答`
            : '已使用知識庫';
        const docN = Array.isArray(meta.docIds) ? meta.docIds.length : 0;
        const docPart = docN ? ` · 限定 ${docN} 份文件` : '';
        const srcPart = srcN != null ? ` · ${srcN} 則來源` : '';
        return `
            <div class="coach-kb-used-badge" role="status">
                <i class="fa-solid fa-database"></i>
                <span>${kbPart}${docPart}${srcPart}${escapeHtml(scopeHint)}</span>
            </div>
        `;
    }

    if (meta.usedKnowledge !== false) return '';

    const reason = meta.kbSkipReason || 'degraded';
    const hints = {
        offline: 'RAG 離線',
        empty_selection: '未選知識庫（可用 @庫名 單則覆寫）',
        degraded: '查詢降級',
        no_team: '未加入團隊',
        no_mention_match: '未辨識到有效 @知識庫'
    };
    const hint = hints[reason] || '未檢索';
    const cta = reason === 'empty_selection'
        ? `<button type="button" class="coach-kb-cta focus-ring ml-1" data-lumina-action="openTeamKnowledgeTab">選庫 / 上傳</button>`
        : (reason === 'no_team'
            ? `<button type="button" class="coach-kb-cta focus-ring ml-1" data-lumina-action="showSection" data-lumina-arg="team">加入團隊</button>`
            : (reason === 'offline'
                ? `<button type="button" class="coach-kb-cta focus-ring ml-1" data-lumina-action="showSection" data-lumina-arg="settings">檢查服務</button>`
                : ''));
    return `
        <div class="coach-kb-unused-badge" role="status">
            <i class="fa-solid fa-book-slash"></i>
            <span>未使用知識庫</span>
            <span class="coach-kb-unused-hint">（${escapeHtml(hint)}）</span>
            ${cta}
        </div>
    `;
}

function openCoachSourceInTeamDocs(documentId) {
    const id = String(documentId || '');
    closeCoachSourcePreview();
    if (!id) {
        if (typeof openTeamKnowledgeTab === 'function') openTeamKnowledgeTab();
        return;
    }
    if (typeof openTeamKnowledgeTab === 'function') openTeamKnowledgeTab();

    const docs = S.enterpriseGroupData?.documents || [];
    const doc = docs.find(d => d.id === id);
    const searchEl = document.getElementById('team-docs-search');
    if (doc && searchEl) {
        searchEl.value = doc.title || '';
        if (typeof onTeamDocsFilterChange === 'function') onTeamDocsFilterChange();
    } else if (typeof renderEnterpriseDocuments === 'function') {
        renderEnterpriseDocuments();
    }

    const tryHighlight = (attempt = 0) => {
        const el = document.querySelector(`[data-doc-id="${CSS.escape(id)}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('doc-highlight-pulse');
            setTimeout(() => el.classList.remove('doc-highlight-pulse'), 2200);
            return;
        }
        if (attempt < 6) setTimeout(() => tryHighlight(attempt + 1), 80);
        else if (typeof showToast === 'function') showToast('已開啟知識庫；若未見該文件，請調整篩選', 'success');
    };
    setTimeout(() => tryHighlight(0), 60);
}

function getOpeningCoachMessage(task, steps) {
    const s0 = steps[0];
    const total = steps.reduce((n, s) => n + parseStepMinutes(s), 0);
    return `我來帶你完成「${task.name}」，分 ${steps.length} 步、約 ${total} 分鐘。\n\n現在：${s0.title} — ${s0.action}\n\n做完跟我說，或點「完成這步」。\n[選項: 我準備好了，開始第一步]\n[選項: 這個任務有難度，先幫我做些引導分析]`;
}

function ensureCoachSessionForTask(task) {
    if (!task) return null;
    if (S.focusSession?.taskId === task.id) return S.focusSession;
    S.todayFocusTaskId = task.id;
    S.focusSession = {
        taskId: task.id,
        steps: getStepsForTask(task),
        currentStep: 0,
        startedAt: null,
        coachActive: false,
        planId: S.taskCoachPlans.get(task.id) || null
    };
    return S.focusSession;
}

function startStepTimerForCoach(session) {
    const step = session.steps[session.currentStep];
    if (!step) return;
    clearFocusTimer();
    const mins = parseStepMinutes(step);
    S.focusSession.endsAt = Date.now() + mins * 60 * 1000;
    tickFocusTimer();
    S.focusTimerInterval = setInterval(tickFocusTimer, 1000);
}

function coachBeginGuidedSession() {
    const task = getCoachTask();
    if (!task) {
        showToast('尚無待辦 — 可先問知識庫，或新增任務後再帶做', 'error');
        // Stay on coach for freeform; also offer demo
        if (!S.coachAgentMessages.length) {
            pushCoachAgentMessage('coach', '還沒有今日任務。你可以先問知識庫，或一鍵體驗。\n\n[選項: 一鍵體驗範例任務]\n[選項: 去今日新增任務]');
            renderCoachAgentThread();
        }
        return;
    }
    // Exit freeform Q&A when starting guided execution
    if (S.focusSession?.freeform) {
        clearFocusTimer();
        S.focusSession = null;
        S.coachAgentMessages = [];
    }
    const session = ensureCoachSessionForTask(task);
    session.freeform = false;
    session.coachActive = true;
    session.startedAt = Date.now();
    session.currentStep = session.currentStep || 0;
    if (!S.coachAgentMessages.length) {
        pushCoachAgentMessage('coach', getOpeningCoachMessage(task, session.steps));
    }
    startStepTimerForCoach(session);
    document.getElementById('next-step-card')?.classList.add('focus-session-active');
    renderCoachAgentView();
    try {
        if (typeof track === 'function') {
            track('coach_start', { taskId: task.id, steps: session.steps?.length || 0 });
        }
    } catch (_) {}
    showToast('教練開始帶你做', 'success');
}

function coachPauseSession() {
    if (!S.focusSession) return;
    S.focusSession.coachActive = false;
    clearFocusTimer();
    pushCoachAgentMessage('coach', '先暫停。準備好再點「教練帶我做」繼續。');
    document.getElementById('next-step-card')?.classList.remove('focus-session-active');
    renderCoachAgentView();
}

function coachAdvanceStepFromAgent() {
    const task = getCoachTask();
    if (!task || !S.focusSession || S.focusSession.taskId !== task.id) {
        return coachBeginGuidedSession();
    }
    const steps = S.focusSession.steps;
    const cur = S.focusSession.currentStep;
    if (cur < steps.length - 1) {
        S.focusSession.currentStep++;
        const next = steps[S.focusSession.currentStep];
        const cheers = ['很好，繼續！', '做得漂亮！', '保持這個節奏！'];
        pushCoachAgentMessage('coach', `${cheers[cur % cheers.length]}\n\n下一步「${next.title}」：${next.action}`);
        startStepTimerForCoach(S.focusSession);
    } else {
        pushCoachAgentMessage('coach', '最後一步了！完成後點「完成這件」，我幫你接下一個任務。');
    }
    renderCoachAgentView();
}

function coachCompleteTaskFromAgent() {
    const task = getCoachTask();
    if (!task) return;
    const taskName = task.name;
    S.coachAgentMessages = [];
    S.focusSession.coachActive = false;
    completeFocusTask(task.id);
    setTimeout(() => {
        refreshCoachView();
        const next = getCoachContext().nextTask;
        if (next) {
            pushCoachAgentMessage('coach', `「${taskName}」完成了！要繼續做「${next.name}」嗎？點「教練帶我做」。`);
        } else {
            pushCoachAgentMessage('coach', '今日待辦都完成了，休息一下！');
        }
        renderCoachAgentThread();
    }, 350);
}

function buildOfflineAgentReply(userMsg, task, session) {
    const lower = String(userMsg || '').toLowerCase();

    // Free-form knowledge mode (no task)
    if (!task || session?.freeform) {
        if (/加入|建立|新增.*任務|待辦/.test(userMsg)) {
            return {
                reply: '可以先到「今日」快速新增一項任務，或點「一鍵體驗」。有任務後我就能一步步帶你做。\n\n[選項: 一鍵體驗範例任務]\n[選項: 去今日新增任務]',
                advance: false, complete: false
            };
        }
        return {
            reply: '目前是知識庫問答模式（尚無聚焦任務）。\n\n請用一句話說清楚你要查的流程或文件重點；若已加入團隊並選知識庫，我會優先依庫回答。有具體任務後，點「教練帶我做」會更精準。\n\n[選項: 環境怎麼設定？]\n[選項: 新人第一天要做什麼？]\n[選項: 幫我建立一項今日任務]',
            advance: false, complete: false
        };
    }

    const steps = session?.steps || [];
    const cur = Math.min(session?.currentStep || 0, Math.max(0, steps.length - 1));
    const step = steps[cur] || { title: '執行', action: task.name };
    const cat = typeof resolveCategory === 'function' ? resolveCategory(task) : 'execution';
    const micro = String(step.action || '').split(/[，。]/)[0] || step.action || task.name;

    if (/完成這步|做完了|好了|done/.test(lower)) {
        const isLast = cur >= steps.length - 1;
        if (isLast) {
            return { reply: '太棒了！點「完成這件」勾選任務。\n\n[選項: 完成這件]', advance: false, complete: false };
        }
        return { reply: '收到，幫你進下一步。', advance: true, complete: false };
    }
    if (/卡住|難|不會|拖延|不想/.test(lower)) {
        const byCat = {
            meeting: `只做 2 分鐘：寫下「${task.name}」要達成的 1 個決議，其餘之後補。`,
            learning: `只做 2 分鐘：用一句話寫出學完要能解釋的重點。`,
            deep: `只做 2 分鐘：打開檔案，寫下最小可交付版本的標題。`,
            admin: `只做 2 分鐘：列出要處理的 3 個項目名稱即可。`,
            execution: `只做 2 分鐘：${String(micro).slice(0, 70)}。`
        };
        return {
            reply: `沒問題，再縮小。\n\n${byCat[cat] || byCat.execution}\n做完跟我說「完成這步」。\n\n[選項: 完成這步]\n[選項: 再拆更細]\n[選項: 換簡單一點]`,
            advance: false, complete: false
        };
    }
    if (/簡單|太難|換/.test(lower)) {
        return {
            reply: `好，把「${step.title}」簡化成：先打開相關檔案，寫下今天要交出的「一句話版本」。\n\n[選項: 我準備好了，開始第一步]\n[選項: 完成這步]`,
            advance: false, complete: false
        };
    }
    if (/資料|參考|範本|文件|SOP|流程/.test(lower)) {
        const q = encodeURIComponent(`${task.name} 範本`);
        return {
            reply: `先找 1 份範本就好，關鍵字：「${task.name}」。\n搜尋：https://www.google.com/search?q=${q}\n\n若已在團隊知識庫上傳過，可勾選知識庫或用 @庫名 再問一次。\n\n[選項: 我找到了，繼續執行]\n[選項: 用知識庫再查一次]`,
            advance: false, complete: false
        };
    }
    if (/怎麼|如何|什麼|為何|哪裡|嗎|？|\?/.test(userMsg)) {
        const guide = {
            meeting: `1) 寫下會議目標一句話\n2) 列出 3 個討論點\n3) 預留會後「誰／做什麼／何時」欄位`,
            learning: `1) 定義學完要能說出的一件事\n2) 只看一個來源 15 分鐘\n3) 用 3 句話總結`,
            deep: `1) 定義最小可交付\n2) 關掉通知做一個番茄鐘\n3) 對照完成標準收尾`,
            admin: `1) 列出要清的項目\n2) 每項標 2 分鐘內可做的動作\n3) 先做最短的一項`,
            execution: `1) ${micro}\n2) 設定計時 ${Math.min(25, task.duration || 25)} 分鐘\n3) 做完回報「完成這步」`
        };
        return {
            reply: `可以這樣做「${step.title}」：\n${guide[cat] || guide.execution}\n\n[選項: 我準備好了，開始第一步]\n[選項: 卡住了]\n[選項: 完成這步]`,
            advance: false, complete: false
        };
    }
    return {
        reply: `收到。此刻專注「${step.title}」——${micro}。\n卡住就說「卡住了」。\n\n[選項: 完成這步]\n[選項: 卡住了]\n[選項: 換簡單一點]`,
        advance: false, complete: false
    };
}

function inferAgentActionsFromUserMsg(userMsg, session) {
    if (!session || session.freeform || !Array.isArray(session.steps) || !session.steps.length) {
        return { advance: false, complete: false };
    }
    if (/完成這步|做完了|做好了|好了/.test(userMsg)) {
        const isLast = (session.currentStep || 0) >= session.steps.length - 1;
        return { advance: !isLast, complete: isLast };
    }
    return { advance: false, complete: false };
}

function isGenericCoachFallback(reply) {
    return /專注這一步就好|針對「[^」]+」：/.test(reply || '');
}

/**
 * Resolve KB + document scope for a coach turn.
 * Priority: @mention override → task-bound docs/kbs → checkbox selection.
 */
function resolveCoachQueryKbIds(task, mention) {
    if (mention?.hadMentions && mention.kbIds?.length) {
        return {
            kbIds: mention.kbIds,
            docIds: [],
            source: 'mention',
            taskBound: false
        };
    }
    const boundKb = typeof getTaskBoundKbIds === 'function'
        ? getTaskBoundKbIds(task)
        : (Array.isArray(task?.kbIds) ? task.kbIds.filter(Boolean) : []);
    const boundDocs = typeof getTaskBoundDocIds === 'function'
        ? getTaskBoundDocIds(task)
        : (Array.isArray(task?.docIds) ? task.docIds.filter(Boolean) : []);

    if (boundDocs.length || boundKb.length) {
        let kbIds = boundKb;
        // Derive KBs from bound docs when only documents are set
        if (!kbIds.length && boundDocs.length) {
            const docs = S.enterpriseGroupData?.documents || [];
            kbIds = [...new Set(
                boundDocs.map(id => {
                    const d = docs.find(x => x.id === id);
                    return d?.kbId || 'general';
                })
            )];
        }
        return {
            kbIds,
            docIds: boundDocs,
            source: boundDocs.length ? 'task_docs' : 'task',
            taskBound: true
        };
    }
    const checked = Array.isArray(S.checkedRagKbs) ? [...S.checkedRagKbs] : [];
    return { kbIds: checked, docIds: [], source: 'checkbox', taskBound: false };
}

function resolveCoachKbSkipReason(task) {
    if (!S.enterpriseSession) return 'no_team';
    if (!S.ragServiceActive) return 'offline';
    const boundKb = task && typeof getTaskBoundKbIds === 'function' ? getTaskBoundKbIds(task) : [];
    const boundDocs = task && typeof getTaskBoundDocIds === 'function' ? getTaskBoundDocIds(task) : [];
    if (boundKb.length || boundDocs.length) return null;
    if (!S.checkedRagKbs?.length) return 'empty_selection';
    return null;
}

function updateCoachTaskKbBanner(task) {
    const el = document.getElementById('coach-task-kb-banner');
    if (!el) return;
    const boundKb = typeof getTaskBoundKbIds === 'function' ? getTaskBoundKbIds(task) : [];
    const boundDocs = typeof getTaskBoundDocIds === 'function' ? getTaskBoundDocIds(task) : [];
    if (!task || (!boundKb.length && !boundDocs.length)) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    const parts = [];
    if (boundKb.length) {
        const labels = boundKb.map(id =>
            (typeof shortTaskKbLabel === 'function' ? shortTaskKbLabel(id) : id)
        );
        parts.push(`庫 <strong>${escapeHtml(labels.join('、'))}</strong>`);
    }
    if (boundDocs.length) {
        parts.push(`文件 <strong>${boundDocs.length} 份</strong>`);
    }
    el.classList.remove('hidden');
    el.innerHTML = `
        <i class="fa-solid fa-link text-indigo-300"></i>
        <span>本任務綁定：${parts.join(' · ')}</span>
        <span class="coach-task-kb-banner-hint">教練優先只查此範圍（可用 @庫名 單則覆寫）</span>
    `;
}

async function coachAgentRespondWithAI(userMsg, task, session) {
    const freeform = !task || !!session?.freeform;
    const mention = parseCoachKbMentions(userMsg);
    const resolved = resolveCoachQueryKbIds(task, mention);
    const effectiveKbIds = resolved.kbIds;
    const effectiveDocIds = resolved.docIds || [];
    const queryText = mention.hadMentions ? mention.cleanedMsg : userMsg;

    // Phase 2: short-TTL cache for identical coach turns
    const cacheKey = typeof coachCacheKey === 'function'
        ? coachCacheKey({
            q: queryText,
            taskId: task?.id || null,
            step: session?.currentStep ?? null,
            kbs: effectiveKbIds,
            docs: effectiveDocIds,
            group: S.enterpriseSession?.groupCode || null,
            freeform
        })
        : null;
    if (cacheKey && typeof getCoachCachedAnswer === 'function') {
        const cached = getCoachCachedAnswer(cacheKey);
        if (cached) {
            try {
                if (typeof recordUsage === 'function') {
                    recordUsage({ kind: 'ai', tokensIn: 0, tokensOut: 0, cached: true, source: 'coach_cache' });
                }
            } catch (_) {}
            return { ...cached, meta: { ...(cached.meta || {}), fromCache: true } };
        }
    }

    let skipReason = null;
    if (!S.enterpriseSession) skipReason = 'no_team';
    else if (!S.ragServiceActive) skipReason = 'offline';
    else if (!effectiveKbIds.length) skipReason = 'empty_selection';

    let ragDegraded = false;

    if (!skipReason) {
        try {
            if (typeof assertUsageQuota === 'function') assertUsageQuota('rag');
            const payload = {
                query: queryText,
                group_code: S.enterpriseSession.groupCode,
                kb_ids: effectiveKbIds,
                ...getRagLlmCredentials()
            };
            if (effectiveDocIds.length) {
                payload.document_ids = effectiveDocIds;
            }

            const response = await fetch(getRagQueryUrl(), {
                method: 'POST',
                headers: getAuthHeaders(true),
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                if (data.retrieval_mode) S.ragRetrievalMode = data.retrieval_mode;
                let reply = String(data.answer || '').trim();
                const sources = (data.citations || data.sources || []).map(enrichCoachSource);

                try {
                    if (typeof recordUsage === 'function') {
                        recordUsage({
                            kind: 'rag',
                            tokensIn: typeof estimateTokensFromText === 'function' ? estimateTokensFromText(queryText) : 32,
                            tokensOut: typeof estimateTokensFromText === 'function' ? estimateTokensFromText(reply) : 64,
                            source: 'coach_rag'
                        });
                    }
                } catch (_) {}

                if (!reply) {
                    ragDegraded = true;
                } else {
                    if (!reply.includes('[選項:')) {
                        reply += freeform
                            ? `\n\n[選項: 再說明得更具體一點]\n[選項: 幫我建立一項今日任務]`
                            : `\n\n[選項: 我了解，繼續執行當前步驟]\n[選項: 請幫我把這段資料再做詳細拆解]`;
                    }

                    const result = {
                        reply: clampText(reply, 5000),
                        sources,
                        meta: {
                            usedKnowledge: true,
                            kbIds: effectiveKbIds,
                            docIds: effectiveDocIds,
                            sourceCount: sources.length,
                            mentionOverride: mention.hadMentions,
                            taskBound: resolved.taskBound && !mention.hadMentions,
                            kbSource: resolved.source
                        },
                        ...inferAgentActionsFromUserMsg(userMsg, session || { currentStep: 0, steps: [] })
                    };
                    if (cacheKey && typeof setCoachCachedAnswer === 'function') {
                        setCoachCachedAnswer(cacheKey, result);
                    }
                    return result;
                }
            } else {
                ragDegraded = true;
            }
        } catch (e) {
            if (e && e.code === 'USAGE_QUOTA') throw e;
            ragDegraded = true;
            console.warn('[Lumina RAG] RAG 查詢失敗，降級到一般 AI 問答:', e.message);
        }
    }

    const kbMeta = {
        usedKnowledge: false,
        kbSkipReason: ragDegraded ? 'degraded' : (skipReason || 'degraded'),
        kbIds: effectiveKbIds,
        docIds: effectiveDocIds,
        mentionOverride: mention.hadMentions,
        taskBound: resolved.taskBound && !mention.hadMentions,
        kbSource: resolved.source
    };

    const contextBlock = buildCoachContextText(getCoachContext());
    const COACH_REPLY_MAX = 3500;

    let systemPrompt;
    if (freeform) {
        systemPrompt = `你是 Lumina 知識庫助理與行動教練。繁體中文，專業、可執行。
用戶目前沒有聚焦任務，請回答他的問題；若適合，建議他建立一項今日任務。
回答最後必須附 2-3 個選項，格式每行：[選項: 文字]
禁止回傳 JSON。可用 markdown。
${contextBlock}`;
    } else {
        const step = session?.steps?.[session.currentStep];
        systemPrompt = `你是 Lumina 行動教練，是引導用戶高效工作的專業教練。
請使用繁體中文，語氣專業嚴謹、邏輯條理清晰。請根據用戶當前的情境給予深入且具實用性、結構化的專業引導與建議。
用戶剛傳了一則訊息——請針對他的訊息進行嚴謹的回應，不要重複貼上無關的完整步驟說明。

重要要求——動態行動選項：
你必須在回答的最後，根據當前的對話進度與情境，額外設計 2 到 3 個用戶可能想要選擇的「具體行動選項」，供用戶點選回答（類似 Claude 的引導選項）。
請嚴格遵守以下格式，在回答的最底部每行輸出一個選項（不要放在代碼塊中）：
[選項: 選項文字]
例如：
[選項: 沒問題，我準備好開始寫第一段]
[選項: 遇到瓶頸，請幫我把當前步驟再拆更細]
[選項: 我需要找一些範本參考，能給我關鍵字嗎]

若用戶詢問如何執行或怎麼做：請給予結構化、有步驟邏輯的引導，列出清晰的步驟。
若用戶表示卡住、遇到瓶頸或拖延：請為他分析可能原因，並提供具體的應對方法或重新規劃子步驟。
禁止：直接回傳原始 JSON。
允許且建議：使用 markdown（例如粗體、無序列表、有序列點、程式碼區塊等）使回答更具結構性。
${contextBlock}
當前任務：${task.name}
當前步驟（${(session.currentStep || 0) + 1}/${session.steps.length}）「${step?.title}」：${step?.action}`;
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        ...S.coachAgentMessages.slice(-8).map(m => ({
            role: m.role === 'coach' ? 'assistant' : 'user',
            content: m.content.slice(0, 500)
        }))
    ];
    const content = await callDeepSeek(messages, { temperature: 0.75, source: 'coach' });
    const text = String(content || '').trim();

    let result;
    if (text.startsWith('{') && task) {
        const parsed = parseCoachAgentResponse(text, userMsg, task, session);
        if (parsed.reply && !isGenericCoachFallback(parsed.reply)) {
            result = {
                ...parsed,
                reply: clampText(parsed.reply, COACH_REPLY_MAX),
                meta: kbMeta,
                ...inferAgentActionsFromUserMsg(userMsg, session)
            };
        }
    }

    if (!result) {
        if (!text) {
            result = { ...buildOfflineAgentReply(userMsg, task, session), meta: kbMeta };
        } else {
            result = {
                reply: clampText(text, COACH_REPLY_MAX),
                meta: kbMeta,
                ...(task ? inferAgentActionsFromUserMsg(userMsg, session) : { advance: false, complete: false })
            };
        }
    }

    if (cacheKey && typeof setCoachCachedAnswer === 'function' && result?.reply) {
        setCoachCachedAnswer(cacheKey, result);
    }
    return result;
}

function parseJsonFromAI(text) {
    const trimmed = String(text || '').trim().replace(/^\uFEFF/, '');
    if (!trimmed) throw new Error('AI 回傳為空');
    try { return JSON.parse(trimmed); } catch (_) {}
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
        try { return JSON.parse(match[1].trim()); } catch (_) {}
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_) {}
    }
    throw new Error('AI 回傳格式無法解析');
}

function parseCoachAgentResponse(content, userMsg, task, session) {
    const text = String(content || '').trim();
    const replyMax = 3500;
    if (!text) return buildOfflineAgentReply(userMsg, task, session);
    
    try {
        const raw = parseJsonFromAI(text);
        const reply = raw.reply || raw.message || raw.content || raw.text;
        if (reply) {
            return {
                reply: clampText(String(reply), replyMax),
                advance: !!(raw.advance || raw.next_step),
                complete: !!raw.complete
            };
        }
    } catch (_) {}
    
    if (!text.startsWith('{') && !text.startsWith('[')) {
        return { reply: clampText(text, replyMax), advance: false, complete: false };
    }
    
    const replyMatch = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/s)
        || text.match(/"reply"\s*:\s*'([^']*)'/);
    if (replyMatch) {
        try {
            const unescaped = replyMatch[1]
                .replace(/\\n/g, '\n')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            return {
                reply: clampText(unescaped, replyMax),
                advance: /"advance"\s*:\s*true/i.test(text),
                complete: /"complete"\s*:\s*true/i.test(text)
            };
        } catch (_) {}
    }
    
    return buildOfflineAgentReply(userMsg, task, session);
}

async function coachRespondWithAI(userMsg) {
    const ctx = getCoachContext();
    const contextBlock = buildCoachContextText(ctx);
    const taskHint = extractTaskNameFromMessage(userMsg) || ctx.nextTask?.name || '';
    
    const systemPrompt = `你是 Lumina 任務行動代理。繁體中文，語氣專業正式、條理清晰。你必須回傳「僅 JSON」、不要 markdown 程式碼區塊。

JSON 格式：
{
  "title": "方案標題（如：Q3 報告執行方案）",
  "task": "對應任務名稱",
  "summary": "2-3句正式摘要，說明目標與產出",
  "steps": [{"title":"步驟名","duration":"10分鐘","action":"具體、可立即執行的做法"}],
  "resources": [{"title":"資源名","url":"https://...","note":"用途說明"}],
  "document": {"title":"文件名","sections":[{"heading":"章節","bullets":["條目（待填處用 [請填寫]）"]}]},
  "checklist": ["完成檢核項"],
  "tips": ["專業提醒"]
}

要求：
1. steps 固定 3 項，duration 用「X 分鐘」格式，action 要具體可執行
2. document 必須是可填寫的正式草稿（報告／提案／會議議程／郵件／執行清單），每節 2-4 條；待填欄位格式為「欄位名稱：[請填寫]」（用戶會在頁面上直接輸入，不需下載）
3. resources 至少 3 項真實可查的連結（Google 搜尋、官方文件、範本庫等）
4. 若用戶要「找資料」，resources 為重點，title 改為「參考資料清單」
5. 禁止空泛勵志語，全部對應任務脈絡與用戶待辦

${contextBlock}
用戶聚焦任務：${taskHint || '（依待辦推斷）'}`;
    
    const messages = [
        { role: 'system', content: systemPrompt },
        ...S.chatHistory.slice(-6).map(m => ({
            role: m.role,
            content: m.content.replace(/<[^>]+>/g, '').slice(0, 800)
        })),
        { role: 'user', content: userMsg }
    ];
    const content = await callDeepSeek(messages, { jsonMode: true, temperature: 0.55 });
    try {
        return normalizeCoachPlan(parseJsonFromAI(content), taskHint);
    } catch (_) {
        return buildOfflineCoachPlan(userMsg, ctx);
    }
}

function getCoachWorkspace() {
    return document.getElementById('coach-workspace');
}

function formatCoachContent(text) {
    return sanitizeHtml(String(text || '').replace(/\n/g, '<br>'));
}

/** Strip coach option tags / markdown noise before creating tasks */
function stripCoachMessageForTasks(content) {
    return String(content || '')
        .replace(/\[選項:\s*[^\]]+\]/g, '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/#{1,6}\s*/g, '')
        .trim();
}

/** Prefer numbered/bullet action items; fallback to first meaningful line */
function extractTaskCandidatesFromCoachMessage(content) {
    const text = stripCoachMessageForTasks(content);
    if (!text) return [];
    const items = [];
    const re = /(?:^|\n)\s*(?:\d+[\.\)]\s+|[-•●]\s+)(.+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        let t = String(m[1] || '').trim()
            .replace(/^[「『"']|[」』"']$/g, '')
            .replace(/\s+/g, ' ');
        // Drop pure questions / very short noise (CJK tasks can be 2–3 chars)
        if (t.length < 2 || t.length > 120) continue;
        if (/^(選項|注意|提示|說明)[:：]/.test(t)) continue;
        items.push(t);
        if (items.length >= 5) break;
    }
    if (items.length) return items;

    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    let title = lines.find(l => l.length >= 2 && !/^[-—]+$/.test(l)) || text.slice(0, 80);
    title = title
        .replace(/^(現在|步驟\s*\d*|任務|建議)[:：]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (title.length > 80) title = title.slice(0, 78) + '…';
    return title ? [title] : [];
}

function addCoachMessageAsTodayTasks(msgIndex) {
    const m = S.coachAgentMessages?.[msgIndex];
    if (!m || m.role !== 'coach') {
        return showToast('找不到教練訊息', 'error');
    }
    const candidates = extractTaskCandidatesFromCoachMessage(m.content);
    if (!candidates.length) {
        return showToast('無法從這則回覆抽出待辦', 'error');
    }

    const maxLen = (typeof C !== 'undefined' && C.TASK_NAME_MAX_LEN) || 200;
    const baseId = Date.now();
    const created = [];
    candidates.forEach((name, i) => {
        const taskName = String(name).slice(0, maxLen);
        const newTask = {
            id: baseId + i,
            name: taskName,
            duration: 30,
            energy: 3,
            category: typeof inferCategory === 'function' ? inferCategory(taskName, 3) : 'execution',
            due: getTodayISO(),
            completed: false,
            updatedAt: new Date().toISOString(),
            source: 'coach'
        };
        S.tasks.unshift(newTask);
        created.push(newTask);
    });

    if (created[0]) S.todayFocusTaskId = created[0].id;
    saveState();
    try {
        if (typeof track === 'function') {
            track('task_created', { source: 'coach_extract', count: created.length, dueToday: true });
        }
    } catch (_) {}
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });

    if (created.length === 1) {
        showToast(`已加入今日待辦：${created[0].name}`, 'success');
    } else {
        showToast(`已從教練回覆加入 ${created.length} 項今日待辦`, 'success');
    }
}

/**
 * Prefill team assign form from a coach message (manager only).
 * Uses first extracted action item as task title.
 */
function openCoachMessageAsTeamAssign(msgIndex) {
    if (!S.enterpriseSession) {
        return showToast('請先加入團隊', 'error');
    }
    if (S.enterpriseSession.role !== 'manager') {
        return showToast('僅主管可指派團隊任務', 'error');
    }
    if (S.enterpriseSession.offline) {
        return showToast('離線模式請至團隊頁本機指派', 'error');
    }

    const m = S.coachAgentMessages?.[msgIndex];
    if (!m || m.role !== 'coach') {
        return showToast('找不到教練訊息', 'error');
    }
    const candidates = extractTaskCandidatesFromCoachMessage(m.content);
    if (!candidates.length) {
        return showToast('無法從這則回覆抽出任務名稱', 'error');
    }

    const title = String(candidates[0]).slice(0, 100);
    S._coachAssignDraft = {
        title,
        all: candidates,
        msgIndex,
        at: Date.now()
    };

    if (typeof showSection === 'function') showSection('team');
    if (typeof switchTeamWorkspaceTab === 'function') switchTeamWorkspaceTab('members');

    const applyDraft = (attempt = 0) => {
        const titleEl = document.getElementById('team-assign-title');
        const dueEl = document.getElementById('team-assign-due');
        const panel = document.getElementById('team-manager-panel');
        if (!titleEl && attempt < 8) {
            setTimeout(() => applyDraft(attempt + 1), 50);
            return;
        }
        if (titleEl) {
            titleEl.value = title;
            titleEl.classList.add('coach-assign-field-flash');
            setTimeout(() => titleEl.classList.remove('coach-assign-field-flash'), 1800);
            try { titleEl.focus(); } catch (_) {}
        }
        if (dueEl && !dueEl.value) {
            dueEl.value = typeof getTodayISO === 'function' ? getTodayISO() : '';
        }
        panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('team-assign-member')?.focus();

        if (candidates.length > 1) {
            showToast(`已帶入「${title}」（另有 ${candidates.length - 1} 項可手動再指派）`, 'success');
        } else {
            showToast(`已帶入「${title}」，請選擇成員後指派`, 'success');
        }
    };
    setTimeout(() => applyDraft(0), 40);
}

function renderCoachAddTaskButton(msgIndex, content) {
    const n = extractTaskCandidatesFromCoachMessage(content).length;
    if (!n) return '';
    const label = n > 1 ? `加入 ${n} 項今日待辦` : '加到今日待辦';
    const isManager = S.enterpriseSession?.role === 'manager' && !S.enterpriseSession?.offline;
    const teamBtn = isManager ? `
        <button type="button"
            class="coach-assign-team-btn focus-ring"
            data-lumina-action="openCoachMessageAsTeamAssign"
            data-lumina-arg="${msgIndex}"
            data-lumina-arg-type="number"
            title="帶入團隊指派表單（需再選成員）">
            <i class="fa-solid fa-user-tie"></i>
            <span>指派給團隊</span>
        </button>
    ` : '';
    return `
        <div class="coach-msg-actions mt-2.5">
            <button type="button"
                class="coach-add-task-btn focus-ring"
                data-lumina-action="addCoachMessageAsTodayTasks"
                data-lumina-arg="${msgIndex}"
                data-lumina-arg-type="number"
                title="把教練建議變成今日可執行任務">
                <i class="fa-solid fa-plus"></i>
                <span>${label}</span>
            </button>
            ${teamBtn}
        </div>
    `;
}

function renderCoachAgentThread(thinking) {
    const el = document.getElementById('coach-agent-thread');
    if (!el) return;
    // Only paint last few turns — rest stays in memory but not DOM
    const recent = S.coachAgentMessages.slice(-8);
    if (!recent.length && !thinking) {
        const task = typeof getCoachTask === 'function' ? getCoachTask() : null;
        el.innerHTML = task
            ? `<div class="coach-agent-thread-hint">準備好了嗎？<span>選「帶我做」，或直接在下方輸入</span></div>`
            : `<div class="coach-agent-thread-hint">今天想完成什麼？<span>上方選任務，或直接開始對話</span></div>`;
        return;
    }
    const thinkingLabel = thinking === 'deepseek' ? 'DeepSeek 回覆中'
        : thinking === 'offline' ? '離線引導中'
        : thinking ? '教練思考中' : '';

    const baseIndex = Math.max(0, S.coachAgentMessages.length - recent.length);
    const hiddenCount = Math.max(0, S.coachAgentMessages.length - recent.length);
    let html = '';
    if (hiddenCount > 0) {
        html += `<div class="coach-agent-thread-more text-[10px] text-slate-500 text-center py-1">較早 ${hiddenCount} 則已收合 · 對話區固定高度，可在此捲動</div>`;
    }
    recent.forEach((m, idx) => {
        const isLast = idx === recent.length - 1;
        const msgIndex = baseIndex + idx;
        let displayContent = m.content;
        const options = [];

        if (m.role === 'coach') {
            displayContent = m.content.replace(/\[選項:\s*([^\]]+)\]/g, (match, optText) => {
                options.push(optText.trim());
                return '';
            }).replace(/\n\s*\n/g, '\n').trim();
        }

        const sourcesHtml = m.role === 'coach' ? renderCoachSourceChips(m.sources, msgIndex) : '';
        const kbBadge = m.role === 'coach' ? renderCoachKbUsageBadge(m.meta) : '';
        const addTaskHtml = m.role === 'coach' ? renderCoachAddTaskButton(msgIndex, m.content) : '';

        // Long replies collapse so the fixed chat viewport stays usable
        const canCollapse = m.role === 'coach' && shouldCollapseCoachText(displayContent);
        const collapsed = canCollapse && !m.expanded;
        const bodyClass = collapsed ? 'coach-msg-body is-collapsed' : 'coach-msg-body';
        const expandBtn = canCollapse
            ? `<button type="button" class="coach-msg-expand-btn focus-ring"
                data-lumina-action="toggleCoachMessageExpand"
                data-lumina-arg="${msgIndex}"
                data-lumina-arg-type="number">
                <i class="fa-solid fa-chevron-${collapsed ? 'down' : 'up'}"></i>
                ${collapsed ? '展開全文' : '收合'}
               </button>`
            : '';

        if (m.role === 'user') {
            // User bubble: fit content width (never collapse to 1 CJK char tall strip)
            html += `
            <div class="coach-agent-msg coach-agent-msg-user">
                <div class="coach-msg-text">${escapeHtml(displayContent)}</div>
            </div>`;
        } else {
            html += `
            <div class="coach-agent-msg coach-agent-msg-coach">
                <span class="coach-msg-avatar" aria-hidden="true"><i class="fa-solid fa-bolt"></i></span>
                <div class="coach-msg-main">
                    <div class="${bodyClass}">
                        <div class="coach-msg-text">${formatCoachContent(displayContent)}</div>
                    </div>
                    ${expandBtn}
                    ${kbBadge}
                    ${sourcesHtml}
                    ${addTaskHtml}
                    ${(isLast && options.length > 0 && !thinking) ? `
                        <div class="coach-agent-options">
                            ${options.map(opt => `
                                <button type="button" ${luminaAction('sendCoachAgentMessage', { argFrom: 'dataset.msg' })} data-msg="${escapeHtml(opt)}" class="coach-agent-option-btn">${escapeHtml(opt)}</button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>`;
        }
    });

    if (thinkingLabel) {
        html += `<div class="coach-agent-thinking"><span class="thinking-dots">${thinkingLabel}</span></div>`;
    }

    el.innerHTML = html;
    // Keep latest message in view inside the fixed viewport
    requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
    });
}

/** Today / pending tasks the coach can focus on */
function getCoachSelectableTasks(limit = 12) {
    const todayPending = typeof getTodayPendingTasks === 'function'
        ? getTodayPendingTasks()
        : (getTodayStats()?.pending || []);
    if (todayPending.length) {
        return rankTasksByNextStepScore(todayPending, getScoringContext()).slice(0, limit);
    }
    const all = S.tasks.filter(t => !t.completed);
    return rankTasksByNextStepScore(all, getScoringContext()).slice(0, limit);
}

/** Grok-style topbar: native select for task options (always available). */
function syncCoachTaskSelect(activeId) {
    const sel = document.getElementById('coach-task-select');
    if (!sel) return;
    const list = getCoachSelectableTasks(12);
    const cur = activeId != null ? String(activeId) : '';
    const opts = ['<option value="">選擇任務…</option>']
        .concat(list.map(t => {
            const label = `${t.name.length > 36 ? t.name.slice(0, 34) + '…' : t.name}（${t.duration || 30}分）`;
            return `<option value="${t.id}" ${String(t.id) === cur ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }));
    sel.innerHTML = opts.join('');
    if (cur && list.some(t => String(t.id) === cur)) sel.value = cur;
}

function updateCoachGuideButton(task, isGuiding) {
    const btn = document.getElementById('coach-guide-btn');
    if (!btn) return;
    if (task && !isGuiding) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function selectCoachTask(taskId) {
    if (taskId === '' || taskId == null) return;
    const id = Number(taskId);
    if (!Number.isFinite(id)) return;
    const task = S.tasks.find(t => t.id === id && !t.completed);
    if (!task) {
        showToast('找不到該任務', 'error');
        syncCoachTaskSelect(S.todayFocusTaskId);
        return;
    }
    if (S.focusSession?.taskId && S.focusSession.taskId !== id) {
        clearFocusTimer();
        S.focusSession = null;
        S.coachAgentMessages = [];
    }
    S.todayFocusTaskId = id;
    if (S.focusSession?.freeform) {
        S.focusSession = null;
        S.coachAgentMessages = [];
    }
    renderCoachAgentView();
    updateCoachContextBar();
    renderCoachQuickActions();
}

function renderCoachEmptyState(container) {
    // Empty focus strip — greeting lives in the thread (Grok style)
    container.innerHTML = '';
}

function toggleCoachKbTools() {
    const panel = document.getElementById('coach-tools-panel');
    const btn = document.getElementById('coach-tools-toggle');
    if (!panel) return;
    const open = panel.classList.toggle('hidden') === false;
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
        if (S.enterpriseSession) {
            document.getElementById('rag-kb-selector-wrap')?.classList.remove('hidden');
            try { window.renderRagKbCheckboxes?.(); } catch (_) {}
            try { updateRagSelectorChrome?.(); } catch (_) {}
        } else {
            showToast('加入團隊後可選知識庫', 'error');
            panel.classList.add('hidden');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        }
    }
}

/** Grow/shrink textarea to match typed lines (1 line empty → up to 6). */
function autoResizeCoachInput(el) {
    const input = el || document.getElementById('chat-input');
    if (!input) return;

    const cs = window.getComputedStyle(input);
    const fontSize = parseFloat(cs.fontSize) || 14.4;
    const lineHeight = (() => {
        const lh = cs.lineHeight;
        if (!lh || lh === 'normal') return fontSize * 1.35;
        const n = parseFloat(lh);
        return Number.isFinite(n) ? n : fontSize * 1.35;
    })();
    const minH = Math.ceil(lineHeight);          // 1 line
    const maxH = Math.ceil(lineHeight * 6);      // 6 lines

    // Collapse first so scrollHeight reflects content, not previous height
    input.style.height = '0px';
    input.style.overflowY = 'hidden';

    const contentH = input.scrollHeight || minH;
    const next = Math.min(maxH, Math.max(minH, contentH));
    input.style.height = `${next}px`;
    input.style.overflowY = contentH > maxH ? 'auto' : 'hidden';
    input.rows = 1;
}

function resetCoachInputSize() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = '';
    input.style.height = '';
    autoResizeCoachInput(input);
}

function renderCoachAgentView() {
    const ws = getCoachWorkspace();
    if (!ws) return;
    const task = getCoachTask();

    syncCoachTaskSelect(task?.id ?? null);

    if (!task) {
        renderCoachEmptyState(ws);
        updateCoachGuideButton(null, false);
        renderCoachAgentThread();
        updateCoachTaskKbBanner(null);
        return;
    }

    updateCoachTaskKbBanner(task);

    const session = S.focusSession?.taskId === task.id ? S.focusSession : null;
    const steps = session?.steps || getStepsForTask(task);
    const isActive = !!session?.coachActive && !session?.freeform;
    updateCoachGuideButton(task, isActive);

    // Not guiding → clean chat only (task is in top select)
    if (!isActive) {
        ws.innerHTML = '';
        renderCoachAgentThread();
        return;
    }

    const cur = Math.min(session.currentStep || 0, Math.max(0, steps.length - 1));
    const current = steps[cur] || { title: '步驟', action: task.name };
    const isLast = cur >= steps.length - 1;

    ws.innerHTML = `
        <div class="coach-focus-panel">
            <div class="coach-agent-session">
                <div class="coach-agent-session-header">
                    <span class="coach-agent-live"><i class="fa-solid fa-circle text-[6px]"></i> 進行中</span>
                    <span id="focus-timer-display" class="coach-agent-timer">--:--</span>
                    <span class="coach-agent-progress">${cur + 1} / ${steps.length}</span>
                </div>
                <div class="coach-agent-hero">
                    <div class="coach-agent-hero-label">現在</div>
                    <div class="coach-agent-hero-title">${escapeHtml(current.title)}</div>
                    <div class="coach-agent-hero-action">${escapeHtml(current.action)}</div>
                </div>
                <div class="coach-agent-steps-rail">
                    ${steps.map((s, i) => {
                        const cls = i < cur ? 'done' : i === cur ? 'active' : '';
                        return `<div class="coach-agent-rail-step ${cls}" title="${escapeHtml(s.title || '')}">
                            <span>${i + 1}</span>
                            <span class="truncate">${escapeHtml(s.title || '步驟')}</span>
                        </div>`;
                    }).join('')}
                </div>
                <div class="coach-agent-actions">
                    <button type="button" ${luminaAction(isLast ? 'coachCompleteTaskFromAgent' : 'coachAdvanceStepFromAgent')} class="coach-agent-btn-primary">
                        ${isLast ? '完成這件' : '完成這步'}
                    </button>
                    <button type="button" ${luminaAction('sendCoachAgentMessage', { arg: '卡住了' })} class="coach-agent-btn-secondary">卡住了</button>
                    <button type="button" ${luminaAction('coachPauseSession')} class="coach-agent-btn-ghost">暫停</button>
                </div>
            </div>
        </div>`;
    tickFocusTimer();
    renderCoachAgentThread();
}

function coachStartFocusNow() {
    showSection('coach');
    setTimeout(() => coachBeginGuidedSession(), 80);
}

function refreshCoachView() {
    if (S.coachRequestInFlight) return;
    updateCoachContextBar();
    renderCoachReadinessBar();
    renderCoachAgentView();
}

function askCoach(question) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = question;
    sendCoachAgentMessage();
}

/** Map option / short phrases to product actions (start step, seed, navigate). */
function handleCoachOptionShortcuts(msg) {
    const t = String(msg || '').trim();
    if (/一鍵體驗|範例任務/.test(t)) {
        if (typeof seedDemoFirstTask === 'function') seedDemoFirstTask();
        return true;
    }
    if (/去設定|看用量|用量/.test(t)) {
        if (typeof showSection === 'function') showSection('settings');
        try { if (typeof renderUsageMeter === 'function') renderUsageMeter(); } catch (_) {}
        return true;
    }
    if (/去今日|新增任務|建立一項今日/.test(t)) {
        if (typeof showSection === 'function') showSection('dashboard');
        if (typeof focusQuickAdd === 'function') focusQuickAdd();
        return true;
    }
    if (/^完成這件$/.test(t)) {
        if (getCoachTask()) coachCompleteTaskFromAgent();
        return !!getCoachTask();
    }
    // P1-5: option drives start / resume guided step
    if (/準備好|開始第一步|開始做|繼續執行|執行當前|我了解，繼續/.test(t)) {
        const task = getCoachTask();
        if (task) {
            ensureCoachSessionForTask(task);
            S.focusSession.coachActive = true;
            if (!S.focusSession.startedAt) S.focusSession.startedAt = Date.now();
            startStepTimerForCoach(S.focusSession);
            document.getElementById('next-step-card')?.classList.add('focus-session-active');
            if (typeof startTodayTask === 'function' && S.focusSession.taskId !== task.id) {
                startTodayTask(task.id, { quiet: true });
                S.focusSession.coachActive = true;
            }
            if (!S.coachAgentMessages.some(m => m.role === 'coach')) {
                pushCoachAgentMessage('coach', getOpeningCoachMessage(task, S.focusSession.steps));
            } else {
                const step = S.focusSession.steps[S.focusSession.currentStep];
                pushCoachAgentMessage('user', t);
                pushCoachAgentMessage('coach', `很好，我們開始「${step?.title || '這一步'}」：${step?.action || task.name}\n\n做完點「完成這步」。\n[選項: 完成這步]\n[選項: 卡住了]`);
            }
            renderCoachAgentView();
            showToast('已開始這一步', 'success');
            return true;
        }
    }
    return false;
}

async function sendCoachAgentMessage(preset) {
    const input = document.getElementById('chat-input');
    const msg = typeof preset === 'string' ? preset : (input?.value?.trim() || '');
    if (!msg) return;
    if (S.coachRequestInFlight) {
        showToast('教練還在回覆中，請稍候', 'error');
        return;
    }
    if (input && typeof preset !== 'string') {
        resetCoachInputSize();
    }

    // Local shortcuts from option chips (no LLM needed)
    if (handleCoachOptionShortcuts(msg)) return;

    const task = getCoachTask();
    const freeform = !task;

    if (task) {
        if (!S.focusSession?.coachActive) {
            ensureCoachSessionForTask(task);
            S.focusSession.coachActive = true;
            S.focusSession.startedAt = Date.now();
            if (!S.coachAgentMessages.length) {
                pushCoachAgentMessage('coach', getOpeningCoachMessage(task, S.focusSession.steps));
            }
            startStepTimerForCoach(S.focusSession);
            document.getElementById('next-step-card')?.classList.add('focus-session-active');
            renderCoachAgentView();
        }

        if (/^完成這步$|^做完了$|^好了$/.test(msg)) {
            const isLast = S.focusSession.currentStep >= S.focusSession.steps.length - 1;
            if (isLast) coachCompleteTaskFromAgent();
            else coachAdvanceStepFromAgent();
            return;
        }
    } else {
        // Knowledge Q&A without a task
        if (!S.focusSession || !S.focusSession.freeform) {
            S.focusSession = {
                taskId: null,
                freeform: true,
                coachActive: true,
                steps: [{ title: '知識問答', duration: '—', action: '依知識庫或一般教練回答' }],
                currentStep: 0,
                startedAt: Date.now()
            };
        }
        if (!S.coachAgentMessages.length) {
            pushCoachAgentMessage('coach', '目前是知識庫問答模式。直接問流程、SOP 或名詞；有任務後可點「教練帶我做」。\n\n[選項: 新人第一天要做什麼？]\n[選項: 一鍵體驗範例任務]');
        }
        renderCoachAgentView();
    }

    pushCoachAgentMessage('user', msg);
    renderCoachAgentThread(isApiReady() ? 'deepseek' : 'offline');
    S.coachRequestInFlight = true;

    try {
        if (typeof track === 'function') {
            track('coach_message', {
                freeform: !!freeform,
                hasTask: !!task,
                api: !!isApiReady()
            });
        }
    } catch (_) {}

    let result;
    try {
        if (isApiReady()) {
            result = await coachAgentRespondWithAI(msg, task, S.focusSession);
        } else {
            result = buildOfflineAgentReply(msg, task, S.focusSession);
            const skip = resolveCoachKbSkipReason(task);
            if (S.enterpriseSession && !result.meta) {
                result.meta = {
                    usedKnowledge: false,
                    kbSkipReason: skip || 'degraded',
                    taskBound: !!(task && (
                        (typeof getTaskBoundKbIds === 'function' && getTaskBoundKbIds(task).length) ||
                        (typeof getTaskBoundDocIds === 'function' && getTaskBoundDocIds(task).length)
                    ))
                };
            }
        }
    } catch (err) {
        if (err && err.code === 'USAGE_QUOTA') {
            S.coachRequestInFlight = false;
            showToast(err.message, 'error');
            pushCoachAgentMessage('coach', `${err.message}\n\n[選項: 去設定看用量]\n[選項: 換簡單一點]`);
            renderCoachAgentView();
            return;
        }
        console.warn('[Lumina Coach] AI 請求失敗，改用離線引導:', err.message);
        try {
            if (typeof track === 'function') {
                track('coach_error', { reason: 'ai_request', message: String(err.message || '').slice(0, 120) });
            }
        } catch (_) {}
        result = buildOfflineAgentReply(msg, task, S.focusSession);
        if (S.enterpriseSession && !result.meta) {
            result.meta = { usedKnowledge: false, kbSkipReason: 'degraded' };
        }
    } finally {
        S.coachRequestInFlight = false;
    }

    if (result?.meta?.usedKnowledge === true && result.meta.sourceCount === 0) {
        try {
            if (typeof track === 'function') track('rag_empty', { kbIds: result.meta.kbIds || [] });
        } catch (_) {}
    }

    pushCoachAgentMessage('coach', result.reply, result.sources, result.meta || null);
    try {
        if (result.sources?.length && typeof rememberCoachSourcesForMemory === 'function') {
            rememberCoachSourcesForMemory(result.sources);
        }
    } catch (_) {}
    if (!freeform && result.complete) {
        coachCompleteTaskFromAgent();
    } else if (!freeform && result.advance) {
        coachAdvanceStepFromAgent();
    } else {
        renderCoachAgentView();
    }
}

function sendChatMessage() { sendCoachAgentMessage(); }

function getCoachContext() {
    const stats = getTodayStats();
    const todayPending = stats.pending;
    const overdue = todayPending.filter(t => t.due < getTodayISO());
    const scoreCtx = getScoringContext();
    const nextTask = todayPending.length
        ? (resolveTodayFocusTask() || rankTasksByNextStepScore(todayPending, scoreCtx)[0])
        : getNextRecommendedTask('all');
    const activeGoals = [...new Set(
        S.tasks.filter(t => t.parentGoalName && !t.completed).map(t => t.parentGoalName)
    )].slice(0, 3);
    return {
        pendingCount: todayPending.length,
        totalPending: S.tasks.filter(t => !t.completed).length,
        overdueCount: overdue.length,
        completionRate: stats.rate,
        nextTask,
        activeGoals,
        peakWindow: `${S.userProfile.peakStart || '09:00'}-${S.userProfile.peakEnd || '12:30'}`
    };
}

function buildCoachContextText(ctx) {
    ctx = ctx || getCoachContext();
    const next = ctx.nextTask;
    const pendingList = S.tasks.filter(t => !t.completed && t.due <= getTodayISO()).slice(0, 5)
        .map(t => `- ${t.name}（${t.duration}分鐘・${getCategoryLabel(resolveCategory(t))}）`).join('\n');
    
    let text = `用戶：${S.userProfile.name}（${S.userProfile.role}）
今日完成率：${ctx.completionRate}%｜連續高效 ${S.userProfile.streak} 天｜高效時段 ${ctx.peakWindow}
今日待辦 ${ctx.pendingCount} 項${ctx.overdueCount > 0 ? `（${ctx.overdueCount} 項逾期）` : ''}：
${pendingList || '（今日無待辦）'}
${next ? `系統推薦的今日第一步：「${next.name}」（${next.duration} 分鐘）` : '尚無推薦任務，建議先分解一個大目標'}
${ctx.activeGoals.length ? `進行中的大目標：${ctx.activeGoals.join('、')}` : ''}`;

    try {
        if (typeof buildExecMemoryContextText === 'function') {
            text += buildExecMemoryContextText(5);
        }
    } catch (_) {}

    if (S.enterpriseSession && S.enterpriseGroupData?.documents?.length) {
        const coachTask = typeof getCoachTask === 'function' ? getCoachTask() : null;
        const boundKb = typeof getTaskBoundKbIds === 'function' ? getTaskBoundKbIds(coachTask) : [];
        const boundDocs = typeof getTaskBoundDocIds === 'function' ? getTaskBoundDocIds(coachTask) : [];
        let docs = S.enterpriseGroupData.documents.filter(d => d && d.status !== 'deleted');
        if (boundDocs.length) {
            const set = new Set(boundDocs);
            docs = docs.filter(d => set.has(d.id));
        } else if (boundKb.length) {
            const set = new Set(boundKb);
            docs = docs.filter(d => set.has(d.kbId || 'general'));
        }
        docs = docs.slice(0, 6);
        if (docs.length) {
            // Cap per-doc + total payload so coach stays fast and within model context
            const perDoc = 900;
            const maxTotal = 3200;
            let used = 0;
            const parts = [];
            for (const d of docs) {
                if (used >= maxTotal) break;
                const body = String(d.content || d.summary || '').slice(0, Math.min(perDoc, maxTotal - used));
                if (!body.trim()) {
                    parts.push(`--- 文件名稱：${d.title || d.filename || '未命名'} ---\n（無內文摘要，僅檔名可作引用提示）`);
                    continue;
                }
                used += body.length;
                parts.push(`--- 文件名稱：${d.title || d.filename || '未命名'} ---\n${body}`);
            }
            const docText = parts.join('\n\n');
            const scope = boundDocs.length
                ? '（本任務綁定文件）'
                : (boundKb.length ? '（本任務綁定庫）' : '');
            text += `\n\n=== 團隊共享知識庫與新人資料${scope} ===\n${docText}\n=================================\n注意：若問題涉及專案流程或工作指南，優先依上方知識庫內容回答；不足處可明確說明需查完整文件。`;
        }
    }
    
    return text;
}

function updateCoachContextBar() {
    const bar = document.getElementById('coach-context-bar');
    if (!bar) return;
    const ctx = getCoachContext();
    const chips = [
        `今日 ${ctx.completionRate}%`,
        `待辦 ${ctx.pendingCount} 項`,
        ctx.nextTask ? `下一步：${ctx.nextTask.name.slice(0, 18)}${ctx.nextTask.name.length > 18 ? '…' : ''}` : '尚無任務'
    ];
    bar.innerHTML = chips.map(c => `<span class="coach-context-chip">${escapeHtml(c)}</span>`).join('');
}

function getCoachReadinessChecks() {
    const hasTeam = !!S.enterpriseSession;
    const teamOnline = hasTeam && !S.enterpriseSession.offline;
    const task = typeof getCoachTask === 'function' ? getCoachTask() : null;
    const taskBoundKb = typeof getTaskBoundKbIds === 'function' ? getTaskBoundKbIds(task) : [];
    const taskBoundDocs = typeof getTaskBoundDocIds === 'function' ? getTaskBoundDocIds(task) : [];
    const taskBound = taskBoundKb.length > 0 || taskBoundDocs.length > 0;
    const kbOk = S.ragServiceActive && (taskBound || (S.checkedRagKbs?.length > 0));
    return [
        { id: 'login', label: '已登入', ok: isLoggedIn(), action: 'showAuthOverlay', actionArg: 'login' },
        { id: 'team', label: '已加入團隊', ok: teamOnline, action: 'showSection', actionArg: 'team' },
        { id: 'rag', label: 'RAG 服務', ok: S.ragServiceActive, action: null },
        {
            id: 'kb',
            label: taskBoundDocs.length ? '任務已綁定文件' : (taskBoundKb.length ? '任務已綁定庫' : '已選知識庫'),
            ok: kbOk,
            action: null
        },
        { id: 'api', label: 'AI 連線', ok: isApiReady(), action: 'showSection', actionArg: 'settings' }
    ];
}

/** Failed index docs that hurt coach answers — visible to all team members */
function getCoachFailedIndexDocs(limit = 5) {
    if (!S.enterpriseSession) return [];
    if (typeof resolveDocRagStatus !== 'function') return [];
    const docs = S.enterpriseGroupData?.documents || [];
    return docs
        .filter(d => resolveDocRagStatus(d) === 'failed')
        .slice(0, limit);
}

function renderCoachReadinessBar() {
    const bar = document.getElementById('coach-readiness-bar');
    if (!bar) return;
    const checks = getCoachReadinessChecks();
    const failedDocs = getCoachFailedIndexDocs(5);
    const allReady = checks.every(c => c.ok);

    if (allReady && failedDocs.length === 0) {
        bar.classList.add('hidden');
        bar.innerHTML = '';
        return;
    }

    bar.classList.remove('hidden');
    const readinessBlock = allReady
        ? ''
        : `
        <div class="coach-readiness-title">知識庫教練就緒檢查</div>
        <div class="coach-readiness-chips">
            ${checks.map(c => `
                <button type="button"
                    class="coach-readiness-chip ${c.ok ? 'ok' : 'missing'}"
                    ${!c.ok && c.action ? luminaAction(c.action, { arg: c.actionArg }) : 'disabled'}>
                    <i class="fa-solid fa-${c.ok ? 'check' : 'circle-exclamation'}"></i>
                    <span>${escapeHtml(c.label)}</span>
                </button>
            `).join('')}
        </div>`;

    const failedBlock = failedDocs.length === 0
        ? ''
        : `
        <div class="coach-failed-docs">
            <div class="coach-failed-docs-title">
                <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
                ${failedDocs.length} 份文件索引失敗（教練可能查不到）
            </div>
            <div class="coach-failed-docs-list">
                ${failedDocs.map(d => {
                    const code = d.rag?.lastErrorCode ? ` · ${escapeHtml(d.rag.lastErrorCode)}` : '';
                    return `
                    <div class="coach-failed-doc-row">
                        <span class="coach-failed-doc-title" title="${escapeHtml(d.rag?.lastError || '')}">${escapeHtml(d.title || '未命名')}${code}</span>
                        <button type="button" class="coach-failed-retry-btn focus-ring"
                            ${luminaAction('retryDocumentRagIndex', { arg: d.id })}>
                            <i class="fa-solid fa-rotate-right"></i> 重試
                        </button>
                    </div>`;
                }).join('')}
            </div>
            <button type="button" class="coach-failed-goto-team text-[10px] text-indigo-300 hover:text-indigo-200 mt-1"
                ${luminaAction('openTeamKnowledgeTab')}>
                前往團隊知識庫 →
            </button>
        </div>`;

    bar.innerHTML = readinessBlock + failedBlock;
}

function renderCoachQuickActions() {
    const container = document.getElementById('coach-quick-actions');
    if (!container) return;
    const ctx = getCoachContext();
    const actions = [];
    if (ctx.nextTask) {
        if (!S.focusSession?.coachActive || S.focusSession?.freeform) {
            actions.push({ label: '教練帶我做', action: 'coachBeginGuidedSession' });
        }
        actions.push({ label: '卡住了', action: 'sendCoachAgentMessage', arg: '卡住了' });
        actions.push({ label: '完成這步', action: 'sendCoachAgentMessage', arg: '完成這步' });
        actions.push({ label: '換簡單點', action: 'sendCoachAgentMessage', arg: '太難了，換簡單一點' });
    } else {
        actions.push({ label: '問知識庫', action: 'askCoach', arg: '請依知識庫說明重點流程' });
        actions.push({ label: '分解目標', action: 'openDecomposeTab' });
        actions.push({ label: '一鍵體驗', action: 'seedDemoFirstTask' });
    }
    container.innerHTML = actions.map(a =>
        `<button type="button" ${luminaAction(a.action, a.arg !== undefined ? { arg: a.arg } : {})} class="coach-quick-btn">${escapeHtml(a.label)}</button>`
    ).join('');
}

function openCoachForNextTask() {
    const next = resolveTodayFocusTask() || getNextRecommendedTask('today');
    if (!next) {
        try {
            if (typeof track === 'function') {
                track('coach_open', { hasTask: false, source: 'openCoachForNextTask' });
            }
        } catch (_) {}
        // Phase 1: go coach freeform or dashboard quick-add, not force decompose
        showSection('coach');
        showToast('先加一項今日任務，或直接問教練', 'success');
        setTimeout(() => {
            try { if (typeof focusQuickAdd === 'function') { /* stay coach */ } } catch (_) {}
            try { refreshCoachView(); } catch (_) {}
        }, 80);
        return;
    }
    openCoachForTask(next.id);
}
