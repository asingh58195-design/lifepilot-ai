# LifePilot AI

> Turn one messy sentence into a coordinated plan: appointments, arrival times, preparation, tasks and reminders.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** — track: **Alexa+**.

> **Transparency note.** LifePilot AI is a **custom, simulated Alexa+-style experience**. It is **not** the official Alexa+ UI, it is **not** an Amazon app, and it has **no** Amazon / AWS / Alexa integration of any kind. It explores the *interaction model* of an action-oriented, context-aware assistant: natural language in, structured and coordinated actions out. There are no credentials, no paid APIs and no network calls to model providers.

---

## Problem

Real requests are not commands. People say *"I have a doctor appointment tomorrow at 3, I need to be there 30 minutes early, and I have to sort my documents first."* That one sentence hides an appointment, an arrival time, a preparation task, and a reminder — and the next thing they say (*"also remind me to bring my ID"*) only makes sense because of what they just said.

Most assistants either answer with text or need one command per action. The user ends up doing the planning.

## Solution

LifePilot AI turns a request into a **plan**, shows it as a structured card, keeps it in a schedule, and **remembers the conversation** so follow-ups work without repeating details.

```
You:   I have a doctor appointment tomorrow at 3 PM. I need to arrive 30 minutes early.
       I also need to prepare my documents before leaving.

PLAN CREATED
  1:30 PM  Preparation  Prepare documents
  2:00 PM  Reminder     Prepare for doctor appointment
  2:30 PM  Action       Leave & arrive early
  3:00 PM  Appointment  Doctor appointment
I organized 1 appointment, 1 preparation task, 1 arrival action, and 1 reminder.

You:   Also remind me to carry my ID card.

REMINDER ADDED   (Context used: Linked to your Doctor appointment)
  2:15 PM  Reminder     Carry your ID card
```

## Key features

- **Multi-step planning** from natural language: appointments, arrival buffers, preparation tasks, reminders, work blocks, exercise and errands.
- **Conversation context**: "it", "also remind me…", "move it to 4 PM", "arrive 45 minutes early" resolve against the active appointment. Moving an appointment re-times every derived step.
- **Personalization**: remembers your arrival buffer and exercise-time preference within the session.
- **Smart scheduling**: flexible tasks (exercise, groceries) are placed in free time around fixed commitments such as a work block.
- **Clarifying questions** when information is missing ("What time is your dentist appointment tomorrow?") and the answer completes the plan.
- **Five screens**: Assistant, Today, Tasks, Schedule, Reminders — all driven by the same data, with completion state kept in sync.
- **Persistence**: conversation, tasks, appointments, reminders, schedule and completion state survive refresh (`localStorage`).
- **Demo mode**: one click runs the full doctor → ID-card flow through the real planner.
- **Voice-style button**: a microphone affordance that *simulates* dictation. No speech API is used; typing is the primary, reliable interaction.
- **Honest errors**: empty input, impossible times (`25:00`, `13 PM`), impossible dates (`February 31`), past times and over-long input all produce readable messages; nothing fails silently; duplicate submissions are blocked.
- **Accessible, responsive UI**: keyboard-friendly chat (Enter to send, Shift+Enter for newline), labelled controls, live regions, reduced-motion support, desktop side rail and mobile tab bar.

## Architecture

```
Browser (React + TypeScript)                       Server (Node + Express)
┌───────────────────────────────────────┐          ┌───────────────────────────┐
│ Screens: Assistant · Today · Tasks ·  │          │ serves dist/ (production) │
│          Schedule · Reminders         │          │ GET /api/health           │
│                 │                     │          │ GET /api/providers        │
│        useLifePilot()  ◄── localStorage│          └───────────────────────────┘
│                 │                     │
│        PlannerProvider  (interface)   │
│          ├── LocalPlannerProvider  ✔  │  deterministic, runs in the browser
│          └── FutureAIProvider      ✖  │  documented stub (no credentials)
└───────────────────────────────────────┘
```

The planner runs **in the browser** so the demo is instant and offline-capable; Express serves the built app and a small health/provider API.

### Project structure

```
lifepilot-ai/
├── server/index.ts                 Express: static hosting + /api/health, /api/providers
├── src/
│   ├── types.ts                    Typed domain models (Appointment, Task, Reminder, ScheduleItem, PlanCard…)
│   ├── planner/
│   │   ├── PlannerProvider.ts      Provider interface + PlannerError
│   │   ├── LocalPlannerProvider.ts Deterministic planner (orchestration, context, narration)
│   │   ├── FutureAIProvider.ts     Placeholder for a hosted LLM
│   │   ├── extract.ts              Clause → typed drafts (appointment, work, task, reminder…)
│   │   ├── parse.ts                Date / time / range / duration / buffer extraction
│   │   ├── layout.ts               Arrival-anchored timing + free-slot search
│   │   └── index.ts                Provider registry
│   ├── store/
│   │   ├── state.ts                Pure state transitions (testable without React)
│   │   ├── storage.ts              Validated localStorage persistence
│   │   └── useLifePilot.ts         The single hook the UI uses
│   ├── components/                 PlanCard, MessageBubble, Composer, Timeline, DemoPanel…
│   ├── screens/                    Assistant, Today, Tasks, Schedule, Reminders
│   ├── lib/                        time helpers, kind/category metadata
│   └── styles.css
└── tests/planner.test.ts           24 unit tests
```

