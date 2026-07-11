/* Lumina: enterprise/documents.js */
function ensurePdfJs() {
    if (typeof pdfjsLib !== 'undefined') return Promise.resolve();
    if (!S.pdfJsLoadPromise) {
        S.pdfJsLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.async = true;
            script.onload = () => {
                if (typeof pdfjsLib !== 'undefined') {
                    pdfjsLib.GlobalWorkerOptions.workerSrc =
                        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }
                resolve();
            };
            script.onerror = () => reject(new Error('PDF.js 載入失敗'));
            document.head.appendChild(script);
        });
    }
    return S.pdfJsLoadPromise;
}

function ensureXlsx() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    if (!S.xlsxLoadPromise) {
        S.xlsxLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('XLSX 載入失敗'));
            document.head.appendChild(script);
        });
    }
    return S.xlsxLoadPromise;
}

function toggleAddDocForm(show) {
    const form = document.getElementById('team-add-doc-form');
    if (!form) return;
    if (show === undefined) {
        form.classList.toggle('hidden');
    } else {
        form.classList.toggle('hidden', !show);
    }
}

function switchDocFormType(type) {
    const isText = type === 'text';
    document.getElementById('team-doc-text-area')?.classList.toggle('hidden', !isText);
    document.getElementById('team-doc-file-area')?.classList.toggle('hidden', isText);
    S.selectedDocFile = null;
    const infoEl = document.getElementById('team-doc-file-info');
    if (infoEl) {
        infoEl.innerHTML = '';
        infoEl.classList.add('hidden');
    }
    const fileInput = document.getElementById('team-doc-file');
    if (fileInput) fileInput.value = '';
}

async function handleDocFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
        S.selectedDocFile = null;
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showToast('檔案大小不能超過 5MB', 'error');
        event.target.value = '';
        S.selectedDocFile = null;
        return;
    }
    
    const infoEl = document.getElementById('team-doc-file-info');
    if (infoEl) {
        infoEl.classList.remove('hidden');
        infoEl.textContent = '載入並解析檔案中，請稍候...';
    }
    
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');
    const isExcel = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                    file.type === 'application/vnd.ms-excel' || 
                    file.name.toLowerCase().endsWith('.xlsx') || 
                    file.name.toLowerCase().endsWith('.xls');
    
    if (!isPdf && !isImage && !isExcel) {
        showToast('僅支援上傳 PDF 文件、圖片與 Excel 檔案', 'error');
        event.target.value = '';
        S.selectedDocFile = null;
        if (infoEl) infoEl.classList.add('hidden');
        return;
    }
    
    const titleInput = document.getElementById('team-doc-title');
    if (titleInput && !titleInput.value) {
        const extIndex = file.name.lastIndexOf('.');
        titleInput.value = extIndex !== -1 ? file.name.slice(0, extIndex) : file.name;
    }
    
    try {
        const reader = new FileReader();
        const base64Promise = new Promise((resolve) => {
            reader.onload = () => {
                const res = reader.result;
                const base64 = res.split(',')[1];
                resolve(base64);
            };
            reader.readAsDataURL(file);
        });
        
        const base64Data = await base64Promise;
        
        if (isPdf) {
            let extractedText = '';
            try {
                extractedText = await extractTextFromPdf(file);
            } catch (e) {
                console.warn('[Lumina PDF] 文字解析失敗:', e.message);
                extractedText = '';
            }
            
            S.selectedDocFile = {
                filename: file.name,
                fileData: base64Data,
                docType: 'pdf',
                extractedText: extractedText
            };
            
            if (infoEl) {
                if (extractedText.length < 30) {
                    infoEl.innerHTML = `
                        <div class="doc-extract-warn" role="alert">
                            <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
                            <div>
                                <div class="font-medium text-amber-200">幾乎沒有可擷取文字（${extractedText.length} 字）</div>
                                <div class="text-[11px] text-amber-200/70 mt-0.5">可能是掃描圖 PDF。請改上傳文字檔，或在下方「檔案備註」補上關鍵內容，否則教練知識庫可能無法檢索。</div>
                            </div>
                        </div>`;
                } else {
                    infoEl.innerHTML = `<i class="fa-solid fa-file-pdf mr-1 text-red-400"></i> PDF 解析完成！共擷取 <strong>${extractedText.length}</strong> 字元，將會自動餵給 AI 行動教練。`;
                }
            }
        } else if (isExcel) {
            let extractedText = '';
            try {
                extractedText = await extractTextFromExcel(file);
            } catch (e) {
                console.warn('[Lumina Excel] 資料解析失敗:', e.message);
                extractedText = '';
            }
            
            S.selectedDocFile = {
                filename: file.name,
                fileData: base64Data,
                docType: 'excel',
                extractedText: extractedText
            };
            
            if (infoEl) {
                if (extractedText.length < 30) {
                    infoEl.innerHTML = `
                        <div class="doc-extract-warn" role="alert">
                            <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
                            <div>
                                <div class="font-medium text-amber-200">幾乎沒有可擷取資料（${extractedText.length} 字）</div>
                                <div class="text-[11px] text-amber-200/70 mt-0.5">請確認工作表有文字內容，或在備註欄補充說明。</div>
                            </div>
                        </div>`;
                } else {
                    infoEl.innerHTML = `<i class="fa-solid fa-file-excel mr-1 text-green-500"></i> Excel 解析完成！共擷取 <strong>${extractedText.length}</strong> 字元，將會自動餵給 AI 行動教練。`;
                }
            }
        } else if (isImage) {
            S.selectedDocFile = {
                filename: file.name,
                fileData: base64Data,
                docType: 'image',
                extractedText: ''
            };
            
            if (infoEl) {
                infoEl.innerHTML = `
                    <div class="flex flex-col gap-1.5">
                        <span class="text-emerald-400"><i class="fa-solid fa-file-image mr-1"></i> 圖片已載入（需填寫描述供 AI 學習，暫不支援自動 OCR）</span>
                        <img src="data:${file.type};base64,${base64Data}" class="max-h-24 rounded-lg border border-slate-800 object-contain w-fit self-start mt-1">
                    </div>`;
            }
        }
    } catch (err) {
        showToast('檔案載入失敗: ' + err.message, 'error');
        event.target.value = '';
        S.selectedDocFile = null;
        if (infoEl) infoEl.classList.add('hidden');
    }
}

async function extractTextFromPdf(file) {
    await ensurePdfJs();
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js 未載入');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    const maxPages = Math.min(pdf.numPages, 30);
    for (let i = 1; i <= maxPages; i++) {
        try {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        } catch (e) {
            console.warn(`[Lumina PDF] 第 ${i} 頁解析失敗`, e);
        }
    }
    return fullText.trim();
}

async function extractTextFromExcel(file) {
    await ensureXlsx();
    if (typeof XLSX === 'undefined') {
        throw new Error('SheetJS (XLSX) 未載入');
    }
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let fullText = '';
    
    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        if (csv && csv.trim()) {
            fullText += `--- 工作表: ${sheetName} ---\n${csv}\n\n`;
        }
    }
    return fullText.trim();
}

