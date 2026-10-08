import { useState } from 'react';
import type { LifePilot } from '../store/useLifePilot';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { fmtDayLabel, fmtRelative, fmtTime } from '../lib/time';

export function RemindersScreen({ app, onAsk }: { app: LifePilot; onAsk: () => void }) {
  const [view, setView] = useState<'active' | 'history'>('active');
  const { reminders, tasks, appointments } = app.state;
  const active = reminders.filter((r) => r.status === 'active').sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const history = reminders.filter((r) => r.status !== 'active').sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const list = view === 'active' ? active : history;

  return (
    <div className="screen">
      <header className="screen__head">
        <div>
          <h1>Reminders</h1>
          <p>{active.length} active · {history.length} done</p>
        </div>
        <div className="seg" role="tablist" aria-label="Reminder status">
          <button role="tab" aria-selected={view === 'active'} className={view === 'active' ? 'on' : ''} onClick={() => setView('active')}>Active <b>{active.length}</b></button>
          <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>Done <b>{history.length}</b></button>
        </div>
      </header>
      {list.length === 0 ? (
        <EmptyState icon="bell" title={view === 'active' ? 'No active reminders' : 'No completed reminders'}>
          {view === 'active' ? 'Say “remind me to…” and it will show up here.' : 'Completed and dismissed reminders collect here.'}
          {view === 'active' && (<><br /><button type="button" className="btn btn--primary mt" onClick={onAsk}>Set a reminder</button></>)}
        </EmptyState>
      ) : (
        <ul className="cards">
          {list.map((r) => {
            const task = r.taskId ? tasks.find((t) => t.id === r.taskId) : undefined;
            const appt = r.appointmentId ? appointments.find((a) => a.id === r.appointmentId) : undefined;
            const due = new Date(r.at);
            const overdue = r.status === 'active' && due.getTime() < app.now.getTime();
            return (
              <li key={r.id} className={`card reminder${r.status !== 'active' ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`}>
                <div className="reminder__time">
                  <strong>{fmtTime(due)}</strong>
                  <span>{fmtDayLabel(due, app.now)}</span>
                </div>
                <div className="card__main">
                  <strong>{r.title}</strong>
                  <div className="meta">
                    {r.status === 'active' && <span className={overdue ? 'late' : ''}><Icon name="clock" size={12} /> {overdue ? 'Overdue' : fmtRelative(due, app.now)}</span>}
                    {r.status !== 'active' && <span><Icon name="check" size={12} /> {r.status === 'completed' ? 'Completed' : 'Dismissed'}</span>}
                    {task && <span className="linked"><Icon name="link" size={12} /> Task: {task.title}</span>}
                    {appt && <span className="linked"><Icon name="calendar" size={12} /> {appt.title}</span>}
                  </div>
                </div>
                <div className="card__actions">
                  {r.status === 'active' ? (
                    <>
                      <button type="button" className="btn btn--sm btn--primary" onClick={() => app.setReminder(r.id, 'completed')}>Complete</button>
                      <button type="button" className="btn btn--sm" onClick={() => app.setReminder(r.id, 'dismissed')}>Dismiss</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--sm" onClick={() => app.setReminder(r.id, 'active')}>Restore</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
