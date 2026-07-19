/**
 * server/domain/enterprise/sop
 * 任務：活的 SOP — 文件 → 可執行步驟編譯（LLM + 規則式 fallback）、卡點事件累計
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const crypto = require('crypto');
const config = require('../../config');
const { API_KEY, DEEPSEEK_URL } = config;
const { loadStore, saveStore } = require('../../../lib/enterprise-store');
const { withLock } = require('../../../lib/write-queue');

const SOP_MAX_STEPS = 12;
const SOP_EVENTS = new Set(['run', 'done', 'stuck']);
const LLM_COMPILE_TIMEOUT_MS = 20000;

/** @param {Record<string, Function>} api */
function register(api) {
    function clampStep(raw, index) {
        if (!raw || typeof raw !== 'object') return null;
        const title = String(raw.title || '').trim().slice(0, 80);
        if (!title) return null;
        const duration = Math.min(120, Math.max(5, parseInt(raw.duration, 10) || 15));
        return {
            index,
            title,
            action: String(raw.action || '').trim().slice(0, 300) || title,
            duration,
            sourceExcerpt: raw.sourceExcerpt ? String(raw.sourceExcerpt).trim().slice(0, 200) : null
        };
    }

    function validateSopSteps(steps) {
        if (!Array.isArray(steps) || !steps.length) return null;
        const out = steps.slice(0, SOP_MAX_STEPS)
            .map((s, i) => clampStep(s, i + 1))
            .filter(Boolean);
        return out.length ? out : null;
    }

    /**
     * 規則式編譯（無 LLM key 或 LLM 失敗時的保底）：
     * 以 markdown 標題／編號行／「步驟N」為切點，後續文字當 action 與摘錄。
     */
    function parseHeuristicSteps(content) {
        const lines = String(content || '').split(/\r?\n/);
        const markerRe = /^(#{1,4}\s+|\d+\s*[.)、．]\s*|[（(]?[一二三四五六七八九十][)）、.．]\s*|步驟\s*[\d一二三四五六七八九十]+\s*[:：、.]?\s*)/;
        const steps = [];
        let current = null;
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            const m = line.match(markerRe);
            if (m && steps.length < SOP_MAX_STEPS) {
                const title = line.slice(m[0].length).trim() || line;
                current = { title, actionLines: [] };
                steps.push(current);
            } else if (current) {
                if (current.actionLines.join(' ').length < 400) current.actionLines.push(line);
            }
        }
        if (steps.length < 2) {
            // 沒有可辨識結構：整份當一步「照文件執行」
            const excerpt = String(content || '').trim().slice(0, 200);
            if (!excerpt) return null;
            return validateSopSteps([{
                title: '閱讀並執行本文件',
                action: '本文件無明顯步驟結構，請按內容依序執行；卡住時向教練提問。',
                duration: 20,
                sourceExcerpt: excerpt
            }]);
        }
        return validateSopSteps(steps.map(s => ({
            title: s.title,
            action: s.actionLines.join(' ').slice(0, 300) || s.title,
            duration: 15,
            sourceExcerpt: s.actionLines.join(' ').slice(0, 200) || null
        })));
    }

    /** LLM 編譯：失敗一律回 null，由 caller 降級到 heuristic。 */
    async function compileLlmSteps(title, content, apiKey) {
        const key = (apiKey || API_KEY || '').trim();
        if (!key) return null;
        const system = '你是流程編譯器。把使用者提供的團隊文件轉成可執行步驟，'
            + '輸出純 JSON 陣列（不要 markdown fence）：'
            + '[{"title":"≤30字動詞開頭","action":"≤120字具體怎麼做","duration":分鐘數5-120,"sourceExcerpt":"引用原文≤80字"}]。'
            + `最多 ${SOP_MAX_STEPS} 步。只輸出 JSON。`;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), LLM_COMPILE_TIMEOUT_MS);
            const response = await fetch(DEEPSEEK_URL, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    temperature: 0.1,
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: `文件標題：${title}\n\n${String(content).slice(0, 12000)}` }
                    ]
                })
            });
            clearTimeout(timer);
            if (!response.ok) return null;
            const data = await response.json();
            let text = String(data?.choices?.[0]?.message?.content || '').trim();
            text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
            const start = text.indexOf('[');
            const end = text.lastIndexOf(']');
            if (start < 0 || end <= start) return null;
            return validateSopSteps(JSON.parse(text.slice(start, end + 1)));
        } catch (_) {
            return null;
        }
    }

    /**
     * 快取鍵。優先用版本雜湊；舊文件沒有版本紀錄時直接雜湊內容，
     * 否則兩邊都是 null 會讓「相等」恆真、內容改了也永不重編。
     */
    function resolvePlanCacheKey(doc) {
        const versions = Array.isArray(doc?.versions) ? doc.versions : [];
        const cur = versions.find(v => v.version === (doc.currentVersion || 1));
        if (cur?.contentHash) return cur.contentHash;
        return crypto.createHash('sha256').update(String(doc?.content || '')).digest('hex');
    }

    /**
     * 取可用快取。降級（heuristic）產物在拿得到 LLM key 時視為未命中，
     * 讓當初因 LLM 暫時失敗而卡住的文件有機會升級成正式編譯。
     */
    function getCachedSopPlan(doc, { hasKey = false, force = false } = {}) {
        if (force) return null;
        const plan = doc?.compiledPlan;
        if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return null;
        if (plan.contentHash !== resolvePlanCacheKey(doc)) return null;
        if (plan.engine === 'heuristic' && hasKey) return null;
        return plan;
    }

    /** 純編譯：不碰 store、不改 doc（呼叫端負責在鎖內落盤）。 */
    async function compileSopPlan(doc, { apiKey } = {}) {
        const content = String(doc?.content || '').trim();
        if (!content) return { error: '此文件沒有可編譯的文字內容', code: 'SOP_NO_CONTENT' };
        let engine = 'llm';
        let steps = await compileLlmSteps(doc.title || '未命名', content, apiKey);
        if (!steps) {
            engine = 'heuristic';
            steps = parseHeuristicSteps(content);
        }
        if (!steps) return { error: '文件內容無法編譯為步驟', code: 'SOP_COMPILE_FAILED' };
        return {
            plan: {
                v: 1,
                contentHash: resolvePlanCacheKey(doc),
                engine,
                compiledAt: new Date().toISOString(),
                steps
            }
        };
    }

    /**
     * 在鎖內重新載入 store 後只寫 compiledPlan 欄位。
     * 編譯可能耗時數十秒，期間別的請求會改動 store——不能把編譯前讀到的
     * 整份快照寫回去，否則會覆蓋掉那些改動。
     */
    async function persistCompiledPlan(groupCode, documentId, plan) {
        return withLock('enterprise', async () => {
            const store = await api.prepareStore(await loadStore());
            const group = api.getGroup(store, api.normalizeCode(groupCode));
            if (!group) return false;
            const doc = api.findGroupDocument(group, { documentId });
            if (!doc || !api.isActiveDocument(doc)) return false;
            // 編譯期間文件可能已發新版：內容對不上就丟棄這份結果
            if (resolvePlanCacheKey(doc) !== plan.contentHash) return false;
            doc.compiledPlan = plan;
            await saveStore(store);
            return true;
        });
    }

    /**
     * 卡點事件累計：只存匿名計數，按文件版本分桶（舊版統計保留）。
     * event: run（開跑）| done（完成某步）| stuck（某步卡住）
     */
    function validateSopEvent({ step, event }) {
        if (!SOP_EVENTS.has(event)) return { error: '不支援的事件', code: 'VALIDATION_ERROR' };
        const stepNum = Math.max(0, Math.min(50, parseInt(step, 10) || 0));
        if (event !== 'run' && !stepNum) return { error: '缺少 step', code: 'VALIDATION_ERROR' };
        return { ok: true, step: stepNum, event };
    }

    function recordSopEvent(doc, { step, event }) {
        const valid = validateSopEvent({ step, event });
        if (valid.error) return valid;
        const stepNum = valid.step;
        const versionKey = 'v' + (doc.currentVersion || 1);
        if (!doc.sopStats || typeof doc.sopStats !== 'object') doc.sopStats = {};
        const bucket = doc.sopStats[versionKey] || (doc.sopStats[versionKey] = { runs: 0, byStep: {} });
        if (event === 'run') {
            bucket.runs += 1;
        } else {
            const s = bucket.byStep[stepNum] || (bucket.byStep[stepNum] = { done: 0, stuck: 0 });
            s[event] += 1;
        }
        return { ok: true, stats: bucket };
    }

    /** 事件落盤同樣走鎖 + 重載，只改目標文件的 sopStats。 */
    async function applySopEvent(groupCode, documentId, { step, event }) {
        const valid = validateSopEvent({ step, event });
        if (valid.error) return valid;
        return withLock('enterprise', async () => {
            const store = await api.prepareStore(await loadStore());
            const group = api.getGroup(store, api.normalizeCode(groupCode));
            if (!group) return { error: '找不到群組', code: 'GROUP_NOT_FOUND', status: 404 };
            const doc = api.findGroupDocument(group, { documentId });
            if (!doc || !api.isActiveDocument(doc)) {
                return { error: '找不到該文件', code: 'DOC_NOT_FOUND', status: 404 };
            }
            const result = recordSopEvent(doc, { step, event });
            if (result.error) return result;
            await saveStore(store);
            return result;
        });
    }

    Object.assign(api, {
        parseHeuristicSteps,
        validateSopSteps,
        resolvePlanCacheKey,
        getCachedSopPlan,
        compileSopPlan,
        persistCompiledPlan,
        recordSopEvent,
        applySopEvent
    });
}

module.exports = { register };
