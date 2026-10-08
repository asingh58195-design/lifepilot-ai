import { useMemo, useState } from 'react';
import type { LifePilot } from '../store/useLifePilot';
import { Timeline } from '../components/Timeline';
import { EmptyState } from '../components/EmptyState';
import { addDays, fmtDate, fmtRelative, fmtTime, startOfDay } from '../lib/time';
import { itemsOnDay, sortItems } from '../lib/schedule';

export function TodayScreen({ app, onAsk }: { app: LifePilot; onAsk: () => void }) {
  const { state, now } = app;
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const todayItems = useMemo(() => itemsOnDay(state.schedule, today), [state.schedule, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const tomorrowItems = useMemo(() => itemsOnDay(state.schedule, tomorrow), [state.schedule, tomorrow.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<'today' | 'tomorrow' | undefined>();
  const view = pick ?? (todayItems.length === 0 && tomorrowItems.length > 0 ? 'tomorrow' : 'today');
  const day = view === 'today' ? today : tomorrow;
  const items = view === 'today' ? todayItems : tomorrowItems;

  const upcoming = sortItems(state.schedule.filter((s) => !s.done && new Date(s.start).getTime() >= now.getTime())).slice(0, 4);
  const completed = sortItems(state.schedule.filter((s) => s.done)).slice(-5).reverse();
  const open = state.schedule.filter((s) => !s.done && startOfDay(new Date(s.start)).getTime() === day.getTime()).length;
  const done = items.filter((s) => s.done).length;

  return (
    <div className="screen">
      <header className="screen__head">
        <div>
          <h1>{view === 'today' ? 'Today' : 'Tomorrow'}</h1>
          <p>{fmtDate(day)} · {items.length ? `${open} to go, ${done} done` : 'nothing planned yet'}</p>
        </div>
        <div className="seg" role="tablist" aria-label="Day">
          <button role="tab" aria-selected={view === 'today'} className={view === 'today' ? 'on' : ''} onClick={() => setPick('today')}>Today <b>{todayItems.length}</b></button>
          <button role="tab" aria-selected={view === 'tomorrow'} className={view === 'tomorrow' ? 'on' : ''} onClick={() => setPick('tomorrow')}>Tomorrow <b>{tomorrowItems.length}</b></button>
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState icon="sun" title={view === 'today' ? 'Nothing on your plate today' : 'Tomorrow is open'}>
          Tell LifePilot what’s coming up and the plan will appear here.
          <br />
          <button type="button" className="btn btn--primary mt" onClick={onAsk}>Plan something</button>
        </EmptyState>
      ) : (
        <div className="grid2">
          <section aria-label="Timeline" className="panel">
            <h2 className="panel__title">Timeline</h2>
            <Timeline items={items} now={now} onToggle={app.toggleItem} />
          </section>
          <aside className="side">
            <section className="panel" aria-label="Upcoming actions">
              <h2 className="panel__title">Up next</h2>
              {upcoming.length === 0 ? <p className="muted">All caught up.</p> : (
                <ul className="mini">
                  {upcoming.map((s) => (
                    <li key={s.id}><span className={`mini__dot kind-${s.kind}`} /><div><strong>{s.title}</strong><span>{fmtTime(s.start)} · {fmtRelative(s.start, now)}</span></div></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="panel" aria-label="Completed actions">
              <h2 className="panel__title">Completed</h2>
              {completed.length === 0 ? <p className="muted">Nothing completed yet. Tick items off as you go.</p> : (
                <ul className="mini mini--done">
                  {completed.map((s) => (
                    <li key={s.id}><span className="mini__dot is-done" /><div><strong>{s.title}</strong><span>{fmtTime(s.start)}</span></div></li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