async function saveTeamDocument() {
    if (!S.enterpriseSession) return;
    
    const typeRadios = document.getElementsByName('team-doc-type');
    let docFormType = 'text';
    for (const r of typeRadios) {
        if (r.checked) {
            docFormType = r.value;
            break;
        }
    }
    
    const title = document.getElementById('team-doc-title')?.value?.trim();
    if (!title) {
        showToast('請輸入文件標題', 'error');
        return;
    }
    
    let content = '';
    let docType = 'text';
    let fileData = null;
    let filename = null;
    
    if (docFormType === 'text') {
        content = document.getElementById('team-doc-content')?.value?.trim();
        if (!content) {
            showToast('請輸入文件內容', 'error');
            return;
        }
    } else {
        if (!S.selectedDocFile) {
            showToast('請選擇要上傳的檔案 (PDF / 圖片 / Excel)', 'error');
            return;
        }
        
        docType = S.selectedDocFile.docType;
        filename = S.selectedDocFile.filename;
        fileData = S.selectedDocFile.fileData;
        
        if (docType === 'pdf' || docType === 'excel') {
            content = S.selectedDocFile.extractedText || '';
            const desc = document.getElementById('team-doc-description')?.value?.trim();
            if (desc) {
                const docLabel = docType === 'pdf' ? 'PDF 原文內容' : 'Excel 資料內容';
                content = `【檔案備註說明】：${desc}\n\n【${docLabel}】：\n${content}`;
            }
        } else if (docType === 'image') {
            content = document.getElementById('team-doc-description')?.value?.trim();
            if (!content) {
                showToast('請輸入圖片描述/備註，供 AI 行動教練閱讀學習', 'error');
                return;
            }
        }
    }
    
    const kbId = document.getElementById('team-doc-kb-select')?.value || 'general';

    // Near-empty PDF/Excel: warn but still allow publish
    if ((docType === 'pdf' || docType === 'excel') && (content || '').replace(/【[^】]+】[：:]\s*/g, '').trim().length < 30) {
        const proceed = confirm(
            `${docType === 'pdf' ? 'PDF' : 'Excel'} 幾乎沒有可擷取文字。仍要發布嗎？\n（教練知識庫可能無法有效檢索這份文件）`
        );
        if (!proceed) return;
    }

    const payload = {
        groupCode: S.enterpriseSession.groupCode,
        managerId: S.enterpriseSession.memberId,
        title,
        content,
        docType,
        filename,
        fileData,
        kbId
    };
    
    let ok = false;
    let newDoc = null;
    let ragOk = null;
    
    if (S.enterpriseSession.offline) {
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
            if (!group) throw new Error('找不到群組');
            if (!group.documents) group.documents = [];
            
            let fileUrl = null;
            if (fileData) {
                if (docType === 'image') {
                    fileUrl = `data:image/png;base64,${fileData}`;
                } else if (docType === 'pdf') {
                    fileUrl = 'blob:local-pdf-file';
                } else if (docType === 'excel') {
                    fileUrl = 'blob:local-excel-file';
                } else {
                    fileUrl = `blob:local-${docType}-file`;
                }
            }
            
            const nowIso = new Date().toISOString();
            newDoc = {
                id: 'd_' + Date.now(),
                title,
                content,
                docType,
                fileUrl,
                filename,
                kbId,
                author: S.enterpriseSession.name,
                authorMemberId: S.enterpriseSession.memberId,
                createdAt: nowIso,
                updatedAt: nowIso,
                currentVersion: 1,
                versions: [{
                    version: 1,
                    title,
                    content,
                    filename,
                    fileUrl,
                    docType,
                    createdAt: nowIso,
                    createdByMemberId: S.enterpriseSession.memberId,
                    createdByName: S.enterpriseSession.name,
                    changeNote: 'initial'
                }],
                status: 'active',
                deletedAt: null,
                ragStatus: 'pending',
                rag: { status: 'pending', lastIndexedAt: null, lastError: null }
            };
            group.documents.unshift(newDoc);
            saveLocalEnterpriseStore(store);
            ok = true;

            applyLocalDocRagStatus(newDoc.id, 'pending');
            ragOk = await syncDocumentToRag({
                groupCode: S.enterpriseSession.groupCode,
                kbId,
                docType,
                title,
                content,
                filename,
                fileData,
                documentId: newDoc?.id
            }, { toastOnError: false });
            applyLocalDocRagStatus(newDoc.id, ragOk ? 'indexed' : 'failed', {
                lastError: ragOk ? null : 'RAG 索引失敗'
            });
            try {
                const store2 = loadLocalEnterpriseStore();
                const g2 = store2.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
                const d2 = g2?.documents?.find(d => d.id === newDoc.id);
                if (d2) {
                    d2.ragStatus = ragOk ? 'indexed' : 'failed';
                    d2.rag = {
                        status: d2.ragStatus,
                        lastIndexedAt: ragOk ? new Date().toISOString() : null,
                        lastError: ragOk ? null : 'RAG 索引失敗'
                    };
                    d2.kbId = kbId;
                    saveLocalEnterpriseStore(store2);
                }
            } catch (_) {}
            S.ragSyncedGroupKey = null;
        } catch (e) {
            showToast('本機保存失敗: ' + e.message, 'error');
        }
    } else {
        // Online: server orchestrates RAG after enterprise write (W2-C).
        // Skip client syncDocumentToRag when server already indexed; client-retry only if ragOk === false.
        const res = await enterpriseFetch('POST', '/api/enterprise/group/document/add', payload);
        if (res.ok) {
            ok = true;
            newDoc = res.data.document;
            if (newDoc) {
                newDoc.kbId = newDoc.kbId || kbId;
                if (!newDoc.ragStatus) newDoc.ragStatus = res.data.ragStatus || 'pending';
            }

            const serverRagOk = res.data?.ragOk;
            const serverRagStatus = res.data?.ragStatus || newDoc?.ragStatus || 'pending';
            const serverPending = res.data?.ragPending === true || serverRagStatus === 'pending';

            if (serverRagOk === true || serverRagStatus === 'indexed') {
                ragOk = true;
                applyLocalDocRagStatus(newDoc?.id, 'indexed', { lastError: null });
            } else if (serverRagOk === false || serverRagStatus === 'failed') {
                // Server tried and failed — one client retry with full file payload if available
                applyLocalDocRagStatus(newDoc?.id, 'pending');
                ragOk = await syncDocumentToRag({
                    groupCode: S.enterpriseSession.groupCode,
                    kbId,
                    docType,
                    title,
                    content,
                    filename,
                    fileData,
                    documentId: newDoc?.id
                }, { toastOnError: false });
                applyLocalDocRagStatus(newDoc?.id, ragOk ? 'indexed' : 'failed', {
                    lastError: ragOk ? null : (res.data?.lastError || res.data?.warning || 'RAG 索引失敗'),
                    lastErrorCode: res.data?.errorCode || null,
                    lastErrorCategory: res.data?.errorCategory || null,
                    retryable: res.data?.retryable
                });
            } else {
                // pending / async server indexing — do not double-write from client
                ragOk = null;
                applyLocalDocRagStatus(newDoc?.id, 'pending');
                if (serverPending && newDoc) newDoc.ragStatus = 'pending';
                ensureRagStatusPolling();
            }
            S.ragSyncedGroupKey = null;
        } else {
            showToast('發布失敗: ' + res.error, 'error');
        }
    }
    
    if (ok) {
        // Enterprise OK vs RAG: indexed / failed / pending (server async)
        if (ragOk === true) {
            showToast('文件已發布，知識庫已可檢索', 'success');
        } else if (ragOk === false) {
            showToast('文件已存檔，但知識庫索引失敗 — 可稍後重試', 'error');
        } else {
            showToast('文件已存檔，知識庫索引處理中', 'success');
        }
        const tEl = document.getElementById('team-doc-title');
        const cEl = document.getElementById('team-doc-content');
        const fInput = document.getElementById('team-doc-file');
        const descEl = document.getElementById('team-doc-description');
        if (tEl) tEl.value = '';
        if (cEl) cEl.value = '';
        if (fInput) fInput.value = '';
        if (descEl) descEl.value = '';
        
        const textRadio = document.querySelector('input[name="team-doc-type"][value="text"]');
        if (textRadio) {
            textRadio.checked = true;
            switchDocFormType('text');
        }
        
        S.selectedDocFile = null;
        toggleAddDocForm(false);
        if (newDoc && S.enterpriseGroupData) {
            const list = S.enterpriseGroupData.documents || [];
            const existing = list.find(d => d.id === newDoc.id);
            if (!existing) {
                S.enterpriseGroupData.documents = [{ ...newDoc, ragStatus: ragOk ? 'indexed' : (ragOk === false ? 'failed' : 'pending'), kbId: newDoc.kbId || kbId }, ...list];
            } else {
                applyLocalDocRagStatus(newDoc.id, ragOk ? 'indexed' : (ragOk === false ? 'failed' : 'pending'), {
                    lastError: ragOk === false ? 'RAG 索引失敗' : null
                });
            }
            renderEnterpriseDocuments();
        }
        refreshEnterpriseData();
    }
}

