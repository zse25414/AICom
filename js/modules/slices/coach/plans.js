/* Lumina: coach/plans.js */
function findTaskForPlan(plan) {
    if (!plan?.task) return null;
    const pending = S.tasks.filter(t => !t.completed);
    const exact = pending.find(t => t.name === plan.task);
    if (exact) return exact;
    return pending.find(t => plan.task.includes(t.name) || t.name.includes(plan.task)) || null;
}

function linkPlanToTask(planId, plan, taskId) {
    if (taskId) {
        S.taskCoachPlans.set(taskId, planId);
        return;
    }
    const task = findTaskForPlan(plan);
    if (task) S.taskCoachPlans.set(task.id, planId);
}

function syncFocusSessionWithPlan(plan, planId) {
    if (!S.focusSession || !plan?.steps?.length) return;
    const task = S.tasks.find(t => t.id === S.focusSession.taskId);
    if (!task || plan.task !== task.name) return;
    S.focusSession.steps = normalizeFocusSteps(plan.steps);
    S.focusSession.planId = planId;
    S.focusSession.currentStep = Math.min(S.focusSession.currentStep || 0, S.focusSession.steps.length - 1);
}

function normalizeCoachPlan(raw, fallbackTask) {
    const plan = {
        title: clampText(raw?.title || '任務執行方案', 80),
        task: clampText(raw?.task || fallbackTask || '目前任務', 120),
        summary: clampText(raw?.summary || '', 400),
        steps: [],
        resources: [],
        document: null,
        checklist: [],
        tips: []
    };
    
    for (const s of (raw?.steps || []).slice(0, 6)) {
        if (!s?.title) continue;
        plan.steps.push({
            title: clampText(s.title, 100),
            duration: clampText(s.duration || '10 分鐘', 20),
            action: clampText(s.action || s.detail || '', 300)
        });
    }
    
    for (const r of (raw?.resources || []).slice(0, 5)) {
        if (!r?.title) continue;
        const url = String(r.url || '').trim();
        plan.resources.push({
            title: clampText(r.title, 80),
            url: isSafeHttpUrl(url) ? url : '',
            note: clampText(r.note || '', 120)
        });
    }
    
    if (raw?.document?.title) {
        plan.document = {
            title: clampText(raw.document.title, 80),
            sections: (raw.document.sections || []).slice(0, 8).map(sec => ({
                heading: clampText(sec.heading || sec.title || '章節', 60),
                bullets: (sec.bullets || sec.items || []).slice(0, 8).map(b => clampText(b, 200))
            }))
        };
    }
    
    plan.checklist = (raw?.checklist || []).slice(0, 8).map(c => clampText(c, 120)).filter(Boolean);
    plan.checklistDone = plan.checklist.map(() => false);
    plan.tips = (raw?.tips || []).slice(0, 4).map(t => clampText(t, 200)).filter(Boolean);
    
    if (plan.document) ensureDocumentFields(plan.document);
    
    const taskForResources = plan.task || fallbackTask || '';
    if (plan.resources.length < 2 && taskForResources) {
        const extras = buildTaskResources(taskForResources, inferCategory(taskForResources, 3));
        for (const r of extras) {
            if (plan.resources.length >= 5) break;
            if (!plan.resources.some(x => x.title === r.title)) plan.resources.push(r);
        }
    }
    return plan;
}

function estimatePlanDuration(plan) {
    let mins = 0;
    for (const s of (plan?.steps || [])) {
        const m = String(s.duration || '').match(/(\d+)/);
        if (m) mins += parseInt(m[1], 10);
    }
    return mins || null;
}

