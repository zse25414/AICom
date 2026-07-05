/* Lumina: ui/feedback.js */
function triggerConfetti() {
    const colors = ['#6366f1', '#a855f7', '#ec4899', '#22c55e'];
    const container = document.body;
    
    for (let i = 0; i < 65; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'fixed';
        particle.style.zIndex = '9999';
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.top = '-10px';
        particle.style.width = '8px';
        particle.style.height = '8px';
        particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.opacity = Math.random() + 0.6;
        container.appendChild(particle);
        
        const duration = Math.random() * 2800 + 2400;
        const angle = Math.random() * 70 + 55;
        
        particle.animate([
            { transform: `translateY(0) rotate(0deg)`, opacity: particle.style.opacity },
            { transform: `translateY(${window.innerHeight + 100}px) rotate(${angle * 4}deg)`, opacity: 0 }
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)'
        }).onfinish = () => particle.remove();
    }
}

// Toast notifications

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
    toast.className = `toast-item ${type === 'success' ? 'toast-success' : 'toast-error'}`;
    toast.setAttribute('role', 'status');
    
    const iconEl = document.createElement('i');
    iconEl.className = `fa-solid ${icon} flex-shrink-0`;
    const textEl = document.createElement('div');
    textEl.className = 'flex-1 leading-snug';
    textEl.textContent = String(message);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'opacity-70 hover:opacity-100 text-lg leading-none';
    closeBtn.setAttribute('aria-label', '關閉');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => toast.remove());
    
    toast.append(iconEl, textEl, closeBtn);
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 3200);
}

// Reset everything

function resetAllData() {
    if (!confirm('確定要重置所有資料嗎？這會清除任務與統計（API Key 與基本設定會保留）。')) return;
    
    clearSensitiveLocalData();
    location.reload();
}