function resolveDocRagStatus(doc) {
    if (!doc) return 'pending';
    // Prefer session override (survives refreshEnterpriseData until Core persists)
    const override = S.docRagStatusOverrides?.[doc.id];
    if (override === 'indexed' || override === 'pending' || override === 'failed' || override === 'deleted') {
        return override;
    }
    const status = doc.ragStatus || doc.rag?.status || null;
    if (status === 'indexed' || status === 'pending' || status === 'failed' || status === 'deleted') {
        return status;
    }
    // No age-based "fake indexed" heuristic — unknown status stays pending until Core persists.
    return 'pending';
}

function applyLocalDocRagStatus(docId, status, extra = {}) {
    if (!docId) return;
    if (!S.docRagStatusOverrides) S.docRagStatusOverrides = {};
    S.docRagStatusOverrides[docId] = status;

    if (!S.enterpriseGroupData?.documents) return;
    const doc = S.enterpriseGroupData.documents.find(d => d.id === docId);
    if (!doc) return;
    doc.ragStatus = status;
    doc.rag = {
        ...(doc.rag && typeof doc.rag === 'object' ? doc.rag : {}),
        status,
        lastIndexedAt: status === 'indexed' ? new Date().toISOString() : (doc.rag?.lastIndexedAt || null),
        lastError: extra.lastError != null ? extra.lastError : (status === 'failed' ? (extra.lastError || '索引失敗') : null),
        lastErrorCode: extra.lastErrorCode != null ? extra.lastErrorCode : (status === 'failed' ? (doc.rag?.lastErrorCode || null) : null),
        lastErrorCategory: extra.lastErrorCategory != null ? extra.lastErrorCategory : (status === 'failed' ? (doc.rag?.lastErrorCategory || null) : null),
        retryable: extra.retryable != null ? extra.retryable : (status === 'failed' ? (doc.rag?.retryable != null ? doc.rag.retryable : true) : null)
    };
    if (status === 'pending') ensureRagStatusPolling();
}

/** Wave 3: poll pending documents until indexed/failed */
const RAG_STATUS_POLL_MS = 4000;
const RAG_STATUS_POLL_MAX = 45; // ~3 min

function ensureRagStatusPolling() {
    if (S._ragStatusPollTimer) return;
    S._ragStatusPollTicks = 0;
    S._ragStatusPollTimer = setInterval(() => {
        pollPendingDocumentRagStatus().catch(err => {
            console.warn('[Lumina] rag status poll', err);
        });
    }, RAG_STATUS_POLL_MS);
}

function stopRagStatusPolling() {
    if (S._ragStatusPollTimer) {
        clearInterval(S._ragStatusPollTimer);
        S._ragStatusPollTimer = null;
    }
    S._ragStatusPollTicks = 0;
}

async function pollPendingDocumentRagStatus() {
    if (!S.enterpriseSession || S.enterpriseSession.offline) {
        stopRagStatusPolling();
        return;
    }
    const docs = S.enterpriseGroupData?.documents || [];
    const pending = docs.filter(d => resolveDocRagStatus(d) === 'pending');
    if (!pending.length) {
        stopRagStatusPolling();
        return;
    }
    S._ragStatusPollTicks = (S._ragStatusPollTicks || 0) + 1;
    if (S._ragStatusPollTicks > RAG_STATUS_POLL_MAX) {
        stopRagStatusPolling();
        return;
    }

    let changed = false;
    for (const doc of pending.slice(0, 8)) {
        try {
            const qs = new URLSearchParams({
                groupCode: S.enterpriseSession.groupCode,
                memberId: S.enterpriseSession.memberId,
                documentId: doc.id
            });
            const res = await enterpriseFetch(
                'GET',
                `/api/enterprise/group/document/status?${qs.toString()}`
            );
            if (!res.ok || !res.data) continue;
            const st = res.data.ragStatus;
            if (st === 'pending' || res.data.indexing) continue;
            if (st === 'indexed' || st === 'failed' || st === 'deleted') {
                applyLocalDocRagStatus(doc.id, st, {
                    lastError: res.data.lastError,
                    lastErrorCode: res.data.lastErrorCode,
                    lastErrorCategory: res.data.lastErrorCategory,
                    retryable: res.data.retryable
                });
                if (S.docRagStatusOverrides) delete S.docRagStatusOverrides[doc.id];
                // merge server fields onto doc
                if (S.enterpriseGroupData?.documents) {
                    const d = S.enterpriseGroupData.documents.find(x => x.id === doc.id);
                    if (d) {
                        d.ragStatus = st;
                        d.rag = {
                            ...(d.rag || {}),
                            status: st,
                            lastError: res.data.lastError,
                            lastErrorCode: res.data.lastErrorCode,
                            lastErrorCategory: res.data.lastErrorCategory,
                            retryable: res.data.retryable,
                            lastIndexedAt: res.data.lastIndexedAt,
                            chunks: res.data.chunks
                        };
                    }
                }
                changed = true;
                if (st === 'indexed') {
                    showToast(`「${doc.title || '文件'}」知識庫已索引完成`, 'success');
                } else if (st === 'failed') {
                    const code = res.data.lastErrorCode ? ` (${res.data.lastErrorCode})` : '';
                    showToast(`「${doc.title || '文件'}」索引失敗${code}`, 'error');
                }
            }
        } catch (_) { /* ignore single poll errors */ }
    }
    if (changed) renderEnterpriseDocuments();
    const stillPending = (S.enterpriseGroupData?.documents || [])
        .some(d => resolveDocRagStatus(d) === 'pending');
    if (!stillPending) stopRagStatusPolling();
}

function renderDocRagStatusBadge(doc) {
    const status = resolveDocRagStatus(doc);
    const errCode = doc.rag?.lastErrorCode || '';
    const errMsg = doc.rag?.lastError || '';
    const retryable = doc.rag?.retryable;
    const failedTitle = [errCode, errMsg, retryable === false ? '（建議檢查內容／設定）' : (retryable ? '（可重試）' : '')]
        .filter(Boolean).join(' — ') || '已存檔但無法被教練檢索';
    const map = {
        indexed: { label: '已索引', cls: 'doc-rag-badge-indexed', icon: 'fa-circle-check', title: '已發布且可被教練檢索' },
        pending: { label: '索引中', cls: 'doc-rag-badge-pending', icon: 'fa-spinner fa-spin', title: '已存檔，知識庫索引處理中（自動刷新）' },
        failed: {
            label: errCode ? `索引失敗 · ${errCode}` : '索引失敗',
            cls: 'doc-rag-badge-failed',
            icon: 'fa-circle-exclamation',
            title: failedTitle
        },
        deleted: { label: '已刪除索引', cls: 'doc-rag-badge-failed', icon: 'fa-trash', title: '索引已移除' }
    };
    const conf = map[status] || map.pending;
    return `<span class="doc-rag-badge ${conf.cls}" title="${escapeHtml(conf.title)}"><i class="fa-solid ${conf.icon}"></i> ${conf.label}</span>`;
}

function isNearEmptyDocContent(doc) {
    if (!doc) return false;
    if (doc.docType !== 'pdf' && doc.docType !== 'excel') return false;
    const text = String(doc.content || '')
        .replace(/【[^】]+】[：:]\s*/g, '')
        .trim();
    return text.length < 30;
}

