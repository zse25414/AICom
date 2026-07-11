/**
 * W1-REV P0 unit/static checks:
 * 1) resolveDocRagStatus — no fake "created > 2min → indexed"
 * 2) enterprise document/delete — RAG fail does not soft-delete
 * 3) ensureEnterpriseDocsInRag — no hard-coded 127.0.0.1:8000 health probe
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function assert(name, cond, detail) {
    if (!cond) {
        failed++;
        console.error(`FAIL ${name}${detail ? ': ' + detail : ''}`);
        return;
    }
    console.log(`OK ${name}`);
}

/** Mirror of fixed resolveDocRagStatus (documents.js) */
function resolveDocRagStatus(doc, overrides = {}) {
    if (!doc) return 'pending';
    const override = overrides[doc.id];
    if (override === 'indexed' || override === 'pending' || override === 'failed' || override === 'deleted') {
        return override;
    }
    const status = doc.ragStatus || doc.rag?.status || null;
    if (status === 'indexed' || status === 'pending' || status === 'failed' || status === 'deleted') {
        return status;
    }
    return 'pending';
}

// --- #2 resolveDocRagStatus behavior ---
assert(
    'no ragStatus + old createdAt → pending (not fake indexed)',
    resolveDocRagStatus({ id: 'd1', createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() }) === 'pending'
);
assert(
    'explicit indexed preserved',
    resolveDocRagStatus({ id: 'd2', ragStatus: 'indexed', createdAt: new Date().toISOString() }) === 'indexed'
);
assert(
    'explicit failed preserved',
    resolveDocRagStatus({ id: 'd3', ragStatus: 'failed' }) === 'failed'
);
assert(
    'rag.status nested works',
    resolveDocRagStatus({ id: 'd4', rag: { status: 'pending' } }) === 'pending'
);
assert(
    'session override wins',
    resolveDocRagStatus({ id: 'd5', ragStatus: 'pending' }, { d5: 'failed' }) === 'failed'
);
assert(
    'null doc → pending',
    resolveDocRagStatus(null) === 'pending'
);