function parseBulletToField(bullet, index) {
    const text = String(bullet || '').trim();
    if (!text) return { label: `項目 ${index + 1}`, value: '', placeholder: '請填寫…', editable: true };
    
    const colonSplit = text.match(/^(.+?)[：:]\s*(.*)$/);
    if (colonSplit) {
        const label = colonSplit[1].trim();
        const rest = colonSplit[2].trim();
        const needsFill = !rest || /\[請填|待填|___/.test(rest);
        if (needsFill) {
            const ph = rest.replace(/\[請填[^\]]*\]/g, '').trim();
            return { label, value: '', placeholder: ph || `填寫${label}…`, editable: true };
        }
        return { label, value: rest, placeholder: `補充${label}…`, editable: true };
    }
    
    if (/^\[請填/.test(text)) {
        return { label: `項目 ${index + 1}`, value: '', placeholder: '請填寫…', editable: true };
    }
    
    if (/（\d+\s*min）|（\d+\s*分鐘）|\d+min\)/.test(text) && !/\[請填|待填/.test(text)) {
        return { static: true, value: text };
    }
    
    return { label: `項目 ${index + 1}`, value: text, placeholder: '請填寫…', editable: true };
}

function ensureDocumentFields(document) {
    if (!document) return null;
    document.sections = (document.sections || []).map(sec => {
        if (sec.fields?.length) return sec;
        const bullets = sec.bullets || [];
        return {
            heading: sec.heading,
            bullets,
            fields: bullets.map((b, i) => parseBulletToField(b, i))
        };
    });
    return document;
}

function renderEditableDocumentHtml(planId, document) {
    if (!document?.sections?.length) return '';
    ensureDocumentFields(document);
    return document.sections.map((sec, si) => `
        <div class="coach-doc-section">
            <div class="coach-doc-heading">${escapeHtml(sec.heading)}</div>
            <div class="coach-doc-fields">
                ${(sec.fields || []).map((f, fi) => {
                    if (f.static) {
                        return `<div class="coach-doc-static">${escapeHtml(f.value)}</div>`;
                    }
                    const label = f.label || `項目 ${fi + 1}`;
                    return `
                    <label class="coach-doc-field">
                        <span class="coach-doc-label">${escapeHtml(label)}</span>
                        <textarea class="coach-doc-input" rows="2" placeholder="${escapeHtml(f.placeholder || '請填寫…')}"
                            oninput="updateCoachDocField('${escapeHtml(planId)}', ${si}, ${fi}, this.value)">${escapeHtml(f.value || '')}</textarea>
                    </label>`;
                }).join('')}
            </div>
        </div>`).join('');
}

function updateCoachDocField(planId, sectionIdx, fieldIdx, value) {
    const plan = S.coachPlans.get(planId);
    if (!plan?.document?.sections?.[sectionIdx]?.fields?.[fieldIdx]) return;
    plan.document.sections[sectionIdx].fields[fieldIdx].value = value;
}

function toggleCoachChecklistItem(planId, itemIdx, checked) {
    const plan = S.coachPlans.get(planId);
    if (!plan) return;
    if (!plan.checklistDone) plan.checklistDone = plan.checklist.map(() => false);
    plan.checklistDone[itemIdx] = checked;
}

function extractTaskNameFromMessage(msg) {
    const quoted = msg.match(/[「『"']([^」』"']+)[」』"']/);
    if (quoted) return quoted[1].trim();
    const prefix = msg.match(/(?:開始做|帶我|任務[：:]|關於)\s*(.+)$/i);
    if (prefix) return prefix[1].trim().slice(0, 120);
    return '';
}

function inferTaskDocType(taskName) {
    const lower = taskName.toLowerCase();
    if (/報告|okr|路線圖|分析/.test(lower)) return 'report';
    if (/提案|簡報|pitch/.test(lower)) return 'proposal';
    if (/會議|同步|討論|standup/.test(lower)) return 'meeting';
    if (/郵件|回覆|信/.test(lower)) return 'email';
    return 'worksheet';
}

function buildTaskResources(taskName, category) {
    const catLabel = getCategoryLabel(category || 'execution');
    const q = encodeURIComponent(`${taskName} ${catLabel} 範本`);
    const resources = [
        { title: '搜尋相關資料與範本', url: `https://www.google.com/search?q=${q}`, note: '找產業案例、格式參考' }
    ];
    const lower = taskName.toLowerCase();
    if (/報告|路線圖|okr/.test(lower)) {
        resources.push({ title: 'Notion 模板庫', url: 'https://www.notion.so/templates', note: '尋找報告／專案規劃模板' });
    }
    if (/提案|簡報/.test(lower)) {
        resources.push({ title: 'Canva 簡報模板', url: 'https://www.canva.com/templates/', note: '快速建立視覺提案' });
    }
    if (/學習|課程|研究/.test(lower)) {
        resources.push({ title: 'Google Scholar', url: `https://scholar.google.com/scholar?q=${encodeURIComponent(taskName)}`, note: '學術與深度資料' });
    }
    return resources;
}

function buildDocumentDraft(taskName, docType) {
    const title = `${taskName} — 執行草稿`;
    const sections = [];
    
    if (docType === 'report') {
        sections.push(
            { heading: '一、背景與目標', bullets: ['現況摘要：[請填寫 3 句]', '核心問題：[請填寫]', '成功標準：[請填寫]'] },
            { heading: '二、分析與發現', bullets: ['數據／事實 #1：[請填寫]', '數據／事實 #2：[請填寫]', '關鍵洞察：[請填寫]'] },
            { heading: '三、建議與行動', bullets: ['優先建議 A：[請填寫]', '優先建議 B：[請填寫]', '負責人與時程：[請填寫]'] }
        );
    } else if (docType === 'proposal') {
        sections.push(
            { heading: '開場（30 秒）', bullets: ['聽眾痛點：[請填寫]', '方案一句話：[請填寫]'] },
            { heading: '核心內容', bullets: ['問題定義：[請填寫]', '解決方案：[請填寫]', '預期效益：[請填寫]'] },
            { heading: '結尾行動', bullets: ['希望對方決定：[請填寫]', '時程與聯絡：[請填寫]'] }
        );
    } else if (docType === 'meeting') {
        sections.push(
            { heading: '會議資訊', bullets: [`主題：${taskName}`, '時間：[請填寫]', '與會者：[請填寫]'] },
            { heading: '議程', bullets: ['開場＆目標（5min）', '討論重點（20min）', '決議與待辦（10min）'] },
            { heading: '會後待辦', bullets: ['待辦 #1 — 負責人 — 截止日：[請填寫]', '待辦 #2 — 負責人 — 截止日：[請填寫]'] }
        );
    } else if (docType === 'email') {
        sections.push(
            { heading: '郵件主旨', bullets: [`Re: ${taskName}`] },
            { heading: '內文結構', bullets: ['開頭（目的＋上下文）：[請填寫]', '正文（重點 1-2-3）：[請填寫]', '結尾（明確請求）：[請填寫]'] }
        );
    } else {
        sections.push(
            { heading: '任務定義', bullets: [`任務：${taskName}`, '完成標準：[請填寫]', '預估時間：[請填寫]'] },
            { heading: '執行步驟', bullets: ['準備（工具／資料）：[請填寫]', '執行（核心產出）：[請填寫]', '檢查（自我審核）：[請填寫]'] }
        );
    }
    return { title, sections };
}

function buildOfflineCoachPlan(userMsg, ctx) {
    ctx = ctx || getCoachContext();
    const extracted = extractTaskNameFromMessage(userMsg);
    const next = ctx.nextTask;
    const taskName = extracted || next?.name || '今日優先任務';
    const category = next ? resolveCategory(next) : inferCategory(taskName, 3);
    const duration = next?.duration || 30;
    const lower = userMsg.toLowerCase();
    
    let title = '任務執行方案';
    let summary = `針對「${taskName}」的行動計劃，依你目前的待辦脈絡整理，可直接照著做。`;
    const steps = [];
    const tips = [];
    const checklist = [];
    
    if (lower.includes('拖延') || lower.includes('拖')) {
        title = '克服拖延 — 啟動方案';
        summary = '用「極小第一步」降低啟動阻力，先產出可見進展再擴大範圍。';
        steps.push(
            { title: '關閉干擾', duration: '2 分鐘', action: '手機勿擾、關閉非必要分頁，只留一個工作視窗' },
            { title: '定義最小產出', duration: '3 分鐘', action: `寫下「${taskName}」今天只要完成的一小塊（不超過 15 分鐘工作量）` },
            { title: '番茄鐘執行', duration: `${Math.min(15, duration)} 分鐘`, action: '計時開始，只做剛才定義的最小產出，不求完美' }
        );
    } else if (lower.includes('找資料') || lower.includes('參考') || lower.includes('資源') || lower.includes('範本')) {
        title = '參考資料清單';
        summary = `針對「${taskName}」整理可立即查閱的資源與搜尋連結，並附文件大綱供你填寫。`;
        steps.push(
            { title: '瀏覽參考資源', duration: '8 分鐘', action: '依下方連結找 1-2 個最相關的範本或案例' },
            { title: '擷取可用片段', duration: '10 分鐘', action: '把有用的結構或段落貼到下方文件欄位' },
            { title: '整合進任務', duration: '7 分鐘', action: '在下方文件區填完第一節，形成最小可交付版本' }
        );
        tips.push('優先找「已有結構」的範本，比從零寫快 3 倍');
    } else if (lower.includes('文件') || lower.includes('產出') || lower.includes('草稿') || lower.includes('大綱')) {
        title = '執行文件產出';
        summary = `為「${taskName}」生成可直接填寫的結構化草稿，照著填就能推進。`;
        steps.push(
            { title: '打開文件區', duration: '1 分鐘', action: '在下方文件區找到第一個待填欄位' },
            { title: '填寫第一節', duration: '15 分鐘', action: '直接在頁面上填完第一個章節，不求完整' },
            { title: '自我檢查', duration: '5 分鐘', action: '對照下方檢核清單，確認可交付' }
        );
    } else {
        title = '今日執行方案';
        steps.push(
            { title: '準備環境與資料', duration: '5 分鐘', action: '列出需要的檔案、連結、人員，一次備齊' },
            { title: '核心執行', duration: `${Math.min(25, duration)} 分鐘`, action: `專注完成「${taskName}」的最小可交付版本` },
            { title: '收尾檢查', duration: '5 分鐘', action: '對照完成標準，標記待補項目或直接勾選完成' }
        );
    }
    
    checklist.push(
        `「${taskName}」的完成標準已寫下`,
        '所需資料已備齊',
        '產出可給他人看的最小版本',
        '下一步行動已排入待辦'
    );
    tips.push('先完成再完美——有 60 分版本就先交付', `你的高效時段是 ${ctx.peakWindow}，深度工作盡量排在這段`);
    
    return normalizeCoachPlan({
        title,
        task: taskName,
        summary,
        steps,
        resources: buildTaskResources(taskName, category),
        checklist,
        tips
    }, taskName);
}

function coachPlanToMarkdown(plan) {
    let md = `# ${plan.document?.title || plan.title}\n\n`;
    md += `> 任務：${plan.task}\n\n`;
    md += `## 摘要\n${plan.summary}\n\n`;
    if (plan.steps.length) {
        md += `## 執行步驟\n`;
        plan.steps.forEach((s, i) => {
            md += `### ${i + 1}. ${s.title}（${s.duration}）\n${s.action}\n\n`;
        });
    }
    if (plan.document?.sections?.length) {
        ensureDocumentFields(plan.document);
        md += `## ${plan.document.title}\n\n`;
        for (const sec of plan.document.sections) {
            md += `### ${sec.heading}\n`;
            if (sec.fields?.length) {
                for (const f of sec.fields) {
                    if (f.static) md += `${f.value}\n`;
                    else md += `**${f.label}**：${f.value || '（待填）'}\n`;
                }
            } else {
                for (const b of (sec.bullets || [])) md += `- ${b}\n`;
            }
            md += '\n';
        }
    }
    if (plan.checklist.length) {
        md += `## 完成檢核\n`;
        plan.checklist.forEach((c, i) => {
            const done = plan.checklistDone?.[i];
            md += `- [${done ? 'x' : ' '}] ${c}\n`;
        });
        md += '\n';
    }
    if (plan.resources.length) {
        md += `## 參考資源\n`;
        plan.resources.forEach(r => {
            md += `- ${r.title}${r.url ? `：${r.url}` : ''}${r.note ? ` — ${r.note}` : ''}\n`;
        });
    }
    if (plan.tips.length) {
        md += `\n## 教練提醒\n`;
        plan.tips.forEach(t => { md += `- ${t}\n`; });
    }
    md += `\n---\n由 Lumina 行動教練產出 · ${new Date().toLocaleString('zh-TW')}\n`;
    return md;
}

function renderCoachPlan(plan, planId) {
    const estMins = estimatePlanDuration(plan);
    const statsHtml = `
        <div class="coach-plan-stats">
            <span class="coach-plan-stat"><strong>${plan.steps.length}</strong> 步驟</span>
            ${estMins ? `<span class="coach-plan-stat">約 <strong>${estMins}</strong> 分鐘</span>` : ''}
            ${plan.resources.length ? `<span class="coach-plan-stat"><strong>${plan.resources.length}</strong> 資源</span>` : ''}
            ${plan.document ? `<span class="coach-plan-stat">含文件草稿</span>` : ''}
        </div>`;
    
    const stepsHtml = plan.steps.map((s, i) => `
        <li class="coach-step-item">
            <span class="coach-step-num">${i + 1}</span>
            <div>
                <div class="coach-step-title">${escapeHtml(s.title)}</div>
                <div class="coach-step-detail">${escapeHtml(s.action)}</div>
                <div class="coach-step-duration"><i class="fa-regular fa-clock"></i> ${escapeHtml(s.duration)}</div>
            </div>
        </li>`).join('');
    
    const resourcesHtml = plan.resources.length ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-book-open"></i> 參考資源</div>
            <ul class="coach-resource-list">
                ${plan.resources.map(r => `
                    <li class="coach-resource-item">
                        ${r.url
                            ? `<a class="coach-resource-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a>`
                            : `<span class="text-slate-300">${escapeHtml(r.title)}</span>`}
                        ${r.note ? `<div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(r.note)}</div>` : ''}
                    </li>`).join('')}
            </ul>
        </div>` : '';
    
    const docHtml = plan.document ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-pen-to-square"></i> ${escapeHtml(plan.document.title || '執行文件')} <span class="text-[10px] text-slate-500 font-normal ml-1">直接填寫</span></div>
            <div class="coach-doc-block">${renderEditableDocumentHtml(planId, plan.document)}</div>
        </div>` : '';
    
    const checklistHtml = plan.checklist.length ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-list-check"></i> 完成檢核</div>
            <ul class="coach-checklist-interactive">${plan.checklist.map((c, i) => `
                <li><label class="coach-check-item">
                    <input type="checkbox" ${plan.checklistDone?.[i] ? 'checked' : ''} onchange="toggleCoachChecklistItem('${escapeHtml(planId)}', ${i}, this.checked)">
                    <span>${escapeHtml(c)}</span>
                </label></li>`).join('')}</ul>
        </div>` : '';
    
    const tipsHtml = plan.tips.length ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-lightbulb"></i> 提醒</div>
            <ul class="coach-checklist">${plan.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
        </div>` : '';
    
    return `
        <div class="coach-plan-card" data-plan-id="${escapeHtml(planId)}">
            <div class="coach-plan-header">
                <div class="coach-plan-title">${escapeHtml(plan.title)}</div>
                <div class="coach-plan-meta">任務：${escapeHtml(plan.task)}</div>
                ${statsHtml}
            </div>
            <div class="coach-plan-body">
                <div class="coach-plan-section">
                    <div class="coach-plan-section-title"><i class="fa-solid fa-bullseye"></i> 摘要</div>
                    <div class="coach-plan-summary">${escapeHtml(plan.summary)}</div>
                </div>
                ${stepsHtml ? `<div class="coach-plan-section"><div class="coach-plan-section-title"><i class="fa-solid fa-shoe-prints"></i> 執行步驟</div><ol class="coach-step-list">${stepsHtml}</ol></div>` : ''}
                ${resourcesHtml}
                ${docHtml}
                ${checklistHtml}
                ${tipsHtml}
            </div>
            <div class="coach-action-bar">
                <button type="button" class="coach-action-btn coach-action-btn-success" onclick="startCoachPlan('${planId}')"><i class="fa-solid fa-play"></i> 照此開始</button>
                <button type="button" class="coach-action-btn coach-action-btn-primary" onclick="copyCoachPlan('${planId}')"><i class="fa-solid fa-copy"></i> 複製已填內容</button>
                <button type="button" class="coach-action-btn" onclick="applyCoachStepsAsTasks('${planId}')"><i class="fa-solid fa-plus"></i> 加入子步驟</button>
                <button type="button" class="coach-action-btn opacity-70" onclick="downloadCoachDocument('${planId}')"><i class="fa-solid fa-file-export"></i> 匯出 .md</button>
            </div>
        </div>`;
}

function storeCoachPlan(plan, taskId) {
    const planId = 'coach_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    S.coachPlans.set(planId, plan);
    linkPlanToTask(planId, plan, taskId);
    return planId;
}

function copyCoachPlan(planId) {
    const plan = S.coachPlans.get(planId);
    if (!plan) return showToast('找不到方案內容', 'error');
    const md = coachPlanToMarkdown(plan);
    navigator.clipboard.writeText(md).then(() => showToast('已複製到剪貼簿', 'success'))
        .catch(() => showToast('複製失敗，請手動選取', 'error'));
}

function downloadCoachDocument(planId) {
    const plan = S.coachPlans.get(planId);
    if (!plan) return showToast('找不到文件內容', 'error');
    const md = coachPlanToMarkdown(plan);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (plan.document?.title || plan.title || 'Lumina教練文件').replace(/[\\/:*?"<>|]/g, '_') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('文件已下載', 'success');
}

function startCoachPlan(planId) {
    const plan = S.coachPlans.get(planId);
    if (!plan) return showToast('找不到方案內容', 'error');
    
    const existing = findTaskForPlan(plan);
    if (existing && plan.steps?.length) {
        S.taskCoachPlans.set(existing.id, planId);
        S.todayFocusTaskId = existing.id;
        S.focusSession = {
            taskId: existing.id,
            startedAt: Date.now(),
            steps: normalizeFocusSteps(plan.steps),
            currentStep: 0,
            planId
        };
        showSection('dashboard');
        refreshUI({ dashboard: true, scheduler: true, filters: true });
        startFocusTimer(existing.duration || 30);
        pulseNextStepCard();
        document.getElementById('next-step-card')?.classList.add('focus-session-active');
        showToast(`照方案開始：${existing.name}`, 'success');
        return;
    }
    
    if (plan.steps?.length) {
        applyCoachStepsAsTasks(planId);
    } else {
        showSection('dashboard');
        showToast(`開始執行：${plan.task}`, 'success');
    }
}

function applyCoachStepsAsTasks(planId) {
    const plan = S.coachPlans.get(planId);
    if (!plan?.steps?.length) return showToast('此方案沒有可加入的步驟', 'error');
    if (findTaskForPlan(plan)) {
        return showToast('此任務已在待辦中，請點「照此開始」', 'error');
    }
    const parentGoalId = Date.now();
    const parentGoalName = plan.task;
    plan.steps.forEach((step, index) => {
        const mins = parseInt(step.duration, 10) || 10;
        S.tasks.push({
            id: parentGoalId + index + 1,
            name: step.title,
            duration: mins,
            energy: index === 0 ? 4 : 3,
            category: inferCategory(step.title, 3),
            due: getTodayISO(),
            completed: false,
            parentGoalId,
            parentGoalName
        });
    });
    S.todayFocusTaskId = parentGoalId + 1;
    saveState();
    refreshUI({ dashboard: true, scheduler: true, filters: true });
    showToast(`已拆解為 ${plan.steps.length} 個子步驟，開始第一步`, 'success');
    showSection('dashboard');
    setTimeout(() => startTodayTask(parentGoalId + 1, { quiet: true }), 300);
}