async function retryDocumentRagIndex(docId) {
    if (!S.enterpriseSession || !docId) return;
    const docs = S.enterpriseGroupData?.documents || [];
    const doc = docs.find(d => d.id === docId);
    if (!doc) {
        showToast('找不到文件', 'error');
        return;
    }

    applyLocalDocRagStatus(docId, 'pending');
    renderEnterpriseDocuments();

    let ok = false;

    if (!S.enterpriseSession.offline) {
        // Online: prefer server reindex (manager only, W2-C)
        const res = await enterpriseFetch('POST', '/api/enterprise/group/document/reindex', {
            groupCode: S.enterpriseSession.groupCode,
            managerId: S.enterpriseSession.memberId,
            documentId: doc.id
        });
        if (res.ok) {
            const status = res.data?.ragStatus || (res.data?.ragOk === true ? 'indexed' : null);
            if (status === 'indexed' || res.data?.ragOk === true) {
                ok = true;
            } else if (res.data?.ragPending || status === 'pending') {
                // Server still working — leave pending; list refresh will pick up status
                applyLocalDocRagStatus(docId, 'pending');
                renderEnterpriseDocuments();
                showToast(`索引處理中：${doc.title}`, 'success');
                S.ragSyncedGroupKey = null;
                return;
            } else {
                ok = false;
            }
        } else {
            // Fallback: client best-effort if reindex endpoint unavailable
            ok = await syncDocumentToRag({
                groupCode: S.enterpriseSession.groupCode,
                kbId: doc.kbId || 'general',
                docType: doc.docType || 'text',
                title: doc.title,
                content: doc.content,
                filename: getRagFilenameForDoc(doc),
                fileData: null,
                documentId: doc.id
            }, { toastOnError: false });
        }
    } else {
        // Offline path: client best-effort RAG
        ok = await syncDocumentToRag({
            groupCode: S.enterpriseSession.groupCode,
            kbId: doc.kbId || 'general',
            docType: doc.docType || 'text',
            title: doc.title,
            content: doc.content,
            filename: getRagFilenameForDoc(doc),
            fileData: null,
            documentId: doc.id
        }, { toastOnError: false });
    }

    applyLocalDocRagStatus(docId, ok ? 'indexed' : 'failed', {
        lastError: ok ? null : '重試索引失敗'
    });

    if (S.enterpriseSession.offline) {
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
            const d = group?.documents?.find(x => x.id === docId);
            if (d) {
                d.ragStatus = ok ? 'indexed' : 'failed';
                d.rag = {
                    status: d.ragStatus,
                    lastIndexedAt: ok ? new Date().toISOString() : d.rag?.lastIndexedAt || null,
                    lastError: ok ? null : '重試索引失敗'
                };
                if (!d.kbId) d.kbId = doc.kbId || 'general';
                saveLocalEnterpriseStore(store);
            }
        } catch (_) {}
    }

    renderEnterpriseDocuments();
    if (ok) showToast(`已重新索引：${doc.title}`, 'success');
    else showToast(`索引仍失敗：${doc.title}`, 'error');
    S.ragSyncedGroupKey = null;
}

// ── W2-F: document version history (minimal UI) ────────────────────────────

function getDocCurrentVersion(doc) {
    const n = Number(doc?.currentVersion);
    if (Number.isFinite(n) && n >= 1) return n;
    if (Array.isArray(doc?.versions) && doc.versions.length) {
        return Math.max(...doc.versions.map(v => Number(v.version) || 0), 1);
    }
    return 1;
}

function renderDocVersionBadge(doc) {
    const v = getDocCurrentVersion(doc);
    return `<span class="doc-version-badge" title="目前版本">v${v}</span>`;
}

function ensureDocUiState() {
    if (!S.docUiOpen) {
        S.docUiOpen = { versionPanels: {}, newVerForms: {}, drafts: {}, previewVersion: {} };
    }
    if (!S.docUiOpen.drafts) S.docUiOpen.drafts = {};
    if (!S.docUiOpen.previewVersion) S.docUiOpen.previewVersion = {};
    return S.docUiOpen;
}

function captureDocNewVersionDraft(docId) {
    if (!docId) return;
    const ui = ensureDocUiState();
    const titleEl = document.getElementById(`doc-newver-title-${docId}`);
    const contentEl = document.getElementById(`doc-newver-content-${docId}`);
    const noteEl = document.getElementById(`doc-newver-note-${docId}`);
    if (!titleEl && !contentEl && !noteEl) return;
    ui.drafts[docId] = {
        title: titleEl ? titleEl.value : '',
        content: contentEl ? contentEl.value : '',
        note: noteEl ? noteEl.value : ''
    };
}

function bindDocNewVersionDraftCapture(docId) {
    ['title', 'content', 'note'].forEach(field => {
        const id = field === 'title'
            ? `doc-newver-title-${docId}`
            : field === 'content'
                ? `doc-newver-content-${docId}`
                : `doc-newver-note-${docId}`;
        const el = document.getElementById(id);
        if (!el || el.dataset.draftBound) return;
        el.dataset.draftBound = '1';
        el.addEventListener('input', () => captureDocNewVersionDraft(docId));
    });
}

function toggleDocVersionPanel(docId) {
    if (!docId) return;
    const ui = ensureDocUiState();
    const panel = document.getElementById(`doc-ver-panel-${docId}`);
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    ui.versionPanels[docId] = opening;
    const btn = document.querySelector(`[aria-controls="doc-ver-panel-${docId}"]`);
    if (btn) btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) {
        loadDocumentVersions(docId);
    }
}

function toggleDocNewVersionForm(docId) {
    if (!docId) return;
    const ui = ensureDocUiState();
    const form = document.getElementById(`doc-newver-form-${docId}`);
    if (!form) return;
    const willOpen = form.classList.contains('hidden');
    if (!willOpen) captureDocNewVersionDraft(docId);
    form.classList.toggle('hidden');
    const open = !form.classList.contains('hidden');
    ui.newVerForms[docId] = open;
    if (open) {
        const draft = ui.drafts[docId];
        if (draft) {
            const titleEl = document.getElementById(`doc-newver-title-${docId}`);
            const contentEl = document.getElementById(`doc-newver-content-${docId}`);
            const noteEl = document.getElementById(`doc-newver-note-${docId}`);
            if (titleEl && draft.title != null) titleEl.value = draft.title;
            if (contentEl && draft.content != null) contentEl.value = draft.content;
            if (noteEl && draft.note != null) noteEl.value = draft.note;
        }
        bindDocNewVersionDraftCapture(docId);
        document.getElementById(`doc-newver-title-${docId}`)?.focus();
    }
}

/** Restore open version panels / new-version forms after list re-render */
function restoreDocUiPanels() {
    const ui = S.docUiOpen;
    if (!ui) return;
    Object.keys(ui.versionPanels || {}).forEach(docId => {
        if (!ui.versionPanels[docId]) return;
        const panel = document.getElementById(`doc-ver-panel-${docId}`);
        if (!panel) return;
        panel.classList.remove('hidden');
        const btn = document.querySelector(`[aria-controls="doc-ver-panel-${docId}"]`);
        if (btn) btn.setAttribute('aria-expanded', 'true');
        loadDocumentVersions(docId);
    });
    Object.keys(ui.newVerForms || {}).forEach(docId => {
        if (!ui.newVerForms[docId]) return;
        const form = document.getElementById(`doc-newver-form-${docId}`);
        if (!form) return;
        form.classList.remove('hidden');
        const draft = ui.drafts && ui.drafts[docId];
        if (draft) {
            const titleEl = document.getElementById(`doc-newver-title-${docId}`);
            const contentEl = document.getElementById(`doc-newver-content-${docId}`);
            const noteEl = document.getElementById(`doc-newver-note-${docId}`);
            if (titleEl && draft.title != null) titleEl.value = draft.title;
            if (contentEl && draft.content != null) contentEl.value = draft.content;
            if (noteEl && draft.note != null) noteEl.value = draft.note;
        }
        bindDocNewVersionDraftCapture(docId);
    });
}

async function loadDocumentVersions(docId) {
    if (!S.enterpriseSession || !docId) return;
    const listEl = document.getElementById(`doc-ver-list-${docId}`);
    if (!listEl) return;

    listEl.innerHTML = `<div class="text-[11px] text-slate-500 py-2"><i class="fa-solid fa-spinner fa-spin mr-1"></i>載入版本歷史…</div>`;

    // Offline / local: use embedded versions on the doc
    if (S.enterpriseSession.offline) {
        const docs = S.enterpriseGroupData?.documents || [];
        const doc = docs.find(d => d.id === docId);
        const versions = (doc?.versions || [])
            .slice()
            .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
        renderDocumentVersionList(docId, versions, getDocCurrentVersion(doc));
        return;
    }

    const qs = new URLSearchParams({
        groupCode: S.enterpriseSession.groupCode,
        documentId: docId,
        memberId: S.enterpriseSession.memberId
    });
    const res = await enterpriseFetch(
        'GET',
        `/api/enterprise/group/document/versions?${qs.toString()}`
    );
    if (!res.ok) {
        listEl.innerHTML = `<div class="text-[11px] text-red-400 py-2">載入失敗：${escapeHtml(res.error || '未知錯誤')}</div>`;
        return;
    }
    const versions = Array.isArray(res.data?.versions) ? res.data.versions : [];
    const currentVersion = res.data?.currentVersion || getDocCurrentVersion(
        (S.enterpriseGroupData?.documents || []).find(d => d.id === docId)
    );
    // Keep session doc in sync
    const doc = (S.enterpriseGroupData?.documents || []).find(d => d.id === docId);
    if (doc && res.data?.currentVersion) {
        doc.currentVersion = res.data.currentVersion;
    }
    renderDocumentVersionList(docId, versions, currentVersion);
}

