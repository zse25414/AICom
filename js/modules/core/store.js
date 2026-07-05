/** Unified mutable store */
import { createSlice as domain } from './state-domain.js';
import { createSlice as cache } from './state-cache.js';
import { createSlice as ui } from './state-ui.js';
import { createSlice as timers } from './state-timers.js';
import { createSlice as collections } from './state-collections.js';

export const S = {
    ...domain(),
    ...cache(),
    ...ui(),
    ...timers(),
    ...collections()
};