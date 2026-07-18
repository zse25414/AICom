/* Lumina: storage/api.js */
function hasStoredApiKey() {
    return !!getStoredApiKey();
}

function migrateApiSettings() {
    if (hasStoredApiKey() && !S.userProfile.apiEnabled && S.userProfile.apiMode !== 'proxy') {
        S.userProfile.apiEnabled = true;
        persistProfile();
    }
}

function migrateApiKeyStorage() {
    const legacy = localStorage.getItem(C.API_KEY_STORAGE);
    if (legacy && !sessionStorage.getItem(C.API_KEY_STORAGE)) {
        sessionStorage.setItem(C.API_KEY_STORAGE, legacy);
        localStorage.removeItem(C.API_KEY_STORAGE);
    }
}

function getStoredApiKey() {
    return (sessionStorage.getItem(C.API_KEY_STORAGE) || '').trim();
}

function setStoredApiKey(key) {
    const trimmed = String(key || '').trim();
    if (trimmed) sessionStorage.setItem(C.API_KEY_STORAGE, trimmed);
    else sessionStorage.removeItem(C.API_KEY_STORAGE);
    localStorage.removeItem(C.API_KEY_STORAGE);
}

function getDeepSeekClientCredentials() {
    if (!S.userProfile.apiEnabled) return {};
    if (S.userProfile.apiMode === 'proxy') return {};
    const apiKey = getStoredApiKey();
    if (!apiKey) return {};
    return {
        deepseek_api_key: apiKey,
        api_base: 'https://api.deepseek.com/v1'
    };
}

function isApiReady() {
    if (!S.userProfile.apiEnabled) return false;
    if (S.userProfile.apiMode === 'proxy') return !!S.userProfile.apiProxyUrl;
    return hasStoredApiKey();
}

function updateApiStatusBadge() {
    const badge = document.getElementById('api-status-badge');
    if (!badge) return;
    if (isApiReady()) {
        badge.textContent = S.userProfile.apiMode === 'proxy' ? '代理模式' : 'DeepSeek 已啟用';
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300';
    } else if (hasStoredApiKey() && !S.userProfile.apiEnabled) {
        badge.textContent = '已填 Key，請啟用開關';
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300';
    } else {
        badge.textContent = '未啟用（使用規則引擎）';
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400';
    }
}

function toggleApiModeFields() {
    const mode = document.getElementById('settings-api-mode')?.value || 'direct';
    document.getElementById('api-key-group')?.classList.toggle('hidden', mode === 'proxy');
    document.getElementById('api-proxy-group')?.classList.toggle('hidden', mode !== 'proxy');
}

