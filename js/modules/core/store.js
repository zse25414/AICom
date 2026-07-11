/** Unified mutable store — must be a true singleton across lazy chunks */
import { createSlice as domain } from './state-domain.js';
import { createSlice as cache } from './state-cache.js';
import { createSlice as ui } from './state-ui.js';
import { createSlice as timers } from './state-timers.js';
import { createSlice as collections } from './state-collections.js';

function createStore() {
    return {
        ...domain(),
        ...cache(),
        ...ui(),
        ...timers(),
        ...collections()
    };
}

/**
 * Lazy chunks (coach / enterprise-docs) are separate IIFEs.
 * Without a shared global, each chunk would create its own `S` and
 * coach/RAG/session state would desync from the core app (coach "dead").
 */
const g = typeof globalThis !== 'undefined' ? globalThis : {};
if (!g.__LUMINA_STORE__) {
    g.__LUMINA_STORE__ = createStore();
}
export const S = g.__LUMINA_STORE__;
