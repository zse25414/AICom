/* Lumina: coach/keywizard.js — AI 連線設定嚮導（P5-A1 / P1-2）
   給第一次接觸的使用者一條被牽著走的 key 設定路：
   說明 → 申請 → 貼上（可選本機記住）→ 測試 → 完成。 */

const KEY_WIZARD_TOTAL_STEPS = 5;

function openKeyWizard() {
    S.keyWizardStep = 0;
    S.keyWizardTested = false;
    try { if (typeof track === 'function') track('key_wizard_open', {}); } catch (_) {}
    renderKeyWizard();
    document.getElementById('key-wizard-overlay')?.classList.remove('hidden');
}

function closeKeyWizard() {
    document.getElementById('key-wizard-overlay')?.classList.add('hidden');
}

function keyWizardBack() {
    if (S.keyWizardStep > 0) S.keyWizardStep--;
    renderKeyWizard();
}

function keyWizardNext() {
    // 貼上步驟離開前先把 key 存起來（與設定頁 saveSettings 行為一致）
    if (S.keyWizardStep === 2) {
        const input = document.getElementById('key-wizard-input');
        const key = input?.value?.trim() || '';
        if (!key) {
            const err = document.getElementById('key-wizard-error');
            if (err) err.textContent = '請先貼上 API Key，或按「稍後再說」離開';
            return;
        }
        const persist = !!document.getElementById('key-wizard-persist')?.checked;
        setStoredApiKey(key, { persist });
        S.userProfile.apiEnabled = true;
        S.userProfile.apiMode = S.userProfile.apiMode || 'direct';
        persistProfile();
    }
    if (S.keyWizardStep < KEY_WIZARD_TOTAL_STEPS - 1) S.keyWizardStep++;
    renderKeyWizard();
}

function keyWizardFinish() {
    closeKeyWizard();
    try { if (typeof track === 'function') track('key_wizard_done', { tested: !!S.keyWizardTested }); } catch (_) {}
    if (typeof updateApiStatusBadge === 'function') updateApiStatusBadge();
    showToast(S.keyWizardTested ? '✅ AI 已連線，教練回覆升級完成' : 'Key 已儲存，可隨時在設定頁測試連線', 'success');
    if (typeof showSection === 'function') showSection('coach');
    try { if (typeof refreshCoachView === 'function') refreshCoachView(); } catch (_) {}
}

