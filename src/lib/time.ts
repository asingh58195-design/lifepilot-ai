/** Small, dependency-free date helpers. All math uses the *local* time zone. */

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const MS_MIN = 60_000;

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes());
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MS_MIN);
}

export function atTime(day: Date, hours: number, minutes = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Local calendar date as YYYY-MM-DD. */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

/** 3:00 PM */
export function fmtTime(value: Date | string): string {
  const d = toDate(value);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

export function fmtTimeRange(start: Date | string, end?: Date | string): string {
  return end ? `${fmtTime(start)} – ${fmtTime(end)}` : fmtTime(start);
}

/** Today / Tomorrow / Yesterday / Fri, Oct 9 */
export function fmtDayLabel(value: Date | string, now: Date): string {
  const d = toDate(value);
  const delta = diffDays(d, now);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  return fmtDate(d);
}

/** Fri, Oct 9 */
export function fmtDate(d: Date): string {
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export function fmtWeekdayLong(d: Date): string {
  return WEEKDAYS_LONG[d.getDay()];
}

/** "tomorrow at 3:00 PM" / "today at 3:00 PM" / "Fri, Oct 9 at 3:00 PM" */
export function fmtWhen(value: Date | string, now: Date): string {
  const d = toDate(value);
  const label = fmtDayLabel(d, now);
  return `${label === 'Today' || label === 'Tomorrow' || label === 'Yesterday' ? label.toLowerCase() : label} at ${fmtTime(d)}`;
}

export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Relative description such as "in 25 min" or "in 2 hr". */
export function fmtRelative(target: Date | string, now: Date): string {
  const diff = Math.round((toDate(target).getTime() - now.getTime()) / MS_MIN);
  if (diff <= 0) return 'now';
  if (diff < 60) return `in ${diff} min`;
  if (diff < 24 * 60) return `in ${Math.round(diff / 60)} hr`;
  return fmtDayLabel(target, now);
}
