// Резервации — the month register (prototype admin/bookings.html; SCREENS §8 /admin/rezervacii).
import type { Metadata } from 'next';
import Link from 'next/link';
import '@/styles/m-admin-money.css';
import { PageChrome } from '../_money/chrome';
import { can } from '@/lib/domain/actor';
import { BOOKING_BADGE, BOOKING_TABS, bookingsRegister } from '@/lib/domain/views-admin-money';
import { dateShort, money, moneyShort, monthName, plural } from '@/lib/format';
import { adminActor, bookingPath, casePath } from '../_money/server';
import { FilterMenu, RowLink, Submit } from '../_money/ui';
import { exportBookingsAction, extendDeadlineAction } from './actions';

export const metadata: Metadata = { title: 'Резервации' };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;

export default async function AdminBookings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const params = { mesec: one(sp.mesec), kategoriya: one(sp.kategoriya), tab: one(sp.tab), q: one(sp.q), grad: one(sp.grad), 'sabitie-id': one(sp['sabitie-id']) };
  const self = `/admin/rezervacii${qs(params)}`;
  const actor = await adminActor(self);
  const r = await bookingsRegister(actor, { month: params.mesec, category: params.kategoriya, tab: params.tab, q: params.q, city: params.grad, eventId: params['sabitie-id'] });
  const href = (patch: Partial<typeof params>) => `/admin/rezervacii${qs({ ...params, ...patch })}`;
  const monthLower = monthName(Number(r.month.slice(5)));
  const att = r.attention;
  const disputes = can(actor, 'resolve_disputes');

  return (
    <div className="am">
      <PageChrome title="Резервации" />
      <div className="page-head">
        <div>
          <h1 className="page-title">Резервации</h1>
          <p className="page-sub">{r.total} през {monthLower} · {moneyShort(r.turnoverCents)} оборот · {plural(att.length, 'изисква', 'изискват')} намеса</p>
        </div>
        <div className="page-head-right">
          <form action={exportBookingsAction}>
            <input type="hidden" name="back" value={self} />
            <input type="hidden" name="month" value={r.month} />
            <input type="hidden" name="category" value={r.category?.slug ?? ''} />
            <input type="hidden" name="tab" value={r.tab} />
            <Submit className="btn btn--outline btn--sm">Експорт</Submit>
          </form>
        </div>
      </div>

      <div className="toolbar am-toolbar">
        <nav className="tab-bar">
          {BOOKING_TABS.map(t => (
            <Link key={t.key} className={`tab-bar-item${r.tab === t.key ? ' is-active' : ''}`} href={href({ tab: t.key === 'vsichki' ? undefined : t.key })} scroll={false}>
              {t.label} <span className="tab-count">{r.counts[t.key]}</span>
            </Link>
          ))}
        </nav>
        <div className="toolbar-right">
          <FilterMenu label={r.monthLabel} icon="calendar" options={r.monthOptions.map(m => ({ label: m.label, href: href({ mesec: m.value, 'sabitie-id': undefined }), active: m.value === r.month }))} />
          <FilterMenu label={r.category?.name ?? 'Категория'} icon="filter" options={[
            { label: 'Всички категории', href: href({ kategoriya: undefined }), active: !r.category },
            ...r.categories.map(c => ({ label: c.name, href: href({ kategoriya: c.slug }), active: r.category?.slug === c.slug })),
          ]} />
        </div>
      </div>

      {att.length > 0 && (
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Изискват намеса</h2>
            <span className="badge badge--danger">{att.length}</span>
          </div>
          <div className="am-tbl-wrap"><table className="tbl am-stack am-att">
            <thead><tr><th>Резервация</th><th>Страни</th><th style={{ textAlign: 'right' }}>Сума</th><th>Проблем</th><th style={{ textAlign: 'right' }}>Действие</th></tr></thead>
            <tbody>
              {att.map(a => (
                <RowLink key={a.number} href={bookingPath(a.number)}>
                  <td className="c-main"><div className="tbl-event">{a.number}</div><div className="tbl-sub">{dateShort(a.eventDate)} · {a.eventTypeName}</div></td>
                  <td className="c-side"><div className="tbl-event">{a.clientName}</div><div className="tbl-sub">{a.partnerName}</div></td>
                  <td className="num strong c-amount">{money(a.amountCents)}</td>
                  <td className="c-status"><span className={`badge ${a.badge.cls}`}>{a.badge.label}</span></td>
                  <td className="am-act c-action">
                    {a.problem === 'deadline' && a.canExtend ? (
                      <form action={extendDeadlineAction}>
                        <input type="hidden" name="number" value={a.number} />
                        <input type="hidden" name="back" value={self} />
                        <Submit className="btn btn--outline btn--sm">Удължи срока</Submit>
                      </form>
                    ) : a.disputeNumber && disputes ? (
                      <Link className="btn btn--outline btn--sm" href={casePath(a.disputeNumber)}>Виж спора</Link>
                    ) : (
                      <Link className="btn btn--outline btn--sm" href={bookingPath(a.number)}>Отвори</Link>
                    )}
                  </td>
                </RowLink>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      <section className="dcard">
        <div className="month-div" style={{ marginTop: 0 }}>
          <b>{r.monthLabel}</b>
          <span>{plural(r.total, 'резервация', 'резервации')} · {moneyShort(r.turnoverCents)} оборот{r.commissionCents !== null ? ` · ${moneyShort(r.commissionCents)} комисиона` : ''}</span>
        </div>
        {r.rows.length ? (
          <div className="am-tbl-wrap"><table className="tbl am-stack am-reg">
            <thead>
              <tr>
                <th>Дата</th><th>Резервация</th><th>Изпълнител</th><th style={{ textAlign: 'right' }}>Сума</th>
                {r.finance && <th style={{ textAlign: 'right' }}>Комисиона</th>}<th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map(b => (
                <RowLink key={b.id} href={bookingPath(b.number)}>
                  <td className="c-date"><div className="tbl-event">{dateShort(b.eventDate)}</div><div className="tbl-sub">{b.eventWeekday}</div></td>
                  <td className="c-main"><div className="tbl-event">{b.eventTypeName} · {b.clientName}</div><div className="tbl-sub">{[b.number, b.venue].filter(Boolean).join(' · ')}</div></td>
                  <td className="c-side"><div className="tbl-event">{b.partnerName}</div><div className="tbl-sub">{b.partnerCategory}</div></td>
                  <td className="num c-amount">{money(b.amountCents)}</td>
                  {r.finance && <td className="num strong c-com">{money(b.commissionCents ?? 0)}</td>}
                  <td className="c-status"><span className={`badge ${BOOKING_BADGE[b.status].cls}`}>{BOOKING_BADGE[b.status].label}</span></td>
                </RowLink>
              ))}
            </tbody>
          </table></div>
        ) : <div className="ui-empty">Няма записи в този изглед.</div>}
      </section>
    </div>
  );
}

function qs(p: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
}
