/** Timers and lazy-load promises */
export function createSlice() {
    return {
        enterprisePollTimer: null,
        enterpriseSyncFlushTimer: null,
        userDataSyncTimer: null,
        focusTimerInterval: null,
        analyticsPersistTimer: null,
        persistStateTimer: null,
        refreshUIQueued: null,
        refreshUIRaf: null,
        chartJsLoadPromise: null,
        pdfJsLoadPromise: null,
        xlsxLoadPromise: null,
        weeklyChartInstance: null,
        pieChartInstance: null
    };
}