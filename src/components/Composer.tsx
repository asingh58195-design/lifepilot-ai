import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

interface Props {
  disabled: boolean;
  onSend: (text: string, viaVoice: boolean) => Promise<{ ok: boolean }>;
  prefill?: { text: string; nonce: number };
}

const MAX = 1000;

export function Composer({ disabled, onSend, prefill }: Props) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | undefined>();
  const ref = useRef<HTMLTextAreaElement>(null);
  const viaVoice = useRef(false);

  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      ref.current?.focus();
    }
  }, [prefill]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (disabled) return;
    const value = text;
    if (!value.trim()) {
      setHint('Type a request first, or tap a suggestion.');
      ref.current?.focus();
      return;
    }
    setHint(undefined);
    setText('');
    const r = await onSend(value, viaVoice.current);
    viaVoice.current = false;
    if (!r.ok) {
      // Give the text back so the user can fix it instead of retyping.
      setText((current) => (current ? current : value));
    }
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  /** Voice-style affordance only: no speech API is used. It simulates dictation of a sample request. */
  const mic = () => {
    if (disabled) return;
    setListening(true);
    setHint('Voice-style demo: simulating dictation. Typing is the primary way to use LifePilot.');
    window.setTimeout(() => {
      setListening(false);
      viaVoice.current = true;
      setText('Alexa, I have a doctor appointment tomorrow at 3 PM. I need to arrive 30 minutes early. I also need to prepare my documents before leaving.');
      ref.current?.focus();
    }, 1400);
  };

  return (
    <form className="composer" onSubmit={submit} aria-label="Message LifePilot">
      {hint && <p className="composer__hint" role="status">{hint}</p>}
      <div className={`composer__box${listening ? ' is-listening' : ''}`}>
        <button type="button" className={`icon-btn mic${listening ? ' is-on' : ''}`} onClick={mic} disabled={disabled || listening} aria-label="Voice-style input (simulated dictation)" title="Voice-style input (simulated)">
          <Icon name="mic" />
        </button>
        <label className="sr-only" htmlFor="message">Message</label>
        <textarea
          id="message"
          ref={ref}
          rows={1}
          value={text}
          maxLength={MAX + 200}
          placeholder={listening ? 'Listening…' : 'Tell me what’s coming up…'}
          onChange={(e) => {
            setText(e.target.value);
            if (hint) setHint(undefined);
          }}
          onKeyDown={onKey}
          aria-describedby="composer-count"
        />
        <button type="submit" className="send" disabled={disabled} aria-label={disabled ? 'Planning…' : 'Send message'}>
          <Icon name="send" size={18} />
        </button>
      </div>
      <div className="composer__meta">
        <span>Enter to send · Shift+Enter for a new line</span>
        <span id="composer-count" className={text.length > MAX ? 'over' : ''}>{text.length > 700 ? `${text.length}/${MAX}` : ''}</span>
      </div>
    </form>
  );
}