async function keyWizardTest() {
    const btn = document.getElementById('key-wizard-test-btn');
    const status = document.getElementById('key-wizard-test-status');
    if (!getStoredApiKey()) {
        if (status) status.innerHTML = '<span class="text-amber-400">尚未儲存 Key，請回上一步貼上</span>';
        return;
    }
    if (btn) btn.disabled = true;
    if (status) status.innerHTML = '<span class="text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-1"></i>測試中…</span>';
    try {
        await callDeepSeek([{ role: 'user', content: '請回覆：連線成功' }], {
            temperature: 0, skipQuota: true, source: 'api_test'
        });
        S.keyWizardTested = true;
        if (status) status.innerHTML = '<span class="text-emerald-400"><i class="fa-solid fa-circle-check mr-1"></i>連線成功！</span>';
        if (typeof updateApiStatusBadge === 'function') updateApiStatusBadge();
        setTimeout(() => { S.keyWizardStep = 4; renderKeyWizard(); }, 700);
    } catch (err) {
        if (status) status.innerHTML = `<span class="text-red-400"><i class="fa-solid fa-circle-xmark mr-1"></i>${escapeHtml(err.message || '連線失敗')}</span>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

function keyWizardStepBody(step) {
    if (step === 0) {
        return `
            <p class="text-sm text-slate-300 leading-relaxed">你現在用的是<strong>內建規則引導</strong>——不用設定就能完整使用。連上 AI 之後，教練會：</p>
            <ul class="text-sm text-slate-300 mt-3 space-y-2">
                <li><i class="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i>依你的任務與情境給個人化回覆</li>
                <li><i class="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i>把大目標拆得更貼合實際</li>
                <li><i class="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i>用團隊知識庫生成有引用來源的回答</li>
            </ul>
            <div class="mt-4 text-[11px] text-slate-500 leading-relaxed rounded-2xl border border-slate-800 bg-slate-950/50 px-3.5 py-2.5">
                <i class="fa-solid fa-lock mr-1"></i>預設只存瀏覽器工作階段（關閉分頁即清除）；可在貼上時勾選「本機記住」。<br>
                <i class="fa-solid fa-coins mr-1"></i>DeepSeek 按用量計費，一般教練對話單次成本遠低於 NT$0.1。
            </div>`;
    }
    if (step === 1) {
        return `
            <p class="text-sm text-slate-300 leading-relaxed">到 DeepSeek 開放平台申請一把 API Key（約 1 分鐘）：</p>
            <ol class="text-sm text-slate-300 mt-3 space-y-2 list-decimal list-inside">
                <li>註冊／登入 DeepSeek 帳號</li>
                <li>左側「API Keys」→「Create new API key」</li>
                <li>複製產生的 <code class="text-indigo-300 font-mono">sk-…</code>（只會顯示一次）</li>
            </ol>
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer"
               class="mt-4 inline-flex items-center gap-x-2 text-sm px-4 py-2.5 rounded-2xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>開啟 DeepSeek 平台
            </a>
            <p class="text-[11px] text-slate-500 mt-3">新帳號通常需先儲值最低額度才能呼叫 API。</p>`;
    }
    if (step === 2) {
        const persistChecked = typeof isApiKeyPersisted === 'function' && isApiKeyPersisted() ? 'checked' : '';
        return `
            <p class="text-sm text-slate-300 leading-relaxed">把剛才複製的 Key 貼在這裡：</p>
            <input id="key-wizard-input" type="password" placeholder="sk-..." autocomplete="off"
                   class="mt-3 w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm focus-ring font-mono"
                   value="${escapeHtml(getStoredApiKey())}">
            <label class="mt-3 flex items-start gap-x-2.5 cursor-pointer text-sm text-slate-300">
                <input id="key-wizard-persist" type="checkbox" class="accent-violet-500 w-4 h-4 mt-0.5 flex-shrink-0" ${persistChecked}>
                <span>本機記住此 Key（關閉瀏覽器後仍保留；僅存你這台裝置的 localStorage）</span>
            </label>
            <p id="key-wizard-error" class="text-[11px] text-amber-400 mt-2" role="alert"></p>
            <p class="text-[11px] text-slate-500 mt-1">按「下一步」即儲存並啟用 AI。預設僅本工作階段有效。</p>`;
    }
    if (step === 3) {
        return `
            <p class="text-sm text-slate-300 leading-relaxed">最後一步：確認 Key 可以用。</p>
            <button type="button" id="key-wizard-test-btn" data-lumina-action="keyWizardTest"
                    class="mt-4 w-full text-sm px-4 py-2.5 rounded-2xl border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 flex items-center justify-center gap-x-2">
                <i class="fa-solid fa-plug"></i><span>測試 AI 連線</span>
            </button>
            <div id="key-wizard-test-status" class="text-sm mt-3 min-h-[1.5rem]" aria-live="polite"></div>
            <button type="button" data-lumina-action="keyWizardNext" class="text-[11px] text-slate-500 hover:text-slate-300 underline mt-1">
                跳過測試，稍後在設定頁再測
            </button>`;
    }
    const persistHint = typeof isApiKeyPersisted === 'function' && isApiKeyPersisted()
        ? '本機已記住 Key，下次開啟仍可直接使用。'
        : 'Key 存在瀏覽器工作階段；關閉分頁後需重新貼上（可回設定勾選「本機記住」）。';
    return `
        <div class="text-center py-2">
            <div class="text-4xl mb-3">${S.keyWizardTested ? '🎉' : '👌'}</div>
            <p class="text-sm text-slate-300 leading-relaxed">${S.keyWizardTested
                ? 'AI 已連線！教練現在會給你個人化的回覆與拆解。'
                : 'Key 已儲存並啟用。之後可隨時在「設定 → DeepSeek AI 連線」測試或更換。'}</p>
            <p class="text-[11px] text-slate-500 mt-3">${persistHint}</p>
        </div>`;
}

function renderKeyWizard() {
    const overlay = document.getElementById('key-wizard-overlay');
    if (!overlay) return;
    const step = S.keyWizardStep || 0;
    const titles = ['連上 AI，教練更懂你', '申請 DeepSeek Key', '貼上你的 Key', '測試連線', '完成'];
    const isLast = step === KEY_WIZARD_TOTAL_STEPS - 1;
    overlay.innerHTML = `
        <div class="auth-card" data-lumina-stop>
            <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-slate-500">步驟 ${step + 1} / ${KEY_WIZARD_TOTAL_STEPS}</span>
                <button type="button" data-lumina-action="closeKeyWizard" class="text-slate-500 hover:text-slate-300 text-sm px-2" aria-label="關閉">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <h2 id="key-wizard-title" class="text-lg font-semibold tracking-tight mb-3">${titles[step]}</h2>
            <div>${keyWizardStepBody(step)}</div>
            <div class="flex items-center gap-x-2 mt-5">
                ${step > 0 && !isLast ? `<button type="button" data-lumina-action="keyWizardBack" class="text-sm px-4 py-2.5 rounded-2xl border border-slate-700 text-slate-300 hover:bg-slate-800">上一步</button>` : ''}
                ${isLast
                    ? `<button type="button" data-lumina-action="keyWizardFinish" class="flex-1 text-sm px-4 py-2.5 rounded-2xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">開始使用</button>`
                    : step === 3
                        ? `<span class="flex-1"></span>`
                        : `<button type="button" data-lumina-action="keyWizardNext" class="flex-1 text-sm px-4 py-2.5 rounded-2xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">下一步</button>`}
                ${!isLast ? `<button type="button" data-lumina-action="closeKeyWizard" class="text-[11px] text-slate-500 hover:text-slate-300 px-2">稍後再說</button>` : ''}
            </div>
        </div>`;
}

/** 離線教練回覆尾端的一次性升級提示（每個工作階段最多一次） */
function maybeAppendAiUpgradeHint(result) {
    try {
        if (typeof isApiReady === 'function' && isApiReady()) return result;
        if (S.coachAiHintShown) return result;
        if (!result || !result.reply) return result;
        S.coachAiHintShown = true;
        result.reply += '\n\n💡 目前是內建規則引導，設定完成後教練回覆會更貼合你的任務。\n[選項: 連上 AI（約 1 分鐘）]';
    } catch (_) {}
    return result;
}
