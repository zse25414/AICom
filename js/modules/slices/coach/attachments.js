/* Lumina: coach/attachments.js — 教練對話／任務附件（圖片・檔案） */

const COACH_ATTACH_MAX_COUNT = 4;
const COACH_ATTACH_MAX_BYTES = 2 * 1024 * 1024; // 2 MB raw file
const COACH_ATTACH_TEXT_MAX = 12000;
const TASK_ATTACH_MAX = 6;
const IMAGE_MAX_DIM = 1280;
const IMAGE_JPEG_QUALITY = 0.72;

const COACH_ATTACH_ACCEPT = [
    'image/*',
    '.txt', '.md', '.markdown', '.csv', '.json', '.log',
    '.pdf',
    'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf'
].join(',');

function ensureCoachPendingAttachments() {
    if (!Array.isArray(S.coachPendingAttachments)) S.coachPendingAttachments = [];
    return S.coachPendingAttachments;
}

function normalizeTaskAttachments(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(a => a && typeof a === 'object' && a.name)
        .map(a => ({
            id: a.id || `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: String(a.name || 'file').slice(0, 200),
            mime: String(a.mime || 'application/octet-stream').slice(0, 120),
            size: Math.max(0, Number(a.size) || 0),
            kind: a.kind === 'image' || a.kind === 'text' ? a.kind : 'file',
            dataUrl: typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:')
                ? a.dataUrl.slice(0, 1_500_000)
                : null,
            textPreview: typeof a.textPreview === 'string'
                ? a.textPreview.slice(0, COACH_ATTACH_TEXT_MAX)
                : null,
            addedAt: a.addedAt || Date.now()
        }))
        .slice(0, TASK_ATTACH_MAX);
}

function getTaskAttachments(task) {
    return normalizeTaskAttachments(task?.attachments);
}

function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function guessAttachKind(file) {
    const mime = String(file?.type || '');
    const name = String(file?.name || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image';
    if (
        mime.startsWith('text/') ||
        mime === 'application/json' ||
        mime === 'application/csv' ||
        /\.(txt|md|markdown|csv|json|log|tsv)$/i.test(name)
    ) return 'text';
    return 'file';
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('讀取檔案失敗'));
        r.readAsDataURL(file);
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('讀取檔案失敗'));
        r.readAsText(file, 'utf-8');
    });
}

function compressImageDataUrl(dataUrl, maxDim = IMAGE_MAX_DIM, quality = IMAGE_JPEG_QUALITY) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                let { width, height } = img;
                if (!width || !height) {
                    resolve(dataUrl);
                    return;
                }
                const scale = Math.min(1, maxDim / Math.max(width, height));
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(dataUrl);
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                // Prefer JPEG for photos; keep PNG if source was PNG with transparency small
                const out = canvas.toDataURL('image/jpeg', quality);
                resolve(out || dataUrl);
            } catch (_) {
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

/**
 * @param {File} file
 * @returns {Promise<object>}
 */
async function processCoachAttachmentFile(file) {
    if (!file) throw new Error('沒有檔案');
    if (file.size > COACH_ATTACH_MAX_BYTES) {
        throw new Error(`檔案超過 ${formatBytes(COACH_ATTACH_MAX_BYTES)} 上限`);
    }
    const kind = guessAttachKind(file);
    const base = {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: String(file.name || 'file').slice(0, 200),
        mime: file.type || 'application/octet-stream',
        size: file.size || 0,
        kind,
        dataUrl: null,
        textPreview: null,
        addedAt: Date.now()
    };

    if (kind === 'image') {
        let dataUrl = await readFileAsDataURL(file);
        dataUrl = await compressImageDataUrl(dataUrl);
        base.dataUrl = dataUrl;
        base.mime = 'image/jpeg';
        // approximate size from base64
        base.size = Math.round((dataUrl.length * 3) / 4);
        return base;
    }

    if (kind === 'text') {
        const text = await readFileAsText(file);
        base.textPreview = text.slice(0, COACH_ATTACH_TEXT_MAX);
        // light dataUrl for re-download of small text
        if (file.size < 200 * 1024) {
            base.dataUrl = await readFileAsDataURL(file);
        }
        return base;
    }

    // binary / pdf: metadata only (no full binary in localStorage)
    base.textPreview = null;
    base.dataUrl = null;
    return base;
}

async function addCoachAttachmentsFromFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const pending = ensureCoachPendingAttachments();
    let added = 0;
    for (const file of files) {
        if (pending.length >= COACH_ATTACH_MAX_COUNT) {
            showToast(`一次最多 ${COACH_ATTACH_MAX_COUNT} 個附件`, 'error');
            break;
        }
        try {
            const att = await processCoachAttachmentFile(file);
            pending.push(att);
            added++;
        } catch (err) {
            showToast(err.message || `無法加入 ${file.name}`, 'error');
        }
    }
    if (added) {
        try {
            if (typeof track === 'function') track('coach_attach_add', { count: added });
        } catch (_) {}
        renderCoachPendingAttachments();
        showToast(`已加入 ${added} 個附件`, 'success');
    }
}

function removeCoachPendingAttachment(id) {
    const pending = ensureCoachPendingAttachments();
    S.coachPendingAttachments = pending.filter(a => a.id !== id);
    renderCoachPendingAttachments();
}

function clearCoachPendingAttachments() {
    S.coachPendingAttachments = [];
    renderCoachPendingAttachments();
}

function openCoachAttachPicker() {
    const input = document.getElementById('coach-attach-input');
    if (input) {
        input.value = '';
        input.click();
        return;
    }
    // Fallback create
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = COACH_ATTACH_ACCEPT;
    el.multiple = true;
    el.className = 'hidden';
    el.addEventListener('change', () => {
        addCoachAttachmentsFromFiles(el.files);
        el.remove();
    });
    document.body.appendChild(el);
    el.click();
}

function onCoachAttachInputChange(ev) {
    const input = ev?.target || document.getElementById('coach-attach-input');
    if (!input?.files?.length) return;
    addCoachAttachmentsFromFiles(input.files);
    input.value = '';
}

function renderCoachPendingAttachments() {
    const strip = document.getElementById('coach-attach-pending');
    if (!strip) return;
    const pending = ensureCoachPendingAttachments();
    if (!pending.length) {
        strip.classList.add('hidden');
        strip.innerHTML = '';
        return;
    }
    strip.classList.remove('hidden');
    strip.innerHTML = pending.map(a => {
        const thumb = a.kind === 'image' && a.dataUrl
            ? `<img src="${a.dataUrl}" alt="" class="coach-attach-thumb">`
            : `<span class="coach-attach-icon"><i class="fa-solid ${a.kind === 'text' ? 'fa-file-lines' : 'fa-file'}"></i></span>`;
        return `
            <div class="coach-attach-chip" data-att-id="${escapeHtml(a.id)}">
                ${thumb}
                <span class="coach-attach-meta">
                    <span class="coach-attach-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
                    <span class="coach-attach-size">${formatBytes(a.size)} · ${a.kind === 'image' ? '圖片' : a.kind === 'text' ? '文字' : '檔案'}</span>
                </span>
                <button type="button" class="coach-attach-remove" data-lumina-action="removeCoachPendingAttachment"
                        data-lumina-arg="${escapeHtml(a.id)}" aria-label="移除附件">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>`;
    }).join('') + `
        <div class="coach-attach-actions">
            <button type="button" class="coach-attach-action-btn" data-lumina-action="pinPendingAttachmentsToTask"
                    title="綁到目前任務，之後教練可見">
                <i class="fa-solid fa-paperclip"></i> 加到任務
            </button>
            <button type="button" class="coach-attach-action-btn coach-attach-action-muted" data-lumina-action="clearCoachPendingAttachments">
                清除
            </button>
        </div>`;
}

function renderMessageAttachmentsHtml(attachments) {
    const list = normalizeTaskAttachments(attachments);
    if (!list.length) return '';
    return `<div class="coach-msg-attachments">${list.map(a => {
        if (a.kind === 'image' && a.dataUrl) {
            return `<a class="coach-msg-attach coach-msg-attach-image" href="${a.dataUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(a.name)}">
                <img src="${a.dataUrl}" alt="${escapeHtml(a.name)}">
                <span>${escapeHtml(a.name)}</span>
            </a>`;
        }
        const icon = a.kind === 'text' ? 'fa-file-lines' : 'fa-file';
        const href = a.dataUrl || '#';
        const open = a.dataUrl
            ? `href="${a.dataUrl}" download="${escapeHtml(a.name)}" target="_blank" rel="noopener noreferrer"`
            : `href="#" onclick="return false;"`;
        return `<a class="coach-msg-attach coach-msg-attach-file" ${open} title="${escapeHtml(a.name)}">
            <i class="fa-solid ${icon}"></i>
            <span class="coach-msg-attach-label">${escapeHtml(a.name)}</span>
            <span class="coach-msg-attach-bytes">${formatBytes(a.size)}</span>
        </a>`;
    }).join('')}</div>`;
}

function renderTaskAttachmentsBar(task) {
    const list = getTaskAttachments(task);
    if (!list.length) return '';
    return `
        <div class="coach-task-attachments" aria-label="任務附件">
            <div class="coach-task-attachments-label"><i class="fa-solid fa-paperclip"></i> 任務附件 ${list.length}</div>
            <div class="coach-task-attachments-list">
                ${list.map(a => {
                    if (a.kind === 'image' && a.dataUrl) {
                        return `<div class="coach-task-attach-item" title="${escapeHtml(a.name)}">
                            <img src="${a.dataUrl}" alt="">
                            <span class="truncate">${escapeHtml(a.name)}</span>
                            <button type="button" class="coach-attach-remove" data-lumina-action="removeTaskAttachment"
                                data-lumina-arg="${escapeHtml(String(task.id))}" data-lumina-arg-type="number"
                                data-lumina-arg2="${escapeHtml(a.id)}" aria-label="移除">×</button>
                        </div>`;
                    }
                    return `<div class="coach-task-attach-item" title="${escapeHtml(a.name)}">
                        <i class="fa-solid ${a.kind === 'text' ? 'fa-file-lines' : 'fa-file'}"></i>
                        <span class="truncate">${escapeHtml(a.name)}</span>
                        <button type="button" class="coach-attach-remove" data-lumina-action="removeTaskAttachment"
                            data-lumina-arg="${escapeHtml(String(task.id))}" data-lumina-arg-type="number"
                            data-lumina-arg2="${escapeHtml(a.id)}" aria-label="移除">×</button>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
}

function pinPendingAttachmentsToTask() {
    const task = typeof getCoachTask === 'function' ? getCoachTask() : null;
    if (!task) {
        showToast('請先選擇要綁定的任務', 'error');
        return;
    }
    const pending = ensureCoachPendingAttachments();
    if (!pending.length) {
        showToast('還沒有待送附件', 'error');
        return;
    }
    const existing = getTaskAttachments(task);
    const room = Math.max(0, TASK_ATTACH_MAX - existing.length);
    if (!room) {
        showToast(`每個任務最多 ${TASK_ATTACH_MAX} 個附件`, 'error');
        return;
    }
    const toAdd = pending.slice(0, room);
    task.attachments = normalizeTaskAttachments([...existing, ...toAdd]);
    touchTask(task);
    saveState();
    // leave remaining pending if any
    S.coachPendingAttachments = pending.slice(room);
    renderCoachPendingAttachments();
    try {
        if (typeof renderCoachAgentView === 'function') renderCoachAgentView();
    } catch (_) {}
    showToast(`已加 ${toAdd.length} 個附件到「${task.name}」`, 'success');
    try {
        if (typeof track === 'function') track('coach_attach_pin_task', { count: toAdd.length });
    } catch (_) {}
}

function removeTaskAttachment(taskId, attId) {
    const task = typeof getTaskById === 'function' ? getTaskById(taskId) : S.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.attachments = getTaskAttachments(task).filter(a => a.id !== attId);
    touchTask(task);
    saveState();
    try {
        if (typeof renderCoachAgentView === 'function') renderCoachAgentView();
    } catch (_) {}
    showToast('已移除任務附件', 'success');
}

/** Text block for LLM context (no raw base64). */
function buildAttachmentsContextText(messageAttachments, task) {
    const chunks = [];
    const msgAtt = normalizeTaskAttachments(messageAttachments);
    const taskAtt = getTaskAttachments(task);

    if (msgAtt.length) {
        chunks.push('【本則訊息附件】');
        msgAtt.forEach((a, i) => {
            chunks.push(`${i + 1}. ${a.name}（${a.kind} · ${formatBytes(a.size)}）`);
            if (a.kind === 'text' && a.textPreview) {
                chunks.push(`內容摘錄：\n${a.textPreview.slice(0, 4000)}`);
            } else if (a.kind === 'image') {
                chunks.push('（使用者附上圖片；請依檔名與對話推斷用途，無法直接看圖時請請對方描述重點）');
            } else {
                chunks.push('（二進位檔，僅有檔名；請請對方說明重點或貼文字）');
            }
        });
    }

    if (taskAtt.length) {
        chunks.push('【任務已綁定附件】');
        taskAtt.forEach((a, i) => {
            chunks.push(`${i + 1}. ${a.name}（${a.kind} · ${formatBytes(a.size)}）`);
            if (a.kind === 'text' && a.textPreview) {
                chunks.push(`內容摘錄：\n${a.textPreview.slice(0, 3000)}`);
            }
        });
    }

    if (!chunks.length) return '';
    return '\n' + chunks.join('\n');
}

/** Take pending attachments for a send (clears pending). */
function takeCoachPendingAttachmentsForSend() {
    const pending = ensureCoachPendingAttachments().slice();
    S.coachPendingAttachments = [];
    renderCoachPendingAttachments();
    return normalizeTaskAttachments(pending);
}

/** Paste image from clipboard into pending. */
function handleCoachComposerPaste(ev) {
    try {
        const items = ev?.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (const it of items) {
            if (it.kind === 'file') {
                const f = it.getAsFile();
                if (f) files.push(f);
            }
        }
        if (!files.length) return;
        ev.preventDefault();
        addCoachAttachmentsFromFiles(files);
    } catch (_) {}
}
