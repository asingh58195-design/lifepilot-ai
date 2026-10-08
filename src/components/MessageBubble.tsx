import type { ChatMessage } from '../types';
import { fmtTime } from '../lib/time';
import { Icon } from './Icon';
import { PlanCard } from './PlanCard';

interface Props {
  message: ChatMessage;
  now: Date;
  isLast: boolean;
  disabled: boolean;
  onSuggest: (text: string) => void;
}

export function MessageBubble({ message, now, isLast, disabled, onSuggest }: Props) {
  if (message.role === 'user') {
    return (
      <div className="msg msg--user">
        <div className="bubble bubble--user">
          {message.viaVoice && <Icon name="mic" size={14} className="bubble__voice" />}
          {message.text}
        </div>
        <time className="msg__time" dateTime={message.createdAt}>{fmtTime(message.createdAt)}</time>
      </div>
    );
  }
  return (
    <div className={`msg msg--assistant${message.isError ? ' is-error' : ''}`}>
      <div className="avatar" aria-hidden="true"><Icon name="spark" size={16} /></div>
      <div className="msg__stack">
        <div className={`bubble bubble--assistant${message.isError ? ' bubble--error' : ''}`} role={message.isError ? 'alert' : undefined}>
          {message.contextNote && (
            <div className="ctx"><Icon name="link" size={13} /> <span>Context used: {message.contextNote}</span></div>
          )}
          {message.text}
        </div>
        {message.card && <PlanCard card={message.card} now={now} />}
        {isLast && message.suggestions && message.suggestions.length > 0 && (
          <div className="chips" role="group" aria-label="Suggested replies">
            {message.suggestions.map((s) => (
              <button key={s} type="button" className="chip" disabled={disabled} onClick={() => onSuggest(s)}>{s}</button>
            ))}
          </div>
        )}
        <time className="msg__time" dateTime={message.createdAt}>{fmtTime(message.createdAt)}</time>
      </div>
    </div>
  );
}