function renderDocumentVersionList(docId, versions, currentVersion) {
    const listEl = document.getElementById(`doc-ver-list-${docId}`);
    if (!listEl) return;
    if (!versions.length) {
        listEl.innerHTML = `<div class="text-[11px] text-slate-500 py-2">尚無版本記錄</div>`;
        return;
    }
    listEl.innerHTML = versions.map(v => {
        const isCurrent = Number(v.version) === Number(currentVersion);
        const when = v.createdAt ? new Date(v.createdAt).toLocaleString('zh-TW') : '—';
        const author = v.createdByName || '—';
        const note = v.changeNote ? escapeHtml(v.changeNote) : '<span class="opacity-50">（無備註）</span>';
        return `
            <button type="button"
                class="doc-ver-row ${isCurrent ? 'is-current' : ''} focus-ring"
                ${luminaAction('previewDocumentVersion', { arg: `${docId}:${v.version}` })}
                title="預覽 v${v.version}">
                <div class="doc-ver-row-main">
                    <span class="doc-ver-num">v${v.version}</span>
                    ${isCurrent ? '<span class="doc-ver-current-tag">目前</span>' : ''}
                    <span class="doc-ver-title">${escapeHtml(v.title || '')}</span>
                </div>
                <div class="doc-ver-row-meta">
                    <span>${escapeHtml(author)} · ${escapeHtml(when)}</span>
                    <span class="doc-ver-note">${note}</span>
                </div>
            </button>
        `;
    }).join('');
}

async function previewDocumentVersion(token) {
    if (!S.enterpriseSession || !token) return;
    const parts = String(token).split(':');
    const docId = parts[0];
    const version = parseInt(parts[1], 10);
    if (!docId || !Number.isFinite(version)) return;

    const previewEl = document.getElementById(`doc-ver-preview-${docId}`);
    if (previewEl) {
        previewEl.classList.remove('hidden');
        previewEl.innerHTML = `<div class="text-[11px] text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-1"></i>載入 v${version}…</div>`;
    }

    if (S.enterpriseSession.offline) {
        const doc = (S.enterpriseGroupData?.documents || []).find(d => d.id === docId);
        const snap = (doc?.versions || []).find(v => Number(v.version) === version);
        if (!snap) {
            if (previewEl) previewEl.innerHTML = `<div class="text-[11px] text-red-400">找不到 v${version}</div>`;
            return;
        }
        renderDocumentVersionPreview(docId, snap, doc?.currentVersion);
        return;
    }

    const qs = new URLSearchParams({
        groupCode: S.enterpriseSession.groupCode,
        documentId: docId,
        version: String(version),
        memberId: S.enterpriseSession.memberId
    });
    const res = await enterpriseFetch(
        'GET',
        `/api/enterprise/group/document/version?${qs.toString()}`
    );
    if (!res.ok) {
        if (previewEl) {
            previewEl.innerHTML = `<div class="text-[11px] text-red-400">預覽失敗：${escapeHtml(res.error || '未知錯誤')}</div>`;
        } else {
            showToast('預覽失敗: ' + (res.error || '未知錯誤'), 'error');
        }
        return;
    }
    renderDocumentVersionPreview(docId, res.data?.version || res.data, res.data?.currentVersion);
}

function renderDocumentVersionPreview(docId, snap, currentVersion) {
    const previewEl = document.getElementById(`doc-ver-preview-${docId}`);
    if (!previewEl || !snap) return;
    const v = snap.version;
    const isCurrent = Number(v) === Number(currentVersion);
    const content = String(snap.content || '');
    const truncated = content.length > 2000 ? content.slice(0, 2000) + '…' : content;
    previewEl.classList.remove('hidden');
    previewEl.innerHTML = `
        <div class="doc-ver-preview-head">
            <span class="font-semibold text-slate-200">v${v} ${escapeHtml(snap.title || '')}</span>
            ${isCurrent ? '<span class="doc-ver-current-tag">目前</span>' : ''}
            <button type="button" class="doc-ver-close-btn focus-ring"
                ${luminaAction('closeDocumentVersionPreview', { arg: docId })}
                aria-label="關閉預覽">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="text-[10px] text-slate-500 mb-1.5">
            ${escapeHtml(snap.createdByName || '—')}
            ${snap.createdAt ? ' · ' + new Date(snap.createdAt).toLocaleString('zh-TW') : ''}
            ${snap.changeNote ? ' · ' + escapeHtml(snap.changeNote) : ''}
            ${snap.filename ? ' · ' + escapeHtml(snap.filename) : ''}
        </div>
        <pre class="doc-ver-preview-body custom-scroll">${escapeHtml(truncated || '（此版本無文字內容）')}</pre>
    `;
}

function closeDocumentVersionPreview(docId) {
    const previewEl = document.getElementById(`doc-ver-preview-${docId}`);
    if (previewEl) {
        previewEl.classList.add('hidden');
        previewEl.innerHTML = '';
    }
}

async function publishDocumentVersion(docId) {
    if (!S.enterpriseSession || !docId) return;
    if (S.enterpriseSession.role !== 'manager') {
        return showToast('僅主管可發新版本', 'error');
    }

    const docs = S.enterpriseGroupData?.documents || [];
    const doc = docs.find(d => d.id === docId);
    if (!doc) return showToast('找不到文件', 'error');

    const titleEl = document.getElementById(`doc-newver-title-${docId}`);
    const contentEl = document.getElementById(`doc-newver-content-${docId}`);
    const noteEl = document.getElementById(`doc-newver-note-${docId}`);

    const title = (titleEl?.value || '').trim() || doc.title;
    const content = (contentEl?.value || '').trim();
    const changeNote = (noteEl?.value || '').trim();

    if (!content) {
        return showToast('請輸入新版本內容', 'error');
    }

    // Offline: push local version snapshot
    if (S.enterpriseSession.offline) {
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
            const localDoc = group?.documents?.find(d => d.id === docId);
            if (!localDoc) throw new Error('找不到文件');
            if (!Array.isArray(localDoc.versions)) localDoc.versions = [];
            const nextV = (Number(localDoc.currentVersion) || localDoc.versions.length || 1) + 1;
            const nowIso = new Date().toISOString();
            const snap = {
                version: nextV,
                title,
                content,
                filename: localDoc.filename || null,
                fileUrl: localDoc.fileUrl || null,
                docType: localDoc.docType || 'text',
                createdAt: nowIso,
                createdByMemberId: S.enterpriseSession.memberId,
                createdByName: S.enterpriseSession.name,
                changeNote: changeNote || null
            };
            localDoc.versions.push(snap);
            localDoc.currentVersion = nextV;
            localDoc.title = title;
            localDoc.content = content;
            localDoc.updatedAt = nowIso;
            localDoc.author = S.enterpriseSession.name;
            saveLocalEnterpriseStore(store);
            Object.assign(doc, {
                currentVersion: nextV,
                title,
                content,
                updatedAt: nowIso,
                versions: localDoc.versions,
                author: S.enterpriseSession.name
            });
            // Best-effort reindex latest for offline coach
            applyLocalDocRagStatus(docId, 'pending');
            const ragOk = await syncDocumentToRag({
                groupCode: S.enterpriseSession.groupCode,
                kbId: doc.kbId || 'general',
                docType: doc.docType || 'text',
                title,
                content,
                filename: getRagFilenameForDoc(doc),
                fileData: null,
                documentId: docId
            }, { toastOnError: false });
            applyLocalDocRagStatus(docId, ragOk ? 'indexed' : 'failed', {
                lastError: ragOk ? null : 'RAG 索引失敗'
            });
            showToast(ragOk ? `已發布 v${nextV}，知識庫已更新` : `已發布 v${nextV}，但索引失敗`, ragOk ? 'success' : 'error');
            toggleDocNewVersionForm(docId);
            renderEnterpriseDocuments();
            // Re-open version panel
            const panel = document.getElementById(`doc-ver-panel-${docId}`);
            if (panel) {
                panel.classList.remove('hidden');
                loadDocumentVersions(docId);
            }
            S.ragSyncedGroupKey = null;
            return;
        } catch (e) {
            return showToast('本機發版失敗: ' + e.message, 'error');
        }
    }

    const payload = {
        groupCode: S.enterpriseSession.groupCode,
        managerId: S.enterpriseSession.memberId,
        documentId: docId,
        title,
        content,
        docType: doc.docType || 'text',
        changeNote: changeNote || null
    };

    const res = await enterpriseFetch('POST', '/api/enterprise/group/document/version', payload);
    if (!res.ok) {
        return showToast('發新版本失敗: ' + (res.error || '未知錯誤'), 'error');
    }

    // Clear draft after successful publish
    const ui = ensureDocUiState();
    delete ui.drafts[docId];
    ui.newVerForms[docId] = false;

    const updated = res.data?.document;
    const nextV = res.data?.currentVersion || updated?.currentVersion;
    const ragStatus = res.data?.ragStatus || updated?.ragStatus || 'pending';
    const ragOk = res.data?.ragOk;

    if (updated) {
        const idx = docs.findIndex(d => d.id === docId);
        if (idx >= 0) {
            docs[idx] = { ...docs[idx], ...updated, currentVersion: nextV || updated.currentVersion };
        }
    } else {
        doc.currentVersion = nextV || (getDocCurrentVersion(doc) + 1);
        doc.title = title;
        doc.content = content;
        doc.updatedAt = new Date().toISOString();
    }

    applyLocalDocRagStatus(docId, ragStatus === 'indexed' || ragOk === true
        ? 'indexed'
        : (ragStatus === 'failed' || ragOk === false ? 'failed' : 'pending'), {
        lastError: ragOk === false ? (res.data?.warning || '索引失敗') : null
    });

    if (ragOk === true || ragStatus === 'indexed') {
        showToast(`已發布 v${nextV}，知識庫已可檢索`, 'success');
    } else if (ragOk === false || ragStatus === 'failed') {
        showToast(`已發布 v${nextV}，但知識庫索引失敗`, 'error');
    } else {
        showToast(`已發布 v${nextV}，知識庫索引處理中`, 'success');
    }

    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    if (noteEl) noteEl.value = '';
    toggleDocNewVersionForm(docId);
    S.ragSyncedGroupKey = null;
    renderEnterpriseDocuments();
    const panel = document.getElementById(`doc-ver-panel-${docId}`);
    if (panel) {
        panel.classList.remove('hidden');
        loadDocumentVersions(docId);
    }
    refreshEnterpriseData();
}

