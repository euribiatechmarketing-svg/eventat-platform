// One request (client/request-status.html → SCREENS §4 /akaunt/zayavki/[nomer]).
// Variants per state (SPEC §4.5); a confirmed booking is shown under ‹Резервации›.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Countdown } from '@/components/client-booking/Countdown';
import { Crumbs, Num, PartnerSum } from '@/components/client-booking/parts';
import { SubmitButton } from '@/components/client-booking/SubmitButton';
import { packageNameOf } from '@/lib/domain/bookings';
import { DECLINE_REASON_LABEL } from '@/lib/domain/requests';
import { clientRequestPage } from '@/lib/domain/views-client-booking';
import { date, dateTime, moneyShort, weekdayName } from '@/lib/format';
import { numberParam, orNotFound, requireClient } from '@/lib/client-booking/guard';
import { chooseOfferAction, watchDateAction, writeToPartnerAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Заявка' };

const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>;
const CLOCK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const CROSS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;

type Tl = { title: string; time?: string; state: 'done' | 'current' | 'next' | 'stop' };
/** The state each timeline mark draws, in words for screen readers. */
const TL_STATE: Record<Tl['state'], string> = { done: 'Готово', current: 'Текущ етап', next: 'Предстои', stop: 'Прекратено' };
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const weekdayOf = (d: string) => { const [y, m, day] = d.split('-').map(Number); return weekdayName(new Date(Date.UTC(y, m - 1, day)).getUTCDay()); };

export default async function RequestPage({ params }: { params: Promise<{ nomer: string }> }) {
  const { nomer } = await params;
  const number = numberParam(nomer);
  const n = encodeURIComponent(number);
  const { actor } = await requireClient(`/akaunt/zayavki/${n}`);
  const v = await orNotFound(clientRequestPage(actor, number));
  const { request: r, booking: b, offer: o, partner: p } = v;
  if (b && ['confirmed', 'cancellation_requested', 'completed', 'cancelled'].includes(b.status)) redirect(`/akaunt/rezervacii/${n}`);

  const at = new Date(v.nowIso);
  const state = b?.status === 'awaiting_payment' ? 'pay' : b?.status === 'payment_expired' ? 'payexp' : b?.status === 'approval_withdrawn' ? 'unapproved' : r.status;
  const payable = state === 'pay' && !!b && at < b.paymentDueAt;
  const amount = b?.amountCents ?? o?.amountCents ?? r.amountCents;

  const write = (
    <form action={writeToPartnerAction}>
      <input type="hidden" name="number" value={r.number} />
      <SubmitButton className="btn btn--outline">Пиши на изпълнителя</SubmitButton>
    </form>
  );
  const similar = <Link className="btn btn--primary" href={v.similarHref}>Виж подобни</Link>;

  let badge: { tone: string; text: string } | null = null;
  let title = '';
  let text: ReactNode = null;
  let actions: ReactNode = null;
  let clockTo: Date | null = null;
  switch (state) {
    case 'pay':
      badge = { tone: 'pink', text: 'Одобрена · чака плащане' };
      title = `${p.name} одобри заявката ви`;
      text = <>Датата <b style={{ color: 'var(--primary-900)' }}>{date(r.eventDate)}</b> е запазена за вас. За да потвърдите резервацията, платете в рамките на {v.payHours} {v.payHours === 1 ? 'час' : 'часа'} — след това датата се освобождава автоматично.</>;
      actions = <>{payable && <Link className="btn btn--primary" href={`/plashtane/${n}`}>Плати {moneyShort(b!.dueNowCents)}</Link>}{write}</>;
      clockTo = b!.paymentDueAt;
      break;
    case 'pending':
      badge = { tone: 'primary', text: 'Чака отговор' };
      title = 'Запитването е изпратено';
      text = <>Изпратихме запитването ви до {p.name} за {date(r.eventDate)}. Изпълнителят отговаря до {v.responseHours} часа. Плащате само ако заявката бъде одобрена.</>;
      actions = write;
      clockTo = r.responseDueAt;
      break;
    case 'offer_sent':
      badge = { tone: 'primary', text: 'Нова оферта' };
      title = `Получихте оферта от ${p.name}`;
      text = <>{p.name} отговори на запитването ви за {v.eventType.definite} с оферта за {low(o?.title ?? r.serviceTitle)}. Плащате едва след като изберете оферта и изпълнителят я потвърди.</>;
      actions = (
        <>
          <form action={chooseOfferAction}>
            <input type="hidden" name="number" value={r.number} />
            <SubmitButton className="btn btn--primary">Избери</SubmitButton>
          </form>
          {write}
        </>
      );
      break;
    case 'awaiting_confirmation':
      badge = { tone: 'primary', text: 'Избрана оферта' };
      title = o?.title ?? r.serviceTitle;
      text = <>Плащате едва след като изберете оферта и изпълнителят я потвърди.</>;
      actions = write;
      clockTo = r.responseDueAt;
      break;
    case 'declined': {
      const reason = r.declineReason ?? 'date_taken';
      badge = { tone: 'danger', text: DECLINE_REASON_LABEL[reason] };
      title = 'Заявката ви е отказана';
      text = reason === 'date_taken'
        ? <>{p.name} отказа заявката ви, защото датата {date(r.eventDate)} е заета. Не дължите нищо — плащате само за одобрени заявки.</>
        : <>{p.name} отказа заявката ви. Не дължите нищо — плащате само за одобрени заявки.</>;
      actions = (
        <>
          {similar}
          {v.canWatch && (
            <form action={watchDateAction}>
              <input type="hidden" name="number" value={r.number} />
              <SubmitButton className="btn btn--outline">Уведоми ме, ако се освободи</SubmitButton>
            </form>
          )}
        </>
      );
      break;
    }
    case 'expired':
      badge = { tone: 'danger', text: 'Изтекла' };
      title = 'Заявката ви отпадна';
      text = <>{p.name} не отговори на заявката ви в рамките на {v.responseHours} часа и тя отпадна автоматично. Не дължите нищо.</>;
      actions = similar;
      break;
    case 'payexp':
      badge = { tone: 'danger', text: 'Изтекъл срок за плащане' };
      title = 'Срокът за плащане изтече';
      text = <>Не получихме плащане по заявката ви към {p.name} в рамките на {v.payHours} {v.payHours === 1 ? 'час' : 'часа'}. Датата {date(r.eventDate)} е освободена автоматично и не дължите нищо.</>;
      actions = <Link className="btn btn--primary" href={`/partnyori/${p.slug}`}>Изпрати нова заявка</Link>;
      break;
    case 'unapproved':
      badge = { tone: 'danger', text: 'Оттеглено одобрение' };
      title = 'Одобрението е оттеглено';
      text = <>{p.name} отмени одобрението на заявка № {r.number}. Датата {date(r.eventDate)} вече не е запазена за вас и не дължите нищо.</>;
      actions = similar;
      break;
    default:
      title = p.name;
  }

  // ‹Движение по заявката›
  const tl: Tl[] = [{ title: 'Изпратихте запитване', time: dateTime(r.sentAt), state: 'done' }];
  if (o) tl.push({ title: 'Нова оферта', time: dateTime(o.sentAt), state: 'done' });
  if (o?.chosenAt) tl.push({ title: 'Избрана оферта', time: dateTime(o.chosenAt), state: 'done' });
  if (state === 'declined') tl.push({ title: 'Отказана заявка', time: r.declinedAt ? dateTime(r.declinedAt) : undefined, state: 'stop' });
  else if (state === 'expired') tl.push({ title: 'Изтекла заявка', time: r.expiredAt ? dateTime(r.expiredAt) : undefined, state: 'stop' });
  else if (state === 'withdrawn') { /* nothing more happens */ }
  else {
    if (b) tl.push({ title: 'Изпълнителят одобри', time: `${dateTime(b.approvedAt)} · датата е запазена`, state: 'done' });
    else tl.push({ title: 'Изпълнителят одобри', time: state === 'offer_sent' ? undefined : `Краен срок: ${dateTime(r.responseDueAt)}`, state: state === 'offer_sent' ? 'next' : 'current' });
    if (state === 'payexp') tl.push({ title: 'Изтекъл срок за плащане', time: dateTime(b!.paymentDueAt), state: 'stop' });
    else if (state === 'unapproved') tl.push({ title: 'Оттеглено одобрение', time: dateTime(b!.updatedAt), state: 'stop' });
    else {
      tl.push(state === 'pay'
        ? { title: 'Плащане', time: `Краен срок: ${dateTime(b!.paymentDueAt)}`, state: 'current' }
        : { title: 'Плащане', time: 'Плащате едва след одобрение от изпълнителя.', state: 'next' });
      tl.push({ title: 'Потвърдена резервация', time: 'Получавате потвърждение по имейл', state: 'next' });
    }
  }

  const venue = r.venueName || r.locality || v.cityName;
  const venueSmall = r.venueName ? (r.locality || v.cityName) : null;

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: 'Моите заявки', href: '/akaunt/zayavki' }, { label: `№ ${r.number}` }]} />

      <div className={`status-hero${clockTo ? '' : ' cb-solo'}`}>
        <div>
          {badge && <div className="sh-badge"><span className={`badge badge--${badge.tone} badge--dot`}>{badge.text}</span></div>}
          <h1 className="sh-t"><Num>{title}</Num></h1>
          {text && <p className="sh-d">{text}</p>}
          {actions && <div className="cb-actions">{actions}</div>}
        </div>
        {clockTo && (
          <div className="clock">
            <div className="clock-l">Остават</div>
            <div className="clock-v"><Countdown to={clockTo.toISOString()} now={v.nowIso} /></div>
            <div className="clock-n">часа и минути</div>
          </div>
        )}
      </div>

      <div className="pv-grid" style={{ marginTop: 26 }}>
        <div>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Движение по заявката</h2></div>
            <div className="tl">
              {tl.map((it, i) => (
                <div key={i} className={`tl-item${it.state === 'done' ? ' is-done' : it.state === 'current' || it.state === 'stop' ? ' is-current' : ''}`}>
                  <span className="tl-dot">{it.state === 'current' ? CLOCK : it.state === 'stop' ? CROSS : CHECK}</span>
                  <div><div className="tl-title"><span className="sr-only">{TL_STATE[it.state]}: </span>{it.title}</div>{it.time && <div className="tl-time">{it.time}</div>}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Детайли за събитието</h2></div>
            <div className="kv">
              <div className="kv-item"><div className="kv-label">Тип събитие</div><div className="kv-value">{v.eventType.name}</div></div>
              <div className="kv-item"><div className="kv-label">Дата</div><div className="kv-value">{date(r.eventDate)} <small>{weekdayOf(r.eventDate)}</small></div></div>
              <div className="kv-item"><div className="kv-label">Начален час</div><div className="kv-value">{r.startTime ? r.startTime.slice(0, 5) : '—'}</div></div>
              <div className="kv-item"><div className="kv-label">Гости</div><div className="kv-value">{r.guests} души</div></div>
              <div className="kv-item"><div className="kv-label">Локация</div><div className="kv-value">{venue ?? '—'}{venueSmall && <small>{venueSmall}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Пакет</div><div className="kv-value">{o?.title ?? r.serviceTitle}</div></div>
              {state === 'declined' && r.declineReason === 'other' && r.declineText && (
                <div className="kv-item" style={{ gridColumn: '1 / -1' }}><div className="kv-label">Причина</div><div className="kv-value">{r.declineText}</div></div>
              )}
            </div>
          </section>
        </div>
        <aside>
          <div className="sum">
            <PartnerSum p={p} />
            <div className="sum-row"><span>Пакет</span><b>{packageLabel(o?.title ?? r.serviceTitle)}</b></div>
            <div className="sum-row"><span>Дата</span><b>{date(r.eventDate)}</b></div>
            <div className="sum-row"><span>Гости</span><b>{r.guests}</b></div>
            <div className="sum-total"><span>Обща сума</span><b>{amount != null ? moneyShort(amount) : '—'}</b></div>
            <div className="book-note" style={{ marginTop: 16 }}>{CLOCK}<span>Плащате едва след одобрение от изпълнителя.</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** ‹Пакет „Цял ден“› → ‹„Цял ден“›; other titles as they are. */
function packageLabel(title: string): string {
  const inner = packageNameOf(title);
  return inner !== title ? `„${inner}“` : title;
}
