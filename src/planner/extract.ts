/**
 * Message understanding for the local planner.
 *
 * `extractMessage` splits a message into clauses and turns each into a typed draft
 * (appointment, work block, task, reminder, ...). It performs no side effects and never
 * creates entities - the provider does that after all clauses are understood, so a
 * statement like "arrive 30 minutes early" can apply to an appointment mentioned earlier
 * or later in the same message.
 */
import type { Category, Preferences, Priority } from '../types';
import { PlannerError } from './PlannerProvider';
import {
  findArrivalBuffer,
  findDate,
  findDuration,
  findPartOfDay,
  findRange,
  findTimes,
  type BufferHit,
  type DateHit,
  type PartOfDay,
  type TimeHit,
} from './parse';

export interface ClockTime {
  hours: number;
  minutes: number;
}

export type AppointmentProfile = 'health' | 'interview' | 'flight' | 'exam' | 'generic';

export interface AppointmentDraft {
  title: string;
  category: Category;
  profile: AppointmentProfile;
  date?: DateHit;
  time?: ClockTime;
  endTime?: ClockTime;
  buffer?: BufferHit;
  /** Index of the clause, so supporting statements can attach to the nearest appointment. */
  clause: number;
}

export interface WorkDraft {
  title: string;
  date?: DateHit;
  startTime: ClockTime;
  endTime: ClockTime;
}

export type TaskFlavor = 'generic' | 'exercise' | 'errand' | 'bring' | 'prep';

export interface TaskDraft {
  title: string;
  category: Category;
  priority: Priority;
  flavor: TaskFlavor;
  durationMin?: number;
  date?: DateHit;
  time?: ClockTime;
  /** Preferred part of day for flexible tasks (e.g. "exercise in the evening"). */
  part?: PartOfDay;
  /** The wording ties this task to an appointment ("before leaving", document-like objects). */
  apptHint?: boolean;
  clause: number;
}

export interface ReminderDraft {
  /** Shown to the user: "Bring your ID card". */
  title: string;
  /** Used for the linked task: "Bring ID card". */
  taskTitle: string;
  date?: DateHit;
  time?: ClockTime;
  /** "30 minutes before" (relative to the appointment start). */
  offsetMin?: number;
  /** The user referred to an appointment, or the item is something you bring to one. */
  apptRelated: boolean;
  bring: boolean;
  category: Category;
  clause: number;
}

export interface RescheduleDraft {
  date?: DateHit;
  time?: ClockTime;
  deltaMin?: number;
  /** Words naming the appointment ("doctor", "dentist", ...). */
  target: string;
}

