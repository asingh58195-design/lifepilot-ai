import type {
  Appointment,
  ConversationContext,
  Intent,
  PlanCard,
  Reminder,
  ScheduleItem,
  Snapshot,
  Task,
} from '../types';

/** Everything a provider needs to turn one user message into structured actions. */
export interface PlannerInput {
  message: string;
  /** Injected clock so planning is deterministic and testable. */
  now: Date;
  context: ConversationContext;
  /** Read-only view of what already exists (for context resolution and conflict avoidance). */
  snapshot: Snapshot;
}

/** Entities to insert-or-replace (matched by id) in the store. */
export interface Upserts {
  appointments: Appointment[];
  tasks: Task[];
  reminders: Reminder[];
  schedule: ScheduleItem[];
}

export interface PlannerOutput {
  reply: string;
  intent: Intent;
  card?: PlanCard;
  upserts: Upserts;
  /** The conversation context after this turn. */
  context: ConversationContext;
  suggestions: string[];
  /** Describes how earlier conversation was used, e.g. "Linked to Doctor appointment". */
  contextNote?: string;
}

export type PlannerErrorCode =
  | 'EMPTY_MESSAGE'
  | 'TOO_LONG'
  | 'INVALID_DATE'
  | 'INVALID_TIME'
  | 'PAST_TIME'
  | 'PROVIDER_UNAVAILABLE'
  | 'INTERNAL';

/** An error whose message is safe and helpful to show directly to the user. */
export class PlannerError extends Error {
  readonly code: PlannerErrorCode;
  constructor(code: PlannerErrorCode, message: string) {
    super(message);
    this.name = 'PlannerError';
    this.code = code;
  }
}

export interface ProviderStatus {
  id: string;
  name: string;
  description: string;
  available: boolean;
  /** Why the provider cannot be used, when `available` is false. */
  reason?: string;
  requiresCredentials: boolean;
}

/**
 * The seam between the UI and "intelligence".
 * Swap the implementation (local rules -> hosted LLM) without touching any screen.
 */
export interface PlannerProvider {
  readonly id: string;
  readonly name: string;
  status(): Promise<ProviderStatus>;
  plan(input: PlannerInput): Promise<PlannerOutput>;
}
