/* Lumina: tasks/schedule.js */
function buildTimeBlocks() {
    const peak = S.userProfile.peakStart || '09:00';
    const workEnd = S.userProfile.workEnd || '18:00';
    const peakEnd = S.userProfile.peakEnd || '12:30';
    
    return [
        { start: peak, end: addMinutes(peak, 90), label: "晨間深度工作", maxEnergy: 5, preferredCategories: ['deep'], capacity: 90 },
        { start: addMinutes(peak, 105), end: peakEnd, label: "上午專注時段", maxEnergy: 4, preferredCategories: ['deep', 'execution'], capacity: 90 },
        { start: "13:30", end: "15:00", label: "下午執行時段", maxEnergy: 3, preferredCategories: ['execution', 'meeting'], capacity: 90 },
        { start: "15:15", end: "16:45", label: "創意與協作", maxEnergy: 4, preferredCategories: ['meeting', 'execution', 'learning'], capacity: 90 },
        { start: "17:00", end: workEnd, label: "收尾與規劃", maxEnergy: 2, preferredCategories: ['admin', 'learning'], capacity: 60 }
    ];
}

function assignTasksToBlocks(pendingTasks, blocks) {
    const pool = pendingTasks.map(scoreTaskPriority);
    pool.sort((a, b) => b.priorityScore - a.priorityScore);
    
    const slots = blocks.map(block => ({ block, tasks: [], load: 0 }));
    const remaining = [];
    
    for (const task of pool) {
        let bestIdx = -1;
        let bestFit = -Infinity;
        
        for (let i = 0; i < slots.length; i++) {
            const fit = scoreTaskBlockFit(task, slots[i]);
            if (fit > bestFit) {
                bestFit = fit;
                bestIdx = i;
            }
        }
        
        if (bestIdx >= 0) {
            slots[bestIdx].tasks.push(task);
            slots[bestIdx].load += task.duration;
        } else {
            remaining.push(task);
        }
    }
    
    return { assigned: slots.filter(s => s.tasks.length > 0), remaining };
}

// Upgraded scheduling algorithm: category-aware best-fit + split suggestions

function optimizeSchedule(silent = false, force = false) {
    if (!force && !$('scheduler')?.classList.contains('active')) return;
    const container = document.getElementById('timeline-view');
    if (!container) return;
    container.innerHTML = '';
    
    const pendingTasks = S.tasks.filter(t => !t.completed);
    
    if (pendingTasks.length === 0) {
        container.innerHTML = `<div class="text-center py-6"><span class="text-emerald-400">🎉 今日所有任務已完成！</span><br><span class="text-xs text-slate-400">休息一下或規劃明天的目標吧</span></div>`;
        setElText('total-scheduled-time', '0h 0m');
        return;
    }
    
    const timeBlocks = buildTimeBlocks();
    const { assigned, remaining } = assignTasksToBlocks(pendingTasks, timeBlocks);
    let totalMinutes = 0;
    
    assigned.forEach(slot => {
        const slotDiv = document.createElement('div');
        slotDiv.className = `timeline-slot flex gap-x-4 p-4 rounded-3xl border border-slate-700 bg-slate-950`;
        
        const loadPct = Math.round((slot.load / slot.block.capacity) * 100);
        const tasksHTML = slot.tasks.map(t => `
            <div class="flex items-center justify-between text-sm py-1.5 px-3 bg-slate-900 rounded-2xl mb-1.5 last:mb-0">
                <div class="flex items-center gap-x-2 min-w-0">
                    <span class="font-medium truncate">${escapeHtml(t.name)}</span>
                    <span class="cat-badge ${getCategoryColor(t.category)}">${getCategoryLabel(t.category)}</span>
                </div>
                <div class="flex items-center gap-x-2 text-xs flex-shrink-0 pl-3">
                    <span class="font-mono text-emerald-300">${t.duration}m</span>
                    <span class="px-2 py-px rounded-xl text-[10px] ${getEnergyColor(t.energy)}">${getEnergyLabel(t.energy)}</span>
                </div>
            </div>
        `).join('');
        
        slotDiv.innerHTML = `
            <div class="w-24 flex-shrink-0 pt-1">
                <div class="font-mono text-lg font-semibold text-indigo-300">${slot.block.start}</div>
                <div class="text-xs text-slate-500">— ${slot.block.end}</div>
                <div class="mt-3">
                    <div class="text-xs px-3 py-1 rounded-2xl bg-indigo-500/10 text-indigo-300 w-fit">${slot.block.label}</div>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="mb-2 flex items-center justify-between">
                    <div class="text-xs text-slate-400">任務負載：${slot.load}/${slot.block.capacity} 分鐘 (${loadPct}%)</div>
                    <div class="text-xs px-2 py-px bg-emerald-500/10 text-emerald-300 rounded">${slot.tasks.length} 項任務</div>
                </div>
                <div class="h-1 bg-slate-800 rounded-full mb-3 overflow-hidden">
                    <div class="h-1 bg-indigo-500 rounded-full transition-all duration-700" style="width:${loadPct}%"></div>
                </div>
                ${tasksHTML}
            </div>
        `;
        
        container.appendChild(slotDiv);
        totalMinutes += slot.load;
    });
    
    if (remaining.length > 0) {
        const remainingDiv = document.createElement('div');
        remainingDiv.className = `mt-4 p-4 border border-dashed border-amber-500/40 rounded-3xl text-xs bg-amber-500/5`;
        
        const itemsHTML = remaining.map(r => `
            <div class="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <div class="flex items-center gap-x-2 min-w-0">
                    <span class="text-slate-200 truncate">${escapeHtml(r.name)}</span>
                    <span class="cat-badge ${getCategoryColor(r.category)}">${getCategoryLabel(r.category)}</span>
                    <span class="text-slate-500 font-mono">${r.duration}m</span>
                </div>
                ${r.duration >= 45 ? `<button ${luminaAction('splitTask', { arg: r.id, type: 'number' })} class="text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-500/30 flex-shrink-0 ml-2"><i class="fa-solid fa-scissors text-[10px]"></i> 拆分</button>` : ''}
            </div>
        `).join('');
        
        remainingDiv.innerHTML = `
            <div class="font-medium text-amber-300 mb-2 flex items-center gap-x-2">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>${remaining.length} 項任務未能排入（能量/時段/容量不匹配）</span>
            </div>
            ${itemsHTML}
            <div class="text-[10px] text-slate-400 mt-2">💡 建議：點擊「拆分」將大任務切半，或調整分類/能量後重新優化</div>
        `;
        container.appendChild(remainingDiv);
    }
    
    setElText('total-scheduled-time', `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`);
    
    if (!silent) {
        const msg = remaining.length > 0
            ? `排程完成，${remaining.length} 項待處理`
            : '已依能量曲線與時段容量完成排程';
        showToast(msg, remaining.length > 0 ? 'error' : 'success');
    }
}

// AI Coach — agent-style guided session
