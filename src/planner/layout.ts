/** Time-layout rules: how supporting steps are placed around an appointment or in free time. */
import { MS_MIN, addMinutes, atTime } from '../lib/time';

export interface ApptLayout {
  arrival: Date;
  prepStart: Date;
  prepReminder: Date;
  getReady: Date;
  bring: Date;
}

/**
 * Everything is anchored to the arrival time (appointment start minus the buffer):
 *   arrival - 60 min  preparation work begins
 *   arrival - 30 min  "prepare / get ready" reminder (also the prep deadline)
 *   arrival - 15 min  "bring this with you" reminders
 *   arrival           leave / arrive early
 */
export function layoutAppointment(start: Date, bufferMin: number): ApptLayout {
  const arrival = addMinutes(start, -bufferMin);
  return {
    arrival,
    prepStart: addMinutes(arrival, -60),
    prepReminder: addMinutes(arrival, -30),
    getReady: addMinutes(arrival, -30),
    bring: addMinutes(arrival, -15),
  };
}

/** Nothing the assistant creates should fire in the past. Pull it forward to "just after now". */
export function clampFuture(t: Date, now: Date): { at: Date; moved: boolean } {
  const floor = now.getTime() + MS_MIN;
  if (t.getTime() >= floor) return { at: t, moved: false };
  const at = new Date(now.getTime() + 2 * MS_MIN);
  at.setSeconds(0, 0);
  return { at, moved: true };
}

export interface Interval {
  start: number;
  end: number;
}

const QUARTER = 15 * MS_MIN;
const ceilToQuarter = (t: number) => Math.ceil(t / QUARTER) * QUARTER;

/**
 * Find a start time at or after `preferred` where `durationMin` fits between busy intervals.
 * Falls back to the first free gap earlier in the day, then to the preferred time.
 */
export function findFreeSlot(
  day: Date,
  preferred: Date,
  durationMin: number,
  busy: Interval[],
  notBefore: Date,
): Date {
  const dayStart = atTime(day, 6, 0).getTime();
  const dayEnd = atTime(day, 22, 30).getTime();
  const dur = durationMin * MS_MIN;
  const sorted = [...busy].sort((a, b) => a.start - b.start);

  const firstFreeFrom = (from: number): number | undefined => {
    let cand = ceilToQuarter(Math.max(from, dayStart, notBefore.getTime() + 5 * MS_MIN));
    for (let i = 0; i < 100; i += 1) {
      const clash = sorted.find((b) => cand < b.end && cand + dur > b.start);
      if (!clash) return cand + dur <= dayEnd ? cand : undefined;
      cand = ceilToQuarter(clash.end);
    }
    return undefined;
  };

  const forward = firstFreeFrom(preferred.getTime());
  if (forward !== undefined) return new Date(forward);
  const fromStart = firstFreeFrom(dayStart);
  if (fromStart !== undefined) return new Date(fromStart);
  return new Date(Math.max(preferred.getTime(), notBefore.getTime() + 5 * MS_MIN));
}
