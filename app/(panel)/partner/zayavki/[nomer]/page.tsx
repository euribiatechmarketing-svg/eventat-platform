// Заявка (prototype vendor/request.html + vendor/request-approved.html; SCREENS §7 `/partner/zayavki/[nomer]`).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { getRequestForPartner } from '@/lib/domain/requests';
import { attachmentsText, hhmm, requestPageExtras, responseDueText, spaceTypeLabel } from '@/lib/domain/views-partner-ops';
import { now } from '@/lib/clock';
import { date, dateShort, dateTime, monthName, moneyShort, weekdayName } from '@/lib/format';
import { Num } from '../../_ops/num';
import { RequestActions, Submit, TopbarTitleText } from '../../_ops/ui';
import { approveAction, askAction, declineAction, remindAction, withdrawAction } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ nomer: string }> }) {
  return { title: `Заявка · № ${decodeURIComponent((await params).nomer)}` };
}

const I = {
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  card: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></svg>,
  ok: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 13l4 4L19 7" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>,
};

type Tl = { state: 'done' | 'current' | ''; icon: ReactNode; title: string; time: string };

export default async function RequestPage({ params }: { params: Promise<{ nomer: string }> }) {
  const n = decodeURIComponent((await params).nomer);
  const u = await requireRole('partner', `/partner/zayavki/${encodeURIComponent(n)}`);
  const actor = await actorFromUser(u);
  const r = await getRequestForPartner(actor, n).catch(e => { if ((e as { code?: string }).code === 'not_found' || (e as Error).name === 'LifecycleError') notFound(); throw e; });
  const bk = r.booking;
  // A paid booking lives on its own page.
  if (bk && ['confirmed', 'cancellation_requested', 'completed', 'cancelled'].includes(bk.status)) redirect(`/partner/rezervacii/${encodeURIComponent(n)}`);
  const x = await requestPageExtras(actor, { number: n, serviceId: r.serviceId, attachmentMediaIds: r.attachmentMediaIds });
  if (!x) notFound();
  const at = await now();

  const open = r.status === 'pending' || r.status === 'awaiting_confirmation';
  const awaiting = r.status === 'approved' && bk?.status === 'awaiting_payment';
  const quote = r.kind !== 'package';
  const amount = r.offer?.amountCents ?? r.amountCents;
  const canApprove = open && r.date.free && at < r.responseDueAt && amount != null && (r.kind === 'package' ? r.status === 'pending' : r.status === 'awaiting_confirmation');
  const wd = weekdayName(new Date(`${r.eventDate}T00:00:00Z`).getUTCDay());

  const badge = r.status === 'pending' ? (quote ? { label: 'Чака оферта', cls: 'badge--primary' } : { label: 'Нова заявка', cls: 'badge--primary' })
    : r.status === 'awaiting_confirmation' ? { label: 'Избрана оферта', cls: 'badge--primary' }
    : awaiting ? { label: 'Одобрена · чака плащане', cls: 'badge--pink' }
    : r.status === 'declined' ? { label: 'Отказана', cls: 'badge--danger' }
    : r.status === 'expired' ? { label: 'Изтекла', cls: '' }
    : bk?.status === 'payment_expired' ? { label: 'Неплатена заявка — датата е освободена', cls: '' }
    : null;
  const sub = awaiting && bk ? `одобрена на ${dateTime(r.approvedAt!)}`
    : r.status === 'declined' && r.declinedAt ? `отказана на ${dateTime(r.declinedAt)}`
    : `получена на ${dateTime(r.sentAt)}`;

  const tl: Tl[] = [{ state: 'done', icon: I.check, title: 'Клиентът изпрати заявка', time: dateTime(r.sentAt) }];
  if (open) {
    tl.push({ state: 'current', icon: I.clock, title: 'Чака вашия отговор', time: `Отговорете до ${responseDueText(r.responseDueAt)}` });
    tl.push({ state: '', icon: I.card, title: 'Плащане от клиента', time: 'В рамките на 24 часа след одобрение' });
    tl.push({ state: '', icon: I.ok, title: 'Потвърдена резервация', time: 'Датата се блокира в календара ви' });
  } else if (r.status === 'approved' && bk) {
    tl.push({ state: 'done', icon: I.check, title: 'Одобрихте заявката', time: `${dateTime(r.approvedAt!)} · датата е запазена` });
    if (awaiting) {
      tl.push({ state: 'current', icon: I.card, title: 'Клиентът плаща', time: `Краен срок: ${dateTime(bk.paymentDueAt)}` });
      tl.push({ state: '', icon: I.ok, title: 'Потвърдена резервация', time: 'Датата се блокира в календара ви' });
    } else if (bk.status === 'payment_expired') {
      tl.push({ state: 'done', icon: I.check, title: 'Неплатена заявка — датата е освободена', time: dateTime(bk.paymentDueAt) });
    } else if (bk.status === 'approval_withdrawn') {
      tl.push({ state: 'done', icon: I.check, title: 'Оттеглено одобрение', time: '' });
    }
  } else if (r.status === 'declined') {
    tl.push({ state: 'done', icon: I.check, title: 'Заявката е отказана', time: [r.declinedAt ? dateTime(r.declinedAt) : '', r.decline?.label].filter(Boolean).join(' · ') });
  } else if (r.status === 'expired') {
    tl.push({ state: 'done', icon: I.check, title: 'Изтекла', time: r.expiredAt ? dateTime(r.expiredAt) : '' });
  }

  const policyNote = <p className="panel-note"><strong>Вашата политика:</strong> {x.policy}</p>;
  const nextSteps = (
    <div className="panel">
      <h3 className="panel-title">Какво следва</h3>
      <div className="rules">
        {awaiting
          ? <div className="rule"><span className="rule-num">✓</span><span>Одобрихте заявката — датата е <strong>запазена за 24 часа</strong>.</span></div>
          : <div className="rule"><span className="rule-num">1</span><span>Одобрявате — датата се <strong>запазва за 24 часа</strong>.</span></div>}
        <div className="rule"><span className="rule-num">2</span><span>Клиентът плаща през платформата; сумата се <strong>задържа</strong> до събитието.</span></div>
        {r.partnerAmountCents != null && <div className="rule"><span className="rule-num">3</span><span>След събитието получавате <strong>{moneyShort(r.partnerAmountCents)}</strong>.</span></div>}
      </div>
    </div>
  );

  const total = bk ? bk.paymentDueAt.getTime() - (r.approvedAt?.getTime() ?? bk.paymentDueAt.getTime()) : 0;
  const left = bk ? Math.max(0, bk.paymentDueAt.getTime() - at.getTime()) : 0;

  return (
    <div className="po">
      <TopbarTitleText text={`Заявка · №\u00a0${r.number}`} />
      <Link className="crumb" href="/partner/zayavki">{I.back}Назад към заявките</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">Заявка от <Num>{x.client.name}</Num></h1>
          <p className="page-sub">{sub}</p>
        </div>
        {badge && <div className="page-head-right"><span className={`badge ${badge.cls} badge--dot`}>{badge.label}</span></div>}
      </div>

      <div className="detail-grid">
        <div>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Детайли за събитието</h2></div>
            <div className="kv">
              <div className="kv-item"><div className="kv-label">Тип събитие</div><div className="kv-value">{r.eventType.name}</div></div>
              <div className="kv-item"><div className="kv-label">Дата</div><div className="kv-value">{date(r.eventDate)} <small>{wd}</small></div></div>
              <div className="kv-item"><div className="kv-label">Начален час</div><div className="kv-value">{r.startTime ?? '—'} {r.endTime && <small>до около {r.endTime}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Гости</div><div className="kv-value">{r.guests} души</div></div>
              <div className="kv-item"><div className="kv-label">Локация</div><div className="kv-value">{r.venueName ?? r.cityName ?? '—'} {r.venueName && (r.locality || r.cityName) && <small>{r.locality ?? r.cityName}</small>}</div></div>
              {spaceTypeLabel(r.spaceType) && <div className="kv-item"><div className="kv-label">Тип пространство</div><div className="kv-value">{spaceTypeLabel(r.spaceType)}</div></div>}
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Заявена услуга</h2></div>
            <div className="svc">
              <span className="svc-thumb" style={x.serviceThumb ? { backgroundImage: `url('${x.serviceThumb}')` } : undefined} />
              <div>
                <div className="svc-name">{quote ? (r.offer?.title ?? r.serviceTitle) : r.serviceTitle}</div>
                {(r.offer?.description ?? x.serviceSummary) && <div className="svc-desc">{r.offer?.description ?? x.serviceSummary}</div>}
              </div>
              <div className="svc-price">
                <div className="svc-price-value">{amount == null ? '—' : moneyShort(amount)}</div>
                <div className="svc-price-note">{amount == null ? 'чака оферта' : quote ? 'по оферта' : 'фиксирана цена'}</div>
              </div>
            </div>
          </section>

          {r.note && (
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title">Бележка от клиента</h2></div>
              <p className="note">{r.note}</p>
            </section>
          )}

          {x.attachments.length > 0 && (
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title">Снимки за вдъхновение</h2></div>
              <p className="panel-text" style={{ marginBottom: 12 }}>{attachmentsText(x.client.name, x.attachments.length)}</p>
              <div className="rw-shots rw-shots--att">
                {x.attachments.map(src => <a key={src} className="rw-shot" href={src} target="_blank" rel="noreferrer" style={{ backgroundImage: `url('${src}')` }} aria-label="Снимки за вдъхновение" />)}
              </div>
            </section>
          )}

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Движение по заявката</h2></div>
            <div className="tl">
              {tl.map((t, i) => (
                <div key={i} className={`tl-item ${t.state === 'done' ? 'is-done' : t.state === 'current' ? 'is-current' : ''}`.trim()}>
                  <span className="tl-dot">{t.state === 'done' ? I.check : t.icon}</span>
                  <div><div className="tl-title">{t.title}</div>{t.time && <div className="tl-time">{t.time}</div>}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside>
          {open && (
            <div className="panel">
              <h3 className="panel-title">Свободни ли сте на <span className="num">{Number(r.eventDate.slice(8))}</span> {monthName(Number(r.eventDate.slice(5, 7)))}?</h3>
              <p className="panel-text">{r.date.free ? 'Датата е свободна в календара ви. Одобрението я запазва временно за 24 часа, докато клиентът плати.' : 'Датата е заета'}</p>
              <RequestActions number={r.number} canApprove={canApprove} canAsk approveAction={approveAction} askAction={askAction} declineAction={declineAction} />
              {policyNote}
            </div>
          )}

          {awaiting && bk && (
            <>
              <div className="countdown">
                <div className="countdown-label">Клиентът трябва да плати до</div>
                <div className="countdown-time">{hhmm(at, bk.paymentDueAt)}</div>
                <div className="countdown-note">часа и минути · {dateTime(bk.paymentDueAt)}<br />Датата е блокирана в календара ви дотогава.</div>
                <div className="countdown-bar"><i style={{ width: `${total > 0 ? Math.round((left / total) * 100) : 0}%` }} /></div>
              </div>
              <div className="panel">
                <h3 className="panel-title">Датата е запазена</h3>
                <p className="panel-text">{dateShort(r.eventDate)} е блокиран за {x.client.name}. Ако плащането не постъпи навреме, датата се освобождава автоматично.</p>
                <div className="panel-actions">
                  <form action={remindAction}><input type="hidden" name="number" value={r.number} /><Submit className="btn btn--outline btn--block">Напомни на клиента</Submit></form>
                  <form action={withdrawAction}><input type="hidden" name="number" value={r.number} /><Submit className="btn btn--ghost btn--block">Отмени одобрението</Submit></form>
                </div>
                {policyNote}
              </div>
            </>
          )}

          {(open || awaiting) && nextSteps}

          <div className="panel">
            <h3 className="panel-title">Клиент</h3>
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
            {!awaiting && <p className="panel-note">Телефонът на клиента се показва след потвърдена резервация. Дотогава си пишете в платформата.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
