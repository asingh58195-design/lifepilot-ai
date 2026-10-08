import type { AppState } from '../types';
import { STATE_VERSION, emptyState } from './state';

export const STORAGE_KEY = 'lifepilot-ai:state:v1';

export interface LoadResult {
  state: AppState;
  /** Set when stored data was unreadable and has been reset. */
  warning?: string;
}

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

/** Defensive check so corrupted storage can never crash the app. */
export function validate(raw: unknown): AppState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (o.version !== STATE_VERSION) return undefined;
  if (![o.messages, o.appointments, o.tasks, o.reminders, o.schedule].every(isArray)) return undefined;
  const ctx = o.context as Record<string, unknown> | undefined;
  if (!ctx || typeof ctx !== 'object' || typeof ctx.turn !== 'number') return undefined;
  return {
    ...emptyState(),
    ...(o as unknown as AppState),
    context: { ...(o.context as AppState['context']), preferences: (ctx.preferences as AppState['context']['preferences']) ?? {} },
  };
}

export function loadState(storage: Storage | undefined = safeStorage()): LoadResult {
  if (!storage) return { state: emptyState(), warning: 'Browser storage is unavailable, so your plans will not survive a refresh.' };
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return { state: emptyState() };
    const state = validate(JSON.parse(text));
    if (state) return { state };
    return { state: emptyState(), warning: 'Saved data was in an unknown format and has been reset.' };
  } catch {
    return { state: emptyState(), warning: 'Saved data could not be read and has been reset.' };
  }
}

/** Returns an error message when saving failed, otherwise undefined. */
export function saveState(state: AppState, storage: Storage | undefined = safeStorage()): string | undefined {
  if (!storage) return 'Browser storage is unavailable, so changes will not survive a refresh.';
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return undefined;
  } catch {
    return 'Could not save your data (browser storage may be full or blocked).';
  }
}

export function clearStorage(storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
