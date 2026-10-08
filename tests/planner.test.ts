import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { LocalPlannerProvider, PlannerError } from '../src/planner';
import {
  applyPlannerOutput,
  emptyState,
  setReminderStatus,
  setTaskDone,
  toggleScheduleItem,
  userMessage,
} from '../src/store/state';
import type { AppState } from '../src/types';
import type { PlannerOutput } from '../src/planner';

// Wed 7 Oct 2026, 09:58 local. "Tomorrow" is therefore Thu 8 Oct 2026.
const NOW = new Date(2026, 9, 7, 9, 58);
let n = 0;
const planner = new LocalPlannerProvider({ idGen: (p) => `${p}_${++n}` });

async function say(state: AppState, message: string): Promise<{ state: AppState; out: PlannerOutput }> {
  const out = await planner.plan({ message, now: NOW, context: state.context, snapshot: state });
  return { state: applyPlannerOutput(state, userMessage(message, NOW), out, NOW), out };
}

const hm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const day = (iso: string) => new Date(iso).getDate();

const FULL = 'I have a doctor appointment tomorrow at 3 PM. I need to arrive 30 minutes early. I also need to prepare my documents before leaving.';

describe('doctor appointment scenario', () => {
  it('builds appointment, arrival action, prep task and reminder at the right times', async () => {
    const { state, out } = await say(emptyState(), FULL);
    assert.equal(out.card?.heading, 'PLAN CREATED');
    assert.equal(out.card?.summary, 'I organized 1 appointment, 1 preparation task, 1 arrival action, and 1 reminder.');

    const times = out.card!.items.map((i) => `${i.kind}@${hm(i.at)}:${i.title}`);
    assert.deepEqual(times, [
      'preparation@13:30:Prepare documents',
      'reminder@14:00:Prepare for doctor appointment',
      'action@14:30:Leave & arrive early',
      'appointment@15:00:Doctor appointment',
    ]);
    assert.ok(out.card!.items.every((i) => day(i.at) === 8), 'all items are tomorrow');

    assert.equal(state.appointments.length, 1);
    assert.equal(state.appointments[0].bufferMin, 30);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].title, 'Prepare documents');
    assert.equal(state.reminders.length, 1);
    assert.equal(state.reminders[0].taskId, state.tasks[0].id, 'reminder is linked to the prep task');
  });

  it('applies a default buffer and says so when none is given', async () => {
    const { out } = await say(emptyState(), 'I have a doctor appointment tomorrow at 3 PM.');
    assert.match(out.reply, /assumed you'd like to arrive 15 minutes early/);
    assert.equal(out.card?.summary, 'I organized 1 appointment, 1 arrival action, and 1 reminder.');
  });
});

