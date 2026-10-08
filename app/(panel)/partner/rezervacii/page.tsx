// Резервации (prototype vendor/bookings.html; SCREENS §7 `/partner/rezervacii?tab=&period=`).
import Link from 'next/link';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { BOOKING_PERIODS, BOOKING_TABS, bookingsLedger, type BookingPeriod, type BookingTab } from '@/lib/domain/views-partner-ops';
import { BookingTable } from '../_ops/rows';
import { FilterMenu, Submit } from '../_ops/ui';
import { exportBookingsAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Резервации' };

function href(tab: BookingTab, period: BookingPeriod | null) {
  const p = new URLSearchParams();
  if (tab !== 'predstoyashti') p.set('tab', tab);
  if (period) p.set('period', period);
  const s = p.toString();
  return `/partner/rezervacii${s ? `?${s}` : ''}`;
}

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  const sp = await searchParams;
  const u = await requireRole('partner', '/partner/rezervacii');
  const tab = (BOOKING_TABS.find(t => t.key === sp.tab)?.key ?? 'predstoyashti') as BookingTab;
  const period = (BOOKING_PERIODS.find(p => p.key === sp.period)?.key ?? null) as BookingPeriod | null;
  const v = await bookingsLedger(await actorFromUser(u), { tab, period });
  const count = { predstoyashti: v.counts.upcoming, priklyuchili: v.counts.past, anulirani: v.counts.cancelled };

  return (
    <div className="po">
      <div className="page-head">
        <div>
          <h1 className="page-title">Резервации</h1>
          <p className="page-sub">{v.counts.upcoming} предстоящи · {v.counts.pastThisYear} приключили през {v.year}</p>
        </div>
        <div className="page-head-right">
          <form action={exportBookingsAction}>
            <input type="hidden" name="back" value={href(tab, period)} />
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="period" value={period ?? ''} />
            <Submit className="btn btn--outline btn--sm">Експорт</Submit>
          </form>
        </div>
      </div>

      <div className="toolbar">
        <nav className="tab-bar">
          {BOOKING_TABS.map(t => (
            <Link key={t.key} className={`tab-bar-item${t.key === tab ? ' is-active' : ''}`} href={href(t.key, period)} scroll={false} aria-current={t.key === tab ? 'page' : undefined}>
              {t.label}{count[t.key] > 0 ? <> <span className="tab-count">{count[t.key]}</span></> : null}
            </Link>
          ))}
        </nav>
        <div className="toolbar-right">
          <FilterMenu label={period ? BOOKING_PERIODS.find(p => p.key === period)!.label : 'Период'} icon="filter"
            options={BOOKING_PERIODS.map(p => ({ label: p.label, href: href(tab, p.key === period ? null : p.key), active: p.key === period }))} />
        </div>
      </div>

      <section className="dcard">
        {v.months.length === 0 && <div className="ui-empty">Няма записи в този изглед.</div>}
        {v.months.map((m, i) => (
          <div key={m.month}>
            <div className="month-div" style={i === 0 ? { marginTop: 0 } : undefined}><b>{m.title}</b><span>{m.summary}</span></div>
            <BookingTable rows={m.rows} />
          </div>
        ))}
      </section>
    </div>
  );
}
