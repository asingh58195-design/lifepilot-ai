import { useEffect, useRef, useState } from 'react';
import type { LifePilot } from '../store/useLifePilot';
import { Composer } from '../components/Composer';
import { Icon } from '../components/Icon';
import { MessageBubble } from '../components/MessageBubble';
import { DemoPanel } from '../components/DemoPanel';

interface Props {
  app: LifePilot;
  onNavigate: (tab: 'today' | 'schedule') => void;
}

export function AssistantScreen({ app, onNavigate }: Props) {
  const { state, loading, now, send } = app;
  const endRef = useRef<HTMLDivElement>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | undefined>();
  const last = state.messages[state.messages.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [state.messages.length, loading]);

  const status = app.statuses.find((s) => s.id === app.provider.id);
  const hasPlan = state.messages.some((m) => m.card);

  return (
    <div className="assistant">
      <div className="assistant__top">
        <div className="provider" title={status?.description}>
          <span className={`pulse${status?.available === false ? ' pulse--off' : ''}`} aria-hidden="true" />
          <span><strong>{app.provider.name}</strong> · {status?.available === false ? 'unavailable' : 'ready · runs locally, no API keys'}</span>
        </div>
        <label className="provider__pick">
          <span className="sr-only">Planner provider</span>
          <select value={app.provider.id} onChange={(e) => app.selectProvider(e.target.value)} aria-label="Planner provider">
            {app.providers.map((p) => {
              const st = app.statuses.find((s) => s.id === p.id);
              return <option key={p.id} value={p.id}>{p.name}{st && !st.available ? ' (not configured)' : ''}</option>;
            })}
          </select>
        </label>
      </div>

      <div className="thread" role="log" aria-live="polite" aria-label="Conversation">
        {state.messages.length === 0 ? (
          <div className="welcome">
            <div className="welcome__orb" aria-hidden="true"><Icon name="spark" size={30} /></div>
            <h1>What’s coming up?</h1>
            <p>Say it the way you’d say it to a person. LifePilot turns it into a coordinated plan — appointments, preparation, arrival times and reminders — and remembers the conversation.</p>
          </div>
        ) : (
          state.messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              now={now}
              isLast={i === state.messages.length - 1}
              disabled={loading}
              onSuggest={(t) => void send(t)}
            />
          ))
        )}
        {loading && (
          <div className="msg msg--assistant" aria-live="polite">
            <div className="avatar" aria-hidden="true"><Icon name="spark" size={16} /></div>
            <div className="bubble bubble--assistant typing" role="status" aria-label="LifePilot is planning">
              <span /><span /><span />
            </div>
          </div>
        )}
        {!loading && hasPlan && last?.role === 'assistant' && !last.isError && (
          <div className="nav-hint">
            <button type="button" className="link-btn" onClick={() => onNavigate('schedule')}>Open schedule <Icon name="arrow" size={14} /></button>
            <button type="button" className="link-btn" onClick={() => onNavigate('today')}>Open Today <Icon name="arrow" size={14} /></button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <DemoPanel app={app} onFill={(text) => setPrefill({ text, nonce: Date.now() })} compact={state.messages.length > 0} />
      <Composer disabled={loading} onSend={(t, v) => send(t, v)} prefill={prefill} />
    </div>
  );
}
