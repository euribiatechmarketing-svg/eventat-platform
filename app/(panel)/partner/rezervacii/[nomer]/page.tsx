// Резервация (prototype vendor/booking.html; SCREENS §7 `/partner/rezervacii/[nomer]`).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { getBookingForPartner, phoneDisplay, timeRange } from '@/lib/domain/bookings';
import { BOOKING_BADGE, bookingPageExtras } from '@/lib/domain/views-partner-ops';
import { date, dateTime, money, moneyShort } from '@/lib/format';
import { Num } from '../../_ops/num';
import { CancelBooking, TopbarTitleText } from '../../_ops/ui';
import { requestCancellationAction } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ nomer: string }> }) {
  return { title: `Резервация · № ${decodeURIComponent((await params).nomer)}` };
}

const I = {
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>,
};

type Tl = { done: boolean; icon: ReactNode; title: string; time: string };

export default async function BookingPage({ params }: { params: Promise<{ nomer: string }> }) {
  const n = decodeURIComponent((await params).nomer);
  const u = await requireRole('partner', `/partner/rezervacii/${encodeURIComponent(n)}`);
  const actor = await actorFromUser(u);
  const b = await getBookingForPartner(actor, n).catch(e => { if ((e as Error).name === 'LifecycleError') notFound(); throw e; });
  // Before payment (and when it never came) the record is the request.
  if (['awaiting_payment', 'payment_expired', 'approval_withdrawn'].includes(b.status)) redirect(`/partner/zayavki/${encodeURIComponent(n)}`);
  const x = await bookingPageExtras(actor, { number: n });
  if (!x) notFound();

  const quote = x.kind !== 'package';
  const held = b.status === 'confirmed' || b.status === 'cancellation_requested';
  const badge = BOOKING_BADGE[b.status];
  const title = `${b.eventType.name} · ${b.hosts ?? b.client.name}`;
  const partnerCents = b.status === 'cancelled' ? (x.cancelledPartnerCents ?? 0) : (x.line?.amountCents ?? b.money.partnerAmountCents);
  const messages = b.conversationId ? `/partner/saobshteniya/${b.conversationId}` : '/partner/saobshteniya';
  const canCancel = b.status === 'confirmed' && b.daysToEvent >= 0;
  // ‹Сигнал до екипа›: the booking's case once there is one (one per booking, SPEC X2), else the form while a case can be opened.
  const reportHref = b.hasDispute ? `/partner/poddrazhka/${encodeURIComponent(n)}`
    : ['confirmed', 'cancellation_requested', 'completed'].includes(b.status) ? `/partner/poddrazhka/nov?rezervaciya=${encodeURIComponent(b.number)}` : null;
  const dur = x.duration ? x.duration.charAt(0).toLowerCase() + x.duration.slice(1) : null;

  const tl: Tl[] = [{ done: true, icon: I.check, title: 'Заявката е одобрена', time: dateTime(b.approvedAt) }];
  if (b.paidAt) tl.push({ done: true, icon: I.check, title: 'Плащането е получено', time: `${date(b.paidAt)} · ${money(b.money.paidByClientCents || b.money.amountCents)}` });
  if (held || b.status === 'completed') tl.push({ done: true, icon: I.check, title: 'Датата е блокирана', time: `${date(b.eventDate)} в календара ви` });
  if (b.status === 'cancellation_requested' && x.cancellationRequestedAt) tl.push({ done: false, icon: I.clock, title: 'Искане за анулиране', time: dateTime(x.cancellationRequestedAt) });
  if (b.status === 'cancelled') tl.push({ done: true, icon: I.check, title: 'Анулирана', time: b.cancelledAt ? dateTime(b.cancelledAt) : '' });
  if (partnerCents > 0 && b.status !== 'cancellation_requested') {
    const paid = x.line?.status === 'paid';
    tl.push({ done: paid, icon: I.clock, title: paid ? 'Изплатено' : 'Изплащането предстои', time: `${date(b.money.payoutDate)} · ${money(partnerCents)}` });
  }

  return (
    <div className="po">
      <TopbarTitleText text={`Резервация\u00a0·\u00a0№\u00a0${b.number}`} short={`№\u00a0${b.number}`} />
      <Link className="crumb" href="/partner/rezervacii">{I.back}Назад към резервациите</Link>

      <div className="page-head">
        <div>
          <h1 className="page-title"><Num>{title}</Num></h1>
          <p className="page-sub">№ {b.number} · {date(b.eventDate)} · {b.location}</p>
        </div>
        <div className="page-head-right">
          <span className={`badge ${badge.cls} badge--dot`}>{badge.label}</span>
          {b.daysToEvent > 0 && b.status !== 'cancelled' && <span className="badge badge--primary">след {b.daysToEvent} {b.daysToEvent === 1 ? 'ден' : 'дни'}</span>}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Събитието</h2>
              {held && <span className="badge badge--success badge--dot">Датата е блокирана</span>}
            </div>
            <div className="kv">
              <div className="kv-item"><div className="kv-label">Тип събитие</div><div className="kv-value">{b.eventType.name}</div></div>
              <div className="kv-item"><div className="kv-label">Дата</div><div className="kv-value">{date(b.eventDate)} <small>{b.eventWeekday}</small></div></div>
              <div className="kv-item"><div className="kv-label">Час</div><div className="kv-value">{timeRange(b.startTime, b.endTime)} {b.startTime && dur && <small>{dur} по пакета</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Локация</div><div className="kv-value">{b.venueName ?? b.cityName ?? '—'} {b.venueName && (b.locality || b.cityName) && <small>{b.locality ?? b.cityName}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Гости</div><div className="kv-value">{b.guests} души</div></div>
              <div className="kv-item"><div className="kv-label">Пакет</div><div className="kv-value">{b.serviceTitle} <small>{quote ? 'по оферта' : 'фиксирана цена'}</small></div></div>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Клиентът</h2>
              <Link className="btn btn--outline btn--sm" href={messages} style={{ marginLeft: 'auto' }}>Пиши на клиента</Link>
            </div>
            <div className="client">
              <span className="avatar avatar--lg">{x.client.initials}</span>
              <div>
                <div className="client-name">{x.client.name}</div>
                <div className="client-meta">{x.client.meta}</div>
              </div>
            </div>
            <div className="client-stats">
              <div><div className="client-stat-value">{x.client.bookings}</div><div className="client-stat-label">Резервации</div></div>
              {x.client.since && <div><div className="client-stat-value">{x.client.since}</div><div className="client-stat-label">Клиент от</div></div>}
            </div>
            {b.client.phone && <div className="kv-item" style={{ marginTop: 16 }}><div className="kv-label">Телефон за деня на събитието</div><div className="kv-value">{phoneDisplay(b.client.phone)}</div></div>}
            {b.client.phone
              ? <p className="panel-note">Договорките остават в разговора в платформата — така има писмена история на всичко договорено. Телефонът е за деня на събитието.</p>
              : b.status !== 'cancelled' && <p className="panel-note">Телефонът на клиента се показва след потвърдена резервация. Дотогава си пишете в платформата.</p>}
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Какво включва пакетът</h2></div>
            <div className="svc">
              <span className="svc-thumb" style={x.serviceThumb ? { backgroundImage: `url('${x.serviceThumb}')` } : undefined} />
              <div>
                <div className="svc-name">{b.serviceTitle}</div>
                {(b.serviceSummary || x.duration) && <div className="svc-desc">{[b.serviceSummary, x.duration].filter(Boolean).map(s => s!.replace(/\.$/, '')).join('. ')}.</div>}
              </div>
              <div className="svc-price">
                <div className="svc-price-value">{moneyShort(b.money.amountCents)}</div>
                <div className="svc-price-note">{quote ? 'по оферта' : 'фиксирана цена'}</div>
              </div>
            </div>
            {b.inclusions.length > 0 && (
              <div className="vbk-sep">
                <div className="rules vbk-inc">
                  {b.inclusions.map(t => <div key={t} className="rule"><span className="rule-num">✓</span><span>{t}</span></div>)}
                </div>
              </div>
            )}
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Пари</h2>
              {b.paidAt && <span className="badge badge--success badge--dot">Платена на {date(b.paidAt)}</span>}
            </div>
            <div className="vbk-money">
              <div>
                <div className="split"><span>Сума</span><b>{money(b.money.amountCents)}</b></div>
                <div className="split is-total"><span>Получавате</span><b>{money(partnerCents)}</b></div>
              </div>
              <div className="kv">
                <div className="kv-item"><div className="kv-label">Платено от клиента</div><div className="kv-value">{b.paidAt ? <>{date(b.paidAt)} <small>през платформата</small></> : '—'}</div></div>
                <div className="kv-item"><div className="kv-label">Изплащане</div><div className="kv-value">{partnerCents > 0 ? <>{date(b.money.payoutDate)} <small>първата партида след събитието</small></> : '—'}</div></div>
                <div className="kv-item"><div className="kv-label">Състояние</div><div className="kv-value">{x.line?.state ? <>{x.line.state.label} {x.line.state.note && <small>{x.line.state.note}</small>}</> : '—'}</div></div>
                <div className="kv-item"><div className="kv-label">Сметка</div><div className="kv-value">{x.account ? <>{x.account.masked} <small>{x.account.bank}</small></> : '—'}</div></div>
              </div>
            </div>
            <p className="panel-note"><strong>Как работи:</strong> сумата се задържа до събитието и се превежда на 1-во или 15-то число след него.</p>
          </section>
        </div>

        <aside>
          <div className="panel">
            <h3 className="panel-title">Действия</h3>
            <div className="panel-actions">
              <Link className="btn btn--primary btn--block" href={messages}>Пиши на клиента</Link>
              <Link className="btn btn--outline btn--block" href={`/partner/kalendar?mesec=${b.eventDate.slice(0, 7)}`}>Виж в календара</Link>
              {reportHref && <Link className="btn btn--outline btn--block" href={reportHref}>Сигнал до екипа</Link>}
              {canCancel && <CancelBooking number={b.number} action={requestCancellationAction} />}
            </div>
            {canCancel && <p className="panel-note">Ако анулирате, изпращаме искането до екипа — той се свързва с клиента и освобождава датата.</p>}
          </div>

          <div className="panel">
            <h3 className="panel-title">Състояние</h3>
            <div className="tl">
              {tl.map((t, i) => (
                <div key={i} className={`tl-item ${t.done ? 'is-done' : 'is-current'}`}>
                  <span className="tl-dot">{t.done ? I.check : t.icon}</span>
                  <div><div className="tl-title">{t.title}</div>{t.time && <div className="tl-time">{t.time}</div>}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3 className="panel-title">Политика на анулиране</h3>
            <p className="panel-text" style={{ marginBottom: 0 }}>{x.policyText}</p>
            {b.policy.freeCancelUntil && <p className="panel-note"><strong>За тази резервация:</strong> безплатно до {date(b.policy.freeCancelUntil)}.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
