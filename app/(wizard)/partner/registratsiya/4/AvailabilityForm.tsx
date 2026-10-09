'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { HORIZONS, LEAD_TIMES, WEEKDAYS_SHORT } from '@/lib/domain/onboarding-labels';
import { Field, WizardForm, useStepState } from '../_ui/WizardForm';
import { ChevronLeft, ChevronRight, Clock, SelectChevron } from '../_ui/icons';
import { availabilityAction, toggleBlockAction } from './actions';

type Mode = 'one' | 'limit' | 'unlimited';
type Cell = { date: string; day: number; out: boolean; past: boolean; today: boolean; blocked: boolean };
type Props = {
  values: { bookingsPerDayMode: Mode; maxBookingsPerDate: number; leadTimeDays: number; horizonMonths: number; workingDays: number[] };
  calendar: { month: string; title: string; cells: Cell[]; prev: string | null; next: string | null };
};

const CHECK = <span className="option-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>;
const MODES: { mode: Mode; title: string; sub: string; body: string; icon: React.ReactNode }[] = [
  { mode: 'one', title: 'Една на ден', sub: 'Само едно събитие', body: 'След потвърдена резервация денят се затваря за други клиенти.',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> },
  { mode: 'limit', title: 'Лимит на ден', sub: 'До определен брой', body: 'Например 2 събития на ден — обяд и вечер.',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></svg> },
  { mode: 'unlimited', title: 'Без лимит', sub: 'Колкото поемете', body: 'Подходящо за студия и услуги по запитване.',
    icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> },
];

function Calendar({ calendar }: Pick<Props, 'calendar'>) {
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [, start] = useTransition();
  // Fresh server data replaces the optimistic states.
  useEffect(() => { setOverride({}); }, [calendar]);
  const href = (m: string) => `/partner/registratsiya/4?mesec=${m}`;
  const toggle = (c: Cell) => {
    const was = override[c.date] ?? c.blocked;
    setOverride(o => ({ ...o, [c.date]: !was }));
    setPendingDate(c.date);
    start(async () => {
      const r = await toggleBlockAction(c.date);
      setPendingDate(null);
      if (!r.ok) setOverride(o => ({ ...o, [c.date]: was }));
    });
  };
  return (
    <div className="calendar">
      <div className="calendar-head">
        {calendar.prev
          ? <Link className="btn btn--outline btn--icon btn--sm" href={href(calendar.prev)} scroll={false} aria-label="Предишен месец"><ChevronLeft /></Link>
          : <button type="button" className="btn btn--outline btn--icon btn--sm" disabled aria-label="Предишен месец"><ChevronLeft /></button>}
        <strong>{calendar.title}</strong>
        {calendar.next
          ? <Link className="btn btn--outline btn--icon btn--sm" href={href(calendar.next)} scroll={false} aria-label="Следващ месец"><ChevronRight /></Link>
          : <button type="button" className="btn btn--outline btn--icon btn--sm" disabled aria-label="Следващ месец"><ChevronRight /></button>}
      </div>
      <div className="calendar-grid">
        {WEEKDAYS_SHORT.map(d => <div key={d} className="calendar-dow" aria-hidden="true">{d}</div>)}
        {calendar.cells.map(c => {
          if (c.out) return <div key={c.date} className="calendar-day calendar-day--off">{c.day}</div>;
          if (c.past) return <div key={c.date} className={`calendar-day m-past${c.blocked ? ' calendar-day--blocked' : ''}`}>{c.day}</div>;
          const blocked = override[c.date] ?? c.blocked;
          return (
            <button key={c.date} type="button" data-date={c.date} aria-pressed={blocked} aria-label={`${c.day} ${calendar.title}`}
              className={`calendar-day${blocked ? ' calendar-day--blocked' : ''}${c.today ? ' calendar-day--today' : ''}${pendingDate === c.date ? ' m-pending' : ''}`}
              onClick={() => toggle(c)}>{c.day}</button>
          );
        })}
      </div>
    </div>
  );
}

