/**
 * Reorganize flat slices into domain subfolders + core helpers.
 * Run once: node scripts/reorganize-slices.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const slicesDir = path.join(root, 'js', 'modules', 'slices');
const coreDir = path.join(root, 'js', 'modules', 'core');

const ROUTES = [
    { dir: 'theme', names: new Set(['initializeTailwind']) },
    { dir: 'dom', names: new Set(['$', 'setElText', 'setElHtml', 'setElStyle']) },
    {
        dir: 'utils',
        names: new Set([
            'toLocalISO', 'getTodayISO', 'getTomorrowISO', 'formatDateTW', 'getGreeting',
            'escapeHtml', 'sanitizeHtml', 'isSafeHttpUrl', 'clampText', 'isPlainObject',
            'sanitizeImportedTask', 'validateImportedData', 'sanitizeImportedProfile', 'sanitizeFaIcon',
            'getInitials', 'addMinutes', 'getEnergyLabel', 'getEnergyColor', 'formatNotifTime'
        ])
    },
    { dir: 'auth', names: new Set([
        'clearSensitiveLocalData', 'hashPin', 'hashPassword', 'normalizeEmail', 'isValidEmail',
        'getAuthBaseUrl', 'getAuthHeaders', 'authApiRequest', 'getAuthSession', 'isLoggedIn', 'needsAuthGate',
        'persistAuthSession', 'applyAuthUserToProfile', 'clearAuthErrors', 'showAuthOverlay', 'hideAuthOverlay',
        'switchAuthTab', 'updateAuthUI', 'buildUserDataPayload', 'applyUserDataFromServer', 'syncUserDataToServer',
        'loadUserDataFromServer', 'finishAuth', 'handleRegister', 'handleLogin', 'handleLogout', 'openUserMenu',
        'dismissAuthAsGuest', 'checkAuthOnInit', 'verifyLocalManagerPin'
    ]) },
    { dir: 'storage', file: 'persist.js', names: new Set([
        'loadState', 'persistTasks', 'persistProfile', 'persistAnalytics', 'flushPersistState', 'saveState',
        'loadDailyHistory', 'saveDailyHistory', 'loadTrackedFocus', 'saveTrackedFocus', 'getTrackedFocusMinutesForDate',
        'recordFocusSessionMinutes', 'mergeTasksArrays', 'trimDailyHistory', 'snapshotDay', 'recordDailySnapshot',
        'recalculateWeeklyScores', 'getFocusComparisonText', 'applyStreakReward', 'evaluateStreakForDate', 'processDailyRollover',
        'exportData', 'importData'
    ]) },
    { dir: 'storage', file: 'api.js', names: new Set([
        'hasStoredApiKey', 'migrateApiSettings', 'migrateApiKeyStorage', 'getStoredApiKey', 'setStoredApiKey',
        'getDeepSeekClientCredentials', 'isApiReady', 'updateApiStatusBadge', 'toggleApiModeFields', 'callDeepSeek',
        'testApiConnection', 'loadSettingsForm', 'clearApiKey', 'saveSettings'
    ]) },
    { dir: 'rag', file: 'client.js', names: new Set([
        'getRagFilenameForDoc', 'getRagKbLabel', 'syncDocumentToRag', 'reindexEnterpriseDocumentsToRag',
        'ensureEnterpriseDocsInRag', 'deleteDocumentFromRag', 'fetchRagKbIds', 'getRagServiceBase',
        'getRagLlmCredentials', 'getRagQueryUrl'
    ]) },
    { dir: 'tasks', file: 'scoring.js', names: new Set([
        'inferCategory', 'getCategoryLabel', 'getCategoryColor', 'resolveCategory', 'invalidateTodayStats',
        'computeTodayStats', 'getTodayStats', 'getScoringContext', 'parseHour', 'scoreTaskForNextStep',
        'rankTasksByNextStepScore', 'getNextRecommendedTask', 'getNextStepReason', 'scoreTaskPriority',
        'scoreTaskBlockFit', 'getCategoryCounts', 'getCompletedCount', 'getTodayRelevantTasks', 'getTodayPendingTasks',
        'getFuturePendingTasks', 'getTodayCompletedCount', 'getTodayFocusMinutes', 'getTodayCompletionRate'
    ]) },
    { dir: 'tasks', file: 'index.js', names: new Set([
        'rebuildTaskIndex', 'getTaskById', 'rebuildTodayQueueMap', 'buildSyncedEnterpriseIdSet', 'migrateTasks',
        'touchTask', 'getFilteredTasks', 'flushRefreshUI', 'refreshUI', 'refreshUIImmediate', 'setCategoryFilter',
        'renderCategoryFilters', 'getTodayQueuePosition', 'pulseNextStepCard', 'renderPersonalTaskRow',
        'getActiveParentGoals', 'checkParentGoalComplete', 'renderActiveGoalsPanel', 'renderTaskBadges',
        'openTaskEdit', 'closeTaskEdit', 'saveTaskEdit', 'quickAddTask', 'renderTaskList', 'toggleTaskComplete',
        'splitTask', 'deleteTask', 'clearAllTasks', 'syncEnterpriseTaskToPersonal', 'syncEnterpriseCompletionToPersonal',
        'enqueueEnterpriseSync', 'scheduleEnterpriseSyncFlush', 'flushEnterpriseSyncQueue', 'syncPersonalTaskCompletionToEnterprise',
        'cacheEnterpriseGroupLocally', 'evaluateStreakOnComplete', 'focusQuickAdd', 'toggleDashStats',
        'updateNextStepCard', 'skipToNextTodayTask', 'quickStartToday'
    ]) },
    { dir: 'tasks', file: 'schedule.js', names: new Set([
        'buildTimeBlocks', 'assignTasksToBlocks', 'optimizeSchedule'
    ]) },
    { dir: 'tasks', file: 'focus.js', names: new Set([
        'resolveTodayFocusTask', 'normalizeFocusSteps', 'buildQuickStartSteps', 'getStepsForTask', 'parseStepMinutes',
        'getCoachTask', 'clearFocusTimer', 'tickFocusTimer', 'startFocusTimer', 'endFocusSession', 'extendFocusTimer',
        'completeFocusTask', 'renderFocusSessionPanel', 'advanceFocusStep', 'focusTodayTask', 'startTodayTask',
        'onTodayTaskCompleted'
    ]) },
    { dir: 'enterprise', file: 'team.js', names: new Set([
        'getEnterpriseBaseUrl', 'loadLocalEnterpriseStore', 'saveLocalEnterpriseStore', 'normalizeEnterpriseCode',
        'enterpriseFetch', 'enterpriseLocalCreate', 'enterpriseLocalJoin', 'enterpriseLocalGetGroup', 'toggleManagerPin',
        'getMemberInitials', 'renderMemberChip', 'fetchApiReadiness', 'formatReadinessHint', 'updateTeamSyncStatus',
        'copyGroupCode', 'applyTeamInviteFromUrl', 'createEnterpriseGroup', 'joinEnterpriseGroup', 'leaveEnterpriseGroup',
        'refreshEnterpriseData', 'renderEnterprisePage', 'renderEnterpriseTasks', 'renderEnterpriseTaskRow',
        'assignEnterpriseTask', 'applyEnterpriseTaskToCache', 'persistEnterpriseTaskToggle', 'toggleEnterpriseTask',
        'getEnterprisePollInterval', 'startEnterprisePolling', 'stopEnterprisePolling'
    ]) },
    { dir: 'enterprise', file: 'documents.js', names: new Set([
        'ensurePdfJs', 'ensureXlsx', 'toggleAddDocForm', 'switchDocFormType', 'handleDocFileSelect',
        'extractTextFromPdf', 'extractTextFromExcel', 'saveTeamDocument', 'deleteTeamDocument', 'renderEnterpriseDocuments'
    ]) },
    { dir: 'notifications', file: 'index.js', names: new Set([
        'ensureLocalGroupNotifications', 'pushLocalTeamNotification', 'getLocalTeamNotifications',
        'getLocalReadNotificationStorageKey', 'loadLocallyReadNotificationIds', 'persistLocallyReadNotificationIds',
        'rememberLocallyReadNotificationIds', 'applyLocalReadFlags', 'markLocalTeamNotificationsRead',
        'getDefaultTeamNotificationPrefs', 'getTeamNotificationPrefs', 'saveTeamNotificationPrefs',
        'onTeamDesktopNotifToggle', 'loadTeamNotificationPrefsForm', 'shouldAlertForNotification',
        'ingestTeamNotificationsFromResponse', 'alertForNewTeamNotification', 'processIncomingTeamNotifications',
        'refreshTeamNotifications', 'updateNotificationUI', 'renderNotificationPanel', 'toggleNotificationPanel',
        'closeNotificationPanel', 'markTeamNotificationRead', 'markAllTeamNotificationsRead', 'handleTeamNotificationClick'
    ]) },
    { dir: 'coach', file: 'decompose.js', names: new Set([
        'decomposeGoalWithAI', 'renderDecomposePlan', 'decomposeGoal', 'generateSmartDecomposition', 'useExampleGoal',
        'copyPlanToClipboard', 'addFirstStepToToday', 'addDecomposedToScheduler', 'askCoachAboutNextTask', 'openCoachForTask'
    ]) },
    { dir: 'coach', file: 'plans.js', names: new Set([
        'normalizeCoachPlan', 'estimatePlanDuration', 'parseBulletToField', 'ensureDocumentFields',
        'renderEditableDocumentHtml', 'updateCoachDocField', 'toggleCoachChecklistItem', 'extractTaskNameFromMessage',
        'inferTaskDocType', 'buildTaskResources', 'buildDocumentDraft', 'buildOfflineCoachPlan', 'coachPlanToMarkdown',
        'renderCoachPlan', 'storeCoachPlan', 'copyCoachPlan', 'downloadCoachDocument', 'startCoachPlan',
        'applyCoachStepsAsTasks', 'findTaskForPlan', 'linkPlanToTask', 'syncFocusSessionWithPlan'
    ]) },
    { dir: 'coach', file: 'agent.js', names: new Set([
        'parseJsonFromAI', 'parseCoachAgentResponse', 'coachRespondWithAI', 'pushCoachAgentMessage', 'getOpeningCoachMessage',
        'ensureCoachSessionForTask', 'startStepTimerForCoach', 'coachBeginGuidedSession', 'coachPauseSession',
        'coachAdvanceStepFromAgent', 'coachCompleteTaskFromAgent', 'buildOfflineAgentReply', 'inferAgentActionsFromUserMsg',
        'isGenericCoachFallback', 'coachAgentRespondWithAI', 'getCoachWorkspace', 'formatCoachContent',
        'renderCoachAgentThread', 'renderCoachEmptyState', 'renderCoachAgentView', 'coachStartFocusNow', 'refreshCoachView',
        'askCoach', 'sendCoachAgentMessage', 'sendChatMessage', 'getCoachContext', 'buildCoachContextText',
        'updateCoachContextBar', 'getCoachReadinessChecks', 'renderCoachReadinessBar', 'renderCoachQuickActions',
        'openCoachForNextTask'
    ]) },
    { dir: 'ui', file: 'navigation.js', names: new Set([
        'showSection', 'switchSchedulerTab', 'openDecomposeTab', 'showGuideTab', 'closeNavMore', 'toggleNavMore',
        'navigateFromMore', 'updateNavMoreState', 'toggleMobileMore', 'closeMobileMore', 'navigateFromMobileMore',
        'setupKeyboardShortcuts'
    ]) },
    { dir: 'ui', file: 'pwa.js', names: new Set([
        'generateManifestIcon', 'setupManifest', 'registerServiceWorker', 'updatePwaStatus', 'setupPwaInstall',
        'promptInstall', 'setupOfflineDetection'
    ]) },
    { dir: 'ui', file: 'onboarding.js', names: new Set([
        'clearOnboardHighlight', 'applyOnboardHighlight', 'renderOnboardingStep', 'startOnboarding', 'nextOnboardingStep',
        'skipOnboarding', 'completeOnboarding'
    ]) },
    { dir: 'ui', file: 'dashboard.js', names: new Set([
        'updateDashboard', 'syncCategoryFromEnergy', 'addTaskToList', 'getTimeDistribution', 'refreshServiceStatus'
    ]) },
    { dir: 'ui', file: 'insights.js', names: new Set([
        'loadChartJs', 'refreshInsightsPage', 'updateInsightsCards', 'initCharts', 'recalculateInsights'
    ]) },
    { dir: 'ui', file: 'feedback.js', names: new Set(['triggerConfetti', 'showToast', 'resetAllData']) },
    { dir: 'boot', file: 'init.js', names: new Set(['initializeApp']) }
];

const LAZY_ROUTE_DIRS = new Set(['coach', 'enterprise']);

function parseFunctions(code) {
    const blocks = [];
    const re = /^(?:async )?function (\w+)\s*\(/gm;
    const hits = [];
    let m;
    while ((m = re.exec(code)) !== null) hits.push({ name: m[1], start: m.index });
    for (let i = 0; i < hits.length; i++) {
        blocks.push({
            name: hits[i].name,
            code: code.slice(hits[i].start, hits[i + 1]?.start ?? code.length).trim()
        });
    }
    return blocks;
}

function routeOf(name) {
    for (const r of ROUTES) {
        if (r.names.has(name)) return r;
    }
    return { dir: 'misc', file: 'index.js', names: new Set() };
}

function readFlatSlices() {
    const files = fs.readdirSync(slicesDir).filter(f => f.endsWith('.js'));
    let allCode = '';
    for (const f of files) {
        if (f === 'boot.js') continue;
        allCode += fs.readFileSync(path.join(slicesDir, f), 'utf8') + '\n';
    }
    allCode += fs.readFileSync(path.join(slicesDir, 'boot.js'), 'utf8');
    return parseFunctions(allCode.replace(/\/\* === Lumina slice:[\s\S]*?=== \*\/\n\n/g, ''));
}

function extractRagHealthFromBoot() {
    const boot = fs.readFileSync(path.join(slicesDir, 'boot.js'), 'utf8');
    const start = boot.indexOf('// RAG Health Checking');
    const end = boot.indexOf('// Bonus: pre-generate');
    if (start < 0 || end < 0) return null;
    return boot.slice(start, end).trim();
}

function writeStoreSlices() {
    const oldStore = fs.readFileSync(path.join(coreDir, 'store.js'), 'utf8');
    const body = oldStore.replace(/^[\s\S]*?export const S = \{/, '').replace(/\};\s*$/, '');

    const domainKeys = [
        'tasks', 'weeklyScores', 'dailyHistory', 'currentDecomposedPlan', 'activeCategoryFilter',
        'deferredInstallPrompt', 'editingTaskId', 'trackedFocusByDay', 'enterpriseSyncSuppress', 'userProfile',
        'enterpriseSession', 'enterpriseGroupData', 'enterprisePollTimer', 'teamNotifications',
        'chatHistory', 'coachAgentMessages', 'coachRequestInFlight', 'ragServiceActive', 'ragRetrievalMode',
        'ragSyncedGroupKey', 'checkedRagKbs', 'rolledCountOnInit', 'todayFocusTaskId', 'focusSession',
        'enterpriseSyncQueue', 'schedulerTabPending', 'onboardingStep', 'selectedDocFile'
    ];
    const cacheKeys = [
        'todayStatsCache', 'todayQueueMap', 'categoryCountsCache', 'taskById', 'enterpriseDataFetchedAt'
    ];
    const uiKeys = [
        'notifPanelOpen', 'teamNotificationsInitialized', 'activeCategoryFilter', 'currentDecomposedPlan',
        'taskListVirtual', 'editingTaskId', 'schedulerTabPending', 'onboardingStep', 'selectedDocFile'
    ];
    const timerKeys = [
        'enterprisePollTimer', 'enterpriseSyncFlushTimer', 'userDataSyncTimer', 'focusTimerInterval',
        'analyticsPersistTimer', 'persistStateTimer', 'refreshUIQueued', 'refreshUIRaf',
        'chartJsLoadPromise', 'pdfJsLoadPromise', 'xlsxLoadPromise', 'weeklyChartInstance', 'pieChartInstance'
    ];
    const collectionKeys = [
        'knownTeamNotificationIds', 'locallyReadNotificationIds', 'enterpriseToggleInFlight',
        'coachPlans', 'taskCoachPlans'
    ];

    function extractKey(key) {
        const re = new RegExp(`\\n\\s*${key}:\\s*([\\s\\S]*?)(?=,\\n\\s*\\w|$)`);
        const m = body.match(re);
        return m ? m[1].trim().replace(/,\s*$/, '') : null;
    }

    function writeSlice(file, keys, comment) {
        let out = `/** ${comment} */\nexport function createSlice() {\n    return {\n`;
        for (const key of keys) {
            const val = extractKey(key);
            if (val != null) out += `        ${key}: ${val},\n`;
        }
        out += '    };\n}\n';
        fs.writeFileSync(path.join(coreDir, file), out);
    }

    writeSlice('state-domain.js', domainKeys, 'Domain state');
    writeSlice('state-cache.js', cacheKeys, 'Derived caches');
    writeSlice('state-ui.js', [...new Set(uiKeys)], 'UI ephemeral state');
    writeSlice('state-timers.js', timerKeys, 'Timers and lazy-load promises');
    writeSlice('state-collections.js', collectionKeys, 'Mutable collections');

    const userProfile = extractKey('userProfile');
    fs.writeFileSync(path.join(coreDir, 'store.js'), `/** Unified mutable store */
import { createSlice as domain } from './state-domain.js';
import { createSlice as cache } from './state-cache.js';
import { createSlice as ui } from './state-ui.js';
import { createSlice as timers } from './state-timers.js';
import { createSlice as collections } from './state-collections.js';

const _domain = domain();
if (_domain.userProfile === undefined) {
    _domain.userProfile = ${userProfile || `{
        name: '使用者', role: '知識工作者', streak: 0, bestStreak: 0, joinDay: 1,
        workStart: '09:00', workEnd: '18:00', peakStart: '09:00', peakEnd: '12:30',
        streakThreshold: 80, enableConfetti: true,
        apiEnabled: false, apiMode: 'direct', apiModel: 'deepseek-chat',
        apiProxyUrl: 'http://localhost:3001/api/chat',
        enterpriseApiUrl: 'http://localhost:3001'
    }`};
}

export const S = {
    ..._domain,
    ...cache(),
    ...ui(),
    ...timers(),
    ...collections()
};
`);
}

function main() {
    const blocks = readFlatSlices();
    const buckets = new Map();

    for (const block of blocks) {
        if (block.name === 'initializeApp') continue;
        const route = routeOf(block.name);
        const file = route.file || 'index.js';
        const key = `${route.dir}/${file}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(block.code);
    }

    const ragHealth = extractRagHealthFromBoot();
    const newSlicesRoot = path.join(root, 'js', 'modules', 'slices-new');
    fs.rmSync(newSlicesRoot, { recursive: true, force: true });

    const order = [];
    const lazyOrder = [];

    for (const [key, parts] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const outPath = path.join(newSlicesRoot, key);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const banner = `/* Lumina: ${key} */\n`;
        fs.writeFileSync(outPath, banner + parts.join('\n\n') + '\n');
        if (LAZY_ROUTE_DIRS.has(key.split('/')[0])) lazyOrder.push(key);
        else order.push(key);
    }

    if (ragHealth) {
        const healthPath = path.join(newSlicesRoot, 'rag', 'health.js');
        const healthCode = `/* Lumina: rag/health.js */
function setupRagHealthMonitoring() {
${ragHealth
    .replace('// RAG Health Checking and helper bindings', '')
    .replace(/window\.checkRagServiceHealth = async \(\) => \{/, 'async function checkRagServiceHealth() {')
    .replace(/window\.renderRagKbCheckboxes = async \(\) => \{/, 'async function renderRagKbCheckboxes() {')
    .replace(/window\.onRagKbCheckboxChange = \(\) => \{/, 'function onRagKbCheckboxChange() {')
    .split('\n')
    .map(l => '    ' + l)
    .join('\n')
    .trim()}
    window.checkRagServiceHealth = checkRagServiceHealth;
    window.renderRagKbCheckboxes = renderRagKbCheckboxes;
    window.onRagKbCheckboxChange = onRagKbCheckboxChange;
    checkRagServiceHealth();
    setInterval(checkRagServiceHealth, 10000);
}

function pregenerateExample() {
    document.getElementById('goal-input').value = "完成 Q3 產品路線圖並獲得團隊共識";
    decomposeGoal();
}
`;
        fs.writeFileSync(healthPath, healthCode);
        order.push('rag/health.js');
    }

    const initBlock = blocks.find(b => b.name === 'initializeApp');
    if (initBlock) {
        let initCode = initBlock.code
            .replace(/\/\/ RAG Health Checking[\s\S]*?window\.pregenerateExample[\s\S]*?\};\n/, '')
            .replace('initializeTailwind()', '/* theme */ initializeTailwind()')
            .trim();
        initCode += '\n    setupRagHealthMonitoring();\n    window.pregenerateExample = pregenerateExample;\n';
        fs.mkdirSync(path.join(newSlicesRoot, 'boot'), { recursive: true });
        fs.writeFileSync(path.join(newSlicesRoot, 'boot', 'init.js'), `/* Lumina: boot/init.js */\n${initCode}\n`);
        order.push('boot/init.js');
    }

    const manifest = {
        version: 3,
        core: order,
        lazy: lazyOrder,
        functions: blocks.map(b => b.name).concat(['checkRagServiceHealth', 'renderRagKbCheckboxes', 'onRagKbCheckboxChange', 'pregenerateExample', 'setupRagHealthMonitoring'])
    };
    fs.writeFileSync(path.join(newSlicesRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

    fs.rmSync(slicesDir, { recursive: true, force: true });
    fs.renameSync(newSlicesRoot, slicesDir);

    writeStoreSlices();

    const misc = buckets.get('misc/index.js');
    console.log('Reorganized into', order.length + lazyOrder.length, 'files');
    if (misc) console.warn('misc functions:', misc.length);
    console.log('lazy chunks:', lazyOrder.join(', ') || '(none)');
}

main();