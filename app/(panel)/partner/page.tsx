// Табло (prototype vendor/dashboard.html; SCREENS §7 `/partner?mesec=`; SPEC §12.5).
import Link from 'next/link';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { dashboardView, euros } from '@/lib/domain/views-partner-ops';
import { BOOKING_BADGE } from '@/lib/domain/views-partner-ops';
import { date, moneyShort } from '@/lib/format';
import { Num } from './_ops/num';
import { MiniCalendar } from './_ops/calendar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Табло' };

const chevron = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg>;
const star = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z" /></svg>;

export default async function PartnerDashboard({ searchParams }: { searchParams: Promise<{ mesec?: string }> }) {
  const sp = await searchParams;
  const u = await requireRole('partner', '/partner');
  const v = await dashboardView(await actorFromUser(u), { month: sp.mesec });
  const n = v.counts.newRequests, m = v.counts.awaitingPayment;
  const back = sp.mesec ? `/partner?mesec=${v.calendar.month}` : '/partner';

  return (
    <div className="po">
      <div className="page-head">
        <div>
          <h1 className="page-title">Добре дошли, <Num>{v.partnerName}</Num></h1>
          <p className="page-sub">Имате {n} {n === 1 ? 'нова заявка' : 'нови заявки'} и {m}, {m === 1 ? 'която чака' : 'които чакат'} плащане.</p>
        </div>
        <div className="page-head-right">
          <Link className="btn btn--outline btn--sm" href="/partner/kalendar">Блокирай дата</Link>
          <Link className="btn btn--primary btn--sm" href="/partner/uslugi/nova">Добави услуга</Link>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi kpi--accent">
          <div><div className="kpi-label">Нови заявки</div><div className="kpi-value">{n}</div></div>
          <span className="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5 5h14l2 8v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4z" /></svg></span>
        </div>
        <div className="kpi kpi--gold">
          <div><div className="kpi-label">Чакат плащане</div><div className="kpi-value">{m}</div></div>
          <span className="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>
        </div>
        <div className="kpi kpi--success">
          <div><div className="kpi-label">Предстоящи събития</div><div className="kpi-value">{v.counts.upcomingEvents}</div></div>
          <span className="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg></span>
        </div>
        <div className="kpi kpi--ink">
          <div><div className="kpi-label">Приходи този месец</div><div className="kpi-value">{euros(v.monthRevenueCents)} <small>€</small></div></div>
          <span className="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 11h20" /></svg></span>
        </div>
      </div>

      <div className="dash-grid">
        <div>
          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Нови заявки</h2>
              <span className="badge badge--primary">{n}</span>
              <Link className="link-more" href="/partner/zayavki">Виж всички {chevron}</Link>
            </div>
            {v.latestRequests.length === 0 && <div className="ui-empty">Няма записи в този изглед.</div>}
            {v.latestRequests.map(r => (
              <Link key={r.number} className="mini-req" href={r.href}>
                <span className="avatar">{r.initials}</span>
                <div>
                  <div className="mini-req-name">{r.clientName}</div>
                  <div className="mini-req-sub">{r.eventType} · {r.serviceLabel} · {r.place}</div>
                </div>
                <div className="mini-req-date">{date(r.eventDate)}</div>
                <div className="mini-req-price">{r.amountCents == null ? '—' : moneyShort(r.amountCents)}</div>
              </Link>
            ))}
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Предстоящи събития</h2>
              <Link className="link-more" href="/partner/kalendar">Календар {chevron}</Link>
            </div>
            {v.events.length === 0 && <div className="ui-empty">Няма записи в този изглед.</div>}
            {v.events.map(e => {
              const b = BOOKING_BADGE[e.status];
              return (
                <Link key={e.number} className="ev" href={e.href}>
                  <div className="ev-date"><div className="ev-day">{e.eventDate.slice(8)}</div><div className="ev-mon">{e.monthShort}</div></div>
                  <div>
                    <div className="ev-name">{e.title}</div>
                    <div className="ev-sub">{e.sub}</div>
                  </div>
                  <span className={`badge ${b.cls} badge--dot`}>{b.label}</span>
                </Link>
              );
            })}
          </section>
        </div>

        <aside>
          <div className="panel">
            <MiniCalendar cal={v.calendar} back={back} />
          </div>

          <div className="panel">
            <h3 className="panel-title">Приходи</h3>
            <div className="earn-row">
              <span className="earn-value">{moneyShort(v.revenue.cents)}</span>
              {v.revenue.deltaPct != null && (
                <span className={`earn-delta${v.revenue.deltaPct < 0 ? ' po-down' : ''}`}>{v.revenue.deltaPct < 0 ? '−' : '+'}{Math.abs(v.revenue.deltaPct)}% спрямо {v.revenue.prevMonthName}</span>
              )}
            </div>
            <div className="bars">
              {v.revenue.bars.map(b => <i key={b.label} className={b.now ? 'is-now' : undefined} style={{ height: `${b.pct}%` }} />)}
            </div>
            <div className="bars-x">{v.revenue.bars.map(b => <span key={b.label}>{b.label}</span>)}</div>
            <div className="earn-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15, color: 'var(--gold-600)' }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              За изплащане след събитията: <b>{moneyShort(v.revenue.toBePaidCents)}</b>
            </div>
          </div>

          {v.rating && (
            <div className="panel">
              <h3 className="panel-title">Рейтинг</h3>
              <div className="rate">
                <span className="rate-value">{v.rating.avgText}</span>
                <div>
                  <span className="stars" aria-label={v.rating.avgText}>{[1, 2, 3, 4, 5].map(i => <span key={i} className={i <= Math.round(v.rating!.avg) ? undefined : 'is-off'}>{star}</span>)}</span>
                  <div className="rate-count">от {v.rating.countLabel}{v.rating.responsiveness != null ? ` · ${v.rating.responsiveness}% отзивчивост` : ''}</div>
                </div>
              </div>
              {v.rating.latest && (
                <p className="quote">{v.rating.latest.body}
                  <cite>— {v.rating.latest.author}, {v.rating.latest.context}</cite>
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
