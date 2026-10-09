// The dashboard's mini month and the calendar page's big month (prototype .cal-* / .mday).
// Booked and held days open their booking or request; a free day is blocked and a
// manually blocked day freed with one click (availability.toggleBlock); with
// ‹Приемам заявки само за избрани дати› a closed day is opened (availability.toggleOpenDate).
import Link from 'next/link';
import type { MiniDay } from '@/lib/domain/views-partner-ops';
import { toggleDayAction } from '../kalendar/actions';

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
const prevIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 6l-6 6 6 6" /></svg>;
const nextIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg>;

/** What a click on the day does. */
function clickOf(c: MiniDay): 'link' | 'toggle' | 'open' | null {
  if (c.out || !c.info) return null;
  if (c.href) return 'link';
  if (c.past) return null;
  if (c.info.state === 'free') return 'toggle';
  if (c.info.state === 'blocked' && c.info.blockId) return 'toggle';
  if (c.info.state === 'closed' && c.info.reason === 'not_opened') return 'open';
  if (c.info.state === 'closed') return 'toggle';
  return null;
}

export function MiniCalendar({ cal, back }: {
  cal: { month: string; title: string; prev: string; next: string; cells: MiniDay[] }; back: string;
}) {
  return (
    <>
      <div className="cal-head">
        <span className="cal-month">{cal.title}</span>
        <span className="cal-nav">
          <Link href={`/partner?mesec=${cal.prev}`} aria-label="Предишен месец" scroll={false}>{prevIcon}</Link>
          <Link href={`/partner?mesec=${cal.next}`} aria-label="Следващ месец" scroll={false}>{nextIcon}</Link>
        </span>
      </div>
      <div className="cal-dow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
      <form className="cal-days" action={toggleDayAction}>
        <input type="hidden" name="back" value={back} />
        {cal.cells.map(c => {
          const s = c.info?.state;
          const cls = ['cal-day', c.out && 'is-out', s === 'booked' && 'is-booked', s === 'held' && 'is-hold', s === 'blocked' && 'is-blocked',
            s === 'closed' && c.info?.reason === 'not_opened' && 'po-closed', c.today && 'is-today'].filter(Boolean).join(' ');
          const how = clickOf(c);
          if (how === 'link') return <Link key={c.date} className={cls} href={c.href!} title={c.info?.label}>{c.n}</Link>;
          if (how === 'toggle') return <button key={c.date} className={cls} type="submit" name="date" value={c.date} title={c.info?.label}>{c.n}</button>;
          if (how === 'open') return <button key={c.date} className={cls} type="submit" name="date" value={`open:${c.date}`}>{c.n}</button>;
          return <span key={c.date} className={cls}>{c.n}</span>;
        })}
      </form>
      <div className="cal-legend">
        <span><i style={{ background: 'var(--primary-600)' }} />Заето</span>
        <span><i style={{ background: 'var(--gold-50)', border: '1px solid var(--gold-200)' }} />Запазено</span>
        <span><i style={{ border: '1.5px solid var(--primary-600)' }} />Днес</span><span><i style={{ border: '1px dashed var(--neutral-300)' }} />Блокирано</span>
      </div>
    </>
  );
}

export function MonthGrid({ cells, back }: { cells: MiniDay[]; back: string }) {
  return (
    <>
      <div className="mdow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
      <form className="mdays" action={toggleDayAction}>
        <input type="hidden" name="back" value={back} />
        {cells.map(c => {
          const s = c.info?.state;
          const cls = ['mday', c.out && 'is-out', c.today && 'is-today', s === 'blocked' && 'is-blocked',
            s === 'closed' && c.info?.reason === 'not_opened' && 'po-closed'].filter(Boolean).join(' ');
          const chip = c.info?.chip
            ? <span className={`chip ${s === 'booked' ? 'chip--booked' : s === 'held' ? 'chip--hold' : 'chip--blocked'}`} title={c.info.chip}>{c.info.chip}</span>
            : null;
          const inner = <><span className="mday-n">{c.n}</span>{chip}</>;
          const how = clickOf(c);
          if (how === 'link') return <Link key={c.date} className={cls} href={c.href!} aria-label={`${c.n} · ${c.info?.label}`}>{inner}</Link>;
          if (how === 'toggle') return <button key={c.date} className={cls} type="submit" name="date" value={c.date} aria-label={`${c.n} · ${c.info?.label}`}>{inner}</button>;
          if (how === 'open') return <button key={c.date} className={cls} type="submit" name="date" value={`open:${c.date}`} aria-label={`${c.n}`}>{inner}</button>;
          return <div key={c.date} className={cls}>{inner}</div>;
        })}
      </form>
    </>
  );
}
