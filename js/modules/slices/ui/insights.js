/* Lumina: ui/insights.js */
function loadChartJs() {
    if (typeof Chart !== 'undefined') return Promise.resolve();
    if (S.chartJsLoadPromise) return S.chartJsLoadPromise;
    S.chartJsLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = C.CHART_JS_URL;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Chart.js 載入失敗'));
        document.head.appendChild(script);
    });
    return S.chartJsLoadPromise;
}

async function refreshInsightsPage() {
    updateInsightsCards();
    try {
        await loadChartJs();
        requestAnimationFrame(() => initCharts());
    } catch (_) {
        $('weekly-chart-fallback')?.classList.remove('hidden');
    }
}

function updateInsightsCards() {
    const dist = getTimeDistribution();
    const avgScore = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    const prevAvg = Math.round(S.weeklyScores.slice(0, 6).reduce((a, b) => a + b, 0) / 6);
    const growth = prevAvg > 0 ? Math.round(((avgScore - prevAvg) / prevAvg) * 100) : 0;
    
    const peakEl = document.getElementById('insight-peak-time');
    const improveEl = document.getElementById('insight-improve-area');
    const growthEl = document.getElementById('insight-growth-pct');
    
    if (peakEl) {
        peakEl.innerText = `${S.userProfile.peakStart || '09:00'} - ${S.userProfile.peakEnd || '12:30'}`;
        setElText('insight-peak-desc',
            `依你設定的時段 · 深度工作佔比 ${dist.deep}%`);
    }
    if (improveEl) {
        const deepPending = S.tasks.filter(t => !t.completed && resolveCategory(t) === 'deep').length;
        const meetingMins = S.tasks.filter(t => t.category === 'meeting').reduce((s, t) => s + t.duration, 0);
        
        if (deepPending > 2) {
            improveEl.innerText = '深度工作任務堆積';
            setElText('insight-improve-desc',
                `有 ${deepPending} 項深度任務待處理，建議排在 ${S.userProfile.peakStart}-${S.userProfile.peakEnd}`);
        } else if (dist.meeting > 25) {
            improveEl.innerText = '會議時間佔比偏高';
            setElText('insight-improve-desc',
                `會議溝通佔 ${dist.meeting}%，建議合併或縮短非必要會議`);
        } else if (dist.admin > 20) {
            improveEl.innerText = '行政雜務佔比過高';
            setElText('insight-improve-desc',
                `行政事務佔 ${dist.admin}%，可批次處理或委派`);
        } else {
            improveEl.innerText = '整體節奏良好';
            setElText('insight-improve-desc', '繼續保持上午深度、下午執行的節奏');
        }
    }
    if (growthEl) {
        growthEl.innerText = `${growth >= 0 ? '+' : ''}${growth}%`;
        setElText('insight-growth-desc', `你已連續 ${S.userProfile.streak} 天保持高效節奏！`);
    }
}

function initCharts() {
    const weeklyFallback = document.getElementById('weekly-chart-fallback');
    const pieFallback = document.getElementById('pie-chart-fallback');
    const weekAvgEl = document.getElementById('insight-week-avg');
    
    if (typeof Chart === 'undefined') {
        weeklyFallback?.classList.remove('hidden');
        return;
    }
    
    const weeklyCanvas = document.getElementById('weekly-chart');
    const pieCanvas = document.getElementById('time-pie-chart');
    if (!weeklyCanvas || !pieCanvas) return;
    
    weeklyFallback?.classList.add('hidden');
    pieFallback?.classList.add('hidden');
    
    const weekAvg = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    if (weekAvgEl) weekAvgEl.innerText = weekAvg;
    
    try {
        if (S.weeklyChartInstance) {
            S.weeklyChartInstance.data.datasets[0].data = S.weeklyScores;
            S.weeklyChartInstance.update('none');
        } else {
        S.weeklyChartInstance = new Chart(weeklyCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['週一', '週二', '週三', '週四', '週五', '週六', '週日'],
                datasets: [{
                    label: '生產力分數',
                    data: S.weeklyScores,
                    backgroundColor: '#6366f1',
                    borderRadius: 6,
                    barThickness: 18
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        min: 40,
                        max: 100,
                        grid: { color: '#334155' },
                        ticks: { color: '#64748b', stepSize: 20 }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#64748b' }
                    }
                }
            }
        });
        }
    } catch (err) {
        console.error('[Lumina] weekly chart error:', err);
        weeklyFallback?.classList.remove('hidden');
    }
    
    const dist = getTimeDistribution();
    const pieData = [
        dist.minutes.deep,
        dist.minutes.execution,
        dist.minutes.meeting,
        dist.minutes.learning,
        dist.minutes.admin
    ];
    
    if (dist.totalMins === 0) {
        pieFallback?.classList.remove('hidden');
        return;
    }
    
    try {
        if (S.pieChartInstance) {
            S.pieChartInstance.data.datasets[0].data = pieData;
            S.pieChartInstance.update('none');
        } else {
        S.pieChartInstance = new Chart(pieCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['深度工作', '執行協作', '會議溝通', '學習成長', '行政雜務'],
                datasets: [{
                    data: pieData,
                    backgroundColor: ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#64748b'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#94a3b8', padding: 12, font: { size: 11 }, boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const mins = ctx.raw;
                                const pct = dist.totalMins > 0 ? Math.round((mins / dist.totalMins) * 100) : 0;
                                return ` ${ctx.label}: ${mins} 分鐘 (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
        }
    } catch (err) {
        console.error('[Lumina] pie chart error:', err);
        pieFallback?.classList.remove('hidden');
    }
}

function recalculateInsights() {
    showToast('正在重新計算本週洞察...', 'success');
    
    recordDailySnapshot();
    recalculateWeeklyScores();
    localStorage.setItem('lumina_weekly', JSON.stringify(S.weeklyScores));
    
    const avgScore = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    const daysWithData = S.weeklyScores.filter(s => s > 0).length;
    
    setTimeout(() => {
        if (document.getElementById('insights').classList.contains('active')) {
            refreshInsightsPage();
        } else {
            updateInsightsCards();
        }
        refreshUI({ dashboard: true, filters: true });
        const msg = daysWithData > 0
            ? `洞察已更新！本週平均完成率 ${avgScore}%`
            : '洞察已更新！完成更多任務後數據會更準確';
        showToast(msg, 'success');
    }, 400);
}
