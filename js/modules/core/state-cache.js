/** Derived caches */
export function createSlice() {
    return {
        todayStatsCache: null,
        todayQueueMap: null,
        categoryCountsCache: null,
        taskById: new Map(),
        enterpriseDataFetchedAt: 0
    };
}