## Local setup

Requires **Node.js 18+**.

```bash
npm install

# Development: API on :3001, Vite dev server (hot reload) on :5173
npm run dev          # open http://localhost:5173

# Production-style: build once, serve everything from Express
npm run serve        # open http://localhost:3001
```

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build`, `npm start` (serve an existing `dist/`). Set `PORT` to change the server port.

## How the planner works

`LocalPlannerProvider.plan()` is deterministic: the same message, clock and state always give the same result. No model, no randomness.

1. **Understand** (`extract.ts`, `parse.ts`) — the message is split into clauses; each is classified (appointment, work block, preparation, "bring" item, exercise, task, reminder, reschedule, query, small talk). Dates (`tomorrow`, `Friday`, `Oct 12`, `12/10`), times (`3 PM`, `15:30`, `noon`), ranges (`10 AM to 6 PM`), durations and arrival buffers (`30 minutes early`) are extracted. Impossible values raise a typed `PlannerError`.
2. **Resolve context** — the provider holds a `ConversationContext` (active appointment, last planned day, preferences, any pending question). A follow-up with no date or appointment of its own attaches to the active appointment.
3. **Lay out** (`layout.ts`) — everything anchors to the arrival time (appointment − buffer): preparation starts 60 min before, the prep reminder lands 30 min before, "bring" reminders 15 min before. Flexible tasks search for a free slot around work and other commitments. Nothing is ever scheduled in the past.
4. **Emit** — structured upserts (appointments, tasks, reminders, schedule items, all cross-linked by id) plus a `PlanCard` and a short natural-language reply. The UI only renders these results.

## Demo scenario (≈60 seconds)

1. Open LifePilot AI and press **Run guided demo** (or type the sentence yourself).
2. The doctor request appears as a **PLAN CREATED** card: 1:30 prep → 2:00 reminder → 2:30 arrive early → 3:00 appointment.
3. The follow-up *"Also remind me to carry my ID card."* is sent. The assistant shows **Context used: Linked to your Doctor appointment** and adds a 2:15 PM reminder — no appointment details repeated.
4. Open **Today** (or **Tomorrow**) and **Schedule** to see the coordinated actions; tick items off and watch Tasks and Reminders stay in sync.
5. Try *"Move it to 4 PM"* — every derived step shifts with it.
6. Second scenario: *"Tomorrow I work from 10 AM to 6 PM. I need 30 minutes of exercise and I need to buy groceries."* → work block, exercise before work, groceries after, with reminders.

## Testing

`npm test` runs 24 planner and state tests covering the doctor scenario, the ID-card follow-up, reschedule/buffer changes, the work/exercise/groceries scenario, preference memory, clarifying questions, duplicate prevention, error cases and a JSON persistence round-trip.

## Limitations

- **Rule-based language understanding.** It handles common English phrasings, not arbitrary language. Unrecognized input gets guidance and examples rather than a guess.
- **Single user, single device.** Data lives in this browser's `localStorage`; there is no account, sync or server-side storage.
- **Reminders are not push notifications.** They appear in the app; nothing fires while the tab is closed.
- **Same-day blocks only.** Overnight work blocks are rejected with a message.
- **Date format.** `12/10` is read as day/month.
- **Simulated voice.** The microphone button inserts a sample utterance; it does no speech recognition.
- **No Amazon integration.** This is a simulation of an interaction style, not an Alexa skill or Alexa+ client.

## Future AI provider integration

The UI depends only on the `PlannerProvider` interface (`src/planner/PlannerProvider.ts`). To add a hosted model:

1. Add a server route (e.g. `POST /api/plan`) that holds the API key in an environment variable — never in the browser bundle.
2. Send it the `PlannerInput` (message, clock, context, snapshot) and ask the model for JSON matching `PlannerOutput`.
3. **Validate** the response (ids, ISO dates, linked references) before applying it; fall back to `LocalPlannerProvider` on failure.
4. Implement `FutureAIProvider.plan()` to call the route and register it in `src/planner/index.ts`. The provider picker and status badge already read from `status()`.

Because the local planner stays available, the app keeps working with no keys.

## License

[MIT](./LICENSE)
