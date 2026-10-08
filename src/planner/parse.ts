/**
 * Deterministic natural-language date / time / duration extraction.
 * Pure functions: the clock is always passed in, nothing reads global state.
 */
import { PlannerError } from './PlannerProvider';
import { addDays, atTime, startOfDay } from '../lib/time';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function monthIndex(token: string): number {
  const t = token.toLowerCase().slice(0, 3);
  return MONTH_NAMES.findIndex((m) => m.startsWith(t));
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface DateHit {
  date: Date;
  index: number;
  end: number;
  partOfDay?: PartOfDay;
}

export interface TimeHit {
  hours: number;
  minutes: number;
  index: number;
  end: number;
  /** True when the user wrote AM/PM, noon, midnight or a 24-hour time. */
  explicit: boolean;
}

export interface RangeHit {
  startHours: number;
  startMinutes: number;
  endHours: number;
  endMinutes: number;
  index: number;
  end: number;
}

export function findPartOfDay(text: string): PartOfDay | undefined {
  if (/\b(tonight|this evening|in the evening|evening|at night)\b/i.test(text)) return 'evening';
  if (/\b(this afternoon|in the afternoon|afternoon)\b/i.test(text)) return 'afternoon';
  if (/\b(this morning|in the morning|morning)\b/i.test(text)) return 'morning';
  return undefined;
}

function buildCalendarDate(year: number | undefined, month0: number, day: number, now: Date, raw: string): Date {
  const today = startOfDay(now);
  const probeYear = year ?? today.getFullYear();
  const candidate = new Date(probeYear, month0, day);
  const valid = candidate.getMonth() === month0 && candidate.getDate() === day && month0 >= 0 && month0 <= 11;
  if (!valid) {
    throw new PlannerError(
      'INVALID_DATE',
      `"${raw.trim()}" isn't a real calendar date. Could you give me the date again, for example "tomorrow" or "October 12"?`,
    );
  }
  if (year === undefined && candidate.getTime() < today.getTime()) {
    return new Date(probeYear + 1, month0, day);
  }
  return candidate;
}

/** Find the first date expression in `text`. Throws INVALID_DATE for impossible dates. */
export function findDate(text: string, now: Date): DateHit | undefined {
  const today = startOfDay(now);
  const part = findPartOfDay(text);
  let m: RegExpExecArray | null;

  // ISO 2026-10-12
  m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (m) {
    const date = buildCalendarDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), now, m[0]);
    return { date, index: m.index, end: m.index + m[0].length, partOfDay: part };
  }

  // October 12 / Oct 12th, 2026
  m = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(text);
  if (m) {
    const date = buildCalendarDate(m[3] ? Number(m[3]) : undefined, monthIndex(m[1]), Number(m[2]), now, m[0]);
    return { date, index: m.index, end: m.index + m[0].length, partOfDay: part };
  }

  // 12 October / 12th of Oct 2026
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, 'i').exec(text);
  if (m) {
    const date = buildCalendarDate(m[3] ? Number(m[3]) : undefined, monthIndex(m[2]), Number(m[1]), now, m[0]);
    return { date, index: m.index, end: m.index + m[0].length, partOfDay: part };
  }

  // 12/10 or 12/10/2026  (day/month, the convention used in India and the UK)
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (m) {
    let year: number | undefined;
    if (m[3]) year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = buildCalendarDate(year, Number(m[2]) - 1, Number(m[1]), now, m[0]);
    return { date, index: m.index, end: m.index + m[0].length, partOfDay: part };
  }

  m = /\bday after tomorrow\b/i.exec(text);
  if (m) return { date: addDays(today, 2), index: m.index, end: m.index + m[0].length, partOfDay: part };

  m = /\byesterday\b/i.exec(text);
  if (m) return { date: addDays(today, -1), index: m.index, end: m.index + m[0].length, partOfDay: part };

  m = /\b(tomorrow|tmrw|tmr)\b/i.exec(text);
  if (m) return { date: addDays(today, 1), index: m.index, end: m.index + m[0].length, partOfDay: part };

  m = /\b(today|tonight|this evening|this morning|this afternoon)\b/i.exec(text);
  if (m) return { date: today, index: m.index, end: m.index + m[0].length, partOfDay: part };

  m = /\bin\s+(\d{1,3})\s+days?\b/i.exec(text);
  if (m) return { date: addDays(today, Number(m[1])), index: m.index, end: m.index + m[0].length, partOfDay: part };

  m = new RegExp(`\\b(?:(next|this|on)\\s+)?(${WEEKDAY_NAMES.join('|')})\\b`, 'i').exec(text);
  if (m) {
    const target = WEEKDAY_NAMES.indexOf(m[2].toLowerCase());
    const qualifier = (m[1] ?? '').toLowerCase();
    let delta = (target - today.getDay() + 7) % 7;
    // Naming today's weekday means "a week from now" unless the user said "this <weekday>".
    if (delta === 0 && qualifier !== 'this') delta = 7;
    return { date: addDays(today, delta), index: m.index, end: m.index + m[0].length, partOfDay: part };
  }

  return undefined;
}

