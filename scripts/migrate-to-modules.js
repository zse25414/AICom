/**
 * Split lumina-app.js into slice files under js/modules/slices/
 * Build step merges slices into a single scope (see build-app.js).
 * Run: node scripts/migrate-to-modules.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'js', 'lumina-app.js'), 'utf8').split(/\r?\n/);
const modulesDir = path.join(root, 'js', 'modules');

const MARKERS = {
    state: '/* Lumina module: state, auth, focus, scoring */',
    data: '/* Lumina module: storage, API, enterprise, RAG sync */',
    ui: '/* Lumina module: navigation, dashboard, scheduler, coach */',
    boot: '/* Lumina module: init, shortcuts, boot */'
};

function findLine(marker) {
    const idx = lines.findIndex(l => l.includes(marker));
    if (idx < 0) throw new Error(`Marker not found: ${marker}`);
    return idx;
}

const dataStart = findLine(MARKERS.data);
const uiStart = findLine(MARKERS.ui);
const bootMarker = findLine(MARKERS.boot);
const initLine = lines.findIndex((l, i) => i > bootMarker && l.trim() === '// Initialize everything');

const chunks = {
    state: lines.slice(findLine(MARKERS.state) + 1, dataStart).join('\n').trim(),
    data: lines.slice(dataStart + 1, uiStart).join('\n').trim(),
    ui: lines.slice(uiStart + 1, initLine).join('\n').trim(),
    boot: lines.slice(initLine).join('\n').trim()
};

const STATE_VARS = [
    'tasks', 'weeklyScores', 'dailyHistory', 'currentDecomposedPlan', 'activeCategoryFilter',
    'deferredInstallPrompt', 'editingTaskId', 'trackedFocusByDay', 'enterpriseSyncSuppress', 'userProfile',
    'enterpriseSession', 'enterpriseGroupData', 'enterprisePollTimer', 'taskListVirtual', 'teamNotifications',
    'notifPanelOpen', 'teamNotificationsInitialized', 'chatHistory', 'coachAgentMessages', 'coachRequestInFlight',
    'ragServiceActive', 'ragRetrievalMode', 'ragSyncedGroupKey', 'userDataSyncTimer', 'checkedRagKbs',
    'enterpriseSyncFlushTimer', 'rolledCountOnInit', 'todayFocusTaskId', 'focusSession', 'focusTimerInterval',
    'analyticsPersistTimer', 'chartJsLoadPromise', 'enterpriseDataFetchedAt', 'todayStatsCache', 'todayQueueMap',
    'categoryCountsCache', 'taskById', 'refreshUIQueued', 'refreshUIRaf', 'persistStateTimer',
    'pdfJsLoadPromise', 'xlsxLoadPromise', 'weeklyChartInstance', 'pieChartInstance',
    'selectedDocFile', 'schedulerTabPending', 'onboardingStep'
];

const COLLECTIONS = [
    'knownTeamNotificationIds', 'locallyReadNotificationIds', 'enterpriseToggleInFlight',
    'coachPlans', 'taskCoachPlans', 'enterpriseSyncQueue'
];

const CONSTS = [
    'DAILY_HISTORY_KEY', 'TRACKED_FOCUS_KEY', 'AUTH_GUEST_DISMISSED_KEY', 'LAST_ACTIVE_DATE_KEY',
    'USER_DATA_SYNC_DELAY_MS', 'RAG_SERVICE_URL', 'API_KEY_STORAGE', 'ENTERPRISE_SYNC_RETRY_MS', 'RAG_KB_LABELS',
    'PERSIST_STATE_DELAY_MS', 'AUTH_SESSION_KEY', 'AUTH_USERS_KEY', 'LOCAL_ENTERPRISE_KEY', 'TEAM_NOTIF_PREFS_KEY',
    'CHART_JS_URL', 'ENTERPRISE_FETCH_TTL_MS', 'ENTERPRISE_POLL_INTERVAL_MS', 'CATEGORIES',
    'SANITIZE_ALLOWED_TAGS', 'IMPORT_MAX_BYTES', 'TEXT_MAX_LEN', 'TASK_NAME_MAX_LEN', 'SAFE_FA_ICONS'
];

