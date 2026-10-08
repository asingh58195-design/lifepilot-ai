/**
 * LocalPlannerProvider - deterministic, rule-based planning. No network, no API keys.
 *
 * Pipeline for every message:
 *   1. extractMessage()  -> typed drafts (appointments, work blocks, tasks, reminders, ...)
 *   2. Turn              -> resolves dates + conversation context, builds linked entities
 *   3. narrate + card    -> a readable reply and a structured "plan card" for the UI
 */
import type {
  Appointment,
  Category,
  ConversationContext,
  DerivedRole,
  Intent,
  PlanCard,
  PlanCardItem,
  PlanHeading,
  Preferences,
  Reminder,
  ScheduleItem,
  Snapshot,
  Task,
} from '../types';
import {
  addDays,
  addMinutes,
  atTime,
  fmtDayLabel,
  fmtDuration,
  fmtTime,
  fmtWhen,
  MS_MIN,
  parseYmd,
  startOfDay,
  ymd,
} from '../lib/time';
import {
  PlannerError,
  type PlannerInput,
  type PlannerOutput,
  type PlannerProvider,
  type ProviderStatus,
  type Upserts,
} from './PlannerProvider';
import {
  capitalize,
  emptyParsed,
  extractMessage,
  type AppointmentDraft,
  type ClockTime,
  type ParsedMessage,
  type ReminderDraft,
  type TaskDraft,
  type WorkDraft,
} from './extract';
import { combine, findDate, findPartOfDay, findRange, findTimes, type DateHit } from './parse';
import { clampFuture, findFreeSlot, layoutAppointment, type ApptLayout, type Interval } from './layout';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0;
const defaultId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const lcFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n === 1 ? singular : pluralForm}`;

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

const KIND_RANK: Record<ScheduleItem['kind'], number> = {
  reminder: 0,
  preparation: 1,
  task: 2,
  action: 3,
  work: 4,
  appointment: 5,
};

function sortSchedule<T extends { start: string; kind: ScheduleItem['kind'] }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || KIND_RANK[a.kind] - KIND_RANK[b.kind],
  );
}

function layoutFor(appt: Appointment): ApptLayout {
  const start = new Date(appt.start);
  const layout = layoutAppointment(start, appt.bufferMin);
  if (appt.bufferMin <= 0) layout.getReady = addMinutes(start, -15);
  return layout;
}

function timeForRole(role: DerivedRole, layout: ApptLayout): { start: Date; end?: Date } {
  switch (role) {
    case 'arrival':
      return { start: layout.arrival };
    case 'prep':
      return { start: layout.prepStart, end: layout.prepReminder };
    case 'prepReminder':
      return { start: layout.prepReminder };
    case 'getReady':
      return { start: layout.getReady };
    case 'bring':
      return { start: layout.bring };
  }
}

const emptyUpserts = (): Upserts => ({ appointments: [], tasks: [], reminders: [], schedule: [] });

const DEFAULT_ARRIVAL: Record<string, number> = { flight: 90 };

/* ------------------------------------------------------------------ */
/* One planning turn                                                   */
/* ------------------------------------------------------------------ */

class Turn {
  readonly planId: string;
  readonly created: Upserts = emptyUpserts();
  readonly updated: Upserts = emptyUpserts();
  readonly narration: string[] = [];
  readonly notes: string[] = [];
  readonly used: string[] = [];
  readonly anchors: ScheduleItem[] = [];
  readonly today: Date;
  lastDay?: Date;
  activeAppointmentId?: string;
  movedToNow = false;

  constructor(
    readonly now: Date,
    readonly ctx: ConversationContext,
    readonly snap: Snapshot,
    readonly parsed: ParsedMessage,
    readonly id: (prefix: string) => string,
  ) {
    this.planId = id('plan');
    this.today = startOfDay(now);
    this.activeAppointmentId = ctx.activeAppointmentId;
  }

  /* ---- lookups ---------------------------------------------------- */

  appointments(): Appointment[] {
    const byId = new Map<string, Appointment>();
    for (const a of this.snap.appointments) byId.set(a.id, a);
    for (const a of this.updated.appointments) byId.set(a.id, a);
    for (const a of this.created.appointments) byId.set(a.id, a);
    return [...byId.values()];
  }

  scheduleItems(): ScheduleItem[] {
    const byId = new Map<string, ScheduleItem>();
    for (const s of this.snap.schedule) byId.set(s.id, s);
    for (const s of this.updated.schedule) byId.set(s.id, s);
    for (const s of this.created.schedule) byId.set(s.id, s);
    return [...byId.values()];
  }

  /** Find the appointment a message is talking about. */
  resolveAppointment(target?: string): Appointment | undefined {
    const upcoming = this.appointments()
      .filter((a) => !a.done && new Date(a.start).getTime() >= this.now.getTime() - 2 * 60 * MS_MIN)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    const generic = !target || /^(it|that|appointment|meeting|visit|session)$/.test(target);
    if (!generic) {
      const hit = upcoming.find((a) => a.title.toLowerCase().includes(target!.replace(/^check-?up$/, 'checkup')));
      if (hit) return hit;
    }
    const active = this.activeAppointmentId ? this.appointments().find((a) => a.id === this.activeAppointmentId && !a.done) : undefined;
    if (active) return active;
    return upcoming[0];
  }

  /** Pick the date for a clause: explicit > same message > conversation > today/tomorrow. */
  dayFor(explicit: DateHit | undefined, time?: ClockTime, useContext = true): { day: Date; explicit: boolean } {
    const given = explicit ?? this.parsed.messageDate;
    if (given) return { day: given.date, explicit: true };

    const ctxDay = useContext && this.ctx.lastDate ? parseYmd(this.ctx.lastDate) : undefined;
    if (ctxDay && ctxDay.getTime() >= this.today.getTime() && (!time || combine(ctxDay, time) > this.now)) {
      this.notes.push(`I used ${fmtDayLabel(ctxDay, this.now).toLowerCase()} because that's the day we've been planning.`);
      return { day: ctxDay, explicit: false };
    }
    if (!time || combine(this.today, time) > this.now) {
      if (time) this.notes.push('You didn\'t mention a day, so I assumed today.');
      return { day: this.today, explicit: false };
    }
    this.notes.push(`${fmtTime(combine(this.today, time))} has already passed today, so I used tomorrow.`);
    return { day: addDays(this.today, 1), explicit: false };
  }

  assertFuture(start: Date): void {
    if (start.getTime() < this.now.getTime()) {
      throw new PlannerError(
        'PAST_TIME',
        `${capitalize(fmtWhen(start, this.now))} has already passed. Could you give me a later time or a different day?`,
      );
    }
  }

  busy(day: Date): Interval[] {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = dayStart + 24 * 60 * MS_MIN;
    return this.scheduleItems()
      .filter((s) => !s.done && (s.kind === 'appointment' || s.kind === 'work' || s.kind === 'task' || s.kind === 'preparation' || s.kind === 'action'))
      .map((s) => {
        const start = new Date(s.start).getTime();
        const end = s.end ? new Date(s.end).getTime() : start + (s.kind === 'action' ? 15 : 30) * MS_MIN;
        return { start, end };
      })
      .filter((i) => i.start < dayEnd && i.end > dayStart);
  }

  /* ---- entity factories ------------------------------------------- */

  private clamp(t: Date): Date {
    const { at, moved } = clampFuture(t, this.now);
    if (moved) this.movedToNow = true;
    return at;
  }

  addSchedule(item: Omit<ScheduleItem, 'id' | 'done' | 'planId'>): ScheduleItem {
    const entry: ScheduleItem = { ...item, id: this.id('sch'), done: false, planId: this.planId };
    this.created.schedule.push(entry);
    this.lastDay = startOfDay(new Date(entry.start));
    return entry;
  }

  addTask(t: Omit<Task, 'id' | 'done' | 'planId' | 'createdAt'>): Task {
    const task: Task = { ...t, id: this.id('task'), done: false, planId: this.planId, createdAt: this.now.toISOString() };
    this.created.tasks.push(task);
    return task;
  }

  addReminder(r: Omit<Reminder, 'id' | 'status' | 'planId'>, detail?: string): Reminder {
    const reminder: Reminder = { ...r, id: this.id('rem'), status: 'active', planId: this.planId };
    this.created.reminders.push(reminder);
    this.addSchedule({
      kind: 'reminder',
      title: reminder.title,
      detail,
      start: reminder.at,
      category: this.categoryOfReminder(reminder),
      refType: 'reminder',
      refId: reminder.id,
      appointmentId: reminder.appointmentId,
      role: reminder.role,
    });
    return reminder;
  }

  private categoryOfReminder(r: Reminder): Category {
    const appt = r.appointmentId ? this.appointments().find((a) => a.id === r.appointmentId) : undefined;
    const task = r.taskId ? this.created.tasks.find((t) => t.id === r.taskId) : undefined;
    return appt?.category ?? task?.category ?? 'Personal';
  }

  /* ---- appointments ------------------------------------------------ */

  /** Create an appointment plus its arrival action, preparation tasks and reminders. */
  bundleAppointment(draft: AppointmentDraft, preps: TaskDraft[], brings: ReminderDraft[], extraBuffer?: number): Appointment | undefined {
    const time = draft.time!;
    const { day, explicit } = this.dayFor(draft.date, time);
    let start = combine(day, time);
    if (start < this.now && !explicit) start = addDays(start, 1);
    this.assertFuture(start);
    const end = draft.endTime ? combine(day, draft.endTime) : undefined;

    const duplicate = this.appointments().find((a) => !a.done && a.title === draft.title && a.start === start.toISOString());
    if (duplicate) {
      this.activeAppointmentId = duplicate.id;
      this.lastDay = startOfDay(start);
      this.narration.push(`Your ${duplicate.title} ${fmtWhen(start, this.now)} is already on your schedule, so I didn't add it twice.`);
      this.used.push(`Matched your existing ${duplicate.title}`);
      this.addExtras(duplicate, preps, brings);
      return duplicate;
    }

    const needsArrival = draft.profile !== 'generic' || draft.buffer !== undefined || extraBuffer !== undefined;
    const explicitBuffer = draft.buffer?.minutes ?? extraBuffer;
    const prefBuffer = this.ctx.preferences.arrivalBufferMin;
    const bufferMin = needsArrival ? explicitBuffer ?? prefBuffer ?? DEFAULT_ARRIVAL[draft.profile] ?? 15 : 0;
    const defaultedBuffer = needsArrival && explicitBuffer === undefined;

    const appt: Appointment = {
      id: this.id('appt'),
      title: draft.title,
      start: start.toISOString(),
      end: end?.toISOString(),
      category: draft.category,
      bufferMin,
      done: false,
      planId: this.planId,
    };
    this.created.appointments.push(appt);
    this.activeAppointmentId = appt.id;

    const layout = layoutFor(appt);
    this.addSchedule({
      kind: 'appointment',
      title: appt.title,
      start: appt.start,
      end: appt.end,
      category: appt.category,
      refType: 'appointment',
      refId: appt.id,
      appointmentId: appt.id,
    });

    if (bufferMin > 0) this.addArrival(appt, layout);
    const narrationMark = this.narration.length;
    this.addExtras(appt, preps, brings);
    const extraNarration = this.narration.splice(narrationMark);

    // A "getReady" reminder is the default nudge when there is no prep task to remind about.
    const hasPrepReminder = this.created.reminders.some((r) => r.appointmentId === appt.id && r.role === 'prepReminder');
    if (!hasPrepReminder) {
      const at = this.clamp(layout.getReady);
      this.addReminder(
        {
          title: bufferMin > 0 ? `Get ready for your ${lcFirst(appt.title)}` : `${appt.title} starts in 15 minutes`,
          at: at.toISOString(),
          appointmentId: appt.id,
          role: 'getReady',
        },
        `For your ${lcFirst(appt.title)}`,
      );
    }

    const arrivalText = bufferMin > 0 ? ` I'll have you there by ${fmtTime(layout.arrival)} (${bufferMin} min early).` : '';
    const remindAt = this.created.reminders.find((r) => r.appointmentId === appt.id && (r.role === 'prepReminder' || r.role === 'getReady'));
    this.narration.push(
      `Done — ${appt.title} is set for ${fmtWhen(start, this.now)}.${arrivalText}${remindAt ? ` I'll remind you at ${fmtTime(remindAt.at)}.` : ''}`,
      ...extraNarration,
    );
    if (defaultedBuffer && bufferMin > 0 && prefBuffer === undefined) {
      this.notes.push(`I assumed you'd like to arrive ${bufferMin} minutes early. Say "arrive 30 minutes early" and I'll adjust.`);
    }
    if (defaultedBuffer && prefBuffer !== undefined) {
      this.used.push(`Used your usual ${prefBuffer}-minute arrival buffer`);
    }
    return appt;
  }

  private addArrival(appt: Appointment, layout: ApptLayout): void {
    const at = this.clamp(layout.arrival);
    this.addSchedule({
      kind: 'action',
      title: 'Leave & arrive early',
      detail: `Be there by ${fmtTime(layout.arrival)} (${appt.bufferMin} min early)`,
      start: at.toISOString(),
      category: appt.category,
      appointmentId: appt.id,
      role: 'arrival',
    });
  }

  /** Preparation tasks and "bring this" reminders for an appointment (new or existing). */
  addExtras(appt: Appointment, preps: TaskDraft[], brings: ReminderDraft[]): void {
    const layout = layoutFor(appt);

    preps.forEach((p, i) => {
      const dueAt = this.clamp(layout.prepReminder);
      const startAt = this.clamp(layout.prepStart);
      const task = this.addTask({
        title: p.title,
        category: appt.category,
        priority: appt.category === 'Health' ? 'high' : p.priority,
        due: dueAt.toISOString(),
        appointmentId: appt.id,
        role: 'prep',
      });
      this.addSchedule({
        kind: 'preparation',
        title: p.title,
        detail: `Finish by ${fmtTime(dueAt)}`,
        start: startAt.toISOString(),
        end: dueAt.toISOString(),
        category: appt.category,
        refType: 'task',
        refId: task.id,
        appointmentId: appt.id,
        role: 'prep',
      });
      if (i === 0) {
        const existing = [...this.snap.reminders, ...this.created.reminders].some(
          (r) => r.appointmentId === appt.id && r.role === 'prepReminder' && r.status === 'active',
        );
        if (!existing) {
          this.addReminder(
            {
              title: `Prepare for ${lcFirst(appt.title)}`,
              at: dueAt.toISOString(),
              taskId: task.id,
              appointmentId: appt.id,
              role: 'prepReminder',
            },
            `Linked to: ${task.title}`,
          );
        }
      }
    });
    if (preps.length) {
      this.narration.push(
        `${joinList(preps.map((p) => p.title))} ${preps.length === 1 ? 'is' : 'are'} scheduled for ${fmtTime(layout.prepStart)} so you're ready before you leave.`,
      );
    }

    for (const b of brings) this.addBring(appt, b);
  }

  addBring(appt: Appointment, draft: ReminderDraft): void {
    const layout = layoutFor(appt);
    const duplicate = [...this.snap.reminders, ...this.created.reminders].find(
      (r) => r.appointmentId === appt.id && r.status === 'active' && r.title.toLowerCase() === draft.title.toLowerCase(),
    );
    if (duplicate) {
      this.narration.push(`You already have a reminder to ${lcFirst(draft.title)} for your ${lcFirst(appt.title)}.`);
      return;
    }

    let at = layout.bring;
    let role: DerivedRole | undefined = 'bring';
    if (draft.offsetMin !== undefined) {
      at = addMinutes(new Date(appt.start), -draft.offsetMin);
      role = undefined;
    } else if (draft.time) {
      const day = draft.date?.date ?? startOfDay(new Date(appt.start));
      at = combine(day, draft.time);
      role = undefined;
    }
    at = this.clamp(at);

    const task = this.addTask({
      title: draft.taskTitle,
      category: appt.category,
      priority: 'high',
      due: at.toISOString(),
      appointmentId: appt.id,
      role,
    });
    this.addReminder(
      { title: draft.title, at: at.toISOString(), taskId: task.id, appointmentId: appt.id, role },
      `Linked to: ${task.title}`,
    );
    this.narration.push(`I'll remind you at ${fmtTime(at)} to ${lcFirst(draft.title)} — linked to your ${lcFirst(appt.title)} ${fmtWhen(new Date(appt.start), this.now)}.`);
  }

  /** Re-time every derived item after the appointment start or buffer changed. */
  retime(oldAppt: Appointment, next: Appointment): number {
    this.updated.appointments.push(next);
    const layout = layoutFor(next);
    let shifted = 0;
    const startShift = new Date(next.start).getTime() - new Date(oldAppt.start).getTime();

    for (const s of this.snap.schedule) {
      if (s.refType === 'appointment' && s.refId === oldAppt.id) {
        this.updated.schedule.push({
          ...s,
          start: next.start,
          end: next.end ?? (s.end ? new Date(new Date(s.end).getTime() + startShift).toISOString() : undefined),
        });
        continue;
      }
      if (s.appointmentId !== oldAppt.id || !s.role) continue;
      const when = timeForRole(s.role, layout);
      const start = this.clamp(when.start);
      this.updated.schedule.push({
        ...s,
        start: start.toISOString(),
        end: when.end ? this.clamp(when.end).toISOString() : s.end,
        detail: s.role === 'arrival' ? `Be there by ${fmtTime(layout.arrival)} (${next.bufferMin} min early)` : s.role === 'prep' ? `Finish by ${fmtTime(layout.prepReminder)}` : s.detail,
      });
      shifted += 1;
    }
    for (const t of this.snap.tasks) {
      if (t.appointmentId !== oldAppt.id || !t.role) continue;
      const when = timeForRole(t.role, layout);
      const due = this.clamp(t.role === 'prep' ? when.end ?? when.start : when.start);
      this.updated.tasks.push({ ...t, due: due.toISOString() });
    }
    for (const r of this.snap.reminders) {
      if (r.appointmentId !== oldAppt.id || !r.role) continue;
      const when = timeForRole(r.role, layout);
      this.updated.reminders.push({ ...r, at: this.clamp(when.start).toISOString() });
    }
    this.lastDay = startOfDay(new Date(next.start));
    return shifted;
  }

  /* ---- work blocks & tasks ----------------------------------------- */

  addWork(draft: WorkDraft): ScheduleItem {
    const { day, explicit } = this.dayFor(draft.date, draft.startTime);
    let start = combine(day, draft.startTime);
    let end = combine(day, draft.endTime);
    if (end.getTime() <= this.now.getTime()) {
      if (explicit) this.assertFuture(end);
      start = addDays(start, 1);
      end = addDays(end, 1);
    }
    const item = this.addSchedule({
      kind: 'work',
      title: draft.title,
      detail: `${fmtTime(start)} – ${fmtTime(end)}`,
      start: start.toISOString(),
      end: end.toISOString(),
      category: 'Work',
    });
    const remindAt = addMinutes(start, -30);
    if (remindAt.getTime() > this.now.getTime() + MS_MIN) {
      this.addReminder({ title: `${draft.title} starts at ${fmtTime(start)}`, at: remindAt.toISOString() }, 'Heads-up before your work block');
    }
    return item;
  }

  workOn(day: Date): { start: Date; end: Date } | undefined {
    const w = this.scheduleItems().find((s) => s.kind === 'work' && !s.done && s.end && startOfDay(new Date(s.start)).getTime() === day.getTime());
    return w ? { start: new Date(w.start), end: new Date(w.end!) } : undefined;
  }

  /** Place exercise / errands in a sensible free slot around the day's fixed commitments. */
  addFlexible(draft: TaskDraft): Task {
    const prefs: Preferences = { ...this.ctx.preferences, ...this.parsed.preferences };
    let day: Date;
    if (draft.time) {
      const resolved = this.dayFor(draft.date, draft.time);
      day = resolved.day;
      let start = combine(day, draft.time);
      if (start < this.now && !resolved.explicit) start = addDays(start, 1);
      this.assertFuture(start);
      return this.scheduleTask(draft, start, draft.durationMin ?? (draft.flavor === 'exercise' ? 30 : 45));
    }
    day = this.dayFor(draft.date).day;
    const work = this.workOn(day);
    const duration = draft.durationMin ?? (draft.flavor === 'exercise' ? 30 : /grocer/i.test(draft.title) ? 60 : 45);
    let preferred: Date;

    if (draft.flavor === 'exercise') {
      const pref = draft.part ?? prefs.exerciseTime;
      if (pref === 'morning') preferred = atTime(day, 7, 0);
      else if (pref === 'evening') preferred = work ? addMinutes(work.end, 30) : atTime(day, 18, 30);
      else if (work && work.start.getHours() >= 9) preferred = addMinutes(work.start, -(60 + duration));
      else if (work) preferred = addMinutes(work.end, 30);
      else preferred = atTime(day, 18, 0);
    } else {
      preferred = draft.part === 'morning' ? atTime(day, 9, 0) : work ? addMinutes(work.end, 30) : atTime(day, 17, 30);
    }

    const start = findFreeSlot(day, preferred, duration, this.busy(day), this.now);
    return this.scheduleTask(draft, start, duration);
  }

  private scheduleTask(draft: TaskDraft, start: Date, duration: number): Task {
    const end = addMinutes(start, duration);
    const task = this.addTask({
      title: draft.title,
      category: draft.category,
      priority: draft.priority,
      due: end.toISOString(),
      durationMin: duration,
    });
    this.addSchedule({
      kind: 'task',
      title: draft.title,
      detail: `${fmtDuration(duration)} · ${draft.category}`,
      start: start.toISOString(),
      end: end.toISOString(),
      category: draft.category,
      refType: 'task',
      refId: task.id,
    });
    const remindAt = addMinutes(start, draft.flavor === 'exercise' ? -10 : -15);
    if (remindAt.getTime() > this.now.getTime() + MS_MIN) {
      this.addReminder({ title: `${draft.title} at ${fmtTime(start)}`, at: remindAt.toISOString(), taskId: task.id }, `Linked to: ${task.title}`);
    }
    return task;
  }

  /** A plain to-do. Gets a due date only when the user mentioned one. */
  addPlainTask(draft: TaskDraft): void {
    const explicitDay = draft.date ?? this.parsed.messageDate;
    if (draft.time) {
      const resolved = this.dayFor(draft.date, draft.time);
      let start = combine(resolved.day, draft.time);
      if (start < this.now && !resolved.explicit) start = addDays(start, 1);
      this.assertFuture(start);
      this.scheduleTask(draft, start, draft.durationMin ?? 30);
      this.narration.push(`${draft.title} is on your plan for ${fmtWhen(start, this.now)}.`);
      return;
    }
    const task = this.addTask({
      title: draft.title,
      category: draft.category,
      priority: draft.priority,
      due: explicitDay ? explicitDay.date.toISOString() : undefined,
      dueAllDay: explicitDay ? true : undefined,
      durationMin: draft.durationMin,
    });
    if (explicitDay) this.lastDay = explicitDay.date;
    this.narration.push(
      explicitDay
        ? `Added "${task.title}" to your tasks for ${fmtDayLabel(explicitDay.date, this.now).toLowerCase()}.`
        : `Added "${task.title}" to your tasks.`,
    );
  }

  addStandaloneReminder(draft: ReminderDraft, at: Date): void {
    const task = this.addTask({
      title: draft.taskTitle,
      category: draft.category,
      priority: 'medium',
      due: at.toISOString(),
    });
    this.addReminder({ title: draft.title, at: at.toISOString(), taskId: task.id }, `Linked to: ${task.title}`);
    this.narration.push(`Okay — I'll remind you ${fmtWhen(at, this.now)}: ${lcFirst(draft.title)}.`);
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export interface LocalPlannerOptions {
  /** Custom id generator (tests use a deterministic one). */
  idGen?: (prefix: string) => string;
}

export class LocalPlannerProvider implements PlannerProvider {
  readonly id = 'local';
  readonly name = 'Local planner';
  private readonly ids: (prefix: string) => string;

  constructor(options: LocalPlannerOptions = {}) {
    this.ids = options.idGen ?? defaultId;
  }

  async status(): Promise<ProviderStatus> {
    return {
      id: this.id,
      name: this.name,
      description: 'Deterministic rule-based planner that runs entirely in your browser. No API keys, no network.',
      available: true,
      requiresCredentials: false,
    };
  }

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    return this.planSync(input);
  }

  planSync(input: PlannerInput): PlannerOutput {
    const raw = input.message ?? '';
    if (!raw.trim()) {
      throw new PlannerError('EMPTY_MESSAGE', 'Type a request first, for example "I have a doctor appointment tomorrow at 3 PM".');
    }
    if (raw.length > 1000) {
      throw new PlannerError('TOO_LONG', 'That message is quite long. Please keep requests under 1,000 characters, or split them into a few messages.');
    }

    const now = input.now;
    const ctx: ConversationContext = {
      ...input.context,
      preferences: { ...input.context.preferences },
      turn: input.context.turn + 1,
    };
    let parsed = extractMessage(raw, now);

    /* ---- pending clarification (the assistant asked a question last turn) ---- */
    if (ctx.pending && /^\s*(never ?mind|cancel|skip|forget it|stop|no thanks?)\b/i.test(input.message)) {
      ctx.pending = undefined;
      return this.assemble(new Turn(now, ctx, input.snapshot, parsed, this.ids), input, ctx, 'smalltalk', 'No problem — I dropped that.', undefined, STARTER_PROMPTS.slice(2));
    }
    if (ctx.pending) {
      const actionable =
        parsed.appointments.length + parsed.works.length + parsed.tasks.length + parsed.reminders.length > 0 ||
        parsed.reschedule || parsed.query || parsed.smalltalk || parsed.bufferClause || parsed.appointmentWithoutTime || parsed.workWithoutHours;
      if (!actionable) {
        const answered = this.completePending(parsed.text, ctx, now);
        if (answered) parsed = answered;
        else {
          return this.finish(
            new Turn(now, ctx, input.snapshot, parsed, this.ids),
            input,
            ctx,
            'clarify',
            ctx.pending.question,
            [],
          );
        }
      }
      ctx.pending = undefined;
    }

    const turn = new Turn(now, ctx, input.snapshot, parsed, this.ids);
    ctx.preferences = { ...ctx.preferences, ...parsed.preferences };

    /* ---- non-planning intents ---------------------------------------------- */
    if (parsed.smalltalk) return this.smalltalk(turn, input, ctx, parsed.smalltalk);
    if (parsed.query) return this.query(turn, input, ctx);
    if (parsed.reschedule) return this.reschedule(turn, input, ctx);
    if (parsed.bufferClause && parsed.appointments.length === 0) {
      const out = this.changeBuffer(turn, input, ctx);
      if (out) return out;
    }

    /* ---- planning ---------------------------------------------------------- */
    return this.planClauses(turn, input, ctx);
  }

  /* ---- pending answers ---------------------------------------------------- */

  private completePending(text: string, ctx: ConversationContext, now: Date): ParsedMessage | undefined {
    const pending = ctx.pending!;
    const part = findPartOfDay(text);
    const times = findTimes(text, part);
    const date = findDate(text, now);
    const out = emptyParsed(text);
    out.messageDate = date;
    const pendingDate: DateHit | undefined = pending.dateISO ? { date: parseYmd(pending.dateISO), index: 0, end: 0 } : undefined;

    if (pending.kind === 'work-hours') {
      const range = findRange(text, part, true);
      if (!range) return undefined;
      out.works.push({
        title: pending.title,
        date: date ?? pendingDate,
        startTime: { hours: range.startHours, minutes: range.startMinutes },
        endTime: { hours: range.endHours, minutes: range.endMinutes },
      });
      return out;
    }
    if (times.length === 0) return undefined;
    const time: ClockTime = { hours: times[0].hours, minutes: times[0].minutes };
    if (pending.kind === 'appointment-time') {
      out.appointments.push({
        title: pending.title,
        category: pending.category ?? 'Personal',
        profile: pending.category === 'Health' ? 'health' : 'generic',
        date: date ?? pendingDate,
        time,
        clause: 0,
      });
      return out;
    }
    out.reminders.push({
      title: pending.title,
      taskTitle: pending.title.replace(/\byour\s+/gi, ''),
      date: date ?? pendingDate,
      time,
      apptRelated: Boolean(pending.appointmentId),
      bring: false,
      category: pending.category ?? 'Personal',
      clause: 0,
    });
    return out;
  }

  /* ---- planning ------------------------------------------------------------ */

  private planClauses(turn: Turn, input: PlannerInput, ctx: ConversationContext): PlannerOutput {
    const { parsed } = turn;
    const nearest = (clause: number, list: AppointmentDraft[]): AppointmentDraft | undefined => {
      const before = list.filter((a) => a.clause <= clause);
      return before.length ? before[before.length - 1] : list[0];
    };

    // Which statements belong to an appointment created in this very message?
    const prepsFor = new Map<AppointmentDraft, TaskDraft[]>();
    const bringsFor = new Map<AppointmentDraft, ReminderDraft[]>();
    const orphanPreps: TaskDraft[] = [];
    const orphanBrings: ReminderDraft[] = [];
    const plainTasks: TaskDraft[] = [];
    const flexibleTasks: TaskDraft[] = [];

    for (const task of parsed.tasks) {
      if (task.flavor === 'prep' || task.flavor === 'bring') {
        const target = parsed.appointments.length ? nearest(task.clause, parsed.appointments) : undefined;
        if (target) {
          if (task.flavor === 'prep') prepsFor.set(target, [...(prepsFor.get(target) ?? []), task]);
          else bringsFor.set(target, [...(bringsFor.get(target) ?? []), this.bringFromTask(task)]);
        } else if (task.apptHint) {
          if (task.flavor === 'prep') orphanPreps.push(task);
          else orphanBrings.push(this.bringFromTask(task));
        } else {
          plainTasks.push(task);
        }
      } else if (task.flavor === 'exercise' || task.flavor === 'errand') flexibleTasks.push(task);
      else plainTasks.push(task);
    }

    const standaloneReminders: ReminderDraft[] = [];
    for (const r of parsed.reminders) {
      const target = r.apptRelated && parsed.appointments.length ? nearest(r.clause, parsed.appointments) : undefined;
      if (target) bringsFor.set(target, [...(bringsFor.get(target) ?? []), r]);
      else if (r.apptRelated) orphanBrings.push(r);
      else standaloneReminders.push(r);
    }

    // 1. Appointments (with their prep + bring items)
    for (const draft of parsed.appointments) {
      turn.bundleAppointment(draft, prepsFor.get(draft) ?? [], bringsFor.get(draft) ?? [], parsed.bufferClause ? parsed.buffer?.minutes : undefined);
    }

    // 2. Statements about an appointment from earlier in the conversation
    if (orphanPreps.length || orphanBrings.length) {
      const appt = turn.resolveAppointment();
      if (appt) {
        turn.used.push(`Linked to your ${appt.title} (${fmtWhen(new Date(appt.start), turn.now)})`);
        const anchors = turn.scheduleItems().filter((s) => s.appointmentId === appt.id && (s.refType === 'appointment' || s.role === 'arrival'));
        turn.anchors.push(...anchors.filter((a) => !turn.anchors.includes(a)));
        turn.activeAppointmentId = appt.id;
        turn.addExtras(appt, orphanPreps, orphanBrings);
      } else {
        // Nothing to link to: keep them as ordinary items so nothing is lost.
        plainTasks.push(...orphanPreps);
        for (const b of orphanBrings) {
          if (b.time || b.date) standaloneReminders.push(b);
          else this.askReminderTime(turn, b);
        }
        if (orphanBrings.length || orphanPreps.length) {
          turn.notes.push("I don't have an appointment to attach that to yet.");
        }
      }
    }

    // 3. Work blocks, then flexible tasks (so they can fit around work)
    for (const w of parsed.works) {
      const item = turn.addWork(w);
      turn.narration.push(
        `${w.title} is blocked ${fmtDayLabel(new Date(item.start), turn.now).toLowerCase()} from ${fmtTime(item.start)} to ${fmtTime(item.end!)}.`,
      );
    }
    for (const t of flexibleTasks) {
      const task = turn.addFlexible(t);
      const slot = turn.created.schedule.find((s) => s.refId === task.id)!;
      const work = turn.workOn(startOfDay(new Date(slot.start)));
      const relation = work
        ? new Date(slot.end ?? slot.start).getTime() <= work.start.getTime()
          ? ', before work'
          : new Date(slot.start).getTime() >= work.end.getTime()
            ? ', after work'
            : ''
        : '';
      turn.narration.push(`${task.title} fits at ${fmtTime(slot.start)}${relation}.`);
    }
    for (const t of plainTasks) turn.addPlainTask(t);

    // 4. Standalone reminders
    for (const r of standaloneReminders) {
      if (r.time || r.date) {
        const resolved = turn.dayFor(r.date, r.time, false);
        const time = r.time ?? { hours: 9, minutes: 0 };
        let at = combine(resolved.day, time);
        if (at < turn.now && !resolved.explicit) at = addDays(at, 1);
        turn.assertFuture(at);
        turn.addStandaloneReminder(r, at);
      } else {
        this.askReminderTime(turn, r);
      }
    }

    if (parsed.workWithoutHours) {
      const { title, date } = parsed.workWithoutHours;
      const when = date ? fmtDayLabel(date.date, turn.now).toLowerCase() : 'that day';
      ctx.pending = {
        kind: 'work-hours',
        title,
        dateISO: date ? ymd(date.date) : undefined,
        question: `What hours will you be working ${when}? For example, "10 AM to 6 PM".`,
      };
    }
    if (parsed.appointmentWithoutTime) {
      const { title, category, date } = parsed.appointmentWithoutTime;
      const when = date ? fmtDayLabel(date.date, turn.now).toLowerCase() : 'then';
      ctx.pending = {
        kind: 'appointment-time',
        title,
        category,
        dateISO: date ? ymd(date.date) : undefined,
        question: `What time is your ${lcFirst(title)} ${when}? For example, "3 PM".`,
      };
    }

    const createdSomething =
      turn.created.appointments.length + turn.created.tasks.length + turn.created.reminders.length + turn.created.schedule.length > 0;

    if (!createdSomething && ctx.pending) {
      return this.finish(turn, input, ctx, 'clarify', ctx.pending.question, []);
    }
    if (!createdSomething && turn.narration.length === 0) {
      const noted = this.preferenceNote(parsed);
      if (noted) return this.assemble(turn, input, ctx, 'smalltalk', noted, undefined, STARTER_PROMPTS);
      return this.helpReply(turn, input, ctx, parsed.unhandled);
    }
    if (ctx.pending) turn.narration.push(ctx.pending.question);
    return this.finish(turn, input, ctx, turn.used.length ? 'followup' : 'plan', undefined, parsed.unhandled);
  }

  /** Acknowledge a stated preference that didn't create anything by itself. */
  private preferenceNote(parsed: ParsedMessage): string | undefined {
    const { arrivalBufferMin, exerciseTime } = parsed.preferences;
    const notes: string[] = [];
    if (arrivalBufferMin) notes.push(`I'll plan to arrive ${arrivalBufferMin} minutes early for appointments`);
    if (exerciseTime) notes.push(`I'll schedule exercise in the ${exerciseTime} when I can`);
    return notes.length ? `Noted — ${notes.join(', and ')}. Tell me about your next appointment or day and I'll use that.` : undefined;
  }

  private bringFromTask(task: TaskDraft): ReminderDraft {
    return {
      title: capitalize(task.title.replace(/\b(?:my|our)\b/gi, 'your')),
      taskTitle: task.title,
      date: task.date,
      time: task.time,
      apptRelated: true,
      bring: true,
      category: task.category,
      clause: task.clause,
    };
  }

  private askReminderTime(turn: Turn, r: ReminderDraft): void {
    turn.ctx.pending = {
      kind: 'reminder-time',
      title: r.title,
      category: r.category,
      dateISO: r.date ? ymd(r.date.date) : undefined,
      question: `When should I remind you to ${lcFirst(r.title.replace(/\byour\b/gi, 'your'))}? For example, "at 5 PM" or "tomorrow at 9 AM".`,
    };
  }

  /* ---- reschedule / buffer ------------------------------------------------ */

  private reschedule(turn: Turn, input: PlannerInput, ctx: ConversationContext): PlannerOutput {
    const draft = turn.parsed.reschedule!;
    const appt = turn.resolveAppointment(draft.target);
    if (!appt) {
      return this.finish(turn, input, ctx, 'clarify', "I don't have an appointment to move yet. Tell me about one first, for example \"I have a dentist appointment tomorrow at 4 PM\".", []);
    }
    const old = new Date(appt.start);
    let next: Date;
    if (draft.deltaMin !== undefined) next = addMinutes(old, draft.deltaMin);
    else {
      const day = draft.date?.date ?? startOfDay(old);
      next = combine(day, draft.time ?? { hours: old.getHours(), minutes: old.getMinutes() });
    }
    turn.assertFuture(next);
    if (next.getTime() === old.getTime()) {
      return this.finish(turn, input, ctx, 'followup', `Your ${appt.title} is already at ${fmtTime(old)} ${fmtDayLabel(old, turn.now).toLowerCase()}, so nothing changed.`, []);
    }
    const shift = next.getTime() - old.getTime();
    const moved: Appointment = {
      ...appt,
      start: next.toISOString(),
      end: appt.end ? new Date(new Date(appt.end).getTime() + shift).toISOString() : undefined,
    };
    const count = turn.retime(appt, moved);
    turn.activeAppointmentId = appt.id;
    turn.used.push(`Resolved "it" to your ${appt.title}`);
    turn.narration.push(
      `Moved your ${appt.title} from ${fmtTime(old)} to ${fmtWhen(next, turn.now)}.` +
        (count ? ` I shifted ${plural(count, 'related step')} to match.` : ''),
    );
    return this.finish(turn, input, ctx, 'reschedule', undefined, []);
  }

  private changeBuffer(turn: Turn, input: PlannerInput, ctx: ConversationContext): PlannerOutput | undefined {
    const appt = turn.resolveAppointment();
    if (!appt) return undefined;
    const minutes = turn.parsed.buffer?.minutes ?? (appt.bufferMin > 0 ? appt.bufferMin : 15);
    const next: Appointment = { ...appt, bufferMin: minutes };
    const count = turn.retime(appt, next);
    const layout = layoutFor(next);
    if (!turn.scheduleItems().some((s) => s.appointmentId === appt.id && s.role === 'arrival')) {
      turn.addSchedule({
        kind: 'action',
        title: 'Leave & arrive early',
        detail: `Be there by ${fmtTime(layout.arrival)} (${minutes} min early)`,
        start: layout.arrival.toISOString(),
        category: appt.category,
        appointmentId: appt.id,
        role: 'arrival',
      });
    }
    turn.activeAppointmentId = appt.id;
    turn.used.push(`Applied to your ${appt.title}`);
    turn.narration.push(
      `Got it — you'll arrive ${minutes} minutes early for your ${lcFirst(appt.title)}, so aim to be there by ${fmtTime(layout.arrival)}.` +
        (count ? ` I shifted ${plural(count, 'related step')}.` : ''),
    );
    return this.finish(turn, input, ctx, 'reschedule', undefined, []);
  }

  /* ---- query / small talk / help ------------------------------------------- */

  private query(turn: Turn, input: PlannerInput, ctx: ConversationContext): PlannerOutput {
    const q = turn.parsed.query!;
    const items = sortSchedule(turn.scheduleItems().filter((s) => !s.done));
    let list: ScheduleItem[];
    let reply: string;

    if (q.next) {
      list = items.filter((s) => new Date(s.start).getTime() >= turn.now.getTime()).slice(0, 4);
      reply = list.length
        ? `Next up: ${list[0].title} ${fmtWhen(new Date(list[0].start), turn.now)}.`
        : 'Nothing is coming up. Tell me what you have planned and I\'ll organize it.';
    } else {
      const day = q.date?.date ?? (turn.ctx.lastDate && !/\btoday\b/i.test(turn.parsed.text) ? parseYmd(turn.ctx.lastDate) : turn.today);
      const label = fmtDayLabel(day, turn.now).toLowerCase();
      list = items.filter((s) => startOfDay(new Date(s.start)).getTime() === startOfDay(day).getTime());
      const primary = list.filter((s) => s.kind !== 'reminder');
      const reminders = list.length - primary.length;
      if (primary.length) {
        const shown = primary.slice(0, 4).map((s) => `${lcFirst(s.title)} at ${fmtTime(s.start)}`);
        const more = primary.length > 4 ? `, plus ${primary.length - 4} more` : '';
        reply = `${capitalize(label)} you have ${joinList(shown)}${more}${reminders ? `, with ${plural(reminders, 'reminder')} to keep you on track` : ''}.`;
      } else if (list.length) {
        reply = `${capitalize(label)} you have ${plural(reminders, 'reminder')} set.`;
      } else {
        reply = `Nothing is scheduled for ${label} yet. Tell me what's on and I'll plan it.`;
      }
      turn.lastDay = day;
    }

    const card: PlanCard | undefined = list.length
      ? {
          id: turn.planId,
          heading: 'YOUR DAY',
          summary: `${plural(list.length, 'item')} on your schedule.`,
          items: list.map((s) => this.cardItem(s)),
        }
      : undefined;
    return this.assemble(turn, input, ctx, 'query', reply, card, this.suggestionsFor(turn, 'query'));
  }

  private smalltalk(turn: Turn, input: PlannerInput, ctx: ConversationContext, kind: 'greeting' | 'thanks' | 'help'): PlannerOutput {
    const reply =
      kind === 'greeting'
        ? "Hi, I'm LifePilot — a simulated assistant demo. Tell me what's coming up in plain language and I'll turn it into a coordinated plan with reminders, preparation and tasks."
        : kind === 'thanks'
          ? 'Anytime. Want me to adjust something or add another reminder?'
          : "I turn requests into plans. I can schedule appointments with an arrival buffer and preparation, block out work hours, fit tasks like exercise or errands around your day, set reminders, and handle follow-ups like \"also remind me to bring my ID card\" or \"move it to 4 PM\".";
    return this.assemble(turn, input, ctx, kind === 'help' ? 'help' : 'smalltalk', reply, undefined, STARTER_PROMPTS);
  }

  private helpReply(turn: Turn, input: PlannerInput, ctx: ConversationContext, unhandled: string[]): PlannerOutput {
    const snippet = unhandled[0] ? ` I couldn't turn "${unhandled[0].slice(0, 80)}" into an action yet.` : " I couldn't turn that into an action yet.";
    return this.assemble(
      turn,
      input,
      ctx,
      'help',
      `${snippet.trim()} I can plan appointments (with arrival buffers and prep), work blocks, tasks and reminders. Try one of these:`,
      undefined,
      STARTER_PROMPTS,
    );
  }

  /* ---- output assembly -------------------------------------------------------- */

  private cardItem(s: ScheduleItem, flags: Partial<PlanCardItem> = {}): PlanCardItem {
    return { id: s.id, at: s.start, endAt: s.end, kind: s.kind, title: s.title, detail: s.detail, ...flags };
  }

  private finish(
    turn: Turn,
    input: PlannerInput,
    ctx: ConversationContext,
    intent: Intent,
    replyOverride: string | undefined,
    unhandled: string[],
  ): PlannerOutput {
    const newItems = sortSchedule(turn.created.schedule);
    const changed = sortSchedule(turn.updated.schedule);
    const hasChange = changed.length > 0 || (intent === 'reschedule' && turn.updated.appointments.length > 0);

    let heading: PlanHeading = 'PLAN CREATED';
    const createdPrimary = turn.created.appointments.length + turn.created.schedule.filter((s) => s.kind === 'work' || s.kind === 'task').length;
    if (hasChange && newItems.length === 0) heading = 'PLAN UPDATED';
    else if (!createdPrimary && newItems.length > 0 && newItems.every((s) => s.kind === 'reminder')) heading = 'REMINDER ADDED';

    const items: PlanCardItem[] = [
      ...turn.anchors.map((s) => this.cardItem(s, { existing: true })),
      ...newItems.map((s) => this.cardItem(s)),
      ...changed.map((s) => this.cardItem(s, { changed: true })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || KIND_RANK[a.kind] - KIND_RANK[b.kind]);

    let card: PlanCard | undefined;
    if (items.length && (newItems.length > 0 || hasChange)) {
      card = { id: turn.planId, heading, summary: this.summary(turn, intent), items };
    }

    const body = replyOverride ?? turn.narration.join(' ');
    const notes = replyOverride ? [] : turn.notes;
    const parts = [body, ...notes];
    if (!replyOverride && unhandled.length) {
      parts.push(`I wasn't sure what to do with "${unhandled[0].slice(0, 70)}", so I left it out.`);
    }
    return this.assemble(turn, input, ctx, intent, parts.filter(Boolean).join(' '), card, this.suggestionsFor(turn, intent));
  }

  private summary(turn: Turn, intent: Intent): string {
    const c = turn.created;
    if (intent === 'reschedule' && c.schedule.length === 0) {
      const n = turn.updated.schedule.length;
      return `I moved ${plural(n, 'item')} to keep everything in sync.`;
    }
    const appts = c.appointments.length;
    const works = c.schedule.filter((s) => s.kind === 'work').length;
    const preps = c.tasks.filter((t) => t.role === 'prep').length;
    const arrivals = c.schedule.filter((s) => s.role === 'arrival').length;
    const tasks = c.tasks.filter((t) => t.role !== 'prep' && t.role !== 'bring').length;
    const reminders = c.reminders.length;
    const parts = [
      appts ? plural(appts, 'appointment') : '',
      works ? plural(works, 'work block') : '',
      preps ? plural(preps, 'preparation task') : '',
      arrivals ? plural(arrivals, 'arrival action') : '',
      tasks ? plural(tasks, 'task') : '',
      reminders ? plural(reminders, 'reminder') : '',
    ].filter(Boolean);
    return parts.length ? `I organized ${joinList(parts)}.` : 'Nothing new was added.';
  }

  private suggestionsFor(turn: Turn, intent: Intent): string[] {
    const pending = turn.ctx.pending;
    if (pending) {
      return pending.kind === 'work-hours'
        ? ['9 AM to 5 PM', '10 AM to 6 PM']
        : pending.kind === 'appointment-time'
          ? ['10 AM', '3 PM', '5:30 PM']
          : ['at 7 PM', 'tomorrow at 9 AM'];
    }
    if (intent === 'clarify') return [];
    if (intent === 'query') {
      const day = turn.lastDay ? fmtDayLabel(turn.lastDay, turn.now).toLowerCase() : 'tomorrow';
      return ["What's next?", 'Also remind me to call mom at 7 PM', `I have a dentist appointment ${day} at 5 PM`];
    }
    const appt = turn.activeAppointmentId ? turn.appointments().find((a) => a.id === turn.activeAppointmentId) : undefined;
    const dayWord = turn.lastDay ? fmtDayLabel(turn.lastDay, turn.now).toLowerCase() : 'tomorrow';
    const out: string[] = [];
    const hasBring = [...turn.snap.reminders, ...turn.created.reminders].some((r) => r.appointmentId === appt?.id && r.role === 'bring');
    if (appt) {
      if (!hasBring) out.push('Also remind me to bring my ID card');
      const hasPrep = [...turn.snap.tasks, ...turn.created.tasks].some((t) => t.appointmentId === appt.id && t.role === 'prep');
      if (!hasPrep) out.push('I also need to prepare my documents before leaving');
      if (turn.parsed.reschedule) out.push('Arrive 45 minutes early');
      else if (turn.parsed.bufferClause) out.push('Move it to 5 PM');
      else out.push('Move it to 4 PM');
    }
    if (turn.created.schedule.some((s) => s.kind === 'work')) out.push('Also remind me to call mom at 7 PM');
    out.push(dayWord === 'today' ? "What's on today?" : `What's on ${dayWord}?`);
    return [...new Set(out)].slice(0, 4);
  }

  private assemble(
    turn: Turn,
    input: PlannerInput,
    ctx: ConversationContext,
    intent: Intent,
    reply: string,
    card: PlanCard | undefined,
    suggestions: string[],
  ): PlannerOutput {
    void input;
    const next: ConversationContext = {
      ...ctx,
      activeAppointmentId: turn.activeAppointmentId,
      lastPlanId: card ? turn.planId : ctx.lastPlanId,
      lastDate: turn.lastDay ? ymd(turn.lastDay) : ctx.lastDate,
      lastIntent: intent,
    };
    // Entities that were both created and later updated in one turn keep their created copy.
    const createdIds = new Set([
      ...turn.created.appointments.map((a) => a.id),
      ...turn.created.tasks.map((t) => t.id),
      ...turn.created.reminders.map((r) => r.id),
      ...turn.created.schedule.map((s) => s.id),
    ]);
    const dedupe = <T extends { id: string }>(list: T[]): T[] => {
      const seen = new Map<string, T>();
      for (const item of list) seen.set(item.id, item);
      return [...seen.values()].filter((i) => !createdIds.has(i.id));
    };
    const upserts: Upserts = {
      appointments: [...turn.created.appointments, ...dedupe(turn.updated.appointments)],
      tasks: [...turn.created.tasks, ...dedupe(turn.updated.tasks)],
      reminders: [...turn.created.reminders, ...dedupe(turn.updated.reminders)],
      schedule: [...turn.created.schedule, ...dedupe(turn.updated.schedule)],
    };
    const note = turn.used.length ? turn.used.join(' · ') : undefined;
    const withMovedNote = turn.movedToNow
      ? `${reply} Some steps would have landed in the past, so I scheduled them for right now.`
      : reply;
    return { reply: withMovedNote, intent, card, upserts, context: next, suggestions, contextNote: note };
  }
}

const STARTER_PROMPTS = [
  'I have a doctor appointment tomorrow at 3 PM. I need to arrive 30 minutes early. I also need to prepare my documents before leaving.',
  'Tomorrow I work from 10 AM to 6 PM. I need 30 minutes of exercise and I need to buy groceries.',
  "What's on tomorrow?",
];
