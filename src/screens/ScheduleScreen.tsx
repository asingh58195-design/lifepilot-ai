import { useMemo, useState } from 'react';
import type { ItemKind } from '../types';
import type { LifePilot } from '../store/useLifePilot';
import { Timeline } from '../components/Timeline';
import { EmptyState } from '../components/EmptyState';
import { KIND_META } from '../lib/kinds';
import { fmtDayLabel, fmtDate } from '../lib/time';
import { groupByDay } from '../lib/schedule';

const FILTERS: Array<{ id: 'all' | ItemKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'appointment', label: 'Appointments' },
  { id: 'preparation', label: 'Preparation' },
  { id: 'reminder', label: 'Reminders' },
  { id: 'action', label: 'Actions' },
  { id: 'work', label: 'Work' },
  { id: 'task', label: 'Tasks' },
];

export function ScheduleScreen({ app, onAsk }: { app: LifePilot; onAsk: () => void }) {
  const [filter, setFilter] = useState<'all' | ItemKind>('all');
  const groups = useMemo(
    () => groupByDay(app.state.schedule.filter((s) => filter === 'all' || s.kind === filter)),
    [app.state.schedule, filter],
  );

  return (
    <div className="screen">
      <header className="screen__head">
        <div>
          <h1>Schedule</h1>
          <p>Everything coordinated in one chronological timeline.</p>
        </div>
      </header>
      <div className="filters" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`pill${filter === f.id ? ' on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.id !== 'all' && <span className={`pill__dot kind-${f.id}`} />}{f.label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <EmptyState icon="calendar" title={filter === 'all' ? 'Your schedule is empty' : `No ${KIND_META[filter as ItemKind].label.toLowerCase()} items`}>
          Ask LifePilot to plan an appointment or a day.
          <br />
          <button type="button" className="btn btn--primary mt" onClick={onAsk}>Open assistant</button>
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="day" aria-label={fmtDate(g.date)}>
            <h2 className="day__title">{fmtDayLabel(g.date, app.now)} <span>{fmtDate(g.date)}</span></h2>
            <Timeline items={g.items} now={app.now} onToggle={app.toggleItem} />
          </section>
        ))
      )}
    </div>
  );
}