function collectInitializer(srcLines, start) {
    let text = srcLines[start].replace(/^let \w+\s*=/, '').replace(/^const \w+\s*=/, '').trim();
    let end = start;
    if (/^new \w+/.test(text) && text.endsWith(';')) return { text: text.replace(/;$/, ''), end };
    if ((text.startsWith('[') || /^['"`\d-]/.test(text) || text === 'null' || text.startsWith('false') || text.startsWith('true')) && text.endsWith(';')) {
        return { text: text.replace(/;$/, ''), end };
    }
    const depth0 = depthDelta(text);
    if (depth0 <= 0) {
        return { text: text.replace(/;\s*$/, '').trim(), end: start };
    }

    const buf = [text];
    let depth = depth0;
    for (let j = start + 1; j < srcLines.length; j++) {
        buf.push(srcLines[j]);
        depth += depthDelta(srcLines[j]);
        end = j;
        if (depth <= 0 && /[;}]/.test(srcLines[j])) break;
    }
    return { text: buf.join('\n').replace(/;\s*$/, '').trim(), end };
}

function depthDelta(line) {
    let d = 0;
    for (const c of line) {
        if ('{[('.includes(c)) d++;
        if ('}])'.includes(c)) d--;
    }
    return d;
}

function stripDecls(code) {
    const srcLines = code.split('\n');
    const storeVars = [];
    const storeCols = [];
    const constants = [];
    const kept = [];

    for (let i = 0; i < srcLines.length; i++) {
        const line = srcLines[i];
        if (/^\/\/ (Tailwind|Global state|RAG Global)/.test(line)) continue;

        let m = line.match(/^let (\w+)\s*=/);
        if (m && STATE_VARS.includes(m[1])) {
            const block = collectInitializer(srcLines, i);
            storeVars.push({ name: m[1], init: block.text });
            i = block.end;
            continue;
        }
        m = line.match(/^const (\w+)\s*=/);
        if (m && COLLECTIONS.includes(m[1])) {
            const block = collectInitializer(srcLines, i);
            storeCols.push({ name: m[1], init: block.text });
            i = block.end;
            continue;
        }
        m = line.match(/^const ([A-Z][A-Z0-9_]*)\s*=/);
        if (m && CONSTS.includes(m[1])) {
            const block = collectInitializer(srcLines, i);
            constants.push({ name: m[1], init: block.text });
            i = block.end;
            continue;
        }
        kept.push(line);
    }
    return { kept: kept.join('\n'), storeVars, storeCols, constants };
}

function inObjectLiteral(full, offset) {
    let depth = 0;
    for (let i = offset - 1; i >= 0; i--) {
        const c = full[i];
        if (c === '}') depth++;
        else if (c === '{') {
            if (depth === 0) {
                if (i > 0 && full[i - 1] === '$') return false;
                return true;
            }
            depth--;
        } else if (c === ']') depth++;
        else if (c === '[') {
            if (depth === 0) return false;
            depth--;
        }
    }
    return false;
}

function rewriteBindings(code, names, prefix) {
    const sorted = [...names].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
        const re = new RegExp(`\\b${name}\\b`, 'g');
        code = code.replace(re, (match, offset, full) => {
            if (full.slice(0, offset).endsWith(`${prefix}.`)) return match;
            const after = full.slice(offset + match.length);
            if (/^\s*:/.test(after)) return match;
            const before = full.slice(0, offset);
            if (/[{,]\s*$/.test(before) && /^\s*[,}\n]/.test(after) && inObjectLiteral(full, offset)) {
                return `${name}: ${prefix}.${name}`;
            }
            return `${prefix}.${name}`;
        });
    }
    return code;
}

