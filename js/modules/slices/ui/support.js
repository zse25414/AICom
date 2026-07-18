/* Lumina: ui/support.js — in-app report / support path (P1-6) */

const SUPPORT_REPORTS_KEY = 'lumina_support_reports_v1';
const MAX_LOCAL_REPORTS = 20;

function getSupportContactEmail() {
    // Optional deploy-time override (set on window by host page or env inject)
    try {
        const w = typeof window !== 'undefined' ? window.__LUMINA_SUPPORT_EMAIL__ : '';
        if (w && String(w).includes('@')) return String(w).trim();
    } catch (_) {}
    return 'support@example.com';
}

function collectSupportDiagnostics() {
    const store = typeof S !== 'undefined' ? S : null;
    const profile = store?.userProfile || {};
    let readySnippet = '';
    try {
        readySnippet = [
            `apiEnabled=${!!profile.apiEnabled}`,
            `apiMode=${profile.apiMode || '—'}`,
            `hasKey=${typeof hasStoredApiKey === 'function' ? hasStoredApiKey() : '—'}`,
            `rag=${store?.ragServiceActive ? 'up' : 'down'}`,
            `team=${store?.enterpriseSession ? (store.enterpriseSession.groupCode || 'yes') : 'no'}`,
            `tasks=${Array.isArray(store?.tasks) ? store.tasks.length : 0}`,
            `loggedIn=${typeof isLoggedIn === 'function' ? !!isLoggedIn() : '—'}`
        ].join(' · ');
    } catch (_) {
        readySnippet = 'diag unavailable';
    }
    return {
        at: new Date().toISOString(),
        href: typeof location !== 'undefined' ? String(location.href || '').slice(0, 200) : '',
        ua: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 180) : '',
        readySnippet,
        offline: typeof navigator !== 'undefined' ? !navigator.onLine : false
    };
}

function loadLocalSupportReports() {
    try {
        const raw = localStorage.getItem(SUPPORT_REPORTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (_) {
        return [];
    }
}

function saveLocalSupportReport(entry) {
    const list = loadLocalSupportReports();
    list.unshift(entry);
    while (list.length > MAX_LOCAL_REPORTS) list.pop();
    try {
        localStorage.setItem(SUPPORT_REPORTS_KEY, JSON.stringify(list));
    } catch (_) {}
    return list;
}

function formatSupportReportBody(entry) {
    return [
        `【Lumina 問題回報】`,
        `類型：${entry.kind || 'bug'}`,
        `時間：${entry.at || ''}`,
        ``,
        `描述：`,
        entry.message || '（無）',
        ``,
        `—— 診斷（可一併貼給工程）——`,
        `URL：${entry.href || ''}`,
        `狀態：${entry.readySnippet || ''}`,
        `UA：${entry.ua || ''}`,
        entry.offline ? `離線：是` : `離線：否`
    ].join('\n');
}

function openReportIssue() {
    const overlay = document.getElementById('report-issue-overlay');
    if (!overlay) {
        showToast('回報介面未載入', 'error');
        return;
    }
    const diag = collectSupportDiagnostics();
    try { if (typeof track === 'function') track('support_report_open', {}); } catch (_) {}
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
        <div class="auth-card max-w-md w-full" data-lumina-stop>
            <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-slate-500">本機回報 · 不自動上傳</span>
                <button type="button" data-lumina-action="closeReportIssue" class="text-slate-500 hover:text-slate-300 text-sm px-2" aria-label="關閉">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <h2 id="report-issue-title" class="text-lg font-semibold tracking-tight mb-2">回報問題</h2>
            <p class="text-[11px] text-slate-500 mb-3 leading-relaxed">寫下發生什麼、期望結果、重現步驟。可複製全文或開郵件寄給 on-call。</p>
            <label class="text-xs text-slate-400 block mb-1">類型</label>
            <select id="report-issue-kind" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm focus-ring mb-3">
                <option value="bug">Bug／異常</option>
                <option value="ux">不好用／卡關</option>
                <option value="idea">功能建議</option>
                <option value="other">其他</option>
            </select>
            <label class="text-xs text-slate-400 block mb-1">描述</label>
            <textarea id="report-issue-message" rows="5" maxlength="2000" placeholder="例：在教練頁按「完成這步」後畫面卡住；期望能進入下一步…"
                      class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm focus-ring resize-y"></textarea>
            <div class="mt-3 text-[10px] text-slate-500 leading-relaxed rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-2">
                <div class="font-medium text-slate-400 mb-1">診斷摘要</div>
                <div id="report-issue-diag">${typeof escapeHtml === 'function' ? escapeHtml(diag.readySnippet) : diag.readySnippet}</div>
            </div>
            <p id="report-issue-status" class="text-[11px] text-slate-400 mt-2 min-h-[1.25rem]" role="status"></p>
            <div class="flex flex-wrap gap-2 mt-4">
                <button type="button" data-lumina-action="submitReportIssue" class="flex-1 text-sm px-4 py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-medium">
                    複製回報全文
                </button>
                <button type="button" data-lumina-action="mailtoReportIssue" class="text-sm px-4 py-2.5 rounded-2xl border border-slate-700 text-slate-300 hover:bg-slate-800">
                    開郵件
                </button>
            </div>
            <button type="button" data-lumina-action="closeReportIssue" class="w-full mt-2 text-[11px] text-slate-500 hover:text-slate-300 py-1">關閉</button>
        </div>`;
    // stash diagnostics for submit
    S._reportDiag = diag;
}

function closeReportIssue() {
    document.getElementById('report-issue-overlay')?.classList.add('hidden');
    S._reportDiag = null;
}

function buildReportEntryFromForm() {
    const kind = document.getElementById('report-issue-kind')?.value || 'bug';
    const message = (document.getElementById('report-issue-message')?.value || '').trim();
    if (!message) {
        const st = document.getElementById('report-issue-status');
        if (st) st.textContent = '請先填寫描述';
        return null;
    }
    const diag = S._reportDiag || collectSupportDiagnostics();
    return {
        id: `r_${Date.now()}`,
        kind,
        message: message.slice(0, 2000),
        ...diag
    };
}

async function submitReportIssue() {
    const entry = buildReportEntryFromForm();
    if (!entry) return;
    saveLocalSupportReport(entry);
    const body = formatSupportReportBody(entry);
    let copied = false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(body);
            copied = true;
        }
    } catch (_) {}
    try {
        if (typeof track === 'function') track('support_report', { kind: entry.kind, copied });
    } catch (_) {}
    const st = document.getElementById('report-issue-status');
    if (st) {
        st.textContent = copied
            ? '已複製到剪貼簿，可貼到工單／聊天室。'
            : '已存本機紀錄（剪貼簿不可用，請用「開郵件」）。';
        st.className = 'text-[11px] text-emerald-400 mt-2 min-h-[1.25rem]';
    }
    showToast(copied ? '回報全文已複製' : '回報已存本機', 'success');
}

function mailtoReportIssue() {
    const entry = buildReportEntryFromForm();
    if (!entry) return;
    saveLocalSupportReport(entry);
    const body = formatSupportReportBody(entry);
    const email = getSupportContactEmail();
    const subject = encodeURIComponent(`[Lumina] ${entry.kind}: ${entry.message.slice(0, 40)}`);
    const mailBody = encodeURIComponent(body);
    try {
        if (typeof track === 'function') track('support_report_mailto', { kind: entry.kind });
    } catch (_) {}
    window.location.href = `mailto:${email}?subject=${subject}&body=${mailBody}`;
    showToast('已開啟郵件草稿', 'success');
}