describe('contextual follow-up', () => {
  it('adds an ID-card reminder linked to the earlier appointment (full message first)', async () => {
    let s = (await say(emptyState(), FULL)).state;
    const { state, out } = await say(s, 'Also remind me to carry my ID card.');
    s = state;
    assert.equal(out.intent, 'followup');
    assert.match(out.contextNote ?? '', /Doctor appointment/);
    assert.equal(s.appointments.length, 1, 'no duplicate appointment is created');
    const id = s.reminders.find((r) => /ID card/.test(r.title));
    assert.ok(id, 'ID card reminder exists');
    assert.equal(id!.appointmentId, s.appointments[0].id);
    assert.equal(hm(id!.at), '14:15');
    assert.equal(day(id!.at), 8);
    const linked = s.tasks.find((t) => t.id === id!.taskId);
    assert.equal(linked?.title, 'Carry ID card');
    assert.ok(out.card?.items.some((i) => i.existing && i.kind === 'appointment'), 'card shows the appointment as context');
  });

  it('works with the exact two-message test scenario', async () => {
    let s = (await say(emptyState(), 'I have a doctor appointment tomorrow at 3 PM.')).state;
    const r = await say(s, 'Also remind me to bring my ID card.');
    s = r.state;
    assert.equal(r.out.intent, 'followup');
    const reminder = s.reminders.find((x) => /ID card/.test(x.title))!;
    assert.equal(reminder.appointmentId, s.appointments[0].id);
    assert.equal(hm(reminder.at), '14:30'); // arrival (14:45) minus 15
    assert.match(r.out.reply, /doctor appointment tomorrow at 3:00 PM/);
  });

  it('moves the appointment and every derived step on "move it to 4 PM"', async () => {
    let s = (await say(emptyState(), FULL)).state;
    s = (await say(s, 'Also remind me to carry my ID card.')).state;
    const r = await say(s, 'Move it to 4 PM');
    s = r.state;
    assert.equal(r.out.card?.heading, 'PLAN UPDATED');
    assert.equal(hm(s.appointments[0].start), '16:00');
    const byTitle = (t: string) => s.schedule.find((x) => x.title === t)!;
    assert.equal(hm(byTitle('Doctor appointment').start), '16:00');
    assert.equal(hm(byTitle('Leave & arrive early').start), '15:30');
    assert.equal(hm(byTitle('Prepare for doctor appointment').start), '15:00');
    assert.equal(hm(byTitle('Prepare documents').start), '14:30');
    assert.equal(hm(byTitle('Carry your ID card').start), '15:15');
    assert.equal(s.schedule.length, 5, 'nothing duplicated');
    assert.equal(hm(s.tasks.find((t) => t.title === 'Prepare documents')!.due!), '15:00');
  });

  it('changes the arrival buffer on a later message', async () => {
    let s = (await say(emptyState(), 'I have a doctor appointment tomorrow at 3 PM.')).state;
    const r = await say(s, 'Arrive 45 minutes early');
    s = r.state;
    assert.equal(s.appointments[0].bufferMin, 45);
    assert.equal(hm(s.schedule.find((x) => x.role === 'arrival')!.start), '14:15');
    assert.equal(s.schedule.filter((x) => x.role === 'arrival').length, 1);
  });

  it('remembers a stated arrival buffer for the next appointment', async () => {
    let s = (await say(emptyState(), FULL)).state;
    const r = await say(s, 'I have a dentist appointment tomorrow at 6 PM.');
    s = r.state;
    assert.equal(s.appointments.find((a) => a.title === 'Dentist appointment')!.bufferMin, 30);
    assert.match(r.out.contextNote ?? '', /30-minute/);
  });

  it('does not create the same appointment twice', async () => {
    let s = (await say(emptyState(), 'I have a doctor appointment tomorrow at 3 PM.')).state;
    const before = JSON.stringify({ a: s.appointments, sc: s.schedule });
    const r = await say(s, 'I have a doctor appointment tomorrow at 3 PM.');
    s = r.state;
    assert.equal(s.appointments.length, 1);
    assert.equal(JSON.stringify({ a: s.appointments, sc: s.schedule }), before);
    assert.match(r.out.reply, /already on your schedule/);
  });

  it('asks a question when information is missing and finishes the plan from the answer', async () => {
    let s = (await say(emptyState(), 'I have a dentist appointment tomorrow')).state;
    assert.equal(s.appointments.length, 0);
    assert.equal(s.context.pending?.kind, 'appointment-time');
    s = (await say(s, '4 PM')).state;
    assert.equal(s.appointments.length, 1);
    assert.equal(hm(s.appointments[0].start), '16:00');
    assert.equal(day(s.appointments[0].start), 8);
    assert.equal(s.context.pending, undefined);
  });
});

describe('work, exercise and groceries scenario', () => {
  const MSG = 'Tomorrow I work from 10 AM to 6 PM. I need 30 minutes of exercise and I need to buy groceries.';

  it('creates a work block, two scheduled tasks and reminders without overlaps', async () => {
    const { state: s, out } = await say(emptyState(), MSG);
    assert.equal(out.card?.summary, 'I organized 1 work block, 2 tasks, and 3 reminders.');
    const work = s.schedule.find((x) => x.kind === 'work')!;
    assert.equal(`${hm(work.start)}-${hm(work.end!)}`, '10:00-18:00');
    const ex = s.schedule.find((x) => /Exercise/.test(x.title) && x.kind === 'task')!;
    assert.equal(hm(ex.start), '8:30');
    assert.equal(hm(ex.end!), '9:00');
    const gr = s.schedule.find((x) => /groceries/i.test(x.title) && x.kind === 'task')!;
    assert.equal(hm(gr.start), '18:30');
    assert.ok(new Date(gr.start) >= new Date(work.end!), 'groceries after work');
    assert.equal(s.tasks.length, 2);
    assert.equal(s.tasks.find((t) => /Exercise/.test(t.title))!.category, 'Fitness');
    assert.equal(s.tasks.find((t) => /groceries/i.test(t.title))!.category, 'Errands');
    assert.equal(s.reminders.length, 3);
    assert.ok(s.schedule.every((x) => day(x.start) === 8));
  });

  it('answers "what\'s on tomorrow?" from stored data', async () => {
    const s = (await say(emptyState(), MSG)).state;
    const r = await say(s, "What's on tomorrow?");
    assert.equal(r.out.intent, 'query');
    assert.equal(r.out.card?.items.length, 6);
    assert.equal(r.state.schedule.length, 6, 'a query changes nothing');
  });

  it('respects a stored evening-exercise preference', async () => {
    let s = (await say(emptyState(), 'I prefer to exercise in the evening.')).state;
    assert.equal(s.context.preferences.exerciseTime, 'evening');
    s = (await say(s, MSG)).state;
    const ex = s.schedule.find((x) => /Exercise/.test(x.title) && x.kind === 'task')!;
    assert.ok(new Date(ex.start).getHours() >= 18, `exercise at ${hm(ex.start)} should be after work`);
  });
});

