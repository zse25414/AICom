/* Lumina: coach/decompose.js */
async function decomposeGoalWithAI(goalText) {
    const systemPrompt = `你是 Lumina 任務行動代理。將用戶的大目標拆解為可執行步驟，並確保第一步是「今天就能開始」的最小行動。繁體中文。
回傳合法 JSON：
{"mainGoal":"...","steps":[{"title":"...","time":30,"priority":"高","why":"...","suggestedTime":"09:00"}],"tips":["..."],"totalTime":120}
priority 只能是「高」「中」「低」。steps 4-8 個。第一步必須門檻最低、可在 30 分鐘內完成。`;
    
    const content = await callDeepSeek([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `請拆解：${goalText}` }
    ], { jsonMode: true, temperature: 0.6 });
    
    const parsed = parseJsonFromAI(content);
    if (!parsed.steps?.length) throw new Error('AI 未回傳有效步驟');
    parsed.totalTime = parsed.totalTime || parsed.steps.reduce((s, x) => s + (x.time || 0), 0);
    parsed.mainGoal = parsed.mainGoal || goalText;
    parsed.tips = parsed.tips || [];
    return parsed;
}

function askCoachAboutNextTask() {
    const pending = resolveTodayFocusTask() || getNextRecommendedTask('today');
    if (!pending) {
        showToast(getFuturePendingTasks().length ? '今日任務已完成，之後的待辦在任務頁' : '目前沒有待辦任務', 'error');
        return;
    }
    openCoachForTask(pending.id);
}

function openCoachForTask(taskId) {
    const task = S.tasks.find(t => t.id === taskId);
    if (!task) return openCoachForNextTask();
    S.todayFocusTaskId = taskId;
    if (S.focusSession?.taskId !== taskId) {
        clearFocusTimer();
        S.focusSession = null;
        S.coachAgentMessages = [];
    }
    showSection('coach');
    setTimeout(() => coachBeginGuidedSession(), 120);
}

