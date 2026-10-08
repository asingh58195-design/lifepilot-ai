import type { ScheduleItem } from '../types';
import { KIND_META } from '../lib/kinds';
import { fmtTime, fmtTimeRange } from '../lib/time';
import { Icon } from './Icon';

interface Props {
  items: ScheduleItem[];
  now: Date;
  onToggle: (id: string) => void;
}

export function Timeline({ items, now, onToggle }: Props) {
  return (
    <ol className="timeline">
      {items.map((s) => {
        const past = new Date(s.end ?? s.start).getTime() < now.getTime() && !s.done;
        const meta = KIND_META[s.kind];
        return (
          <li key={s.id} className={`tl kind-${s.kind}${s.done ? ' is-done' : ''}${past ? ' is-past' : ''}`}>
            <time className="tl__time" dateTime={s.start}>
              {s.kind === 'work' || s.kind === 'task' || s.kind === 'preparation' ? fmtTime(s.start) : fmtTime(s.start)}
              {s.end && <span className="tl__end">{fmtTimeRange(s.start, s.end).split('–')[1]?.trim()}</span>}
            </time>
            <span className="tl__rail" aria-hidden="true"><span className="tl__dot"><Icon name={meta.icon} size={13} /></span></span>
            <div className="tl__card">
              <div className="tl__main">
                <span className="tl__kind">{meta.label}{past && <em className="tag">earlier</em>}</span>
                <strong>{s.title}</strong>
                {s.detail && <span className="tl__detail">{s.detail}</span>}
              </div>
              <button
                type="button"
                className={`check${s.done ? ' is-on' : ''}`}
                onClick={() => onToggle(s.id)}
                aria-pressed={s.done}
                aria-label={`${s.done ? 'Mark not done' : 'Mark done'}: ${s.title}`}
              >
                <Icon name="check" size={16} />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
