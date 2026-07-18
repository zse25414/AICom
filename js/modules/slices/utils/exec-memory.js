/* Lumina: utils/exec-memory.js — Phase 4 execution memory (moat) */
const EXEC_MEMORY_KEY = 'lumina_exec_memory_v1';
const EXEC_MEMORY_MAX = 80;

function _readExecMemory() {
    try {
        const raw = localStorage.getItem(EXEC_MEMORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

function _writeExecMemory(arr) {
    try {
        localStorage.setItem(EXEC_MEMORY_KEY, JSON.stringify(arr.slice(-EXEC_MEMORY_MAX)));
    } catch (_) {}
}

/**
 * @param {object} entry
 */
function recordExecMemory(entry) {
    if (!entry || typeof entry !== 'object') return;
    const row = {
        ts: new Date().toISOString(),
        type: entry.type || 'note',
        taskId: entry.taskId ?? null,
        taskName: entry.taskName ? String(entry.taskName).slice(0, 120) : null,
        completed: !!entry.completed,
        templateId: entry.templateId || null,
        templateName: entry.templateName || null,
        taskCount: entry.taskCount ?? null,
        coachTurns: entry.coachTurns ?? null,
        sources: Array.isArray(entry.sources)
            ? entry.sources.slice(0, 5).map(s => ({
                filename: String(s.filename || s.title || '').slice(0, 80),
                kb_id: s.kb_id || s.kbId || null
            }))
            : [],
        note: entry.note ? String(entry.note).slice(0, 200) : null
    };
    const buf = _readExecMemory();
    buf.push(row);
    _writeExecMemory(buf);
    try {
        if (typeof track === 'function') {
            track('exec_memory', { type: row.type, hasSources: row.sources.length > 0 });
        }
    } catch (_) {}
}

function getExecMemory(limit = 20) {
    return _readExecMemory().slice(-Math.max(1, limit)).reverse();
}

/** Short text for coach system context */
function buildExecMemoryContextText(limit = 5) {
    const items = getExecMemory(limit).filter(e => e.type === 'task_completed' || e.type === 'template_applied');
    if (!items.length) return '';
    const lines = items.map(e => {
        if (e.type === 'template_applied') {
            return `- 套用模板「${e.templateName}」（${e.taskCount || '?'} 項）`;
        }
        const src = e.sources?.length
            ? `；引用：${e.sources.map(s => s.filename).filter(Boolean).join('、')}`
            : '';
        return `- 完成「${e.taskName || '任務'}」${src}`;
    });
    return `\n=== 最近執行記憶（請延續用戶工作節奏，勿重複已完成） ===\n${lines.join('\n')}\n`;
}

/**
 * Snapshot last coach sources onto session for next completion.
 */
function rememberCoachSourcesForMemory(sources) {
    if (!Array.isArray(sources) || !sources.length) return;
    try {
        S._lastCoachSources = sources.slice(0, 5).map(s => ({
            filename: s.filename || s.title || '',
            kb_id: s.kb_id || s.kbId || null
        }));
    } catch (_) {}
}

function recordTaskCompletionMemory(task) {
    if (!task) return;
    const sources = (S && Array.isArray(S._lastCoachSources)) ? S._lastCoachSources : [];
    const coachTurns = Array.isArray(S?.coachAgentMessages) ? S.coachAgentMessages.length : null;
    recordExecMemory({
        type: 'task_completed',
        taskId: task.id,
        taskName: task.name,
        completed: true,
        templateId: task.templateId || null,
        coachTurns,
        sources
    });
    try { S._lastCoachSources = []; } catch (_) {}
}

function renderExecMemoryPanel() {
    const el = document.getElementById('exec-memory-panel');
    if (!el) return;
    const items = getExecMemory(6);
    if (!items.length) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="exec-mem-head">
            <span class="exec-mem-title"><i class="fa-solid fa-clock-rotate-left"></i> 執行記憶</span>
            <span class="exec-mem-sub">完成與引用會累積，教練會參考節奏</span>
        </div>
        <ul class="exec-mem-list">
            ${items.map(e => {
                const when = (e.ts || '').replace('T', ' ').slice(0, 16);
                if (e.type === 'template_applied') {
                    return `<li><span class="exec-mem-time">${escapeHtml(when)}</span> 模板 <strong>${escapeHtml(e.templateName || '')}</strong></li>`;
                }
                const src = e.sources?.length
                    ? ` · ${escapeHtml(e.sources.map(s => s.filename).filter(Boolean).slice(0, 2).join('、'))}`
                    : '';
                return `<li><span class="exec-mem-time">${escapeHtml(when)}</span> 完成 <strong>${escapeHtml(e.taskName || '')}</strong>${src}</li>`;
            }).join('')}
        </ul>
    `;
}

function getKnowledgeHealthSummary() {
    const docs = S.enterpriseGroupData?.documents || [];
    if (!docs.length) {
        return { total: 0, indexed: 0, pending: 0, failed: 0, ok: true, hasTeam: !!S.enterpriseSession };
    }
    let indexed = 0;
    let pending = 0;
    let failed = 0;
    const resolve = typeof resolveDocRagStatus === 'function' ? resolveDocRagStatus : () => 'unknown';
    docs.forEach(d => {
        if (!d || d.status === 'deleted') return;
        const st = resolve(d);
        if (st === 'indexed' || st === 'ready' || st === 'ok') indexed++;
        else if (st === 'pending' || st === 'indexing') pending++;
        else if (st === 'failed' || st === 'error') failed++;
    });
    const total = docs.filter(d => d && d.status !== 'deleted').length;
    return {
        total,
        indexed,
        pending,
        failed,
        ok: failed === 0 && pending === 0,
        hasTeam: !!S.enterpriseSession
    };
}

function renderKnowledgeHealthPanel() {
    const el = document.getElementById('kb-health-panel');
    if (!el) return;
    if (!S.enterpriseSession) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    const h = getKnowledgeHealthSummary();
    el.classList.remove('hidden');
    const tone = h.failed > 0 ? 'bad' : (h.pending > 0 ? 'warn' : 'ok');
    el.innerHTML = `
        <div class="kb-health kb-health-${tone}">
            <div class="kb-health-title"><i class="fa-solid fa-database"></i> 知識庫健康</div>
            <div class="kb-health-stats">
                <span>文件 ${h.total}</span>
                <span>已索引 ${h.indexed}</span>
                <span>處理中 ${h.pending}</span>
                <span>失敗 ${h.failed}</span>
            </div>
            <div class="kb-health-actions">
                <button type="button" class="kb-health-btn" data-lumina-action="openTeamKnowledgeTab">前往知識庫</button>
            </div>
        </div>
    `;
}

if (typeof window !== 'undefined') {
    window.recordExecMemory = recordExecMemory;
    window.getExecMemory = getExecMemory;
    window.buildExecMemoryContextText = buildExecMemoryContextText;
    window.rememberCoachSourcesForMemory = rememberCoachSourcesForMemory;
    window.recordTaskCompletionMemory = recordTaskCompletionMemory;
    window.renderExecMemoryPanel = renderExecMemoryPanel;
    window.getKnowledgeHealthSummary = getKnowledgeHealthSummary;
    window.renderKnowledgeHealthPanel = renderKnowledgeHealthPanel;
}