/** Convert a 12-hour clock value to 24 h when the user gave no AM/PM. */
export function inferHours(hour12: number, part?: PartOfDay): number {
  if (hour12 > 12) return hour12; // already 24-hour
  if (part === 'morning') return hour12 === 12 ? 0 : hour12;
  if (part === 'afternoon' || part === 'evening' || part === 'night') return hour12 === 12 ? 12 : hour12 + 12;
  if (hour12 >= 7 && hour12 <= 11) return hour12;
  if (hour12 === 12) return 12;
  if (hour12 === 0) return 0;
  return hour12 + 12; // 1-6 -> afternoon / evening
}

function to24(hour12: number, meridiem: 'am' | 'pm'): number {
  if (meridiem === 'am') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function badTime(raw: string): PlannerError {
  return new PlannerError(
    'INVALID_TIME',
    `"${raw.trim()}" isn't a valid time. Try something like "3 PM", "3:30 PM" or "15:30".`,
  );
}

function checkClock(hourText: string, minuteText: string | undefined, meridiem: string | undefined, raw: string): void {
  const h = Number(hourText);
  const min = minuteText === undefined ? 0 : Number(minuteText);
  if (min > 59) throw badTime(raw);
  if (meridiem) {
    if (h < 1 || h > 12) throw badTime(raw);
  } else if (h > 23) {
    throw badTime(raw);
  }
}

const overlaps = (hits: { index: number; end: number }[], index: number, end: number) =>
  hits.some((h) => index < h.end && end > h.index);

/** Every clock time mentioned in `text`, left to right. Throws INVALID_TIME for impossible ones. */
export function findTimes(text: string, part?: PartOfDay): TimeHit[] {
  const hits: TimeHit[] = [];
  let m: RegExpExecArray | null;

  const withMeridiem = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])/gi;
  while ((m = withMeridiem.exec(text))) {
    checkClock(m[1], m[2], 'm', m[0]);
    const mer = m[3].toLowerCase() === 'a' ? 'am' : 'pm';
    hits.push({
      hours: to24(Number(m[1]), mer),
      minutes: m[2] ? Number(m[2]) : 0,
      index: m.index,
      end: m.index + m[0].length,
      explicit: true,
    });
  }

  const colon = /\b(\d{1,2}):(\d{2})\b/g;
  while ((m = colon.exec(text))) {
    if (overlaps(hits, m.index, m.index + m[0].length)) continue;
    checkClock(m[1], m[2], undefined, m[0]);
    const h = Number(m[1]);
    hits.push({
      hours: h > 12 || h === 0 ? h : inferHours(h, part),
      minutes: Number(m[2]),
      index: m.index,
      end: m.index + m[0].length,
      explicit: h > 12 || h === 0,
    });
  }

  const words = /\b(noon|midday|midnight)\b/gi;
  while ((m = words.exec(text))) {
    hits.push({
      hours: m[1].toLowerCase() === 'midnight' ? 0 : 12,
      minutes: 0,
      index: m.index,
      end: m.index + m[0].length,
      explicit: true,
    });
  }

  const bare = /\bat\s+(\d{1,2})(?![\d:.])(?:\s*o'?clock)?(?!\s*(?:%|minutes?|mins?|hours?|hrs?|[ap]\.?m\b))/gi;
  while ((m = bare.exec(text))) {
    if (overlaps(hits, m.index, m.index + m[0].length)) continue;
    const h = Number(m[1]);
    if (h > 24 || h === 24) throw badTime(m[0]);
    hits.push({
      hours: h > 12 || h === 0 ? h : inferHours(h, part),
      minutes: 0,
      index: m.index,
      end: m.index + m[0].length,
      explicit: h > 12,
    });
  }

  return hits.sort((a, b) => a.index - b.index);
}

