// Календар и наличност (prototype vendor/calendar.html; SCREENS §7 `/partner/kalendar?mesec=`; SPEC §4.13, §12.6).
import Link from 'next/link';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { monthGrid, today } from '@/lib/domain/availability';
import { calendarCells, isMonth, monthTitle, rangeText, shiftMonth } from '@/lib/domain/views-partner-ops';
import { Num } from '../_ops/num';
import { MonthGrid } from '../_ops/calendar';
import { BlockButtons, TodayButton } from '../_ops/ui';
import { blockDateAction, blockRangeAction, setRulesAction, unblockAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Календар и наличност' };

const prevIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>;
const nextIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ mesec?: string }> }) {
  const sp = await searchParams;
  const u = await requireRole('partner', '/partner/kalendar');
  const actor = await actorFromUser(u);
  const month = isMonth(sp.mesec) ? sp.mesec : (await today()).slice(0, 7);
  const [grid, view] = await Promise.all([monthGrid(actor, { month }), calendarCells(actor, { month })]);
  const back = `/partner/kalendar?mesec=${month}`;
  const r = grid.rules;
  const max = r.onePerDay ? 1 : r.maxBookingsPerDate;
  const title = monthTitle(month);

  return (
    <div className="po">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Num>{title}</Num></h1>
          <p className="page-sub">
            {plural(grid.counts.booked, 'заета дата', 'заети дати')} · {plural(grid.counts.held, 'запазена', 'запазени')} · {plural(grid.counts.blocked, 'блокирана ръчно', 'блокирани ръчно')}
          </p>
        </div>
        <div className="page-head-right">
          <BlockButtons today={view.today} back={back} rangeAction={blockRangeAction} dateAction={blockDateAction} />
        </div>
      </div>

      <div className="cal-grid">
        <section className="dcard">
          <div className="month-head">
            <span className="month-title">{title}</span>
            <span className="month-nav">
              <Link href={`/partner/kalendar?mesec=${shiftMonth(month, -1)}`} aria-label="Предишен месец" scroll={false}>{prevIcon}</Link>
              <Link href={`/partner/kalendar?mesec=${shiftMonth(month, 1)}`} aria-label="Следващ месец" scroll={false}>{nextIcon}</Link>
            </span>
            <span className="month-today"><TodayButton href={`/partner/kalendar?mesec=${view.today.slice(0, 7)}`} /></span>
          </div>
          <MonthGrid cells={view.cells} back={back} />
          <div className="cal-legend" aria-hidden="true">
            <span><i style={{ background: 'var(--primary-600)' }} />Потвърдено събитие</span>
            <span><i style={{ background: 'var(--gold-50)', border: '1px solid var(--gold-200)' }} />Запазена дата (24ч)</span>
            <span><i style={{ border: '1px dashed var(--neutral-300)' }} />Блокирана ръчно</span>
            <span><i style={{ border: '1.5px solid var(--primary-600)' }} />Днес</span>
          </div>
        </section>

        <aside>
          <div className="panel">
            <h2 className="panel-title">Правила за наличност</h2>
            <p className="panel-text">Определете колко събития приемате за един ден. Правилата важат за всички услуги.</p>

            <form className="rule-row" action={setRulesAction}>
              <input type="hidden" name="back" value={back} />
              {/* switching it off allows more than one: the stepper starts at 2 */}
              {r.onePerDay && <input type="hidden" name="max" value={Math.max(2, r.maxBookingsPerDate)} />}
              <div className="rule-text">
                <div className="rule-name">Само едно събитие на ден</div>
                <div className="rule-desc">След потвърдена резервация датата се затваря автоматично.</div>
              </div>
              <button type="submit" name="onePerDay" value={r.onePerDay ? 'off' : 'on'} className={`toggle${r.onePerDay ? ' is-on' : ''}`}
                role="switch" aria-checked={r.onePerDay} aria-label="Само едно събитие на ден" />
            </form>

            <form className="rule-row" action={setRulesAction}>
              <input type="hidden" name="back" value={back} />
              <div className="rule-text">
                <div className="rule-name" id="rule-max">Максимум резервации за дата</div>
                <div className="rule-desc">Важи само ако допускате повече от едно събитие.</div>
              </div>
              {/* ‹+› from ‹Само едно събитие на ден› allows two (the switch turns off); ‹−› down to 1 keeps the limit mode. */}
              <span className="stepper" role="group" aria-labelledby="rule-max">
                <button type="submit" name="max" value={Math.max(1, max - 1)} disabled={max <= 1} aria-label="−">−</button>
                <span aria-live="polite">{max}</span>
                <button type="submit" name="max" value={Math.min(9, max + 1)} disabled={max >= 9} aria-label="+">+</button>
              </span>
            </form>

            <form className="rule-row" action={setRulesAction}>
              <input type="hidden" name="back" value={back} />
              <div className="rule-text">
                <div className="rule-name">Приемам заявки само за избрани дати</div>
                <div className="rule-desc">Всички останали дати остават скрити за клиентите.</div>
              </div>
              <button type="submit" name="onlySelected" value={r.onlySelectedDates ? 'off' : 'on'} className={`toggle${r.onlySelectedDates ? ' is-on' : ''}`}
                role="switch" aria-checked={r.onlySelectedDates} aria-label="Приемам заявки само за избрани дати" />
            </form>

            <p className="panel-note">Резервациите са по дати, без часови интервали.</p>
          </div>

          <div className="panel">
            <h2 className="panel-title">Блокирани дати</h2>
            {grid.blocks.length === 0 && <div className="ui-empty">Няма записи в този изглед.</div>}
            {grid.blocks.map(b => (
              <form key={b.id} className="blk" action={unblockAction}>
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="blockId" value={b.id} />
                <div>
                  <div className="blk-date">{rangeText(b.startDate, b.endDate)}</div>
                  {b.reason && <div className="blk-reason">{b.reason}</div>}
                </div>
                <button type="submit" className="blk-x" aria-label={`Освободи ${rangeText(b.startDate, b.endDate)}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </form>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
