import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { useLifePilot } from './store/useLifePilot';
import { Icon, type IconName } from './components/Icon';
import { AssistantScreen } from './screens/AssistantScreen';
import { TodayScreen } from './screens/TodayScreen';
import { TasksScreen } from './screens/TasksScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { RemindersScreen } from './screens/RemindersScreen';

type Tab = 'assistant' | 'today' | 'tasks' | 'schedule' | 'reminders';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'assistant', label: 'Assistant', icon: 'spark' },
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'tasks', label: 'Tasks', icon: 'check' },
  { id: 'schedule', label: 'Schedule', icon: 'calendar' },
  { id: 'reminders', label: 'Reminders', icon: 'bell' },
];

function Shell() {
  const app = useLifePilot();
  const [tab, setTab] = useState<Tab>('assistant');
  const badge: Partial<Record<Tab, number>> = {
    tasks: app.state.tasks.filter((t) => !t.done).length,
    reminders: app.state.reminders.filter((r) => r.status === 'active').length,
  };
  const goAssistant = () => setTab('assistant');

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <span className="brand__mark"><Icon name="spark" size={18} /></span>
          <div>
            <strong>LifePilot AI</strong>
            <span>Simulated Alexa+-style assistant</span>
          </div>
        </div>
        <nav aria-label="Primary" className="nav">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={`nav__item${tab === t.id ? ' on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
              {badge[t.id] ? <b className="nav__badge" aria-label={`${badge[t.id]} open`}>{badge[t.id]}</b> : null}
            </button>
          ))}
        </nav>
        <p className="disclaimer">
          A custom demo built for a hackathon to explore an Alexa+-style, action-oriented assistant. It is <strong>not</strong> the official Alexa+ experience and is not affiliated with or endorsed by Amazon.
        </p>
      </aside>

      <main className="main" id="main">
        <div className="mobile-bar">
          <span className="brand__mark"><Icon name="spark" size={16} /></span>
          <strong>LifePilot AI</strong>
          <span className="mobile-bar__tag">Simulated demo · not official Alexa+</span>
        </div>
        {app.notice && (
          <div className="banner" role="alert">
            <span>{app.notice}</span>
            <button type="button" className="icon-btn icon-btn--sm" onClick={app.dismissNotice} aria-label="Dismiss message"><Icon name="x" size={14} /></button>
          </div>
        )}
        {tab === 'assistant' && <AssistantScreen app={app} onNavigate={setTab} />}
        {tab === 'today' && <TodayScreen app={app} onAsk={goAssistant} />}
        {tab === 'tasks' && <TasksScreen app={app} onAsk={goAssistant} />}
        {tab === 'schedule' && <ScheduleScreen app={app} onAsk={goAssistant} />}
        {tab === 'reminders' && <RemindersScreen app={app} onAsk={goAssistant} />}
      </main>

      <nav aria-label="Primary" className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tabbar__item${tab === t.id ? ' on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span className="tabbar__icon">
              <Icon name={t.icon} size={22} />
              {badge[t.id] ? <b className="tabbar__badge">{badge[t.id]}</b> : null}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** A crash in any screen shows a readable message instead of a blank page. */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LifePilot UI error', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>Reload</button>
        <button
          className="btn"
          onClick={() => {
            try {
              window.localStorage.removeItem('lifepilot-ai:state:v1');
            } catch {
              /* ignore */
            }
            window.location.reload();
          }}
        >
          Clear saved data and reload
        </button>
      </div>
    );
  }
}

export function App() {
  return (
    <Boundary>
      <Shell />
    </Boundary>
  );
}