/** "from 10 AM to 6 PM", "9 to 5", "14:00-16:00". */
export function findRange(text: string, part?: PartOfDay, allowBare = false): RangeHit | undefined {
  const re = /\b(from\s+|between\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?\s*(?:to|until|till|through|and|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?(?![\d:])/i;
  const m = re.exec(text);
  if (!m) return undefined;

  const hasFrom = Boolean(m[1]);
  const hasMeridiem = Boolean(m[4] || m[7]);
  const hasColon = Boolean(m[3] || m[6]);
  // A bare "10-12" or "2026-10-07" is more likely a date or a number than a time range.
  if (!allowBare && !hasFrom && !hasMeridiem && !hasColon) return undefined;

  checkClock(m[2], m[3], m[4], m[0]);
  checkClock(m[5], m[6], m[7], m[0]);

  const h1 = Number(m[2]);
  const h2 = Number(m[5]);
  const min1 = m[3] ? Number(m[3]) : 0;
  const min2 = m[6] ? Number(m[6]) : 0;
  const mer1 = m[4] ? (m[4].toLowerCase() === 'a' ? 'am' : 'pm') : undefined;
  const mer2 = m[7] ? (m[7].toLowerCase() === 'a' ? 'am' : 'pm') : undefined;

  let start: number;
  let end: number;

  const candidatesFor = (h: number, minutes: number): number[] =>
    h > 12 || h === 0 ? [h * 60 + minutes] : [to24(h, 'am') * 60 + minutes, to24(h, 'pm') * 60 + minutes];

  if (mer1 && mer2) {
    start = to24(h1, mer1) * 60 + min1;
    end = to24(h2, mer2) * 60 + min2;
  } else if (mer2 && !mer1) {
    end = to24(h2, mer2) * 60 + min2;
    const options = candidatesFor(h1, min1).filter((v) => v < end);
    const same = to24(h1, mer2) * 60 + min1;
    start = same < end ? same : options.length ? options[options.length - 1] : same;
  } else if (mer1 && !mer2) {
    start = to24(h1, mer1) * 60 + min1;
    const options = candidatesFor(h2, min2).filter((v) => v > start);
    end = options.length ? options[0] : candidatesFor(h2, min2)[0];
  } else {
    start = (h1 > 12 || h1 === 0 ? h1 : inferHours(h1, part)) * 60 + min1;
    const options = candidatesFor(h2, min2).filter((v) => v > start);
    end = options.length ? options[0] : candidatesFor(h2, min2)[0];
  }

  if (end <= start) {
    throw new PlannerError(
      'INVALID_TIME',
      `"${m[0].trim()}" ends before it starts. Overnight blocks aren't supported yet, so please give a start and end on the same day.`,
    );
  }

  return {
    startHours: Math.floor(start / 60),
    startMinutes: start % 60,
    endHours: Math.floor(end / 60),
    endMinutes: end % 60,
    index: m.index,
    end: m.index + m[0].length,
  };
}

/** A duration such as "30 minutes", "1.5 hours", "half an hour". Returns minutes. */
export function findDuration(text: string): number | undefined {
  if (/\bhalf an? hour\b/i.test(text)) return 30;
  if (/\b(?:an|one|1) hour\b/i.test(text)) return 60;
  const m = /\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)\b/i.exec(text);
  if (!m) return undefined;
  const value = Number(m[1]);
  const minutes = /^h/i.test(m[2]) ? value * 60 : value;
  return Math.round(minutes);
}

export interface BufferHit {
  /** Minutes before the appointment, when a number was given. */
  minutes?: number;
}

/**
 * "arrive 30 minutes early", "get there an hour before", "arrive early".
 * Returns undefined when the clause isn't about arriving early.
 */
export function findArrivalBuffer(text: string): BufferHit | undefined {
  const aboutArriving = /\b(arrive|arriving|get there|be there|show up|get to|reach|be at)\b/i.test(text) || /\bearly\b/i.test(text);
  if (!aboutArriving) return undefined;

  const m = /\b(\d+(?:\.\d+)?|half an|an|one|a)\s*(minutes?|mins?|hours?|hrs?)\s+(?:early|ahead|before|prior)/i.exec(text);
  if (!m) {
    return /\bearly\b/i.test(text) ? {} : undefined;
  }
  const token = m[1].toLowerCase();
  const unitIsHour = /^h/i.test(m[2]);
  let value: number;
  if (token === 'half an') value = 0.5;
  else if (token === 'an' || token === 'one' || token === 'a') value = 1;
  else value = Number(token);
  const minutes = Math.round(value * (unitIsHour ? 60 : 1));
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 360) {
    throw new PlannerError(
      'INVALID_TIME',
      `I can't plan an arrival buffer of "${m[0].trim()}". Please choose between 1 minute and 6 hours.`,
    );
  }
  return { minutes };
}

/** Combine a date with a parsed time. */
export function combine(date: Date, time: { hours: number; minutes: number }): Date {
  return atTime(date, time.hours, time.minutes);
}