async function deleteTeamDocument(docId) {
    if (!S.enterpriseSession) return;
    if (!confirm('確定要刪除此文件嗎？刪除後將無法恢復，且 AI 也無法讀取該資料。')) return;
    
    const docs = S.enterpriseGroupData?.documents || [];
    const docToDelete = docs.find(d => d.id === docId);
    
    const payload = {
        groupCode: S.enterpriseSession.groupCode,
        managerId: S.enterpriseSession.memberId,
        documentId: docId
    };
    
    let ok = false;
    
    if (S.enterpriseSession.offline) {
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
            if (!group) throw new Error('找不到群組');
            if (group.documents) {
                group.documents = group.documents.filter(d => d.id !== docId);
            }
            saveLocalEnterpriseStore(store);
            ok = true;
        } catch (e) {
            showToast('本機刪除失敗: ' + e.message, 'error');
        }
    } else {
        const res = await enterpriseFetch('POST', '/api/enterprise/group/document/delete', payload);
        if (!res.ok) {
            showToast('刪除失敗: ' + res.error, 'error');
            return;
        }
        const data = res.data || {};
        // RAG index cleanup failed: server did not soft-delete — keep list item + allow retry
        if (data.ragDeleteOk === false || data.ok === false) {
            const msg = data.warning || data.error || '知識庫索引清除失敗，文件仍保留，請重試刪除';
            applyLocalDocRagStatus(docId, data.ragStatus || 'failed', {
                lastError: msg
            });
            renderEnterpriseDocuments();
            showToast(msg, 'error');
            return;
        }
        ok = true;
    }
    
    if (ok) {
        showToast('文件已成功刪除', 'success');
        
        // Offline path: best-effort client RAG cleanup (online path is server-side).
        if (S.enterpriseSession.offline && S.ragServiceActive && docToDelete) {
            await deleteDocumentFromRag({
                groupCode: S.enterpriseSession.groupCode,
                kbId: docToDelete.kbId || 'general',
                filename: getRagFilenameForDoc(docToDelete),
                documentId: docToDelete.id
            });
        }
        
        if (S.docRagStatusOverrides && docId) delete S.docRagStatusOverrides[docId];
        refreshEnterpriseData();
    }
}

function toggleCreateKbForm(show) {
    const form = document.getElementById('team-kb-create-form');
    if (!form) return;
    if (show === undefined) {
        form.classList.toggle('hidden');
    } else {
        form.classList.toggle('hidden', !show);
    }
    if (!form.classList.contains('hidden')) {
        document.getElementById('team-kb-create-name')?.focus();
    }
}

function getFallbackKbItems() {
    return Object.keys(C.RAG_KB_LABELS).map(id => ({
        id,
        displayName: C.RAG_KB_LABELS[id],
        description: '',
        docCount: getKbDocCount(id),
        status: 'active'
    }));
}

async function populateTeamDocKbSelect(items) {
    const select = document.getElementById('team-doc-kb-select');
    if (!select) return;
    const prev = select.value || 'general';
    const list = (items && items.length) ? items : getFallbackKbItems();
    select.innerHTML = list.map(kb => {
        const label = (kb.displayName || getRagKbLabel(kb.id)).replace(/\s*\([^)]*\)\s*$/, '').trim();
        const count = typeof kb.docCount === 'number' ? kb.docCount : getKbDocCount(kb.id);
        const countHint = count > 0 ? `（${count} 份）` : '（空庫）';
        return `<option value="${escapeHtml(kb.id)}">${escapeHtml(label)} ${countHint}</option>`;
    }).join('');
    if ([...select.options].some(o => o.value === prev)) select.value = prev;
    else select.value = list[0]?.id || 'general';
}

