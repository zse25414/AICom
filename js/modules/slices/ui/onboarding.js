/* Lumina: ui/onboarding.js — beginner-first onboarding */

const BEGINNER_DISMISS_KEY = 'lumina_beginner_dismissed';
const ONBOARDING_DONE_KEY = 'lumina_onboarding_v3';
const ONBOARDING_LEGACY_KEY = 'lumina_onboarding_v2';

function isBeginnerMode() {
    if (localStorage.getItem(BEGINNER_DISMISS_KEY) === 'true') return false;
    if (localStorage.getItem(ONBOARDING_DONE_KEY) === 'true' && (S.tasks?.length || 0) > 0) return false;
    // New user or empty task list → keep simple chrome
    return (S.tasks?.length || 0) < 3;
}

function hasCompletedOnboarding() {
    return localStorage.getItem(ONBOARDING_DONE_KEY) === 'true'
        || localStorage.getItem(ONBOARDING_LEGACY_KEY) === 'true';
}

function applySimpleModeChrome() {
    const simple = isBeginnerMode();
    document.body.classList.toggle('simple-mode', simple);
    // Soft-hide dense stats for beginners (still expandable)
    const statsToggle = document.getElementById('dash-stats-toggle');
    if (statsToggle) {
        statsToggle.classList.toggle('opacity-70', simple);
        const span = statsToggle.querySelector('span');
        if (span && simple && document.getElementById('dash-stats-panel')?.classList.contains('hidden')) {
            span.textContent = '進階：查看數據摘要';
        }
    }
}

function clearOnboardHighlight() {
    document.querySelectorAll('.onboard-highlight').forEach(el => el.classList.remove('onboard-highlight'));
}

function applyOnboardHighlight(id) {
    clearOnboardHighlight();
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('onboard-highlight');
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
    }
}

function renderOnboardingStep() {
    const steps = typeof ONBOARDING_STEPS !== 'undefined' ? ONBOARDING_STEPS : [];
    const step = steps[S.onboardingStep];
    if (!step) return;

    const iconEl = document.getElementById('onboarding-icon');
    const titleEl = document.getElementById('onboarding-title');
    const descEl = document.getElementById('onboarding-desc');
    const nextBtn = document.getElementById('onboarding-next-btn');
    const dots = document.querySelectorAll('.onboarding-dot');

    if (iconEl) {
        iconEl.className = 'onboarding-icon ' + step.iconBg;
        iconEl.innerHTML = `<i class="fa-solid ${sanitizeFaIcon(step.icon)}"></i>`;
    }
    if (titleEl) titleEl.textContent = step.title;
    if (descEl) descEl.textContent = step.desc;
    if (nextBtn) {
        const last = S.onboardingStep === steps.length - 1;
        nextBtn.textContent = last ? '開始使用' : '下一步';
    }

    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === S.onboardingStep);
        dot.classList.toggle('done', i < S.onboardingStep);
    });

    // Prefer staying on dashboard for first step (less disorienting)
    if (step.section) showSection(step.section);
    if (step.schedTab) switchSchedulerTab(step.schedTab);
    if (step.onEnter) setTimeout(() => step.onEnter(), 400);
    setTimeout(() => {
        if (step.highlight) applyOnboardHighlight(step.highlight);
    }, 350);
}

function startOnboarding() {
    S.onboardingStep = 0;
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.classList.remove('hidden');
    renderOnboardingStep();
}

function nextOnboardingStep() {
    const steps = typeof ONBOARDING_STEPS !== 'undefined' ? ONBOARDING_STEPS : [];
    S.onboardingStep++;
    if (S.onboardingStep >= steps.length) {
        completeOnboarding();
        return;
    }
    renderOnboardingStep();
}

function skipOnboarding() {
    completeOnboarding({ skipped: true });
}

function completeOnboarding(opts = {}) {
    clearOnboardHighlight();
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.classList.add('hidden');
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
    localStorage.setItem(ONBOARDING_LEGACY_KEY, 'true');
    showSection('dashboard');
    try { renderBeginnerWelcome(); } catch (_) {}
    try { applySimpleModeChrome(); } catch (_) {}
    if (!opts.skipped && (S.tasks?.length || 0) === 0) {
        showToast('選一個開始方式：一鍵體驗、自己輸入，或拆大目標', 'success');
    } else {
        showToast('歡迎！從「今日」頁開始就好', 'success');
    }
}

/** Persistent (dismissible) helper card for empty/new accounts */
function renderBeginnerWelcome() {
    const el = document.getElementById('beginner-welcome');
    if (!el) return;

    const dismissed = localStorage.getItem(BEGINNER_DISMISS_KEY) === 'true';
    const empty = (S.tasks?.length || 0) === 0;
    const show = !dismissed && (empty || isBeginnerMode());

    el.classList.toggle('hidden', !show);
    if (!show) return;

    el.innerHTML = `
        <div class="beginner-welcome-inner">
            <div class="beginner-welcome-badge"><i class="fa-solid fa-sparkles"></i> 新人 3 步上手</div>
            <h2 class="beginner-welcome-title">Lumina 很簡單：今天只做一件事</h2>
            <ol class="beginner-welcome-steps">
                <li><strong>加一項任務</strong>（或一鍵體驗）</li>
                <li>按 <strong>開始做這件</strong></li>
                <li>卡住就按 <strong>教練帶我做</strong></li>
            </ol>
            <div class="beginner-welcome-actions">
                <button type="button" class="beginner-cta-primary focus-ring" data-lumina-action="seedDemoFirstTask">
                    <i class="fa-solid fa-play"></i> 一鍵體驗
                </button>
                <button type="button" class="beginner-cta-secondary focus-ring" data-lumina-action="focusQuickAdd">
                    自己輸入任務
                </button>
                <button type="button" class="beginner-cta-ghost focus-ring" data-lumina-action="dismissBeginnerWelcome">
                    我知道了
                </button>
            </div>
            <p class="beginner-welcome-note">團隊知識庫、數據洞察屬於進階功能，之後在「更多」打開即可。</p>
        </div>
    `;
}

function dismissBeginnerWelcome() {
    localStorage.setItem(BEGINNER_DISMISS_KEY, 'true');
    document.getElementById('beginner-welcome')?.classList.add('hidden');
    applySimpleModeChrome();
    showToast('已切換為一般介面。需要時可到指南重新開始。', 'success');
}

function restartBeginnerTour() {
    localStorage.removeItem(BEGINNER_DISMISS_KEY);
    localStorage.removeItem(ONBOARDING_DONE_KEY);
    startOnboarding();
}
