// /admin/klienti/[id] — admin/client.html (SCREENS §8): profile, spend and commission, events, bookings,
// open requests, state, support actions and the team's notes.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import '@/styles/m-admin-ops.css';
import { can } from '@/lib/domain/actor';
import { NotFoundError } from '@/lib/domain/catalogue-kit';
import { BOOKING_ADMIN, adminClientDetail } from '@/lib/domain/views-admin-ops';
import { now } from '@/lib/clock';
import { date, dateShort, dateTime, money, moneyShort, sofiaDate } from '@/lib/format';
import { shortName } from '@/lib/initials';
import { requireTeam } from '../../_ops/guard';
import { Badge, fromToday, initials, monthYearShort, n, Email } from '../../_ops/fmt';
import { ActionDialog, MailLink, NoteOnBlur, RowLink } from '../../_ops/ui';
import { addClientNoteAction, blockClientAction } from '../actions';

export const metadata = { title: 'Профил на клиент' };

const Lock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>;

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireTeam(undefined, `/admin/klienti/${id}`);
  let d;
  try { d = await adminClientDetail(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const at = await now();
  const today = sofiaDate(at);
  const c = d.client;
  const finance = can(actor, 'view_finance');
  const back = `/admin/klienti/${c.id}`;
  const upcoming = d.events.filter(e => e.upcoming).length;
  const past = d.events.length - upcoming;
  const reqParts = [
    d.reqCounts.waiting ? `${n(d.reqCounts.waiting, 'чака', 'чакат')} отговор` : null,
    d.reqCounts.awaitingPayment ? `${n(d.reqCounts.awaitingPayment, 'чака', 'чакат')} плащане` : null,
    d.reqCounts.declined ? n(d.reqCounts.declined, 'отказана', 'отказани') : null,
  ].filter(Boolean).join(' · ');
  const paidTotal = d.bookings.reduce((s, b) => s + b.amountCents, 0);
  const due = d.state.reviewsDue[0];
  const events = [...d.events.filter(e => e.upcoming), ...d.events.filter(e => !e.upcoming).reverse()];

  return (
    <div className="ops-page">
      <Link className="crumb" href="/admin/klienti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>Клиенти</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">Профил на клиент</h1>
          <p className="page-sub">{[c.typeLabel, c.cityName, `регистрация от ${date(c.createdAt)}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="page-head-right"><Badge tone={c.badge.tone}>{c.badge.label}</Badge></div>
      </div>

      <div className={`gmv${finance ? '' : ' ops-gmv--3'}`} style={{ marginBottom: 20 }}>
        {finance && (
          <div className="gmv-cell gmv-cell--lead">
            <span className="gmv-l">Похарчени общо</span>
            <span className="gmv-v">{moneyShort(d.spentCents)}</span>
            <span className="gmv-d is-flat">от тях {moneyShort(d.commissionCents)} комисиона за платформата</span>
          </div>
        )}
        <div className={`gmv-cell${finance ? '' : ' gmv-cell--lead'}`}>
          <span className="gmv-l">Резервации</span>
          <span className="gmv-v">{d.bookings.length}</span>
          <span className="gmv-d is-flat">{d.reqCounts.awaitingPayment ? `${n(d.reqCounts.awaitingPayment, 'чака', 'чакат')} плащане` : d.bookings.length ? 'всички платени' : ''}</span>
        </div>
        <div className="gmv-cell">
          <span className="gmv-l">Заявки</span>
          <span className="gmv-v">{d.requests.length}</span>
          {reqParts && <span className="gmv-d is-flat">{reqParts}</span>}
        </div>
        <div className="gmv-cell">
          <span className="gmv-l">Събития</span>
          <span className="gmv-v">{d.events.length}</span>
          {d.events.length > 0 && <span className="gmv-d is-flat">{n(upcoming, 'предстоящо', 'предстоящи')}, {n(past, 'приключило', 'приключили')}</span>}
        </div>
      </div>

      <div className="adm-grid adm-grid--wide">
        <div>
          <section className="dcard">
            <div className="cprof-id">
              <span className="avatar avatar--lg">{initials(c.name)}</span>
              <div>
                <div className="cprof-id-n">{c.name}</div>
                <div className="cprof-id-s">{[c.typeLabel, c.cityName, c.email].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="cprof-id-end">
                <span className="cprof-id-l">Клиент от</span>
                <span className="cprof-id-v">{date(c.createdAt)}</span>
              </div>
            </div>
            <div className="kv">
              <div className="kv-item"><div className="kv-label">Имейл</div><div className="kv-value"><Email value={c.email} />{c.emailVerified && <small>потвърден</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Телефон</div><div className="kv-value">{c.phone || '—'}</div></div>
              <div className="kv-item"><div className="kv-label">Град</div><div className="kv-value">{c.cityName || '—'}</div></div>
              <div className="kv-item"><div className="kv-label">Състояние на профила</div><div className="kv-value">{c.badge.label}{c.banned ? (c.banReason && <small>{c.banReason}</small>) : c.badge.label === 'Активен' && <small>без ограничения</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Начин на плащане</div><div className="kv-value">{d.card ? `Карта •••• ${d.card.last4}` : '—'}{d.card && <small>през платформата</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Последен вход</div><div className="kv-value">{c.lastLoginAt ? dateTime(c.lastLoginAt) : '—'}{c.lastLoginAt && c.lastLoginCity && <small>от {c.lastLoginCity}</small>}</div></div>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Събития</h2>
              <span className="badge">{d.events.length} общо</span>
            </div>
            {events.length ? events.map(e => (
              <Link key={e.id} className={`cprof-ev${e.upcoming ? '' : ' cprof-ev--past'}`} href={`/admin/rezervacii?sabitie-id=${e.id}`}>
                <span className="cprof-ev-d">
                  <span className="cprof-ev-dd">{Number(e.date.slice(8, 10))}</span>
                  <span className="cprof-ev-dm">{monthYearShort(e.date)}</span>
                </span>
                <span>
                  <span className="cprof-ev-n">{e.title}</span>
                  <span className="cprof-ev-s">{[e.place, e.guests ? n(e.guests, 'гост', 'гости') : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="cprof-ev-end">
                  <span className="cprof-ev-when">{fromToday(e.date, today, at)}</span>
                  {e.upcoming ? <Badge tone="primary">Предстоящо</Badge> : <span className="badge">Приключило</span>}
                </span>
              </Link>
            )) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Резервации</h2>
              {d.bookings.length > 0 && <span className="badge badge--success">{n(d.bookings.length, 'платена', 'платени')}{finance ? ` · ${moneyShort(paidTotal)}` : ''}</span>}
            </div>
            {d.bookings.length ? (
              <div className="ops-tbl-wrap">
                <table className="tbl ops-tbl">
                  <thead><tr><th>Резервация</th><th>Изпълнител</th><th style={{ textAlign: 'right' }}>Сума</th>{finance && <th style={{ textAlign: 'right' }}>Комисиона</th>}<th>Статус</th></tr></thead>
                  <tbody>
                    {d.bookings.map(b => (
                      <RowLink key={b.number} href={`/admin/rezervacii/${encodeURIComponent(b.number)}`}>
                        <td><Link className="tbl-event cprof-link ops-link" href={`/admin/rezervacii/${encodeURIComponent(b.number)}`}>{b.number}</Link><div className="tbl-sub">{b.eventTitle} · {dateShort(b.eventDate)}</div></td>
                        <td><div className="tbl-event">{b.partnerName}</div><div className="tbl-sub">{b.serviceTitle}</div></td>
                        <td className="num">{money(b.amountCents)}</td>
                        {finance && <td className="num strong">{money(b.commissionCents)}</td>}
                        <td><Badge tone={BOOKING_ADMIN[b.status]?.tone ?? ''}>{BOOKING_ADMIN[b.status]?.label}</Badge></td>
                      </RowLink>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Заявки</h2>
              <span className="badge">{d.requests.length} общо</span>
            </div>
            {d.requests.length ? (
              <div className="ops-tbl-wrap">
                <table className="tbl ops-tbl">
                  <thead><tr><th>Заявка</th><th>Изпълнител</th><th>Събитие</th><th style={{ textAlign: 'right' }}>Сума</th><th>Статус</th></tr></thead>
                  <tbody>
                    {d.requests.map(r => {
                      const cells = (
                        <>
                          <td>{r.hasBooking ? <Link className="tbl-event cprof-link ops-link" href={`/admin/rezervacii/${encodeURIComponent(r.number)}`}>{r.number}</Link> : <div className="tbl-event">{r.number}</div>}<div className="tbl-sub">{dateShort(r.sentAt)}</div></td>
                          <td><div className="tbl-event">{r.partnerName}</div><div className="tbl-sub">{r.categoryName}</div></td>
                          <td className="muted">{r.eventTitle}</td>
                          <td className="num">{r.amountCents != null ? money(r.amountCents) : '—'}</td>
                          <td><Badge tone={r.badge.tone}>{r.badge.label}</Badge></td>
                        </>
                      );
                      return r.hasBooking ? <RowLink key={r.number} href={`/admin/rezervacii/${encodeURIComponent(r.number)}`}>{cells}</RowLink> : <tr key={r.number}>{cells}</tr>;
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>
        </div>

        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Поддръжка</h2></div>
            <div className="cprof-acts">
              <MailLink className="btn btn--outline btn--block" href={`mailto:${c.email}`} toastText="Отваряме имейл до клиента">Свържи се</MailLink>
              {d.canBlock && !c.banned && (
                <ActionDialog trigger="Блокирай профила" triggerClass="btn btn--ghost btn--block cprof-danger" title="Блокирай профила" submitLabel="Блокирай профила"
                  submitClass="btn btn--danger" action={blockClientAction} hidden={{ clientId: c.id }}>
                  <div className="cprof-id" style={{ borderBottom: 0, paddingBottom: 0, marginBottom: 0 }}>
                    <span className="avatar">{initials(c.name)}</span>
                    <div><div className="cprof-id-n" style={{ fontSize: 18 }}>{c.name}</div><div className="cprof-id-s">{c.email}</div></div>
                  </div>
                </ActionDialog>
              )}
            </div>
            <NoteOnBlur action={addClientNoteAction} label="Вътрешна бележка" hidden={{ clientId: c.id, back }}
              hint={<div className="cprof-only"><Lock /><span>Бележката се вижда само от екипа на платформата.</span></div>} />
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Състояние</h2></div>
            <div className="mini"><span><span className="mini-n">Отворени спорове</span><span className="mini-s">{d.state.disputesTotal ? n(d.state.disputesTotal, 'спор', 'спора') : 'няма история'}</span></span><span className="mini-end"><span className="mini-v">{d.state.openDisputes}</span></span></div>
            <div className="mini"><span><span className="mini-n">Анулирани резервации</span>{d.state.cancelled === 0 && <span className="mini-s">няма история</span>}</span><span className="mini-end"><span className="mini-v">{d.state.cancelled}</span></span></div>
            <div className="mini"><span><span className="mini-n">Оставени ревюта</span>{due && <span className="mini-s">{d.state.reviewsDue.length} чака — {due.title}, {dateShort(due.date)}</span>}</span><span className="mini-end"><span className="mini-v">{d.state.reviews}</span></span></div>
            <div className="mini"><span><span className="mini-n">Отказани заявки</span><span className="mini-s">{d.state.declined === 0 ? 'няма история' : d.state.declinedDateTaken ? (d.state.declined === 2 ? 'и в двата случая датата е била заета' : 'датата е била заета') : ''}</span></span><span className="mini-end"><span className="mini-v">{d.state.declined}</span></span></div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Бележки на екипа</h2></div>
            {d.notes.length ? d.notes.map(x => (
              <div className="rev" key={x.id}>
                <div className="rev-head">
                  <span className="avatar avatar--sm">{initials(x.authorName)}</span>
                  <div><div className="rev-name">{shortName(x.authorName)}</div><div className="rev-meta">{dateTime(x.at)}</div></div>
                </div>
                <div className="rev-text">{x.body}</div>
              </div>
            )) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>
        </aside>
      </div>
    </div>
  );
}
