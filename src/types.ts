/**
 * Shared, typed domain models for LifePilot AI.
 * All timestamps are ISO-8601 strings (UTC) so they serialise cleanly to localStorage.
 */

export type Category = 'Health' | 'Work' | 'Personal' | 'Errands' | 'Fitness' | 'Home';
export type Priority = 'high' | 'medium' | 'low';

/** What a schedule entry is. Drives icon, colour and label in the UI. */
export type ItemKind = 'appointment' | 'action' | 'reminder' | 'preparation' | 'work' | 'task';

/**
 * Items generated from an appointment carry a role so they can be re-laid-out
 * automatically when the appointment moves or the arrival buffer changes.
 */
export type DerivedRole = 'arrival' | 'prep' | 'prepReminder' | 'getReady' | 'bring';

export interface Appointment {
  id: string;
  title: string;
  start: string;
  end?: string;
  category: Category;
  /** Minutes the user wants to arrive before `start`. */
  bufferMin: number;
  done: boolean;
  planId: string;
}

export interface Task {
  id: string;
  title: string;
  category: Category;
  priority: Priority;
  /** Due date/time. When `dueAllDay` is true only the date part matters. */
  due?: string;
  dueAllDay?: boolean;
  durationMin?: number;
  done: boolean;
  appointmentId?: string;
  role?: DerivedRole;
  planId: string;
  createdAt: string;
}

export type ReminderStatus = 'active' | 'completed' | 'dismissed';

export interface Reminder {
  id: string;
  title: string;
  at: string;
  status: ReminderStatus;
  taskId?: string;
  appointmentId?: string;
  role?: DerivedRole;
  planId: string;
}

export interface ScheduleItem {
  id: string;
  kind: ItemKind;
  title: string;
  detail?: string;
  start: string;
  end?: string;
  category: Category;
  done: boolean;
  /** The entity this timeline entry represents (kept in sync for completion state). */
  refType?: 'appointment' | 'task' | 'reminder';
  refId?: string;
  appointmentId?: string;
  role?: DerivedRole;
  planId: string;
}

/* ------------------------------------------------------------------ */
/* Conversation                                                        */
/* ------------------------------------------------------------------ */

export type Intent =
  | 'plan'
  | 'followup'
  | 'reschedule'
  | 'query'
  | 'clarify'
  | 'smalltalk'
  | 'help';

export interface PlanCardItem {
  id: string;
  at: string;
  endAt?: string;
  kind: ItemKind;
  title: string;
  detail?: string;
  /** True when this entry was changed (moved) rather than newly created. */
  changed?: boolean;
  /** Shown dimmed as context (already on the schedule before this turn). */
  existing?: boolean;
}

export type PlanHeading = 'PLAN CREATED' | 'PLAN UPDATED' | 'REMINDER ADDED' | 'YOUR DAY';

export interface PlanCard {
  id: string;
  heading: PlanHeading;
  summary: string;
  items: PlanCardItem[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  viaVoice?: boolean;
  isError?: boolean;
  card?: PlanCard;
  suggestions?: string[];
  /** Human readable note describing how conversation context was used. */
  contextNote?: string;
  intent?: Intent;
}

export interface Preferences {
  arrivalBufferMin?: number;
  exerciseTime?: 'morning' | 'evening';
}

export interface PendingClarification {
  kind: 'appointment-time' | 'reminder-time' | 'work-hours';
  /** Draft fields collected so far. */
  title: string;
  dateISO?: string;
  category?: Category;
  appointmentId?: string;
  question: string;
}

export interface ConversationContext {
  activeAppointmentId?: string;
  lastPlanId?: string;
  /** Local date (YYYY-MM-DD) the conversation is currently "about". */
  lastDate?: string;
  lastIntent?: Intent;
  turn: number;
  preferences: Preferences;
  pending?: PendingClarification;
}

export interface Snapshot {
  appointments: Appointment[];
  tasks: Task[];
  reminders: Reminder[];
  schedule: ScheduleItem[];
}

export interface AppState extends Snapshot {
  version: 1;
  messages: ChatMessage[];
  context: ConversationContext;
}