async function renderTeamKnowledgeBases(options = {}) {
    if (!S.enterpriseSession) return;
    const listEl = document.getElementById('team-kb-list');
    const createToggle = document.getElementById('team-kb-create-toggle');
    const createDisabled = document.getElementById('team-kb-create-disabled');
    const isManager = S.enterpriseSession.role === 'manager';
    const offline = !!S.enterpriseSession.offline;
    const force = !!options.force;

    if (createToggle) createToggle.classList.toggle('hidden', !isManager || offline);
    if (createDisabled) {
        // Show when member OR offline — create API needs manager + online
        createDisabled.classList.toggle('hidden', isManager && !offline);
        if (!isManager) {
            createDisabled.innerHTML = '<i class="fa-solid fa-lock"></i><span>僅主管可建立／刪除知識庫。你可檢視庫別與文件；請請主管補資料。</span>';
        } else if (offline) {
            createDisabled.innerHTML = '<i class="fa-solid fa-lock"></i><span>離線模式無法建立新庫；請連線 API 後再試。仍可對既有類別上傳文件（本機）。</span>';
        }
    }

    if (!listEl) return;

    let items = null;
    const cacheFresh = S._kbListCache
        && S._kbListCache.groupCode === S.enterpriseSession.groupCode
        && (Date.now() - (S._kbListCache.at || 0)) < 8000;

    if (!force && cacheFresh) {
        items = S._kbListCache.items;
    } else if (!offline) {
        const list = await fetchRagKbList(S.enterpriseSession.groupCode).catch(() => null);
        if (list?.items?.length) {
            rememberRagKbItems(list.items);
            items = list.items;
        } else if (list?.kb_ids?.length) {
            items = list.kb_ids.map(id => ({
                id,
                displayName: getRagKbLabel(id),
                docCount: getKbDocCount(id),
                status: 'active'
            }));
            rememberRagKbItems(items);
        }
        if (items?.length) {
            S._kbListCache = {
                groupCode: S.enterpriseSession.groupCode,
                at: Date.now(),
                items
            };
        }
    }

    if (!items || !items.length) {
        items = getFallbackKbItems();
        rememberRagKbItems(items);
    }

    // Live doc counts from enterprise documents (source of truth in session)
    items = items.map(kb => ({
        ...kb,
        displayName: kb.displayName || getRagKbLabel(kb.id),
        docCount: getKbDocCount(kb.id)
    }));

    await populateTeamDocKbSelect(items);

    listEl.innerHTML = items.map(kb => {
        const name = (kb.displayName || getRagKbLabel(kb.id)).replace(/\s*\([^)]*\)\s*$/, '').trim();
        const count = typeof kb.docCount === 'number' ? kb.docCount : 0;
        const countLabel = count > 0 ? `${count} 份文件` : '空庫';
        const isGeneral = kb.id === 'general';
        const canDelete = isManager && !offline && !isGeneral;
        return `
            <div class="team-kb-card" data-kb-id="${escapeHtml(kb.id)}">
                <div class="team-kb-card-main">
                    <div class="team-kb-card-name">${escapeHtml(name)}</div>
                    <div class="team-kb-card-meta">
                        <span class="font-mono text-[10px] opacity-70">${escapeHtml(kb.id)}</span>
                        ${kb.description ? ` · ${escapeHtml(kb.description)}` : ''}
                    </div>
                </div>
                <div class="team-kb-card-actions">
                    <span class="team-kb-card-badge ${count === 0 ? 'is-empty' : ''}">${countLabel}</span>
                    ${canDelete ? `
                        <button type="button" class="team-kb-delete-btn focus-ring"
                            ${luminaAction('deleteTeamKnowledgeBase', { arg: kb.id })}
                            aria-label="刪除知識庫 ${escapeHtml(name)}"
                            title="刪除知識庫（不可恢復）">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    ` : (isGeneral ? '<span class="text-[10px] text-slate-600">預設</span>' : '')}
                </div>
            </div>
        `;
    }).join('');
}

async function createTeamKnowledgeBase() {
    if (!S.enterpriseSession) return;
    if (S.enterpriseSession.role !== 'manager') {
        return showToast('僅主管可建立知識庫', 'error');
    }
    if (S.enterpriseSession.offline) {
        return showToast('離線模式無法建立知識庫，請先連線 API', 'error');
    }
    const nameEl = document.getElementById('team-kb-create-name');
    const descEl = document.getElementById('team-kb-create-desc');
    const displayName = (nameEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!displayName) return showToast('請輸入知識庫名稱', 'error');

    try {
        const kb = await createRagKnowledgeBase({
            groupCode: S.enterpriseSession.groupCode,
            displayName,
            description
        });
        if (kb?.id) {
            rememberRagKbItems([{
                id: kb.id,
                displayName: kb.displayName || displayName,
                description: kb.description || description,
                docCount: 0,
                status: 'active'
            }]);
        }
        if (nameEl) nameEl.value = '';
        if (descEl) descEl.value = '';
        toggleCreateKbForm(false);
        showToast(`知識庫「${displayName}」已建立`, 'success');
        S._kbListCache = null;
        await renderTeamKnowledgeBases({ force: true });
        window.renderRagKbCheckboxes?.();
    } catch (e) {
        if (e.status === 404 || e.code === 'NOT_FOUND') {
            showToast('建立 API 尚未就緒，請使用既有知識庫類別上傳', 'error');
            document.getElementById('team-kb-create-toggle')?.classList.add('hidden');
            document.getElementById('team-kb-create-disabled')?.classList.remove('hidden');
            toggleCreateKbForm(false);
            return;
        }
        showToast(e.message || '建立知識庫失敗', 'error');
    }
}

async function deleteTeamKnowledgeBase(kbId) {
    if (!S.enterpriseSession || !kbId) return;
    if (S.enterpriseSession.role !== 'manager') {
        return showToast('僅主管可刪除知識庫', 'error');
    }
    if (kbId === 'general') {
        return showToast('不可刪除預設知識庫 general', 'error');
    }
    const label = getRagKbLabel(kbId).replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!confirm(`確定刪除知識庫「${label}」？庫內文件將一併移除，且教練無法再檢索。`)) return;

    try {
        const data = await deleteRagKnowledgeBase({
            groupCode: S.enterpriseSession.groupCode,
            kbId
        });
        // Align with deleteTeamDocument: RAG wipe fail → error toast, no false success
        if (data && (data.ragDeleteOk === false || data.ok === false)) {
            const msg = data.warning || data.error || '知識庫索引清除失敗，知識庫仍保留，請重試刪除';
            showToast(msg, 'error');
            return;
        }
        if (S.ragKbItemsById) delete S.ragKbItemsById[kbId];
        S.checkedRagKbs = (S.checkedRagKbs || []).filter(id => id !== kbId);
        showToast(`已刪除知識庫「${label}」`, 'success');
        S._kbListCache = null;
        await refreshEnterpriseData(true);
        await renderTeamKnowledgeBases({ force: true });
        window.renderRagKbCheckboxes?.();
    } catch (e) {
        showToast(e.message || '刪除知識庫失敗', 'error');
    }
}

