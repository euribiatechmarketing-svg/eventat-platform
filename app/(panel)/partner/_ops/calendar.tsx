// The dashboard's mini month and the calendar page's big month (prototype .cal-* / .mday).
// Booked and held days open their booking or request; a free day is blocked and a
// manually blocked day freed with one click (availability.toggleBlock); with
// ‹Приемам заявки само за избрани дати› a closed day is opened (availability.toggleOpenDate).
import Link from 'next/link';
import type { MiniDay } from '@/lib/domain/views-partner-ops';
import { date } from '@/lib/format';
import { toggleDayAction } from '../kalendar/actions';

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
const prevIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>;
const nextIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;

/** The day's name for screen readers: its chip and the legend's word for its state. In the month grid the name
 *  starts with the text the cell shows, in its order (WCAG 2.5.3) — ‹14 · Сватба · 120 гости · Потвърдено събитие›,
 *  ‹19 · Свободно›. The month page's heading names the month; the dashboard's small calendar shows only the number
 *  and has no heading, so its days carry the full date (‹14 юни 2026 · Потвърдено събитие · …›). A blocked day's
 *  chip (‹Блокирана›) is the start of its state word (‹Блокирана ръчно›), so it is not repeated. */
function dayName(c: MiniDay, full = false): string {
  const i = c.info;
  const chip = i?.chip && i.state !== 'blocked' ? i.chip : null;
  const parts = full ? [date(c.date), i?.label || null, chip] : [String(c.n), chip, i?.label || null];
  return parts.filter(Boolean).join(' · ');
}

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
      <div className="cal-dow" aria-hidden="true">{DOW.map(d => <span key={d}>{d}</span>)}</div>
      <form className="cal-days" action={toggleDayAction}>
        <input type="hidden" name="back" value={back} />
        {cal.cells.map(c => {
          const s = c.info?.state;
          const how = clickOf(c);
          const cls = ['cal-day', c.out && 'is-out', s === 'booked' && 'is-booked', s === 'held' && 'is-hold', s === 'blocked' && 'is-blocked',
            s === 'closed' && c.info?.reason === 'not_opened' && 'po-closed', c.today && 'is-today', !c.out && !how && 'po-still'].filter(Boolean).join(' ');
          if (how === 'link') return <Link key={c.date} className={cls} href={c.href!} title={c.info?.label} aria-label={dayName(c, true)}>{c.n}</Link>;
          if (how === 'toggle') return <button key={c.date} className={cls} type="submit" name="date" value={c.date} title={c.info?.label} aria-label={dayName(c, true)}>{c.n}</button>;
          if (how === 'open') return <button key={c.date} className={cls} type="submit" name="date" value={`open:${c.date}`} aria-label={dayName(c, true)}>{c.n}</button>;
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

/**
 * A chip's text in two parts — ‹Сватба› + ‹ · 120 гости›, ‹Запазена› + ‹ до 11:06› — so a narrow
 * day cell drops the second part (container query in m-partner-ops.css) instead of cutting the text.
 */
function ChipText({ text }: { text: string }) {
  const i = text.search(/ · | до /);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<span className="chip-more">{text.slice(i)}</span></>;
}

export function MonthGrid({ cells, back }: { cells: MiniDay[]; back: string }) {
  return (
    <>
      <div className="mdow" aria-hidden="true">{DOW.map(d => <span key={d}>{d}</span>)}</div>
      <form className="mdays" action={toggleDayAction}>
        <input type="hidden" name="back" value={back} />
        {cells.map(c => {
          const s = c.info?.state;
          const how = clickOf(c);
          const cls = ['mday', c.out && 'is-out', c.today && 'is-today', s === 'blocked' && 'is-blocked',
            s === 'closed' && c.info?.reason === 'not_opened' && 'po-closed', !c.out && !how && 'po-still'].filter(Boolean).join(' ');
          const chip = c.info?.chip
            ? <span className={`chip ${s === 'booked' ? 'chip--booked' : s === 'held' ? 'chip--hold' : 'chip--blocked'}`} title={c.info.chip}><ChipText text={c.info.chip} /></span>
            : null;
          // The space keeps the number and the chip apart in the text (‹14 Сватба›); the flex column drops it.
          const inner = <><span className="mday-n">{c.n}</span>{chip && ' '}{chip}</>;
          if (how === 'link') return <Link key={c.date} className={cls} href={c.href!} aria-label={dayName(c)}>{inner}</Link>;
          if (how === 'toggle') return <button key={c.date} className={cls} type="submit" name="date" value={c.date} aria-label={dayName(c)}>{inner}</button>;
          if (how === 'open') return <button key={c.date} className={cls} type="submit" name="date" value={`open:${c.date}`} aria-label={dayName(c)}>{inner}</button>;
          return <div key={c.date} className={cls}>{inner}</div>;
        })}
      </form>
    </>
  );
}