export interface ParsedMessage {
  text: string;
  messageDate?: DateHit;
  part?: PartOfDay;
  appointments: AppointmentDraft[];
  works: WorkDraft[];
  tasks: TaskDraft[];
  reminders: ReminderDraft[];
  buffer?: BufferHit;
  bufferClause: boolean;
  reschedule?: RescheduleDraft;
  query?: { date?: DateHit; next: boolean };
  smalltalk?: 'greeting' | 'thanks' | 'help';
  preferences: Preferences;
  /** Work clause with no hours, e.g. "I work tomorrow". */
  workWithoutHours?: { title: string; date?: DateHit };
  /** Appointment clause with a date but no time. */
  appointmentWithoutTime?: { title: string; category: Category; date?: DateHit };
  unhandled: string[];
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

export function capitalize(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

const minus = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Remove date and time expressions (and dangling prepositions) from a phrase. */
export function removeTemporal(text: string, now: Date): string {
  const cuts: Array<[number, number]> = [];
  const date = findDate(text, now);
  if (date) cuts.push([date.index, date.end]);
  const range = findRange(text, undefined, false);
  if (range) cuts.push([range.index, range.end]);
  for (const t of findTimes(text)) cuts.push([t.index, t.end]);
  let out = text;
  for (const [s, e] of cuts.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + ' ' + out.slice(e);
  out = out
    .replace(/\b(?:at|on|by|around|from|for|until|till|before)\s*(?=$|[,.!?]|\b(?:at|on|by)\b)/gi, ' ')
    .replace(/\b(?:at|on|by)\s+(?=$)/gi, ' ');
  return minus(out).replace(/^[,.\s]+|[,.\s]+$/g, '');
}

const toYour = (s: string) => s.replace(/\bmy\b/gi, 'your').replace(/\bmyself\b/gi, 'yourself');
const dropPossessive = (s: string) => s.replace(/\b(?:my|our|your)\s+/gi, '');

const TRAILING_CONTEXT =
  /\s*(?:,\s*)?\b(?:before (?:i )?(?:leave|leaving|go|going|head(?:ing)? out|the (?:appointment|meeting|visit))|beforehand|first|for (?:it|that|the (?:appointment|meeting|visit)|my (?:appointment|meeting|visit))|about (?:it|that)|when i leave|as well|too)\b.*$/i;

/* ------------------------------------------------------------------ */
/* Classification vocabulary                                           */
/* ------------------------------------------------------------------ */

const HEALTH_MAP: Array<[RegExp, string]> = [
  [/\b(?:doctor|dr)\b/i, 'Doctor appointment'],
  [/\bdentist\b/i, 'Dentist appointment'],
  [/\bdental\b/i, 'Dental appointment'],
  [/\b(?:physio|physiotherapy|physiotherapist)\b/i, 'Physiotherapy appointment'],
  [/\borthodontist\b/i, 'Orthodontist appointment'],
  [/\bdermatologist\b/i, 'Dermatologist appointment'],
  [/\bcardiologist\b/i, 'Cardiologist appointment'],
  [/\boptometrist\b/i, 'Optometrist appointment'],
  [/\btherapist\b/i, 'Therapy session'],
  [/\bvet\b/i, 'Vet appointment'],
  [/\b(?:surgeon|specialist)\b/i, 'Specialist appointment'],
  [/\b(?:check-?up)\b/i, 'Health checkup'],
  [/\bconsultation\b/i, 'Consultation'],
  [/\b(?:blood test|lab test)\b/i, 'Lab test'],
  [/\b(?:vaccination|vaccine)\b/i, 'Vaccination'],
  [/\b(?:clinic|hospital)\b/i, 'Clinic visit'],
];

const EVENT_MAP: Array<[RegExp, string, AppointmentProfile, Category]> = [
  [/\binterview\b/i, 'Interview', 'interview', 'Work'],
  [/\bflight\b/i, 'Flight', 'flight', 'Personal'],
  [/\bexam\b/i, 'Exam', 'exam', 'Personal'],
  [/\bpresentation\b/i, 'Presentation', 'generic', 'Work'],
  [/\bmeeting\b/i, 'Meeting', 'generic', 'Work'],
  [/\b(?:lunch)\b/i, 'Lunch', 'generic', 'Personal'],
  [/\b(?:dinner)\b/i, 'Dinner', 'generic', 'Personal'],
  [/\bhaircut\b/i, 'Haircut', 'generic', 'Personal'],
  [/\bclass\b/i, 'Class', 'generic', 'Personal'],
  [/\btraining\b/i, 'Training', 'generic', 'Work'],
  [/\bsession\b/i, 'Session', 'generic', 'Personal'],
  [/\bcall\b/i, 'Call', 'generic', 'Work'],
  [/\bvisit\b/i, 'Visit', 'generic', 'Personal'],
  [/\bappointment\b/i, 'Appointment', 'generic', 'Personal'],
];

const NOUN_LEAD = String.raw`(?:a|an|my|the|our|another|that|this)\s+(?:[\w'-]+\s+){0,2}`;
const HAVE_RE = /\b(?:have(?!\s+to\b)|got|has|scheduled|booked|seeing|see|visiting|attending|there'?s|there is|set up|fixed|arranged|go(?:ing)? to|am at)\b/i;
const BRING_VERBS = /\b(?:bring|carry|take|pack|grab|remember|don'?t forget)\b/i;
const BRING_OBJECTS = /\b(?:id|id card|passport|documents?|papers?|reports?|insurance|wallet|keys?|card|prescription|referral|license|licence|forms?|charger|laptop|files?|certificate|medicines?|lens(?:es)?)\b/i;
const APPT_HINT = /\bbefore (?:i )?(?:leave|leaving|go|going|head(?:ing)? out|the (?:appointment|meeting|visit))\b|\bfor (?:it|that|the (?:appointment|meeting|visit)|my (?:appointment|meeting|visit))\b|\bwhen i leave\b/i;
const WORK_RE = /\b(work|working|shift|office|study|studying)\b/i;

function appointmentTitleFor(clause: string): { title: string; category: Category; profile: AppointmentProfile } | undefined {
  const withName = /\b(meeting|call|lunch|dinner|interview|session)\s+with\s+([A-Za-z][\w'.-]*(?:\s+[A-Z][\w'.-]*)?)/i.exec(clause);
  const name = withName ? withName[2].replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;

  for (const [re, label] of HEALTH_MAP) {
    if (re.test(clause) && (new RegExp(NOUN_LEAD + re.source.replace(/^\\b|\\b$/g, ''), 'i').test(clause) || /\bappointment|visit|seeing|see|go(?:ing)? to\b/i.test(clause))) {
      return { title: label, category: 'Health', profile: 'health' };
    }
  }
  for (const [re, label, profile, category] of EVENT_MAP) {
    if (!re.test(clause)) continue;
    // Require noun usage ("a meeting", "my call") so "I have to call mom" is not an appointment.
    const nounUse = new RegExp(NOUN_LEAD + re.source.replace(/^\\b|\\b$/g, ''), 'i').test(clause) || /\b(?:meeting|interview|flight|exam|lunch|dinner|haircut|appointment)\b/i.test(clause);
    if (!nounUse) continue;
    const title = name && /^(Meeting|Call|Lunch|Dinner|Interview|Session)$/.test(label) ? `${label} with ${name}` : label;
    return { title, category, profile };
  }
  return undefined;
}

function categoryFor(text: string): Category {
  const t = text.toLowerCase();
  if (/\b(exercise|workout|work out|gym|run|jog|walk|yoga|stretch|swim|cycle|cycling)\b/.test(t)) return 'Fitness';
  if (/\b(buy|groceries|grocery|shop|shopping|pick up|pickup|store|pharmacy|market|order|return)\b/.test(t)) return 'Errands';
  if (/\b(doctor|medicine|medication|pills|prescription|appointment|clinic|hospital|dentist|insurance|lab)\b/.test(t)) return 'Health';
  if (/\b(email|report|submit|presentation|invoice|client|slides|deadline|meeting|proposal|review)\b/.test(t)) return 'Work';
  if (/\b(clean|laundry|cook|dishes|water|plants|vacuum|tidy|trash|garbage|repair|fix)\b/.test(t)) return 'Home';
  return 'Personal';
}

function priorityFor(text: string, category: Category): Priority {
  if (/\b(urgent|asap|important|critical|immediately|must)\b/i.test(text)) return 'high';
  if (/\b(sometime|whenever|maybe|if i can|eventually|someday)\b/i.test(text)) return 'low';
  if (category === 'Health') return 'high';
  return 'medium';
}

/* ------------------------------------------------------------------ */
/* Clause handlers                                                     */
/* ------------------------------------------------------------------ */

const FILLER_LEAD = /^(?:(?:and|also|then|okay|ok|so|please|actually|oh|um|well)\s*,?\s+)+/i;

function splitClauses(raw: string): string[] {
  const sentences = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  const joiner = /\s*,?\s+and\s+(?=(?:i\s+(?:also\s+)?(?:need|have|want|should|must|gotta|got|will|am|'m)\b|also\b|then\b|remind\b|don'?t forget\b))|\s*,\s+(?=then\b)/i;
  return sentences.flatMap((s) => s.split(joiner)).map((s) => s.trim()).filter(Boolean);
}

function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\b([ap])\.m\b\.?/gi, '$1m')
    .replace(/\bDr\.\s*/g, 'Dr ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripWakeWord(raw: string): string {
  return raw.replace(/^\s*(?:(?:hey|ok|okay|hi)[\s,]+)?(?:alexa|lifepilot)\b[\s,:;-]*/i, '');
}

function toClock(t: TimeHit | undefined): ClockTime | undefined {
  return t ? { hours: t.hours, minutes: t.minutes } : undefined;
}

function detectSmalltalk(text: string): ParsedMessage['smalltalk'] {
  const t = text.trim().toLowerCase().replace(/[!.?]+$/g, '');
  if (!t) return 'greeting';
  if (t.length <= 40 && /^(hi|hello|hey|yo|namaste|good (morning|afternoon|evening)|hi there|hello there)\b/.test(t)) return 'greeting';
  if (t.length <= 40 && /^(thanks|thank you|thx|ty|great|awesome|perfect|cool|nice|got it|ok thanks)\b/.test(t)) return 'thanks';
  if (t.length <= 60 && /\b(help|what can you do|how does this work|what do you do|examples?)\b/.test(t)) return 'help';
  return undefined;
}

export function emptyParsed(text: string): ParsedMessage {
  return {
    text,
    appointments: [],
    works: [],
    tasks: [],
    reminders: [],
    bufferClause: false,
    preferences: {},
    unhandled: [],
  };
}

export function extractMessage(raw: string, now: Date): ParsedMessage {
  const cleaned = stripWakeWord(raw);
  const text = normalize(cleaned.replace(/\n+/g, ' \n '));
  const parsed = emptyParsed(text);

  parsed.smalltalk = detectSmalltalk(text);
  if (parsed.smalltalk) return parsed;

  parsed.messageDate = findDate(text, now);
  parsed.part = findPartOfDay(text);

  // Query: "what's on tomorrow", "show my schedule", "what's next"
  if (/^(?:what(?:'s| is| do i have| have i got| am i doing)|show(?: me)?|list|read|how(?:'s| is)|do i have|am i free)\b/i.test(text)) {
    const next = /\b(?:what'?s|what is)\s+(?:up\s+)?next\b/i.test(text);
    if (next || /\b(on|today|tomorrow|tonight|schedule|agenda|plan|day|week|calendar|tasks?|reminders?|do i have|up next|free)\b/i.test(text)) {
      parsed.query = { date: parsed.messageDate, next };
      return parsed;
    }
  }

  const clauses = splitClauses(cleaned).map(normalize);
  clauses.forEach((original, clause) => {
    const c = original.replace(FILLER_LEAD, '').trim();
    if (!c) return;
    const part = findPartOfDay(c) ?? parsed.part;
    const date = findDate(c, now);
    const times = findTimes(c, part);

    /* ---- reschedule ------------------------------------------------ */
    const resched = /^(?:(?:can|could|would) you\s+)?(move|push|shift|reschedule|postpone|delay|change|make|set|update)\b/i.exec(c);
    const arrivalOnly = findArrivalBuffer(c);
    if (resched && !arrivalOnly) {
      const mentionsTarget = /\b(it|that|appointment|meeting|visit|doctor|dentist|interview|flight|call|lunch|dinner|session|class|exam|checkup|check-up|consultation|surgery)\b/i.exec(c);
      const range = findRange(c, part);
      const hasWhen = date || times.length > 0 || range;
      const durationMin = findDuration(c);
      if (mentionsTarget && (hasWhen || durationMin)) {
        const draft: RescheduleDraft = { target: mentionsTarget[1].toLowerCase() };
        if (hasWhen) {
          draft.date = date;
          draft.time = toClock(times[0]) ?? (range ? { hours: range.startHours, minutes: range.startMinutes } : undefined);
        } else if (durationMin) {
          const earlier = /\b(earlier|forward|sooner|ahead|before)\b/i.test(c);
          draft.deltaMin = earlier ? -durationMin : durationMin;
        }
        parsed.reschedule = draft;
        return;
      }
    }

    /* ---- reminder -------------------------------------------------- */
    if (/\b(remind me|set (?:a )?reminder|reminder (?:to|for|about))\b/i.test(c)) {
      const m = /\b(?:remind me|set (?:a )?reminder|reminder)\s*(?:to|about|that|for)?\s*(.*)$/i.exec(c);
      const body = m ? m[1] : '';
      const offset = /(\d+)\s*(minutes?|mins?|hours?|hrs?)\s+before\b/i.exec(c);
      const offsetMin = offset ? Number(offset[1]) * (/^h/i.test(offset[2]) ? 60 : 1) : undefined;
      let title = removeTemporal(body.replace(/(\d+)\s*(?:minutes?|mins?|hours?|hrs?)\s+before(?:\s+(?:it|the (?:appointment|meeting|visit)|then))?/i, ''), now);
      const apptWords = /\b(?:appointment|meeting|visit|before (?:i )?(?:leave|leaving|go|going|head(?:ing)? out)|when i leave|for (?:it|that))\b/i.test(c);
      title = title.replace(TRAILING_CONTEXT, '').replace(/^(?:to|about|that)\s+/i, '').trim();
      if (!title) {
        parsed.unhandled.push(original);
        return;
      }
      const bring = BRING_VERBS.test(title) || BRING_OBJECTS.test(title);
      parsed.reminders.push({
        title: capitalize(toYour(title)),
        taskTitle: capitalize(dropPossessive(title)),
        date,
        time: toClock(times[0]),
        offsetMin,
        apptRelated: apptWords || bring,
        bring,
        category: categoryFor(title),
        clause,
      });
      return;
    }

    /* ---- arrival buffer on its own --------------------------------- */
    const apptInfo = HAVE_RE.test(c) || /\bappointment\b/i.test(c) ? appointmentTitleFor(c) : undefined;
    if (arrivalOnly && !apptInfo) {
      parsed.buffer = arrivalOnly;
      parsed.bufferClause = true;
      return;
    }

    /* ---- preparation ------------------------------------------------ */
    const prep = /^(?:(?:i\s+)?(?:also\s+)?(?:(?:need|have|want|should|must|gotta|got|will|'ll)\s+(?:to\s+)?)?)(prepare|prep|gather|collect|pack|organi[sz]e|print)\s+(.+)$/i.exec(c);
    const prepAlt = /^(?:i\s+)?(?:also\s+)?(?:(?:need|have|want|should|must|gotta|got)\s+(?:to\s+)?)?get\s+(?:my\s+|the\s+)?(.+?)\s+ready\b/i.exec(c);
    if (!apptInfo && (prep || prepAlt)) {
      let title: string;
      if (prep) {
        const verb = prep[1].toLowerCase().replace(/^prep$/, 'prepare');
        const object = dropPossessive(removeTemporal(prep[2].replace(TRAILING_CONTEXT, ''), now)).trim();
        title = `${capitalize(verb.replace(/ise$/, 'ize'))} ${object}`.trim();
      } else {
        const object = dropPossessive(prepAlt![1]).trim();
        title = `Prepare ${object}`;
      }
      parsed.tasks.push({
        title,
        category: categoryFor(title),
        priority: priorityFor(c, categoryFor(title)),
        flavor: 'prep',
        date,
        time: toClock(times[0]),
        apptHint: APPT_HINT.test(c) || BRING_OBJECTS.test(title),
        clause,
      });
      return;
    }

    /* ---- work block ------------------------------------------------- */
    const workMatch = WORK_RE.exec(c);
    if (workMatch && !apptInfo && /\b(i|i'm|i am|i'll|i will|we|my)\b/i.test(c)) {
      const range = findRange(c, part, true);
      const label = workMatch[1].toLowerCase();
      const title = /^stud/.test(label) ? 'Study session' : label === 'shift' ? 'Shift' : label === 'office' ? 'Office' : 'Work';
      if (range) {
        parsed.works.push({
          title,
          date,
          startTime: { hours: range.startHours, minutes: range.startMinutes },
          endTime: { hours: range.endHours, minutes: range.endMinutes },
        });
        return;
      }
      if (!BRING_VERBS.test(c) && !/\b(need|have) to\b/i.test(c)) {
        parsed.workWithoutHours = { title, date };
        return;
      }
    }

    /* ---- appointment ------------------------------------------------ */
    if (apptInfo && (date || times.length > 0 || findRange(c, part) || parsed.messageDate || HAVE_RE.test(c))) {
      const range = findRange(c, part);
      const startTime = toClock(times[0]) ?? (range ? { hours: range.startHours, minutes: range.startMinutes } : undefined);
      if (!startTime) {
        parsed.appointmentWithoutTime = { title: apptInfo.title, category: apptInfo.category, date: date ?? parsed.messageDate };
        return;
      }
      parsed.appointments.push({
        title: apptInfo.title,
        category: apptInfo.category,
        profile: apptInfo.profile,
        date,
        time: startTime,
        endTime: range ? { hours: range.endHours, minutes: range.endMinutes } : undefined,
        buffer: arrivalOnly,
        clause,
      });
      return;
    }

    /* ---- stated preferences ("I prefer to exercise in the evening") ---- */
    const exercisePref = /\b(?:prefer|like|usually|always|love)\b.*\b(?:exercise|work out|workout|gym|run|jog|walk|yoga)\b.*\b(morning|evening)\b/i.exec(c);
    if (exercisePref && !/\b(?:need|have|got) to\b/i.test(c)) {
      parsed.preferences.exerciseTime = exercisePref[1].toLowerCase() as 'morning' | 'evening';
      return;
    }

    /* ---- exercise with a duration ---------------------------------- */
    const exercise = /\b(\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)|half an hour|an hour)\s+(?:of\s+)?(exercise|exercising|workout|working out|gym|yoga|running|jogging|walking|cardio|stretching|swimming|cycling)\b/i.exec(c)
      ?? /\b(exercise|workout|work out|gym|yoga|run|jog|walk|cardio|swim)\b.*?\bfor\s+(\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)|half an hour|an hour)\b/i.exec(c);
    if (exercise || /\b(?:need|want|should|have|gotta|must)\s+(?:to\s+)?(?:exercise|work out|workout|go to the gym|do yoga|go for a (?:run|walk|jog))\b/i.test(c)) {
      const durationMin = findDuration(c) ?? 30;
      const preferWords = /\b(prefer|usually|always|like to|i like)\b/i.test(c);
      const exPart = /\bmorning\b/i.test(c) ? 'morning' : /\b(evening|night|after work)\b/i.test(c) ? 'evening' : undefined;
      if (exPart && preferWords) parsed.preferences.exerciseTime = exPart;
      parsed.tasks.push({
        title: `Exercise (${durationMin >= 60 && durationMin % 60 === 0 ? `${durationMin / 60} hr` : `${durationMin} min`})`,
        category: 'Fitness',
        priority: 'medium',
        flavor: 'exercise',
        durationMin,
        date,
        time: toClock(times[0]),
        part: exPart,
        clause,
      });
      return;
    }

    /* ---- generic tasks ---------------------------------------------- */
    const task =
      /^(?:i\s+)?(?:also\s+)?(?:(?:need|have|want|should|must|gotta|got|ought)\s+to|don'?t forget to|remember to|(?:i'?ll|i will|let me))\s+(.+)$/i.exec(c) ??
      /^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+)?(?:to-?do|tasks?|list)\b/i.exec(c);
    if (task) {
      const stripped = task[1].replace(TRAILING_CONTEXT, '');
      const body = removeTemporal(stripped, now);
      if (body) {
        const title = capitalize(dropPossessive(body));
        const category = categoryFor(body);
        const bring = BRING_VERBS.test(body) && (BRING_OBJECTS.test(body) || /\b(bring|carry)\b/i.test(body));
        const errand = category === 'Errands';
        parsed.tasks.push({
          title,
          category,
          priority: priorityFor(c, category),
          flavor: bring ? 'bring' : errand ? 'errand' : 'generic',
          durationMin: findDuration(body),
          date,
          time: toClock(times[0]),
          apptHint: bring || APPT_HINT.test(c),
          clause,
        });
        return;
      }
    }

    parsed.unhandled.push(original);
  });

  parsed.buffer ??= parsed.appointments.find((a) => a.buffer)?.buffer;
  const explicit = parsed.buffer?.minutes;
  if (explicit !== undefined) parsed.preferences.arrivalBufferMin = explicit;
  return parsed;
}

export { PlannerError };
