/* Lumina: ui/onboarding.js */
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
    const step = ONBOARDING_STEPS[S.onboardingStep];
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
    if (nextBtn) nextBtn.textContent = S.onboardingStep === ONBOARDING_STEPS.length - 1 ? '開始使用' : '下一步';
    
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === S.onboardingStep);
        dot.classList.toggle('done', i < S.onboardingStep);
    });
    
    showSection(step.section);
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
    S.onboardingStep++;
    if (S.onboardingStep >= ONBOARDING_STEPS.length) {
        completeOnboarding();
        return;
    }
    renderOnboardingStep();
}

function skipOnboarding() {
    completeOnboarding();
}

function completeOnboarding() {
    clearOnboardHighlight();
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.classList.add('hidden');
    localStorage.setItem('lumina_onboarding_v2', 'true');
    showSection('dashboard');
    showToast('歡迎使用 Lumina！從「今日」頁開始吧', 'success');
}
