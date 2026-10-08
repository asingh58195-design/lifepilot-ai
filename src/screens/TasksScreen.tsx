import { useMemo, useState } from 'react';
import type { Category, Task } from '../types';
import type { LifePilot } from '../store/useLifePilot';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { CATEGORY_ICON, PRIORITY_LABEL, PRIORITY_RANK } from '../lib/kinds';
import { fmtDayLabel, fmtTime } from '../lib/time';

const CATEGORIES: Category[] = ['Health', 'Work', 'Personal', 'Errands', 'Fitness', 'Home'];

function dueText(t: Task, now: Date): string {
  if (!t.due) return 'No due time';
  const d = new Date(t.due);
  return t.dueAllDay ? `Due ${fmtDayLabel(d, now).toLowerCase()}` : `Due ${fmtDayLabel(d, now).toLowerCase()} at ${fmtTime(d)}`;
}

export function TasksScreen({ app, onAsk }: { app: LifePilot; onAsk: () => void }) {
  const [view, setView] = useState<'pending' | 'completed'>('pending');
  const [cat, setCat] = useState<'all' | Category>('all');
  const { tasks } = app.state;

  const pendingCount = tasks.filter((t) => !t.done).length;
  const doneCount = tasks.length - pendingCount;
  const list = useMemo(
    () =>
      tasks
        .filter((t) => (view === 'pending' ? !t.done : t.done) && (cat === 'all' || t.category === cat))
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            (a.due ? new Date(a.due).getTime() : Infinity) - (b.due ? new Date(b.due).getTime() : Infinity),
        ),
    [tasks, view, cat],
  );
  const linked = (t: Task) => (t.appointmentId ? app.state.appointments.find((a) => a.id === t.appointmentId)?.title : undefined);

  return (
    <div className="screen">
      <header className="screen__head">
        <div>
          <h1>Tasks</h1>
          <p>{pendingCount} pending · {doneCount} completed</p>
        </div>
        <div className="seg" role="tablist" aria-label="Task status">
          <button role="tab" aria-selected={view === 'pending'} className={view === 'pending' ? 'on' : ''} onClick={() => setView('pending')}>Pending <b>{pendingCount}</b></button>
          <button role="tab" aria-selected={view === 'completed'} className={view === 'completed' ? 'on' : ''} onClick={() => setView('completed')}>Completed <b>{doneCount}</b></button>
        </div>
      </header>
      <div className="filters" role="group" aria-label="Filter by category">
        <button type="button" className={`pill${cat === 'all' ? ' on' : ''}`} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`pill${cat === c ? ' on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
            <Icon name={CATEGORY_ICON[c]} size={13} /> {c}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState icon="list" title={view === 'pending' ? (tasks.length ? 'No pending tasks here' : 'No tasks yet') : 'Nothing completed yet'}>
          {tasks.length === 0 ? 'Tasks appear when you tell LifePilot what you need to do.' : 'Try another filter.'}
          {tasks.length === 0 && (<><br /><button type="button" className="btn btn--primary mt" onClick={onAsk}>Add tasks by chatting</button></>)}
        </EmptyState>
      ) : (
        <ul className="cards">
          {list.map((t) => (
            <li key={t.id} className={`card task${t.done ? ' is-done' : ''}`}>
              <button type="button" className={`check${t.done ? ' is-on' : ''}`} aria-pressed={t.done} aria-label={`${t.done ? 'Mark pending' : 'Mark complete'}: ${t.title}`} onClick={() => app.toggleTask(t.id, !t.done)}>
                <Icon name="check" size={16} />
              </button>
              <div className="card__main">
                <strong>{t.title}</strong>
                <div className="meta">
                  <span className={`prio prio--${t.priority}`}><Icon name="flag" size={12} /> {PRIORITY_LABEL[t.priority]}</span>
                  <span className="cat"><Icon name={CATEGORY_ICON[t.category]} size={12} /> {t.category}</span>
                  <span><Icon name="clock" size={12} /> {dueText(t, app.now)}</span>
                  {linked(t) && <span className="linked"><Icon name="link" size={12} /> {linked(t)}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