function renderEnterpriseDocuments() {
    if (!S.enterpriseSession || !S.enterpriseGroupData) return;
    const docs = S.enterpriseGroupData.documents || [];
    const isManager = S.enterpriseSession.role === 'manager';

    // Wave 3: keep polling while any doc is pending
    if (docs.some(d => resolveDocRagStatus(d) === 'pending')) {
        ensureRagStatusPolling();
    }
    
    const addBtn = document.getElementById('team-add-doc-btn');
    if (addBtn) addBtn.classList.toggle('hidden', !isManager);

    // Refresh KB cards with live counts when knowledge pane is open (uses cache)
    if (S.teamWorkspaceTab === 'knowledge') {
        renderTeamKnowledgeBases();
    } else {
        populateTeamDocKbSelect(Object.values(S.ragKbItemsById || {}));
    }
    
    const listEl = document.getElementById('team-docs-list');
    if (!listEl) return;
    
    if (docs.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state py-8">
                <div class="empty-state-icon bg-purple-500/10 text-purple-400" style="background-color: rgba(168, 85, 247, 0.1); color: rgb(192, 132, 252);"><i class="fa-solid fa-folder-open"></i></div>
                <div class="text-sm text-slate-400">目前沒有知識庫文件</div>
                <div class="text-xs text-slate-500 mt-1">${isManager ? '點擊「新增文件」發布專案指南；空庫時教練勾選該庫可能查不到內容' : '主管發布指南後將顯示於此。教練選庫時若顯示「空庫」表示尚無可檢索文件'}</div>
            </div>`;
        return;
    }
    
    function resolveDocFileUrl(fileUrl) {
        if (!fileUrl) return '';
        if (fileUrl.startsWith('data:image/')) return fileUrl;
        if (fileUrl.startsWith('blob:')) return fileUrl;
        if (fileUrl.startsWith('http:') || fileUrl.startsWith('https:')) {
            return fileUrl;
        }
        if (fileUrl.startsWith('/uploads/')) {
            const base = getEnterpriseBaseUrl() + fileUrl;
            try {
                const session = JSON.parse(localStorage.getItem('lumina_auth_session') || 'null');
                if (session?.token) {
                    const sep = base.includes('?') ? '&' : '?';
                    return `${base}${sep}token=${encodeURIComponent(session.token)}`;
                }
            } catch (_) {}
            return base;
        }
        return '';
    }
    
    listEl.innerHTML = docs.map(d => {
        const type = d.docType || 'text';
        const isText = type === 'text';
        const isPdf = type === 'pdf';
        const isImage = type === 'image';
        const isExcel = type === 'excel';
        
        let typeBadge = '';
        if (isPdf) {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-red-500/20 text-red-300 border border-red-500/20"><i class="fa-solid fa-file-pdf mr-1"></i>PDF 文件</span>';
        } else if (isExcel) {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-green-500/20 text-green-300 border border-green-500/20"><i class="fa-solid fa-file-excel mr-1"></i>Excel 檔案</span>';
        } else if (isImage) {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/20"><i class="fa-solid fa-image mr-1"></i>圖片檔案</span>';
        } else {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/20"><i class="fa-solid fa-file-lines mr-1"></i>文字筆記</span>';
        }

        const kbId = d.kbId || 'general';
        const kbName = getRagKbLabel(kbId).replace(/\s*\([^)]*\)\s*$/, '').trim() || kbId;
        const kbBadge = `<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/20"><i class="fa-solid fa-tag mr-1"></i>${escapeHtml(kbName)}</span>`;
        const ragBadge = renderDocRagStatusBadge(d);
        const versionBadge = renderDocVersionBadge(d);
        const ragStatus = resolveDocRagStatus(d);
        const nearEmpty = isNearEmptyDocContent(d);
        const canRetry = isManager && (ragStatus === 'failed' || ragStatus === 'pending');
        const contentPreview = String(d.content || '');
        
        return `
        <div class="p-4 rounded-2xl border border-slate-800 bg-slate-950/40 hover:bg-slate-900/50 transition-colors" data-doc-id="${escapeHtml(d.id)}">
            <div class="flex items-start justify-between gap-3 mb-2">
                <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <h4 class="font-semibold text-sm text-slate-200">${escapeHtml(d.title)}</h4>
                        ${versionBadge}
                        ${typeBadge}
                        ${kbBadge}
                        ${ragBadge}
                    </div>
                    <div class="text-[10px] text-slate-500 mt-0.5">發布者：${escapeHtml(d.author || '主管')} · ${new Date(d.createdAt).toLocaleString('zh-TW')}${d.updatedAt && d.updatedAt !== d.createdAt ? ' · 更新 ' + new Date(d.updatedAt).toLocaleString('zh-TW') : ''}</div>
                    ${nearEmpty ? `
                        <div class="doc-near-empty-warn mt-1.5" role="status">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            幾乎無文字內容 — 教練可能無法從此文件檢索
                        </div>
                    ` : ''}
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    ${canRetry ? `
                        <button type="button" ${luminaAction('retryDocumentRagIndex', { arg: d.id })}
                            class="doc-rag-retry-btn focus-ring"
                            title="重新同步至知識庫"
                            aria-label="重試索引 ${escapeHtml(d.title)}">
                            <i class="fa-solid fa-rotate-right"></i>
                            <span>重試</span>
                        </button>
                    ` : ''}
                    ${isManager ? `
                        <button type="button" ${luminaAction('toggleDocNewVersionForm', { arg: d.id })}
                            class="doc-ver-action-btn focus-ring"
                            title="發新版本"
                            aria-label="發新版本 ${escapeHtml(d.title)}">
                            <i class="fa-solid fa-code-branch"></i>
                            <span>發新版</span>
                        </button>
                        <button type="button" ${luminaAction('deleteTeamDocument', { arg: d.id })}
                            class="text-red-400 hover:text-red-300 text-xs min-h-[44px] min-w-[44px] px-2 py-1 rounded hover:bg-red-500/10 transition-colors focus-ring"
                            aria-label="刪除文件 ${escapeHtml(d.title)}">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
            
            ${isText ? `
                <p class="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed">${escapeHtml(contentPreview)}</p>
            ` : ''}
            
            ${isPdf ? `
                <div class="mt-3 flex items-center gap-2">
                    <a href="${resolveDocFileUrl(d.fileUrl)}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 text-xs hover:bg-red-500/15 transition-colors">
                        <i class="fa-solid fa-file-pdf"></i>
                        <span>開啟 PDF 檔案 (${escapeHtml(d.filename || '檢視文件')})</span>
                    </a>
                </div>
                ${contentPreview ? `
                    <div class="mt-3">
                        <div class="text-[10px] text-slate-500 mb-1">擷取文字內容預覽 (已自動導入 AI 教練)：</div>
                        <p class="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80 leading-relaxed custom-scroll font-mono">${escapeHtml(contentPreview.slice(0, 500))}${contentPreview.length > 500 ? '...' : ''}</p>
                    </div>
                ` : ''}
            ` : ''}
            
            ${isExcel ? `
                <div class="mt-3 flex items-center gap-2">
                    <a href="${resolveDocFileUrl(d.fileUrl)}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-green-500/30 bg-green-500/5 text-green-400 text-xs hover:bg-green-500/15 transition-colors">
                        <i class="fa-solid fa-file-excel"></i>
                        <span>開啟 Excel 檔案 (${escapeHtml(d.filename || '檢視資料')})</span>
                    </a>
                </div>
                ${contentPreview ? `
                    <div class="mt-3">
                        <div class="text-[10px] text-slate-500 mb-1">擷取試算表內容預覽 (已自動導入 AI 教練)：</div>
                        <p class="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80 leading-relaxed custom-scroll font-mono">${escapeHtml(contentPreview.slice(0, 500))}${contentPreview.length > 500 ? '...' : ''}</p>
                    </div>
                ` : ''}
            ` : ''}
            
            ${isImage ? `
                <div class="mt-3">
                    <img src="${resolveDocFileUrl(d.fileUrl)}" class="max-h-48 rounded-xl border border-slate-800/80 object-contain hover:scale-[1.01] transition-transform cursor-pointer" ${luminaAction('openSafeUrl', { argFrom: 'src' })}>
                </div>
                <p class="text-xs text-slate-400 mt-2.5 whitespace-pre-wrap leading-relaxed"><i class="fa-solid fa-circle-info mr-1 text-purple-400"></i>${escapeHtml(contentPreview)}</p>
            ` : ''}

            <div class="doc-ver-toolbar mt-3">
                <button type="button" class="doc-ver-history-btn focus-ring"
                    ${luminaAction('toggleDocVersionPanel', { arg: d.id })}
                    aria-expanded="false"
                    aria-controls="doc-ver-panel-${escapeHtml(d.id)}">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    <span>版本歷史</span>
                </button>
            </div>

            <div id="doc-newver-form-${escapeHtml(d.id)}" class="doc-newver-form hidden mt-3">
                <div class="text-[11px] font-medium text-purple-300 mb-2">
                    <i class="fa-solid fa-code-branch mr-1"></i>發佈新版本（目前 v${getDocCurrentVersion(d)}）
                </div>
                <input id="doc-newver-title-${escapeHtml(d.id)}" type="text" maxlength="100"
                    class="w-full mb-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 focus-ring"
                    placeholder="標題（可留空沿用）" value="${escapeHtml(d.title || '')}">
                <textarea id="doc-newver-content-${escapeHtml(d.id)}" rows="4" maxlength="10000"
                    class="w-full mb-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 focus-ring custom-scroll"
                    placeholder="新版本內容">${escapeHtml(isText ? contentPreview : '')}</textarea>
                <input id="doc-newver-note-${escapeHtml(d.id)}" type="text" maxlength="200"
                    class="w-full mb-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-200 focus-ring"
                    placeholder="變更備註（選填，例如：更新 Q3 流程）">
                <div class="flex gap-2">
                    <button type="button" class="flex-1 min-h-[40px] py-2 rounded-xl bg-purple-500 hover:bg-purple-600 text-white text-xs font-medium focus-ring"
                        ${luminaAction('publishDocumentVersion', { arg: d.id })}>
                        <i class="fa-solid fa-cloud-arrow-up mr-1"></i>發布 v${getDocCurrentVersion(d) + 1}
                    </button>
                    <button type="button" class="min-h-[40px] px-3 py-2 rounded-xl border border-slate-700 text-slate-400 text-xs hover:bg-slate-800 focus-ring"
                        ${luminaAction('toggleDocNewVersionForm', { arg: d.id })}>
                        取消
                    </button>
                </div>
            </div>

            <div id="doc-ver-panel-${escapeHtml(d.id)}" class="doc-ver-panel hidden mt-3">
                <div id="doc-ver-list-${escapeHtml(d.id)}" class="doc-ver-list space-y-1.5"></div>
                <div id="doc-ver-preview-${escapeHtml(d.id)}" class="doc-ver-preview hidden mt-2"></div>
            </div>
        </div>
    `;
    }).join('');

    // Wave 3 polish: keep version/history UI open across re-renders (rag poll, etc.)
    try { restoreDocUiPanels(); } catch (e) { console.warn('[Lumina] restoreDocUiPanels', e); }
}
