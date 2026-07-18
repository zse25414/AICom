/* Lumina: utils/templates.js — Phase 4 workflow templates (moat) */

const WORKFLOW_TEMPLATES = [
    {
        id: 'onboarding-week1',
        name: '新人第一週',
        icon: 'fa-user-plus',
        blurb: '環境、文件、第一個可交付',
        tasks: [
            { name: '領取帳號與權限清單確認', duration: 25, energy: 2, category: 'admin', dueOffset: 0 },
            { name: '讀完新人 SOP 並寫下 3 個問題', duration: 40, energy: 3, category: 'learning', dueOffset: 0 },
            { name: '完成開發／工具環境安裝', duration: 60, energy: 4, category: 'execution', dueOffset: 1 },
            { name: '跟導師 15 分鐘對齊本週目標', duration: 20, energy: 3, category: 'meeting', dueOffset: 1 },
            { name: '交付第一個小任務並請人 review', duration: 90, energy: 4, category: 'deep', dueOffset: 3 }
        ],
        goalName: '新人 onboarding 第一週'
    },
    {
        id: 'cs-daily',
        name: '客服日流程',
        icon: 'fa-headset',
        blurb: '收件→標準回覆→升級→收尾',
        tasks: [
            { name: '清完隔夜未結工單並標優先', duration: 30, energy: 3, category: 'admin', dueOffset: 0 },
            { name: '依 SOP 回覆高優先 5 件', duration: 45, energy: 3, category: 'execution', dueOffset: 0 },
            { name: '需升級案件整理給主管', duration: 25, energy: 3, category: 'admin', dueOffset: 0 },
            { name: '更新知識庫常見問答 1 則', duration: 20, energy: 2, category: 'learning', dueOffset: 0 }
        ],
        goalName: '客服當日節奏'
    },
    {
        id: 'weekly-review',
        name: '週回顧與下週一步',
        icon: 'fa-calendar-week',
        blurb: '回顧完成、選下週最重要一件',
        tasks: [
            { name: '列出本週完成與卡住的各 3 項', duration: 20, energy: 2, category: 'admin', dueOffset: 0 },
            { name: '從知識庫補一則流程缺口筆記', duration: 25, energy: 3, category: 'learning', dueOffset: 0 },
            { name: '選定下週「最重要一件事」並拆第一步', duration: 30, energy: 4, category: 'deep', dueOffset: 0 },
            { name: '與利害關係人對齊下週優先（可非同步）', duration: 20, energy: 3, category: 'meeting', dueOffset: 1 }
        ],
        goalName: '週回顧'
    }
];

function getWorkflowTemplates() {
    return WORKFLOW_TEMPLATES.slice();
}

function applyWorkflowTemplate(templateId) {
    const tpl = WORKFLOW_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) {
        if (typeof showToast === 'function') showToast('找不到此模板', 'error');
        return null;
    }

    const parentGoalId = Date.now();
    const base = parentGoalId + 1;
    const created = [];

    tpl.tasks.forEach((step, i) => {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (step.dueOffset || 0));
        const due = typeof toLocalISO === 'function' ? toLocalISO(dueDate) : dueDate.toISOString().slice(0, 10);
        const task = {
            id: base + i,
            name: step.name,
            duration: step.duration || 30,
            energy: step.energy || 3,
            category: step.category || 'execution',
            due,
            completed: false,
            updatedAt: new Date().toISOString(),
            parentGoalId,
            parentGoalName: tpl.goalName || tpl.name,
            source: 'template',
            templateId: tpl.id
        };
        S.tasks.unshift(task);
        created.push(task);
    });

    if (created[0]) S.todayFocusTaskId = created[0].id;
    if (typeof rebuildTaskIndex === 'function') rebuildTaskIndex();
    if (typeof invalidateTodayStats === 'function') invalidateTodayStats();
    if (typeof saveState === 'function') saveState();

    try {
        if (typeof track === 'function') {
            track('template_applied', { templateId: tpl.id, tasks: created.length });
        }
    } catch (_) {}

    try {
        if (typeof recordExecMemory === 'function') {
            recordExecMemory({
                type: 'template_applied',
                templateId: tpl.id,
                templateName: tpl.name,
                taskCount: created.length
            });
        }
    } catch (_) {}

    if (typeof refreshUI === 'function') {
        refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
    }
    if (typeof showToast === 'function') {
        showToast(`已套用「${tpl.name}」：${created.length} 項任務`, 'success');
    }
    try { if (typeof pulseNextStepCard === 'function') pulseNextStepCard(); } catch (_) {}
    try { if (typeof renderWorkflowTemplatesPanel === 'function') renderWorkflowTemplatesPanel(); } catch (_) {}
    try { if (typeof renderExecMemoryPanel === 'function') renderExecMemoryPanel(); } catch (_) {}

    return created;
}

function renderWorkflowTemplatesPanel() {
    const el = document.getElementById('workflow-templates-panel');
    if (!el) return;

    // Show when empty or beginner, or always compact strip
    const showAlways = true;
    if (!showAlways) {
        el.classList.add('hidden');
        return;
    }
    el.classList.remove('hidden');

    el.innerHTML = `
        <div class="wf-templates-head">
            <div>
                <div class="wf-templates-title"><i class="fa-solid fa-layer-group"></i> 工作流模板</div>
                <div class="wf-templates-sub">一鍵套用團隊節奏（護城河：可複製的執行結構）</div>
            </div>
        </div>
        <div class="wf-templates-grid">
            ${WORKFLOW_TEMPLATES.map(t => `
                <button type="button" class="wf-template-card focus-ring"
                    data-lumina-action="applyWorkflowTemplate"
                    data-lumina-arg="${escapeHtml(t.id)}"
                    title="${escapeHtml(t.blurb)}">
                    <span class="wf-template-icon"><i class="fa-solid ${t.icon}"></i></span>
                    <span class="wf-template-name">${escapeHtml(t.name)}</span>
                    <span class="wf-template-blurb">${escapeHtml(t.blurb)}</span>
                    <span class="wf-template-meta">${t.tasks.length} 步</span>
                </button>
            `).join('')}
        </div>
    `;
}

if (typeof window !== 'undefined') {
    window.getWorkflowTemplates = getWorkflowTemplates;
    window.applyWorkflowTemplate = applyWorkflowTemplate;
    window.renderWorkflowTemplatesPanel = renderWorkflowTemplatesPanel;
    try {
        if (typeof window.registerLuminaAction === 'function') {
            window.registerLuminaAction('applyWorkflowTemplate', applyWorkflowTemplate);
        }
    } catch (_) {}
}
