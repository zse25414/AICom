/* Lumina: ui/pwa.js */
function generateManifestIcon() {
    const fallback = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="#6366f1"/><text x="96" y="110" text-anchor="middle" font-size="80" fill="#fff">⚡</text></svg>'
    );
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;
    const grad = ctx.createLinearGradient(0, 0, 192, 192);
    grad.addColorStop(0, '#6366f1');
    grad.addColorStop(0.5, '#a855f7');
    grad.addColorStop(1, '#ec4899');
    ctx.fillStyle = grad;
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(24, 24, 144, 144, 32);
        ctx.fill();
    } else {
        ctx.fillRect(24, 24, 144, 144);
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', 96, 100);
    return canvas.toDataURL('image/png');
}

function setupManifest() {
    const iconUrl = generateManifestIcon();
    const manifest = {
        name: '光流 AI Lumina',
        short_name: 'Lumina',
        description: '大目標拆成小步，AI 告訴你今日第一步該做什麼',
        start_url: window.location.href.split('?')[0],
        scope: './',
        display: 'standalone',
        background_color: '#020617',
        theme_color: '#6366f1',
        lang: 'zh-TW',
        icons: [
            { src: iconUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }
        ]
    };
    
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
    document.head.appendChild(link);
    
    let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
        appleIcon = document.createElement('link');
        appleIcon.rel = 'apple-touch-icon';
        document.head.appendChild(appleIcon);
    }
    appleIcon.href = iconUrl;
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
    
    const swCode = `
        const CACHE = 'lumina-v9';
        const origin = '${window.location.origin}';
        const LOCAL_ASSETS = [
            origin + '/lumina-ai.html',
            origin + '/js/lumina-app.js',
            origin + '/js/chunks/lumina-coach.js',
            origin + '/js/chunks/lumina-enterprise-docs.js',
            origin + '/css/lumina.css',
            origin + '/css/tailwind.build.css'
        ];
        const CDN_ASSETS = [
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
        ];
        
        self.addEventListener('install', e => {
            e.waitUntil(
                caches.open(CACHE).then(c => c.addAll([...LOCAL_ASSETS, ...CDN_ASSETS]).catch(() => {}))
            );
            self.skipWaiting();
        });
        
        self.addEventListener('activate', e => {
            e.waitUntil(
                caches.keys().then(keys =>
                    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
                ).then(() => self.clients.claim())
            );
        });
        
        self.addEventListener('fetch', e => {
            if (e.request.method !== 'GET') return;
            const url = new URL(e.request.url);
            const isLocal = url.origin === origin;
            e.respondWith(
                (isLocal
                    ? caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
                        if (res.ok) {
                            const clone = res.clone();
                            caches.open(CACHE).then(c => c.put(e.request, clone));
                        }
                        return res;
                    }))
                    : fetch(e.request).then(res => {
                        if (res.ok) {
                            const clone = res.clone();
                            caches.open(CACHE).then(c => c.put(e.request, clone));
                        }
                        return res;
                    })
                ).catch(() => caches.match(e.request).then(cached =>
                    cached || new Response('離線中，請稍後再試', { status: 503, statusText: 'Offline' })
                ))
            );
        });
    `;
    
    const blob = new Blob([swCode], { type: 'application/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(blob))
        .then(() => updatePwaStatus('已啟用離線快取'))
        .catch(() => updatePwaStatus('離線快取啟用失敗（不影響正常使用）'));
}

function updatePwaStatus(msg) {
    const el = document.getElementById('pwa-status');
    if (el) el.textContent = msg;
}

function setupPwaInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        S.deferredInstallPrompt = e;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.classList.remove('hidden');
        updatePwaStatus('可安裝到主畫面，像 App 一樣使用');
    });
    
    window.addEventListener('appinstalled', () => {
        S.deferredInstallPrompt = null;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.classList.add('hidden');
        updatePwaStatus('✅ 已安裝到主畫面');
        showToast('Lumina 已安裝到主畫面！', 'success');
    });
    
    if (window.matchMedia('(display-mode: standalone)').matches) {
        updatePwaStatus('✅ 正以 App 模式執行');
    } else if (window.location.protocol === 'file:') {
        updatePwaStatus('請透過本機伺服器開啟以啟用離線與安裝功能');
    }
}

async function promptInstall() {
    if (!S.deferredInstallPrompt) {
        showToast('目前環境不支援安裝，請用 Chrome 並透過 http:// 開啟', 'error');
        return;
    }
    S.deferredInstallPrompt.prompt();
    await S.deferredInstallPrompt.userChoice;
    S.deferredInstallPrompt = null;
    document.getElementById('pwa-install-btn')?.classList.add('hidden');
}

function setupOfflineDetection() {
    const banner = document.getElementById('offline-banner');
    
    function updateOnlineStatus() {
        if (navigator.onLine) {
            banner?.classList.remove('show');
        } else {
            banner?.classList.add('show');
        }
    }
    
    window.addEventListener('online', () => {
        updateOnlineStatus();
        showToast('已恢復連線', 'success');
    });
    window.addEventListener('offline', () => {
        updateOnlineStatus();
        showToast('已進入離線模式，資料仍會保存在本機', 'error');
    });
    
    updateOnlineStatus();
}
