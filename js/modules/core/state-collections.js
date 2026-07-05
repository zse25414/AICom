/** Mutable collections */
export function createSlice() {
    return {
        knownTeamNotificationIds: new Set(),
        locallyReadNotificationIds: new Set(),
        enterpriseToggleInFlight: new Set(),
        coachPlans: new Map(),
        taskCoachPlans: new Map()
    };
}