describe('errors and edge cases', () => {
  const fails = async (msg: string, code: string) => {
    await assert.rejects(
      () => planner.plan({ message: msg, now: NOW, context: emptyState().context, snapshot: emptyState() }),
      (e: unknown) => e instanceof PlannerError && e.code === code,
      `"${msg}" should fail with ${code}`,
    );
  };
  it('rejects empty and whitespace-only messages', async () => {
    await fails('', 'EMPTY_MESSAGE');
    await fails('   \n  ', 'EMPTY_MESSAGE');
  });
  it('rejects impossible times', async () => {
    await fails('I have a meeting tomorrow at 25:00', 'INVALID_TIME');
    await fails('I have a doctor appointment tomorrow at 13 PM', 'INVALID_TIME');
    await fails('I have a doctor appointment tomorrow at 3:75 PM', 'INVALID_TIME');
  });
  it('rejects impossible dates', async () => {
    await fails('I have a dentist appointment on February 31 at 3 PM', 'INVALID_DATE');
    await fails('I have a dentist appointment on 31/04 at 3 PM', 'INVALID_DATE');
  });
  it('rejects appointments in the past', async () => {
    await fails('I have a doctor appointment yesterday at 3 PM', 'PAST_TIME');
    await fails('I have a doctor appointment today at 8 AM', 'PAST_TIME');
  });
  it('rejects overlong messages and absurd buffers', async () => {
    await fails('a'.repeat(1001), 'TOO_LONG');
    await fails('I have a doctor appointment tomorrow at 3 PM and I want to arrive 9 hours early', 'INVALID_TIME');
  });
  it('rejects an end time before the start time', async () => {
    await fails('Tomorrow I work from 6 PM to 10 AM', 'INVALID_TIME');
  });
  it('turns unknown input into guidance instead of failing', async () => {
    const { out, state } = await say(emptyState(), 'blah blah');
    assert.equal(out.intent, 'help');
    assert.equal(state.appointments.length + state.tasks.length + state.reminders.length, 0);
  });
  it('handles a follow-up with nothing to attach to', async () => {
    const { out } = await say(emptyState(), 'Also remind me to carry my ID card.');
    assert.equal(out.intent, 'clarify');
    assert.match(out.reply, /When should I remind you/);
  });
  it('understands an Alexa-style wake word without pretending to be Alexa', async () => {
    const { out } = await say(emptyState(), 'Alexa, I have a doctor appointment tomorrow at 3 PM.');
    assert.equal(out.card?.heading, 'PLAN CREATED');
  });
  it('parses 24-hour, lowercase and dotted times', async () => {
    const a = await say(emptyState(), 'i have a doctor appointment tomorrow at 15:30');
    assert.equal(hm(a.state.appointments[0].start), '15:30');
    const b = await say(emptyState(), 'I have a doctor appointment tomorrow at 3 p.m.');
    assert.equal(hm(b.state.appointments[0].start), '15:00');
    const c = await say(emptyState(), 'I have a doctor appointment tomorrow at 3:45pm');
    assert.equal(hm(c.state.appointments[0].start), '15:45');
  });
});

describe('persistence shape and completion state', () => {
  it('survives a JSON round trip unchanged', async () => {
    let s = (await say(emptyState(), FULL)).state;
    s = (await say(s, 'Also remind me to carry my ID card.')).state;
    const revived = JSON.parse(JSON.stringify(s)) as AppState;
    assert.equal(JSON.stringify(revived), JSON.stringify(s));
    const r = await say(revived, 'Move it to 5 PM');
    assert.equal(hm(r.state.appointments[0].start), '17:00', 'context still resolves after revival');
  });

  it('keeps tasks, reminders and timeline rows in sync', async () => {
    let s = (await say(emptyState(), FULL)).state;
    const task = s.tasks[0];
    s = setTaskDone(s, task.id, true);
    assert.equal(s.tasks[0].done, true);
    assert.equal(s.schedule.find((x) => x.refId === task.id)!.done, true);
    assert.equal(s.reminders[0].status, 'completed', 'finishing the task settles its reminder');
    assert.equal(s.schedule.find((x) => x.refType === 'reminder')!.done, true);

    s = toggleScheduleItem(s, s.schedule.find((x) => x.refType === 'appointment')!.id);
    assert.equal(s.appointments[0].done, true);

    s = setReminderStatus(s, s.reminders[0].id, 'active');
    assert.equal(s.schedule.find((x) => x.refType === 'reminder')!.done, false);
  });
});
