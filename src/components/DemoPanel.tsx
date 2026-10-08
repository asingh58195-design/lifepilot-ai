import { useRef, useState } from 'react';
import type { LifePilot } from '../store/useLifePilot';
import { Icon } from './Icon';

const DOCTOR = 'I have a doctor appointment tomorrow at 3 PM. I need to arrive 30 minutes early. I also need to prepare my documents before leaving.';
const FOLLOW = 'Also remind me to carry my ID card.';
const WORKDAY = 'Tomorrow I work from 10 AM to 6 PM. I need 30 minutes of exercise and I need to buy groceries.';

interface Props {
  app: LifePilot;
  onFill: (text: string) => void;
  compact: boolean;
}

/** Quick, honest demo helpers: they send real messages through the real planner. */
export function DemoPanel({ app, onFill, compact }: Props) {
  const [running, setRunning] = useState(false);
  // Open on a fresh conversation; folds away once there is a thread (the user can always reopen it).
  const [pick, setPick] = useState<boolean | undefined>();
  const open = pick ?? !compact;
  const setOpen = (v: boolean) => setPick(v);
  const cancel = useRef(false);

  const runGuided = async () => {
    if (running || app.loading) return;
    setRunning(true);
    cancel.current = false;
    const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const a = await app.send(DOCTOR);
    if (a.ok && !cancel.current) {
      await pause(1600);
      await app.send(FOLLOW);
    }
    setRunning(false);
  };

  const disabled = running || app.loading;

  if (!open) {
    return (
      <div className="demo demo--closed">
        <button type="button" className="link-btn" onClick={() => setOpen(true)}><Icon name="play" size={13} /> Demo mode</button>
      </div>
    );
  }

  return (
    <section className="demo" aria-label="Demo mode">
      <div className="demo__head">
        <span className="demo__title"><Icon name="play" size={13} /> Demo mode</span>
        <span className="demo__sub">Real messages, real planner — nothing is mocked.</span>
        {<button type="button" className="icon-btn icon-btn--sm" onClick={() => setOpen(false)} aria-label="Hide demo mode"><Icon name="x" size={14} /></button>}
      </div>
      <div className="demo__row">
        <button type="button" className="btn btn--primary" onClick={runGuided} disabled={disabled}>
          <Icon name="play" size={14} /> {running ? 'Running demo…' : 'Run guided demo'}
        </button>
        <button type="button" className="btn" onClick={() => onFill(DOCTOR)} disabled={disabled}>Doctor visit</button>
        <button type="button" className="btn" onClick={() => onFill(FOLLOW)} disabled={disabled}>ID-card follow-up</button>
        <button type="button" className="btn" onClick={() => onFill(WORKDAY)} disabled={disabled}>Work day</button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            if (window.confirm('Clear the conversation and all saved plans?')) app.reset();
          }}
          disabled={disabled}
        >
          <Icon name="trash" size={14} /> Reset
        </button>
      </div>
    </section>
  );
}
