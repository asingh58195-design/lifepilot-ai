/**
 * Pure state helpers (no React, no browser APIs) so the whole conversation loop
 * can be unit-tested in Node exactly as the UI runs it.
 */
import type {
  AppState,
  ChatMessage,
  ConversationContext,
  Reminder,
  ReminderStatus,
  ScheduleItem,
  Task,
} from '../types';
import type { PlannerOutput } from '../planner/PlannerProvider';

export const STATE_VERSION = 1 as const;

export function emptyContext(): ConversationContext {
  return { turn: 0, preferences: {} };
}

export function emptyState(): AppState {
  return {
    version: STATE_VERSION,
    messages: [],
    appointments: [],
    tasks: [],
    reminders: [],
    schedule: [],
    context: emptyContext(),
  };
}

function upsert<T extends { id: string }>(list: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return list;
  const next = [...list];
  for (const item of incoming) {
    const i = next.findIndex((x) => x.id === item.id);
    if (i >= 0) next[i] = item;
    else next.push(item);
  }
  return next;
}

let msgCounter = 0;
export const messageId = (): string => `msg_${Date.now().toString(36)}${(msgCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function userMessage(text: string, now: Date, viaVoice?: boolean): ChatMessage {
  return { id: messageId(), role: 'user', text, createdAt: now.toISOString(), viaVoice };
}

export function assistantMessage(output: PlannerOutput, now: Date): ChatMessage {
  return {
    id: messageId(),
    role: 'assistant',
    text: output.reply,
    createdAt: now.toISOString(),
    card: output.card,
    suggestions: output.suggestions,
    contextNote: output.contextNote,
    intent: output.intent,
  };
}

export function errorMessage(text: string, now: Date): ChatMessage {
  return { id: messageId(), role: 'assistant', text, createdAt: now.toISOString(), isError: true };
}

/** Fold a planner result (plus the user's message) into the app state. */
export function applyPlannerOutput(state: AppState, user: ChatMessage, output: PlannerOutput, now: Date): AppState {
  return {
    ...state,
    messages: [...state.messages, user, assistantMessage(output, now)],
    appointments: upsert(state.appointments, output.upserts.appointments),
    tasks: upsert(state.tasks, output.upserts.tasks),
    reminders: upsert(state.reminders, output.upserts.reminders),
    schedule: upsert(state.schedule, output.upserts.schedule),
    context: output.context,
  };
}

/** Record a user message that produced a readable error (state data is untouched). */
export function applyError(state: AppState, user: ChatMessage, text: string, now: Date): AppState {
  return { ...state, messages: [...state.messages, user, errorMessage(text, now)] };
}

/* ------------------------------------------------------------------ */
/* Completion state - kept in sync across tasks, reminders and timeline */
/* ------------------------------------------------------------------ */

export function setTaskDone(state: AppState, taskId: string, done: boolean): AppState {
  const tasks = state.tasks.map((t): Task => (t.id === taskId ? { ...t, done } : t));
  const schedule = state.schedule.map((s): ScheduleItem => (s.refType === 'task' && s.refId === taskId ? { ...s, done } : s));
  // Finishing a task also settles reminders that only existed to nudge it.
  const reminders = done
    ? state.reminders.map((r): Reminder => (r.taskId === taskId && r.status === 'active' ? { ...r, status: 'completed' } : r))
    : state.reminders;
  const remIds = new Set(reminders.filter((r) => r.taskId === taskId && r.status === 'completed').map((r) => r.id));
  const schedule2 = done ? schedule.map((s) => (s.refType === 'reminder' && s.refId && remIds.has(s.refId) ? { ...s, done: true } : s)) : schedule;
  return { ...state, tasks, reminders, schedule: schedule2 };
}

export function setReminderStatus(state: AppState, reminderId: string, status: ReminderStatus): AppState {
  const reminders = state.reminders.map((r): Reminder => (r.id === reminderId ? { ...r, status } : r));
  const done = status !== 'active';
  const schedule = state.schedule.map((s): ScheduleItem => (s.refType === 'reminder' && s.refId === reminderId ? { ...s, done } : s));
  return { ...state, reminders, schedule };
}

export function setAppointmentDone(state: AppState, appointmentId: string, done: boolean): AppState {
  const appointments = state.appointments.map((a) => (a.id === appointmentId ? { ...a, done } : a));
  const schedule = state.schedule.map((s): ScheduleItem => (s.refType === 'appointment' && s.refId === appointmentId ? { ...s, done } : s));
  return { ...state, appointments, schedule };
}

/** Toggle from a timeline row, whatever it represents. */
export function toggleScheduleItem(state: AppState, itemId: string): AppState {
  const item = state.schedule.find((s) => s.id === itemId);
  if (!item) return state;
  const done = !item.done;
  if (item.refType === 'task' && item.refId) return setTaskDone(state, item.refId, done);
  if (item.refType === 'reminder' && item.refId) return setReminderStatus(state, item.refId, done ? 'completed' : 'active');
  if (item.refType === 'appointment' && item.refId) return setAppointmentDone(state, item.refId, done);
  return { ...state, schedule: state.schedule.map((s) => (s.id === itemId ? { ...s, done } : s)) };
}

export function clearAll(): AppState {
  return emptyState();
}