// --- Source guards ---
const docsSrc = fs.readFileSync(path.join(root, 'js/modules/slices/enterprise/documents.js'), 'utf8');
assert(
    'documents.js removed age>120000 fake indexed',
    !/ageMs\s*>\s*120000/.test(docsSrc) && !/120000\s*\)\s*return\s*['"]indexed['"]/.test(docsSrc)
);
assert(
    'deleteTeamDocument reads ragDeleteOk',
    /ragDeleteOk\s*===\s*false/.test(docsSrc)
);
assert(
    'deleteTeamDocument shows error toast path (no success on rag fail)',
    /showToast\(\s*msg,\s*['"]error['"]\s*\)/.test(docsSrc)
);

const apiSrc = fs.readFileSync(path.join(root, 'api-proxy.js'), 'utf8');
const deleteBlockMatch = apiSrc.match(
    /if \(method === 'POST' && urlPath === '\/api\/enterprise\/group\/document\/delete'\) \{[\s\S]*?\n    \}/
);
assert('enterprise document/delete handler found', !!deleteBlockMatch);
if (deleteBlockMatch) {
    const block = deleteBlockMatch[0];
    assert(
        'RAG fail path returns ragDeleteOk:false before soft-delete',
        /ragDeleteOk:\s*false/.test(block) &&
            /文件仍保留於列表/.test(block) &&
            block.indexOf('ragDeleteOk: false') < block.indexOf("doc.status = 'deleted'")
    );
    assert(
        'success soft-delete only after cleanup ok',
        /setDocumentRagStatus\(doc,\s*['"]deleted['"]/.test(block)
    );
    assert(
        'warning no longer claims list removed on rag fail',
        !/文件已從列表移除，但知識庫索引清除失敗/.test(block)
    );
}

const clientSrc = fs.readFileSync(path.join(root, 'js/modules/slices/rag/client.js'), 'utf8');
const ensureMatch = clientSrc.match(/async function ensureEnterpriseDocsInRag[\s\S]*?\n\}/);
assert('ensureEnterpriseDocsInRag found', !!ensureMatch);
if (ensureMatch) {
    const ensure = ensureMatch[0];
    assert(
        'ensureEnterpriseDocsInRag does not hardcode C.RAG_SERVICE_URL /health',
        !/C\.RAG_SERVICE_URL/.test(ensure)
    );
    assert(
        'ensureEnterpriseDocsInRag uses probe or getRagServiceBase',
        /probeRagServiceOnline|getRagServiceBase/.test(ensure)
    );
    assert(
        'ensureEnterpriseDocsInRag manager-gated',
        /role\s*!==\s*['"]manager['"]/.test(ensure)
    );
}
assert(
    'reindexEnterpriseDocumentsToRag manager-gated',
    /async function reindexEnterpriseDocumentsToRag[\s\S]*?role\s*!==\s*['"]manager['"]/.test(clientSrc)
);

// --- W2-REV P0: delete vs index race + KB soft-delete RAG fail ---
const applyMatch = apiSrc.match(
    /async function applyDocumentRagIndexResult[\s\S]*?\nasync function orchestrateDocumentRagIndex/
);
assert('applyDocumentRagIndexResult found', !!applyMatch);
if (applyMatch) {
    const apply = applyMatch[0];
    assert(
        'applyDocumentRagIndexResult reloads store before writeback',
        /loadStore\s*\(/.test(apply)
    );
    assert(
        'applyDocumentRagIndexResult checks isActiveDocument',
        /isActiveDocument\s*\(/.test(apply)
    );
    assert(
        'applyDocumentRagIndexResult compensates with proxyRagDeleteIndex (or helper)',
        /compensateRagIndexAfterDelete|proxyRagDeleteIndex/.test(apply)
    );
    assert(
        'applyDocumentRagIndexResult does not blindly set indexed without active check',
        apply.indexOf('isActiveDocument') < apply.indexOf("'indexed'")
    );
}
assert(
    'persistDocumentRagStatus refuses indexed for inactive docs',
    /status\s*===\s*['"]indexed['"]\s*&&\s*!isActiveDocument/.test(apiSrc)
        || /!isActiveDocument\(doc\)\s*&&\s*status\s*===\s*['"]indexed['"]/.test(apiSrc)
);

const softKbMatch = apiSrc.match(/async function softDeleteKnowledgeBase[\s\S]*?\nasync function proxyRagDeleteKb/);
assert('softDeleteKnowledgeBase found', !!softKbMatch);
if (softKbMatch) {
    const soft = softKbMatch[0];
    assert(
        'softDeleteKnowledgeBase calls proxyRagDeleteKb before cascade soft-delete',
        soft.indexOf('proxyRagDeleteKb') < soft.indexOf("doc.status = 'deleted'")
    );
    assert(
        'softDeleteKnowledgeBase returns ragDeleteOk:false on RAG wipe fail',
        /ragDeleteOk:\s*false/.test(soft) && /RAG_DELETE_FAILED|索引清除失敗/.test(soft)
    );
    assert(
        'softDeleteKnowledgeBase does not soft-delete docs when RAG fails',
        soft.indexOf('ragDeleteOk: false') < soft.indexOf("doc.status = 'deleted'")
    );
    assert(
        'softDeleteKnowledgeBase cascade unlinks uploads',
        /unlinkSync/.test(soft) && /fileUrl/.test(soft)
    );
}
assert(
    'deleteTeamKnowledgeBase reads ragDeleteOk',
    /async function deleteTeamKnowledgeBase[\s\S]*?ragDeleteOk\s*===\s*false/.test(docsSrc)
);
assert(
    'deleteTeamKnowledgeBase error toast on rag fail (no false success)',
    /async function deleteTeamKnowledgeBase[\s\S]*?showToast\(\s*msg,\s*['"]error['"]\s*\)/.test(docsSrc)
);

if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll W1-REV P0 checks passed');
process.exit(0);