async function callDeepSeek(messages, options = {}) {
    const { jsonMode = false, temperature = 0.7, timeoutMs = 90000, skipQuota = false, source = 'chat' } = options;
    if (!S.userProfile.apiEnabled) throw new Error('API 未啟用');

    if (!skipQuota && typeof assertUsageQuota === 'function') {
        assertUsageQuota('ai');
    }
    
    const useProxy = S.userProfile.apiMode === 'proxy';
    const apiKey = getStoredApiKey();
    if (!useProxy && !apiKey) throw new Error('請在設定中填入 DeepSeek API Key');
    if (useProxy && !S.userProfile.apiProxyUrl) throw new Error('請設定代理伺服器 URL');
    
    const payload = {
        model: S.userProfile.apiModel || 'deepseek-chat',
        messages,
        temperature,
        stream: false
    };
    if (jsonMode) payload.response_format = { type: 'json_object' };

    const tokensIn = typeof estimateTokensFromMessages === 'function'
        ? estimateTokensFromMessages(messages)
        : Math.ceil(JSON.stringify(messages || []).length / 4);
    
    const url = useProxy ? S.userProfile.apiProxyUrl : 'https://api.deepseek.com/chat/completions';
    if (useProxy && !isSafeHttpUrl(url)) throw new Error('代理 URL 不安全或格式錯誤');
    const headers = useProxy ? getAuthHeaders(true) : { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${apiKey}`;
    
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('AI 回應逾時，請稍後再試');
        throw e;
    } finally {
        clearTimeout(timer);
    }
    const raw = await res.text();
    if (!res.ok) {
        let msg = raw;
        try { msg = JSON.parse(raw).error?.message || raw; } catch (_) {}
        throw new Error(msg || `API 錯誤 ${res.status}`);
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
        throw new Error('API 回應格式異常');
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (content == null || content === '') {
        const apiErr = parsed.error?.message || parsed.message;
        throw new Error(apiErr || 'AI 回傳內容為空');
    }

    const usage = parsed.usage || {};
    const tokensOut = usage.completion_tokens
        || (typeof estimateTokensFromText === 'function' ? estimateTokensFromText(content) : Math.ceil(String(content).length / 4));
    const tokensInFinal = usage.prompt_tokens || tokensIn;
    try {
        if (typeof recordUsage === 'function') {
            recordUsage({
                kind: 'ai',
                tokensIn: tokensInFinal,
                tokensOut,
                source,
                cached: false
            });
        }
    } catch (_) {}

    return content;
}

async function testApiConnection() {
    const keyInput = document.getElementById('settings-api-key').value.trim();
    if (keyInput) {
        setStoredApiKey(keyInput);
        S.userProfile.apiEnabled = true;
        document.getElementById('settings-api-enabled').checked = true;
    } else {
        S.userProfile.apiEnabled = document.getElementById('settings-api-enabled').checked;
    }
    S.userProfile.apiMode = document.getElementById('settings-api-mode').value;
    S.userProfile.apiProxyUrl = document.getElementById('settings-api-proxy').value.trim();
    S.userProfile.apiModel = document.getElementById('settings-api-model').value;
    
    showToast('正在測試 API 連線...', 'success');
    try {
        await callDeepSeek([{ role: 'user', content: '請回覆：連線成功' }], {
            temperature: 0,
            skipQuota: true,
            source: 'api_test'
        });
        showToast('✅ API 連線成功！', 'success');
        updateApiStatusBadge();
        try { if (typeof renderUsageMeter === 'function') renderUsageMeter(); } catch (_) {}
    } catch (err) {
        showToast('連線失敗：' + err.message, 'error');
    }
}

function loadSettingsForm() {
    document.getElementById('settings-name').value = S.userProfile.name;
    document.getElementById('settings-role').value = S.userProfile.role;
    document.getElementById('settings-work-start').value = S.userProfile.workStart || '09:00';
    document.getElementById('settings-work-end').value = S.userProfile.workEnd || '18:00';
    document.getElementById('settings-peak-start').value = S.userProfile.peakStart || '09:00';
    document.getElementById('settings-peak-end').value = S.userProfile.peakEnd || '12:30';
    document.getElementById('settings-streak-threshold').value = S.userProfile.streakThreshold || 80;
    document.getElementById('settings-streak-value').innerText = (S.userProfile.streakThreshold || 80) + '%';
    document.getElementById('settings-confetti').checked = S.userProfile.enableConfetti !== false;
    document.getElementById('settings-api-enabled').checked = !!S.userProfile.apiEnabled;
    document.getElementById('settings-api-mode').value = S.userProfile.apiMode || 'direct';
    document.getElementById('settings-api-key').value = getStoredApiKey();
    document.getElementById('settings-api-proxy').value = S.userProfile.apiProxyUrl || 'http://localhost:3001/api/chat';
    document.getElementById('settings-api-model').value = S.userProfile.apiModel || 'deepseek-chat';
    document.getElementById('settings-enterprise-api').value = S.userProfile.enterpriseApiUrl || 'http://localhost:3001';
    toggleApiModeFields();
    updateApiStatusBadge();
    updateAuthUI();
    try {
        if (typeof renderUsageMeter === 'function') renderUsageMeter();
    } catch (_) {}
}

function clearApiKey() {
    setStoredApiKey('');
    const input = document.getElementById('settings-api-key');
    if (input) input.value = '';
    updateApiStatusBadge();
    showToast('API Key 已清除', 'success');
}

function saveSettings() {
    S.userProfile.name = document.getElementById('settings-name').value.trim() || '使用者';
    S.userProfile.role = document.getElementById('settings-role').value.trim() || '知識工作者';
    S.userProfile.workStart = document.getElementById('settings-work-start').value;
    S.userProfile.workEnd = document.getElementById('settings-work-end').value;
    S.userProfile.peakStart = document.getElementById('settings-peak-start').value;
    S.userProfile.peakEnd = document.getElementById('settings-peak-end').value;
    S.userProfile.streakThreshold = parseInt(document.getElementById('settings-streak-threshold').value);
    S.userProfile.enableConfetti = document.getElementById('settings-confetti').checked;
    S.userProfile.apiEnabled = document.getElementById('settings-api-enabled').checked;
    S.userProfile.apiMode = document.getElementById('settings-api-mode').value;
    S.userProfile.apiModel = document.getElementById('settings-api-model').value;
    const planPro = document.getElementById('settings-plan-pro');
    if (planPro && typeof setUsagePlan === 'function') {
        setUsagePlan(planPro.checked ? 'pro' : 'free');
    }
    
    const proxyUrl = document.getElementById('settings-api-proxy').value.trim();
    const enterpriseUrl = document.getElementById('settings-enterprise-api').value.trim() || 'http://localhost:3001';
    if (S.userProfile.apiMode === 'proxy' && proxyUrl && !isSafeHttpUrl(proxyUrl)) {
        return showToast('代理伺服器 URL 無效，請使用 http:// 或 https://', 'error');
    }
    if (!isSafeHttpUrl(enterpriseUrl)) {
        return showToast('企業 API 位址無效，請使用 http:// 或 https://', 'error');
    }
    S.userProfile.apiProxyUrl = proxyUrl;
    S.userProfile.enterpriseApiUrl = enterpriseUrl;
    
    const apiKey = document.getElementById('settings-api-key').value.trim();
    if (apiKey) {
        setStoredApiKey(apiKey);
        S.userProfile.apiEnabled = true;
        document.getElementById('settings-api-enabled').checked = true;
    }
    
    saveState();
    refreshUI({ dashboard: true, filters: true });
    updateApiStatusBadge();
    showToast('設定已儲存！', 'success');
    showSection('dashboard');
}
