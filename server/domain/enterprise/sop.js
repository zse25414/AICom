/**
 * server/domain/enterprise/sop
 * 任務：活的 SOP — 文件 → 可執行步驟編譯（LLM + 規則式 fallback）、卡點事件累計
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const config = require('../../config');
const { API_KEY, DEEPSEEK_URL } = config;

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

    function getCurrentContentHash(doc) {
        const versions = Array.isArray(doc?.versions) ? doc.versions : [];
        const cur = versions.find(v => v.version === (doc.currentVersion || 1));
        return cur?.contentHash || null;
    }

    /**
     * 編譯（或取快取）。以 contentHash 快取：發新版自動重編，舊 plan 覆蓋。
     * 回傳 { plan, cached }；無內容回 { error }。呼叫端負責 saveStore。
     */
    async function compileDocumentPlan(doc, { apiKey } = {}) {
        const content = String(doc?.content || '').trim();
        if (!content) return { error: '此文件沒有可編譯的文字內容', code: 'SOP_NO_CONTENT' };
        const contentHash = getCurrentContentHash(doc);
        if (doc.compiledPlan && doc.compiledPlan.contentHash === contentHash
            && Array.isArray(doc.compiledPlan.steps) && doc.compiledPlan.steps.length) {
            return { plan: doc.compiledPlan, cached: true };
        }
        let engine = 'llm';
        let steps = await compileLlmSteps(doc.title || '未命名', content, apiKey);
        if (!steps) {
            engine = 'heuristic';
            steps = parseHeuristicSteps(content);
        }
        if (!steps) return { error: '文件內容無法編譯為步驟', code: 'SOP_COMPILE_FAILED' };
        doc.compiledPlan = {
            v: 1,
            contentHash,
            engine,
            compiledAt: new Date().toISOString(),
            steps
        };
        return { plan: doc.compiledPlan, cached: false };
    }

    /**
     * 卡點事件累計：只存匿名計數，按文件版本分桶（舊版統計保留）。
     * event: run（開跑）| done（完成某步）| stuck（某步卡住）
     */
    function recordSopEvent(doc, { step, event }) {
        if (!SOP_EVENTS.has(event)) return { error: '不支援的事件', code: 'VALIDATION_ERROR' };
        const stepNum = Math.max(0, Math.min(50, parseInt(step, 10) || 0));
        if (event !== 'run' && !stepNum) return { error: '缺少 step', code: 'VALIDATION_ERROR' };
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

    Object.assign(api, {
        parseHeuristicSteps,
        validateSopSteps,
        compileDocumentPlan,
        recordSopEvent
    });
}

module.exports = { register };