function extractFunctions(code) {
    const names = [];
    const re = /^(?:async )?function (\w+)\s*\(/gm;
    let m;
    while ((m = re.exec(code)) !== null) names.push(m[1]);
    return names;
}

function splitByFunctions(code) {
    const fnRe = /^(?:async )?function (\w+)\s*\(/gm;
    const fns = [];
    let m;
    while ((m = fnRe.exec(code)) !== null) fns.push({ name: m[1], start: m.index });
    return fns.map((fn, i) => ({
        name: fn.name,
        code: code.slice(fn.start, fns[i + 1]?.start ?? code.length).trim()
    }));
}

const SLICES = [
    { file: 'auth.js', names: new Set(['initializeTailwind','hashPin','hashPassword','normalizeEmail','isValidEmail','getAuthBaseUrl','getAuthHeaders','authApiRequest','getAuthSession','isLoggedIn','needsAuthGate','persistAuthSession','applyAuthUserToProfile','clearAuthErrors','showAuthOverlay','hideAuthOverlay','switchAuthTab','updateAuthUI','buildUserDataPayload','applyUserDataFromServer','syncUserDataToServer','loadUserDataFromServer','finishAuth','handleRegister','handleLogin','handleLogout','openUserMenu','dismissAuthAsGuest','checkAuthOnInit','verifyLocalManagerPin','clearSensitiveLocalData']) },
    { file: 'rag.js', names: new Set(['getRagFilenameForDoc','getRagKbLabel','syncDocumentToRag','reindexEnterpriseDocumentsToRag','ensureEnterpriseDocsInRag','deleteDocumentFromRag','fetchRagKbIds','getRagServiceBase','getRagLlmCredentials','getRagQueryUrl']) },
    { file: 'tasks.js', names: new Set(['inferCategory','getCategoryLabel','getCategoryColor','$','resolveCategory','invalidateTodayStats','rebuildTaskIndex','getTaskById','rebuildTodayQueueMap','migrateTasks','touchTask','getFilteredTasks','getCategoryCounts','flushRefreshUI','refreshUI','refreshUIImmediate','setCategoryFilter','renderCategoryFilters','getCompletedCount','getTodayRelevantTasks','getTodayPendingTasks','getFuturePendingTasks','getTodayCompletedCount','getTodayFocusMinutes','getTodayCompletionRate','parseHour','scoreTaskForNextStep','rankTasksByNextStepScore','getNextRecommendedTask','resolveTodayFocusTask','getTodayQueuePosition','pulseNextStepCard','normalizeFocusSteps','buildQuickStartSteps','getStepsForTask','parseStepMinutes','getCoachTask','renderPersonalTaskRow','getActiveParentGoals','checkParentGoalComplete','renderActiveGoalsPanel','renderTaskBadges','openTaskEdit','closeTaskEdit','saveTaskEdit','clearFocusTimer','tickFocusTimer','startFocusTimer','endFocusSession','extendFocusTimer','completeFocusTask','renderFocusSessionPanel','advanceFocusStep','focusTodayTask','startTodayTask','onTodayTaskCompleted','getNextStepReason','syncEnterpriseTaskToPersonal','syncEnterpriseCompletionToPersonal','enqueueEnterpriseSync','scheduleEnterpriseSyncFlush','flushEnterpriseSyncQueue','syncPersonalTaskCompletionToEnterprise','cacheEnterpriseGroupLocally','evaluateStreakOnComplete','computeTodayStats','getTodayStats','getScoringContext','buildSyncedEnterpriseIdSet','addMinutes','getInitials','quickAddTask','renderTaskList','toggleTaskComplete','splitTask','deleteTask','clearAllTasks','buildTimeBlocks','scoreTaskPriority','scoreTaskBlockFit','assignTasksToBlocks','optimizeSchedule','quickStartToday','skipToNextTodayTask','updateNextStepCard','focusQuickAdd','toggleDashStats']) },
    { file: 'enterprise.js', names: new Set(['getEnterpriseBaseUrl','loadLocalEnterpriseStore','saveLocalEnterpriseStore','normalizeEnterpriseCode','enterpriseFetch','enterpriseLocalCreate','enterpriseLocalJoin','enterpriseLocalGetGroup','toggleManagerPin','getMemberInitials','renderMemberChip','fetchApiReadiness','formatReadinessHint','updateTeamSyncStatus','copyGroupCode','applyTeamInviteFromUrl','createEnterpriseGroup','joinEnterpriseGroup','leaveEnterpriseGroup','refreshEnterpriseData','renderEnterprisePage','renderEnterpriseTasks','toggleAddDocForm','switchDocFormType','handleDocFileSelect','ensurePdfJs','ensureXlsx','extractTextFromPdf','extractTextFromExcel','saveTeamDocument','deleteTeamDocument','renderEnterpriseDocuments','renderEnterpriseTaskRow','assignEnterpriseTask','applyEnterpriseTaskToCache','persistEnterpriseTaskToggle','toggleEnterpriseTask','getEnterprisePollInterval','startEnterprisePolling','stopEnterprisePolling']) },
    { file: 'notifications.js', names: new Set(['ensureLocalGroupNotifications','pushLocalTeamNotification','getLocalTeamNotifications','getLocalReadNotificationStorageKey','loadLocallyReadNotificationIds','persistLocallyReadNotificationIds','rememberLocallyReadNotificationIds','applyLocalReadFlags','markLocalTeamNotificationsRead','getDefaultTeamNotificationPrefs','getTeamNotificationPrefs','saveTeamNotificationPrefs','onTeamDesktopNotifToggle','loadTeamNotificationPrefsForm','formatNotifTime','shouldAlertForNotification','ingestTeamNotificationsFromResponse','alertForNewTeamNotification','processIncomingTeamNotifications','refreshTeamNotifications','updateNotificationUI','renderNotificationPanel','toggleNotificationPanel','closeNotificationPanel','markTeamNotificationRead','markAllTeamNotificationsRead','handleTeamNotificationClick']) },
    { file: 'coach.js', names: new Set(['pushCoachAgentMessage','getOpeningCoachMessage','ensureCoachSessionForTask','startStepTimerForCoach','coachBeginGuidedSession','coachPauseSession','coachAdvanceStepFromAgent','coachCompleteTaskFromAgent','buildOfflineAgentReply','inferAgentActionsFromUserMsg','isGenericCoachFallback','coachAgentRespondWithAI','findTaskForPlan','linkPlanToTask','syncFocusSessionWithPlan','parseJsonFromAI','parseCoachAgentResponse','decomposeGoalWithAI','normalizeCoachPlan','estimatePlanDuration','parseBulletToField','ensureDocumentFields','renderEditableDocumentHtml','updateCoachDocField','toggleCoachChecklistItem','extractTaskNameFromMessage','inferTaskDocType','buildTaskResources','buildDocumentDraft','buildOfflineCoachPlan','coachPlanToMarkdown','renderCoachPlan','storeCoachPlan','copyCoachPlan','downloadCoachDocument','startCoachPlan','applyCoachStepsAsTasks','coachRespondWithAI','getCoachWorkspace','formatCoachContent','renderCoachAgentThread','renderCoachEmptyState','renderCoachAgentView','coachStartFocusNow','refreshCoachView','askCoach','sendCoachAgentMessage','sendChatMessage','getCoachContext','buildCoachContextText','updateCoachContextBar','getCoachReadinessChecks','renderCoachReadinessBar','renderCoachQuickActions','openCoachForNextTask','openCoachForTask','askCoachAboutNextTask','decomposeGoal','generateSmartDecomposition','renderDecomposePlan','useExampleGoal','copyPlanToClipboard','addFirstStepToToday','addDecomposedToScheduler']) },
    { file: 'storage.js', names: new Set(['loadState','hasStoredApiKey','migrateApiSettings','migrateApiKeyStorage','getStoredApiKey','setStoredApiKey','getDeepSeekClientCredentials','isApiReady','updateApiStatusBadge','toggleApiModeFields','callDeepSeek','testApiConnection','loadSettingsForm','clearApiKey','saveSettings','exportData','importData','persistTasks','persistProfile','persistAnalytics','flushPersistState','saveState','loadDailyHistory','saveDailyHistory','loadTrackedFocus','saveTrackedFocus','getTrackedFocusMinutesForDate','recordFocusSessionMinutes','mergeTasksArrays','trimDailyHistory','snapshotDay','recordDailySnapshot','recalculateWeeklyScores','getFocusComparisonText','applyStreakReward','evaluateStreakForDate','processDailyRollover']) },
    { file: 'ui.js', names: new Set(['setupManifest','generateManifestIcon','registerServiceWorker','updatePwaStatus','setupPwaInstall','promptInstall','setupOfflineDetection','toLocalISO','getTodayISO','getTomorrowISO','formatDateTW','getGreeting','escapeHtml','sanitizeHtml','isSafeHttpUrl','clampText','isPlainObject','sanitizeImportedTask','validateImportedData','sanitizeImportedProfile','sanitizeFaIcon','showSection','setElText','setElHtml','setElStyle','updateDashboard','getEnergyLabel','getEnergyColor','syncCategoryFromEnergy','addTaskToList','switchSchedulerTab','openDecomposeTab','clearOnboardHighlight','applyOnboardHighlight','renderOnboardingStep','startOnboarding','nextOnboardingStep','skipOnboarding','completeOnboarding','showGuideTab','closeNavMore','toggleNavMore','navigateFromMore','updateNavMoreState','toggleMobileMore','closeMobileMore','navigateFromMobileMore','getTimeDistribution','loadChartJs','refreshInsightsPage','updateInsightsCards','initCharts','recalculateInsights','triggerConfetti','showToast','resetAllData','refreshServiceStatus','setupKeyboardShortcuts']) },
    { file: 'boot.js', names: new Set(['initializeApp']) }
];

function assignSlice(name) {
    for (const s of SLICES) if (s.names.has(name)) return s.file;
    return 'misc.js';
}

const s1 = stripDecls(chunks.state);
const s2 = stripDecls(chunks.data);
const allConstants = [...s1.constants];
for (const c of s2.constants) {
    if (!allConstants.find(x => x.name === c.name)) allConstants.push(c);
}

let constantsCode = '/** Immutable configuration */\n';
for (const c of allConstants) constantsCode += `export const ${c.name} = ${c.init};\n`;

let storeCode = '/** Mutable shared state */\nexport const S = {\n';
for (const v of [...s1.storeVars, ...s2.storeVars]) {
    const init = v.init.replace(/;\s*$/, '').trim();
    storeCode += `    ${v.name}: ${init},\n`;
}
for (const c of [...s1.storeCols, ...s2.storeCols]) {
    const init = c.init.replace(/;\s*$/, '').trim();
    storeCode += `    ${c.name}: ${init},\n`;
}
storeCode += '};\n';

const combinedRaw = [s1.kept, s2.kept, chunks.ui].join('\n\n');
const blocks = splitByFunctions(combinedRaw);
const byFile = new Map();

for (const block of blocks) {
    const file = assignSlice(block.name);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(block.code);
}

let bootBlocks = splitByFunctions(chunks.boot.replace(/window\.onload = initializeApp;\s*/g, '').replace(/window\.lumina = \(\) => triggerConfetti\(\);\s*/g, ''));
for (const block of bootBlocks) {
    const file = assignSlice(block.name);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(block.code);
}

const virtualTemplatePath = path.join(modulesDir, 'virtual', 'list.js');
const virtualTemplate = fs.existsSync(virtualTemplatePath)
    ? fs.readFileSync(virtualTemplatePath, 'utf8')
    : null;

fs.rmSync(modulesDir, { recursive: true, force: true });
fs.mkdirSync(path.join(modulesDir, 'core'), { recursive: true });
fs.writeFileSync(path.join(modulesDir, 'core', 'constants.js'), constantsCode);
fs.writeFileSync(path.join(modulesDir, 'core', 'store.js'), storeCode);

fs.mkdirSync(path.join(modulesDir, 'virtual'), { recursive: true });
fs.writeFileSync(
    path.join(modulesDir, 'virtual', 'list.js'),
    virtualTemplate || fs.readFileSync(path.join(root, 'js', 'modules', 'virtual', 'list.js'), 'utf8')
);

const sliceOrder = ['auth.js', 'storage.js', 'rag.js', 'tasks.js', 'enterprise.js', 'notifications.js', 'coach.js', 'ui.js', 'misc.js', 'boot.js'];
const slicesDir = path.join(modulesDir, 'slices');
fs.mkdirSync(slicesDir, { recursive: true });

const allFnNames = [];

for (const file of sliceOrder) {
    const parts = byFile.get(file) || [];
    if (!parts.length) continue;
    let code = `/* === Lumina slice: ${file} === */\n\n${parts.join('\n\n')}`;
    code = rewriteBindings(code, COLLECTIONS, 'S');
    code = rewriteBindings(code, STATE_VARS, 'S');
    code = rewriteBindings(code, CONSTS, 'C');
    const fns = extractFunctions(code);
    allFnNames.push(...fns);
    fs.writeFileSync(path.join(slicesDir, file), code + '\n');
}

const manifest = {
    version: 2,
    slices: sliceOrder.filter(f => fs.existsSync(path.join(slicesDir, f))),
    functions: allFnNames
};
fs.writeFileSync(path.join(modulesDir, 'slices', 'manifest.json'), JSON.stringify(manifest, null, 2));

fs.writeFileSync(
    path.join(root, 'js', 'main.js'),
    `/** Lumina ESM entry — bundles to js/lumina-app.js */
import './modules/generated/bundle.js';
import { LuminaVirtual } from './modules/virtual/list.js';
if (typeof window !== 'undefined') window.LuminaVirtual = LuminaVirtual;
`
);

console.log('Created', manifest.slices.length, 'slices,', allFnNames.length, 'functions');
console.log(manifest.slices.join(', '));