function ModeCards({ initial, max }: { initial: Mode; max: number }) {
  const { state } = useStepState();
  const [mode, setMode] = useState<Mode>(initial);
  return (
    <section className="wiz-fieldset">
      <div className="wiz-fieldset-head">
        <div>
          <h2 className="wiz-fieldset-title" id="m-mode-t">Колко резервации приемате на ден?</h2>
          <p className="wiz-fieldset-sub">Изберете една на ден, ако услугата ви изключва друго събитие — например DJ на сватба.</p>
        </div>
      </div>
      <div className="wiz-row--3" role="radiogroup" aria-labelledby="m-mode-t" aria-describedby={state.fields?.bookingsPerDayMode ? 'm-mode-e' : undefined}>
        {MODES.map(m => (
          <label key={m.mode} className={`option-card${mode === m.mode ? ' is-selected' : ''}`}>
            <input type="radio" name="bookingsPerDayMode" value={m.mode} checked={mode === m.mode} onChange={() => setMode(m.mode)}
              aria-labelledby={`m-mode-${m.mode}`} aria-describedby={`m-mode-${m.mode}-d`} />
            <div className="option-card-head">
              <div className="option-card-icon">{m.icon}</div>
              <div><p className="option-card-title" id={`m-mode-${m.mode}`}>{m.title}</p><p className="option-card-sub">{m.sub}</p></div>
              {CHECK}
            </div>
            <p className="option-card-body" id={`m-mode-${m.mode}-d`}>{m.body}</p>
          </label>
        ))}
      </div>
      {mode === 'limit' && (
        <div className="wiz-row">
          <Field name="maxBookingsPerDate" label="Максимум резервации за дата" required>
            <div className="select-wrap">
              <select id="f-maxBookingsPerDate" className="field-select" name="maxBookingsPerDate" defaultValue={String(Math.max(2, max))}>
                {[2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
        </div>
      )}
      {state.fields?.bookingsPerDayMode && <p className="m-section-error" role="alert" id="m-mode-e">{state.fields.bookingsPerDayMode}</p>}
    </section>
  );
}

export function AvailabilityForm({ values: v, calendar }: Props) {
  return (
    <WizardForm action={availabilityAction}>
      <ModeCards initial={v.bookingsPerDayMode} max={v.maxBookingsPerDate} />

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h2 className="wiz-fieldset-title">Кога приемате заявки</h2>
            <p className="wiz-fieldset-sub">Минимално време преди събитието и дните, в които работите.</p>
          </div>
        </div>
        <div className="wiz-row">
          <Field name="leadTimeDays" label="Минимум дни предварително" required message="Клиентите няма да могат да изпращат заявки в по-кратък срок.">
            <div className="select-wrap">
              <select id="f-leadTimeDays" className="field-select" name="leadTimeDays" defaultValue={String(v.leadTimeDays)}>
                {LEAD_TIMES.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
          <Field name="horizonMonths" label="Максимум напред във времето" message="Колко време напред клиентите могат да резервират.">
            <div className="select-wrap">
              <select id="f-horizonMonths" className="field-select" name="horizonMonths" defaultValue={String(v.horizonMonths)}>
                {HORIZONS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
        </div>
        <div className="wiz-row--full">
          <Field name="workingDays" label="Работни дни" message="Дните от седмицата, в които приемате събития. Останалите се показват като заети.">
            <div className="dow-row" role="group" aria-labelledby="f-workingDays-label" aria-describedby="f-workingDays-msg">
              {WEEKDAYS_SHORT.map((d, i) => (
                <label key={d} className="dow-pill ui-click"><input type="checkbox" name="workingDays" value={i + 1} defaultChecked={v.workingDays.includes(i + 1)} /><span>{d}</span></label>
              ))}
            </div>
          </Field>
        </div>
      </section>

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h2 className="wiz-fieldset-title">Блокирани дати</h2>
            <p className="wiz-fieldset-sub">Кликнете върху ден, за да го блокирате.</p>
          </div>
          <div className="cal-legend" aria-hidden="true">
            <span className="cal-legend-item"><span className="cal-dot cal-dot--free" />Свободно</span>
            <span className="cal-legend-item"><span className="cal-dot cal-dot--blocked" />Блокирано</span>
          </div>
        </div>
        <Calendar calendar={calendar} />
      </section>

      <div className="alert">
        <Clock className="alert-icon" />
        <div><p className="alert-title">Наличността е по дати</p><p className="alert-text">Клиентите избират дата, без час. Когато добавим часови интервали, ще ви уведомим — настройките ви ще се запазят.</p></div>
      </div>
    </WizardForm>
  );
}
