import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, ReminderStatus } from '../types';
import { createProviders, DEFAULT_PROVIDER_ID, PlannerError, type PlannerProvider, type ProviderStatus } from '../planner';
import {
  applyError,
  applyPlannerOutput,
  emptyState,
  setReminderStatus,
  setTaskDone,
  toggleScheduleItem,
  userMessage,
} from './state';
import { clearStorage, loadState, saveState } from './storage';

export interface LifePilot {
  state: AppState;
  now: Date;
  /** True while a request is being planned. Blocks duplicate submissions. */
  loading: boolean;
  /** A persistent, dismissible message (storage problems, server status, ...). */
  notice?: string;
  dismissNotice: () => void;
  providers: PlannerProvider[];
  provider: PlannerProvider;
  statuses: ProviderStatus[];
  selectProvider: (id: string) => void;
  send: (text: string, viaVoice?: boolean) => Promise<{ ok: boolean }>;
  toggleTask: (id: string, done: boolean) => void;
  toggleItem: (id: string) => void;
  setReminder: (id: string, status: ReminderStatus) => void;
  reset: () => void;
}

/** Single source of truth for the UI: conversation loop, persistence and completion state. */
export function useLifePilot(): LifePilot {
  const initial = useMemo(() => loadState(), []);
  const providers = useMemo(() => createProviders(), []);
  const [state, setState] = useState<AppState>(initial.state);
  const [notice, setNotice] = useState<string | undefined>(initial.warning);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [providerId, setProviderId] = useState(DEFAULT_PROVIDER_ID);
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);

  // The ref is the real duplicate-submission guard: React state updates are async, a ref is not.
  const inFlight = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const provider = providers.find((p) => p.id === providerId) ?? providers[0];

  // Persist every change. A failed save is surfaced, never swallowed.
  useEffect(() => {
    const problem = saveState(state);
    if (problem) setNotice(problem);
  }, [state]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(providers.map((p) => p.status())).then((s) => !cancelled && setStatuses(s));
    return () => {
      cancelled = true;
    };
  }, [providers]);

  const send = useCallback(
    async (text: string, viaVoice?: boolean): Promise<{ ok: boolean }> => {
      if (inFlight.current) return { ok: false };
      const at = new Date();

      if (!text.trim()) {
        setState((s) => applyError(s, userMessage('(empty message)', at), 'Type a request first, for example "I have a doctor appointment tomorrow at 3 PM".', at));
        return { ok: false };
      }

      inFlight.current = true;
      setLoading(true);
      const user = userMessage(text.trim(), at, viaVoice);
      try {
        // A short beat so the "planning" state is visible and the exchange reads naturally.
        await new Promise((r) => window.setTimeout(r, 600));
        const current = stateRef.current;
        const out = await provider.plan({ message: text, now: new Date(), context: current.context, snapshot: current });
        setState((s) => applyPlannerOutput(s, user, out, new Date()));
        return { ok: true };
      } catch (e) {
        const message =
          e instanceof PlannerError
            ? e.message
            : 'Something went wrong while planning that. Nothing was changed. Please try rephrasing.';
        setState((s) => applyError(s, user, message, new Date()));
        return { ok: false };
      } finally {
        inFlight.current = false;
        setLoading(false);
        setNow(new Date());
      }
    },
    [provider],
  );

  return {
    state,
    now,
    loading,
    notice,
    dismissNotice: () => setNotice(undefined),
    providers,
    provider,
    statuses,
    selectProvider: setProviderId,
    send,
    toggleTask: (id, done) => setState((s) => setTaskDone(s, id, done)),
    toggleItem: (id) => setState((s) => toggleScheduleItem(s, id)),
    setReminder: (id, status) => setState((s) => setReminderStatus(s, id, status)),
    reset: () => {
      clearStorage();
      setState(emptyState());
      setNotice(undefined);
    },
  };
}
