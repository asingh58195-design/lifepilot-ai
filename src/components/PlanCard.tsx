import type { PlanCard as PlanCardModel } from '../types';
import { KIND_META } from '../lib/kinds';
import { fmtDayLabel, fmtTime } from '../lib/time';
import { Icon } from './Icon';

interface Props {
  card: PlanCardModel;
  now: Date;
}

/** The structured result shown under an assistant message. */
export function PlanCard({ card, now }: Props) {
  const firstDay = card.items[0] ? fmtDayLabel(card.items[0].at, now) : '';
  return (
    <section className="plan" aria-label={card.heading.toLowerCase()}>
      <header className="plan__head">
        <span className="plan__badge">
          <Icon name={card.heading === 'REMINDER ADDED' ? 'bell' : 'spark'} size={14} />
          {card.heading}
        </span>
        {firstDay && <span className="plan__day">{firstDay}</span>}
      </header>
      <ol className="plan__list">
        {card.items.map((item) => (
          <li key={`${item.id}-${item.changed ? 'm' : 'n'}`} className={`plan__row kind-${item.kind}${item.existing ? ' is-existing' : ''}`}>
            <time className="plan__time" dateTime={item.at}>
              {fmtTime(item.at)}
            </time>
            <span className="plan__dot" aria-hidden="true">
              <Icon name={KIND_META[item.kind].icon} size={13} />
            </span>
            <div className="plan__body">
              <span className="plan__kind">
                {KIND_META[item.kind].label}
                {item.changed && <em className="tag tag--moved">moved</em>}
                {item.existing && <em className="tag">already planned</em>}
              </span>
              <strong className="plan__title">{item.title}</strong>
              {item.detail && <span className="plan__detail">{item.detail}</span>}
            </div>
          </li>
        ))}
      </ol>
      <footer className="plan__foot">{card.summary}</footer>
    </section>
  );
}
