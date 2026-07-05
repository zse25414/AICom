/* Lumina: rag/client.js */
function getRagFilenameForDoc(doc) {
    if (!doc) return '';
    if (doc.filename) return doc.filename;
    if (doc.title) return `text::${doc.title}.md`;
    return '';
}

function getRagKbLabel(kbId) {
    return C.RAG_KB_LABELS[kbId] || kbId;
}

async function syncDocumentToRag({ groupCode, kbId, docType, title, content, filename, fileData }, options = {}) {
    if (!groupCode) return false;
    const kb = kbId || 'general';
    const ragFilename = filename || `text::${title}.md`;
    const textContent = (content || '').trim();
    const ragBase = getRagServiceBase();

    try {
        if (textContent) {
            const res = await fetch(`${ragBase}/api/rag/document/upload-text`, {
                method: 'POST',
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    group_code: groupCode,
                    kb_id: kb,
                    title,
                    content: textContent,
                    filename: docType === 'text' ? `text::${title}.md` : ragFilename
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || err.error || `RAG 文字索引失敗 (${res.status})`);
            }
        } else if (fileData && filename && (docType === 'pdf' || docType === 'excel' || docType === 'image')) {
            const res = await fetch(`${ragBase}/api/rag/document/upload`, {
                method: 'POST',
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    group_code: groupCode,
                    kb_id: kb,
                    filename: ragFilename,
                    file_base64: fileData
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || err.error || `RAG 檔案索引失敗 (${res.status})`);
            }
        } else {
            throw new Error('沒有可索引的文件內容');
        }

        console.log(`[Lumina RAG] 已索引：${title} (${kb})`);
        if (options.toastOnSuccess) showToast(`已同步至 RAG：${title}`, 'success');
        return true;
    } catch (e) {
        console.warn('[Lumina RAG] 文件索引同步失敗:', e.message);
        if (options.toastOnError) showToast(`RAG 索引失敗：${e.message}`, 'error');
        return false;
    }
}

async function reindexEnterpriseDocumentsToRag(options = {}) {
    if (!S.enterpriseSession || !S.enterpriseGroupData?.documents?.length) return { ok: 0, fail: 0 };

    let ok = 0;
    let fail = 0;
    for (const doc of S.enterpriseGroupData.documents) {
        const synced = await syncDocumentToRag({
            groupCode: S.enterpriseSession.groupCode,
            kbId: doc.kbId || 'general',
            docType: doc.docType || 'text',
            title: doc.title,
            content: doc.content,
            filename: getRagFilenameForDoc(doc)
        });
        if (synced) ok++;
        else fail++;
    }

    if (options.toast && ok > 0) {
        showToast(`已重新同步 ${ok} 份文件至 RAG 知識庫`, 'success');
    }
    if (options.toast && fail > 0) {
        showToast(`${fail} 份文件同步 RAG 失敗，請稍後再試`, 'error');
    }
    if (ok > 0) await window.renderRagKbCheckboxes?.();
    return { ok, fail };
}

async function ensureEnterpriseDocsInRag(options = {}) {
    if (!S.enterpriseSession || !S.enterpriseGroupData?.documents?.length) return;
    const syncKey = `${S.enterpriseSession.groupCode}:${S.enterpriseGroupData.documents.map(d => d.id).join(',')}`;
    if (!options.force && S.ragSyncedGroupKey === syncKey) return;

    try {
        const res = await fetch(`${C.RAG_SERVICE_URL}/health`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.service !== 'lumina-rag-service') return;
    } catch (_) {
        return;
    }

    const result = await reindexEnterpriseDocumentsToRag(options);
    if (result.ok > 0) S.ragSyncedGroupKey = syncKey;
}

async function deleteDocumentFromRag({ groupCode, kbId, filename }) {
    if (!S.ragServiceActive || !groupCode || !filename) return;
    try {
        const res = await fetch(`${getRagServiceBase()}/api/rag/document/delete`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({
                group_code: groupCode,
                kb_id: kbId || 'general',
                filename
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `RAG 刪除失敗 (${res.status})`);
        }
        console.log('[Lumina RAG] 文件已從知識庫索引移除。');
    } catch (e) {
        console.warn('[Lumina RAG] 知識庫刪除同步失敗:', e.message);
    }
}

async function fetchRagKbIds(groupCode) {
    const res = await fetch(`${getRagServiceBase()}/api/rag/kb/list?group_code=${encodeURIComponent(groupCode)}`, {
        headers: getAuthHeaders(false)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.kb_ids) ? data.kb_ids : null;
}

function getRagServiceBase() {
    return getEnterpriseBaseUrl();
}

function getRagLlmCredentials() {
    const apiKey = getStoredApiKey();
    if (!apiKey) return {};
    return {
        deepseek_api_key: apiKey,
        api_base: 'https://api.deepseek.com/v1'
    };
}

function getRagQueryUrl() {
    return getEnterpriseBaseUrl() + '/api/rag/query';
}