function renderDecomposePlan(plan, source = '規則引擎') {
    const content = document.getElementById('decompose-content');
    if (!content) return;
    content.innerHTML = `
        <div class="mb-3 flex items-center gap-x-2">
            <span class="text-[10px] px-2 py-0.5 rounded-full ${source.includes('DeepSeek') ? 'bg-violet-500/20 text-violet-300' : 'bg-slate-700 text-slate-400'}">${escapeHtml(source)}</span>
        </div>
        <div class="mb-5">
            <div class="uppercase tracking-[1.5px] text-xs text-purple-400 font-medium mb-1">主要目標</div>
            <div class="text-2xl font-semibold leading-tight">${escapeHtml(plan.mainGoal)}</div>
        </div>
        <div class="mb-6">
            <div class="flex items-center justify-between mb-3">
                <div class="text-xs uppercase tracking-wider text-slate-400 font-medium">執行步驟 (${plan.steps.length} 個)</div>
                <div class="text-xs px-3 py-px rounded-full bg-purple-500/10 text-purple-300 font-mono">總預估 ${plan.totalTime} 分鐘</div>
            </div>
            <div class="space-y-2.5">
                ${plan.steps.map((step, idx) => `
                    <div class="subtask group flex gap-x-4 px-5 py-[13px] bg-slate-950 hover:bg-slate-900 transition-colors border border-slate-700 rounded-2xl items-start ${idx === 0 ? 'decompose-first-step' : ''}">
                        <div class="mt-0.5 w-6 h-6 flex-shrink-0 rounded-xl ${idx === 0 ? 'bg-indigo-500/20 text-indigo-300' : 'bg-purple-500/10 text-purple-400'} flex items-center justify-center text-xs font-mono font-bold">${idx === 0 ? '★' : idx + 1}</div>
                        <div class="flex-1 min-w-0 pt-0.5">
                            <div class="font-medium pr-2">${escapeHtml(step.title)}${idx === 0 ? ' <span class="text-[10px] text-indigo-300 font-normal">← 今日第一步</span>' : ''}</div>
                            <div class="text-xs text-slate-400 mt-px">${escapeHtml(step.why)}</div>
                            <div class="flex items-center gap-x-4 mt-3 text-xs">
                                <div class="flex items-center gap-x-1.5 text-emerald-300">
                                    <i class="fa-regular fa-clock"></i>
                                    <span class="font-mono">${step.time} 分鐘</span>
                                </div>
                                <div class="px-2.5 py-px rounded-xl text-xs border ${step.priority === '高' ? 'border-red-400/60 text-red-400' : step.priority === '中' ? 'border-amber-400/60 text-amber-300' : 'border-slate-400/60 text-slate-300'}">${step.priority} 優先</div>
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0">
                            <div class="text-[10px] text-slate-500">建議開始</div>
                            <div class="font-mono text-xs text-slate-300">${escapeHtml(step.suggestedTime || '')}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="pt-4 border-t border-slate-700">
            <div class="text-xs uppercase tracking-[1px] text-purple-300 font-medium mb-2">LUMINA AI 額外建議</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 text-xs text-slate-300">
                ${plan.tips.map(tip => `<div class="flex gap-x-2 py-1"><i class="fa-solid fa-check text-emerald-400 mt-0.5 text-xs"></i> <span>${escapeHtml(tip)}</span></div>`).join('')}
            </div>
        </div>
    `;
}

async function decomposeGoal() {
    const input = document.getElementById('goal-input').value.trim();
    if (!input) {
        showToast('請先輸入你的目標', 'error');
        return;
    }
    
    const resultDiv = document.getElementById('decompose-result');
    const content = document.getElementById('decompose-content');
    if (!resultDiv || !content) return;
    resultDiv.classList.remove('hidden');
    content.innerHTML = `
        <div class="flex justify-center py-8">
            <div class="flex flex-col items-center">
                <div class="w-9 h-9 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <div class="text-sm text-purple-300">${isApiReady() ? 'DeepSeek 正在分析目標...' : 'Lumina AI 正在分析目標...'}</div>
            </div>
        </div>
    `;
    
    let plan, source = '規則引擎';
    try {
        if (isApiReady()) {
            plan = await decomposeGoalWithAI(input);
            source = 'DeepSeek AI';
        } else {
            await new Promise(r => setTimeout(r, 800));
            plan = generateSmartDecomposition(input);
        }
    } catch (err) {
        showToast('AI 失敗，已改用離線規則：' + err.message, 'error');
        plan = generateSmartDecomposition(input);
        source = '規則引擎（備援）';
    }
    
    S.currentDecomposedPlan = plan;
    renderDecomposePlan(plan, source);
    showToast('目標分解完成！', 'success');
}

function generateSmartDecomposition(goalText) {
    const lower = goalText.toLowerCase();
    let steps = [];
    let tips = [];
    let totalTime = 0;
    let mainGoal = goalText;
    
    // Smart detection
    if (lower.includes('報告') || lower.includes('okr') || lower.includes('路線圖')) {
        steps = [
            { title: "收集資料與現況分析", time: 45, priority: "高", why: "確保數據與事實基礎正確", suggestedTime: "09:00" },
            { title: "建立大綱與關鍵論點", time: 35, priority: "高", why: "先有框架再填充內容", suggestedTime: "10:00" },
            { title: "撰寫初稿（核心章節）", time: 90, priority: "高", why: "最耗時的部分，安排在高峰期", suggestedTime: "10:45" },
            { title: "視覺化圖表與數據呈現", time: 40, priority: "中", why: "讓報告更具說服力", suggestedTime: "14:00" },
            { title: "內部 review 與修改", time: 50, priority: "高", why: "找出盲點與提升品質", suggestedTime: "15:30" },
            { title: "最終校對與格式調整", time: 25, priority: "中", why: "專業度來自細節", suggestedTime: "16:45" }
        ];
        tips = [
            "使用 AI 工具先產生初稿大綱，再親自調整語氣",
            "設定 3 個檢查點：大綱完成、初稿完成、review 完成",
            "準備一個「反對意見」頁面，展示你已思考周全"
        ];
        totalTime = 285;
    } 
    else if (lower.includes('提案') || lower.includes('簡報') || lower.includes('pitch')) {
        steps = [
            { title: "定義聽眾痛點與目標", time: 25, priority: "高", why: "先懂對方需求才能說服", suggestedTime: "09:15" },
            { title: "設計故事線與 3 個關鍵訊息", time: 30, priority: "高", why: "簡報的核心是故事而非數據", suggestedTime: "09:45" },
            { title: "製作高品質視覺簡報", time: 75, priority: "高", why: "視覺決定第一印象", suggestedTime: "10:30" },
            { title: "準備可能問答與反對意見", time: 40, priority: "中", why: "專業的表現來自準備", suggestedTime: "14:00" },
            { title: "彩排與時間控制練習", time: 25, priority: "高", why: "流暢度決定信任感", suggestedTime: "15:30" }
        ];
        tips = [
            "每頁只講一個核心觀點，避免資訊過載",
            "準備 2 種版本：5 分鐘精華版 + 完整版",
            "最後一頁永遠放「下一步行動」與聯絡方式"
        ];
        totalTime = 195;
    }
    else if (lower.includes('專案') || lower.includes('mvp') || lower.includes('side project') || lower.includes('product hunt') || lower.includes('上架')) {
        steps = [
            { title: "定義 MVP 核心功能（只做 3 件事）", time: 30, priority: "高", why: "範圍控制是 side project 成敗關鍵", suggestedTime: "09:00" },
            { title: "技術選型與專案架構搭建", time: 45, priority: "高", why: "先讓骨架跑起來再優化", suggestedTime: "09:45" },
            { title: "開發核心功能 v0.1", time: 120, priority: "高", why: "可 demo 的版本比完美更重要", suggestedTime: "10:30" },
            { title: "設計 Landing Page 與文案", time: 50, priority: "中", why: "第一印象決定轉換率", suggestedTime: "14:00" },
            { title: "內部測試與 bug 修復", time: 40, priority: "高", why: "上線前最後一道防線", suggestedTime: "15:30" },
            { title: "準備 Product Hunt 上架素材", time: 35, priority: "中", why: "好的發布能帶來初始流量", suggestedTime: "16:30" }
        ];
        tips = [
            "設定「上線截止日」並公開承諾，增加外部壓力",
            "先找 5 個朋友做 beta 測試，收集真實 feedback",
            "準備 3 張產品截圖 + 30 秒 demo 影片"
        ];
        totalTime = 320;
    }
    else if (lower.includes('學習') || lower.includes('技能') || lower.includes('prompt')) {
        steps = [
            { title: "定義學習目標與可驗證成果", time: 15, priority: "高", why: "沒有明確目標很容易半途而廢", suggestedTime: "晚上" },
            { title: "收集優質學習資源（課程/文章/範例）", time: 25, priority: "中", why: "好的資源決定學習效率", suggestedTime: "晚上" },
            { title: "建立個人知識筆記系統", time: 20, priority: "中", why: "輸出是最好的輸入", suggestedTime: "晚上" },
            { title: "每天實作 1 小時 + 記錄心得", time: 60, priority: "高", why: " deliberate practice 才是關鍵", suggestedTime: "固定時段" },
            { title: "找人 review 或分享學習成果", time: 30, priority: "中", why: "教學是最好的學習", suggestedTime: "週末" }
        ];
        tips = [
            "使用費曼技巧：用簡單語言解釋給別人聽",
            "設定「輸出里程碑」：第 7 天做出一個小專案",
            "加入相關社群或 Discord 保持動力"
        ];
        totalTime = 150;
    }
    else {
        // Generic smart breakdown
        steps = [
            { title: "明確定義成功標準與範圍", time: 20, priority: "高", why: "避免做到一半發現方向錯誤", suggestedTime: "09:00" },
            { title: "拆解成最小可執行單元", time: 25, priority: "高", why: "降低啟動阻力", suggestedTime: "09:30" },
            { title: "分配資源與時間預算", time: 15, priority: "中", why: "現實的規劃才有執行力", suggestedTime: "10:00" },
            { title: "執行第一個 25 分鐘 Pomodoro", time: 25, priority: "高", why: "克服開始的惰性", suggestedTime: "10:30" },
            { title: "每日復盤與調整計劃", time: 15, priority: "中", why: "持續優化是長期成功的關鍵", suggestedTime: "每日晚上" }
        ];
        tips = [
            "每完成一個步驟就給自己小獎勵",
            "使用「2 分鐘法則」：任何小事立刻做",
            "設定環境：關閉通知、準備好需要的工具"
        ];
        totalTime = 100;
    }
    
    // Add some variation
    if (lower.includes('團隊') || lower.includes('共識')) {
        steps.push({ title: "收集團隊 feedback 並整合", time: 35, priority: "中", why: "共識比完美更重要", suggestedTime: "隔天" });
        totalTime += 35;
    }
    
    return {
        mainGoal: mainGoal,
        steps: steps,
        totalTime: totalTime,
        tips: tips
    };
}

function useExampleGoal(idx) {
    const examples = [
        "完成本季 OKR 報告並獲得主管認可",
        "準備下週與大客戶的產品提案簡報",
        "在 30 天內學會 Prompt Engineering 並應用在工作上",
        "完成個人 side project MVP 並上架到 Product Hunt"
    ];
    document.getElementById('goal-input').value = examples[idx];
    decomposeGoal();
}

function copyPlanToClipboard() {
    if (!S.currentDecomposedPlan) return;
    
    let text = `目標：${S.currentDecomposedPlan.mainGoal}\n\n`;
    text += `總預估時間：${S.currentDecomposedPlan.totalTime} 分鐘\n\n`;
    text += `執行步驟：\n`;
    
    S.currentDecomposedPlan.steps.forEach((step, i) => {
        text += `${i+1}. ${step.title}（${step.time}分鐘・${step.priority}優先）\n   建議時間：${step.suggestedTime}\n   原因：${step.why}\n\n`;
    });
    
    text += `AI 建議：\n`;
    S.currentDecomposedPlan.tips.forEach(t => text += `• ${t}\n`);
    
    navigator.clipboard.writeText(text).then(() => {
        showToast('計劃已複製到剪貼簿！', 'success');
    });
}

function addFirstStepToToday() {
    if (!S.currentDecomposedPlan?.steps?.length) return;
    const step = S.currentDecomposedPlan.steps[0];
    const parentGoalId = Date.now();
    const energy = step.priority === '高' ? 5 : (step.priority === '中' ? 3 : 2);
    const newTask = {
        id: parentGoalId + 1,
        name: step.title,
        duration: step.time,
        energy: energy,
        category: inferCategory(step.title, energy),
        due: getTodayISO(),
        completed: false,
        parentGoalId: parentGoalId,
        parentGoalName: S.currentDecomposedPlan.mainGoal
    };
    S.tasks.push(newTask);
    S.todayFocusTaskId = newTask.id;
    saveState();
    showToast('今日第一步已加入！', 'success');
    showSection('dashboard');
    refreshUI({ dashboard: true, filters: true });
    setTimeout(() => pulseNextStepCard(), 300);
}

function addDecomposedToScheduler() {
    if (!S.currentDecomposedPlan) return;
    
    const parentGoalId = Date.now();
    const parentGoalName = S.currentDecomposedPlan.mainGoal;
    
    S.currentDecomposedPlan.steps.forEach((step, index) => {
        const energy = step.priority === '高' ? 5 : (step.priority === '中' ? 3 : 2);
        const dueToday = index <= 1 || step.priority === '高';
        const newTask = {
            id: parentGoalId + index + 1,
            name: step.title,
            duration: step.time,
            energy: energy,
            category: inferCategory(step.title, energy),
            due: dueToday ? getTodayISO() : toLocalISO(new Date(Date.now() + (index - 1) * 86400000)),
            completed: false,
            parentGoalId: parentGoalId,
            parentGoalName: parentGoalName
        };
        S.tasks.push(newTask);
    });
    
    saveState();
    S.todayFocusTaskId = parentGoalId + 1;
    showToast('已加入任務！今日可連續執行前兩步', 'success');
    showSection('dashboard');
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
    setTimeout(() => pulseNextStepCard(), 300);
}

// Task management for scheduler
