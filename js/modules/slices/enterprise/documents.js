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
                infoEl.innerHTML = `<i class="fa-solid fa-file-pdf mr-1 text-red-400"></i> PDF 解析完成！共擷取 <strong>${extractedText.length}</strong> 字元，將會自動餵給 AI 行動教練。`;
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
                infoEl.innerHTML = `<i class="fa-solid fa-file-excel mr-1 text-green-500"></i> Excel 解析完成！共擷取 <strong>${extractedText.length}</strong> 字元，將會自動餵給 AI 行動教練。`;
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
            
            newDoc = {
                id: 'd_' + Date.now(),
                title,
                content,
                docType,
                fileUrl,
                filename,
                author: S.enterpriseSession.name,
                createdAt: new Date().toISOString()
            };
            group.documents.unshift(newDoc);
            saveLocalEnterpriseStore(store);
            ok = true;
            await syncDocumentToRag({
                groupCode: S.enterpriseSession.groupCode,
                kbId,
                docType,
                title,
                content,
                filename,
                fileData
            }, { toastOnError: true });
            S.ragSyncedGroupKey = null;
        } catch (e) {
            showToast('本機保存失敗: ' + e.message, 'error');
        }
    } else {
        const res = await enterpriseFetch('POST', '/api/enterprise/group/document/add', payload);
        if (res.ok) {
            ok = true;
            newDoc = res.data.document;
            
            await syncDocumentToRag({
                groupCode: S.enterpriseSession.groupCode,
                kbId,
                docType,
                title,
                content,
                filename,
                fileData
            }, { toastOnError: true });
            S.ragSyncedGroupKey = null;
        } else {
            showToast('發布失敗: ' + res.error, 'error');
        }
    }
    
    if (ok) {
        showToast('文件已成功發布', 'success');
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
        refreshEnterpriseData();
    }
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
        if (res.ok) {
            ok = true;
        } else {
            showToast('刪除失敗: ' + res.error, 'error');
        }
    }
    
    if (ok) {
        showToast('文件已成功刪除', 'success');
        
        if (S.ragServiceActive && docToDelete) {
            await deleteDocumentFromRag({
                groupCode: S.enterpriseSession.groupCode,
                kbId: docToDelete.kbId || 'general',
                filename: getRagFilenameForDoc(docToDelete)
            });
        }
        
        refreshEnterpriseData();
    }
}

function renderEnterpriseDocuments() {
    if (!S.enterpriseSession || !S.enterpriseGroupData) return;
    const docs = S.enterpriseGroupData.documents || [];
    const isManager = S.enterpriseSession.role === 'manager';
    
    const addBtn = document.getElementById('team-add-doc-btn');
    if (addBtn) addBtn.classList.toggle('hidden', !isManager);
    
    const listEl = document.getElementById('team-docs-list');
    if (!listEl) return;
    
    if (docs.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state py-8">
                <div class="empty-state-icon bg-purple-500/10 text-purple-400" style="background-color: rgba(168, 85, 247, 0.1); color: rgb(192, 132, 252);"><i class="fa-solid fa-folder-open"></i></div>
                <div class="text-sm text-slate-400">目前沒有知識庫文件</div>
                <div class="text-xs text-slate-500 mt-1">${isManager ? '在上方點擊「新增文件」發布專案指南或新人資料' : '主管發布指南後將會在此顯示，且 AI 行動教練會自動學習'}</div>
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

        const kbLabels = {
            general: '一般預設',
            onboarding: '新人培訓',
            specs: '開發規格',
            meetings: '會議 SOP'
        };
        const kbName = kbLabels[d.kbId || 'general'] || '一般預設';
        const kbBadge = `<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/20"><i class="fa-solid fa-tag mr-1"></i>${kbName}</span>`;
        
        return `
        <div class="p-4 rounded-2xl border border-slate-800 bg-slate-950/40 hover:bg-slate-900/50 transition-colors">
            <div class="flex items-start justify-between gap-3 mb-2">
                <div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <h4 class="font-semibold text-sm text-slate-200">${escapeHtml(d.title)}</h4>
                        ${typeBadge}
                        ${kbBadge}
                    </div>
                    <div class="text-[10px] text-slate-500 mt-0.5">發布者：${escapeHtml(d.author || '主管')} · ${new Date(d.createdAt).toLocaleString('zh-TW')}</div>
                </div>
                ${isManager ? `
                    <button onclick="deleteTeamDocument('${d.id}')" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                ` : ''}
            </div>
            
            ${isText ? `
                <p class="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed">${escapeHtml(d.content)}</p>
            ` : ''}
            
            ${isPdf ? `
                <div class="mt-3 flex items-center gap-2">
                    <a href="${resolveDocFileUrl(d.fileUrl)}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 text-xs hover:bg-red-500/15 transition-colors">
                        <i class="fa-solid fa-file-pdf"></i>
                        <span>開啟 PDF 檔案 (${escapeHtml(d.filename || '檢視文件')})</span>
                    </a>
                </div>
                ${d.content ? `
                    <div class="mt-3">
                        <div class="text-[10px] text-slate-500 mb-1">擷取文字內容預覽 (已自動導入 AI 教練)：</div>
                        <p class="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80 leading-relaxed custom-scroll font-mono">${escapeHtml(d.content.slice(0, 500))}${d.content.length > 500 ? '...' : ''}</p>
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
                ${d.content ? `
                    <div class="mt-3">
                        <div class="text-[10px] text-slate-500 mb-1">擷取試算表內容預覽 (已自動導入 AI 教練)：</div>
                        <p class="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80 leading-relaxed custom-scroll font-mono">${escapeHtml(d.content.slice(0, 500))}${d.content.length > 500 ? '...' : ''}</p>
                    </div>
                ` : ''}
            ` : ''}
            
            ${isImage ? `
                <div class="mt-3">
                    <img src="${resolveDocFileUrl(d.fileUrl)}" class="max-h-48 rounded-xl border border-slate-800/80 object-contain hover:scale-[1.01] transition-transform cursor-pointer" onclick="window.open(this.src, '_blank')">
                </div>
                <p class="text-xs text-slate-400 mt-2.5 whitespace-pre-wrap leading-relaxed"><i class="fa-solid fa-circle-info mr-1 text-purple-400"></i>${escapeHtml(d.content)}</p>
            ` : ''}
        </div>
    `;
    }).join('');
}
