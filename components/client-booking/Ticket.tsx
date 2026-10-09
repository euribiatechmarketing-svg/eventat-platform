// The booking ticket and the three "what happens next" cards (client/confirmed.html),
// shared by /plashtane/[nomer]/potvardena and /akaunt/rezervacii/[nomer].
import type { ClientBookingView } from '@/lib/domain/bookings';
import type { PartnerCard } from '@/lib/domain/views-client-booking';
import { numericDate, subtitleOf } from '@/lib/domain/views-client-booking';
import { date, moneyShort } from '@/lib/format';
import { Num, STAR } from './parts';

export function Ticket({ b, partner }: { b: ClientBookingView; partner: PartnerCard }) {
  // ‹Пакет „Цял ден“ · DJ, озвучаване и осветление›; without a summary, as on the list rows (‹Торти и десерти · Коледна торта…›).
  const what = b.serviceSummary ? `${b.serviceTitle} · ${b.serviceSummary}` : subtitleOf(partner.category, b.serviceTitle);
  const venue = b.venueName || b.locality || b.cityName;
  const venueSmall = b.venueName ? (b.locality || b.cityName) : null;
  return (
    <div className="ticket">
      <div className="ticket-top">
        <span className="ticket-img" style={partner.thumb ? { backgroundImage: `url('${partner.thumb}')` } : undefined} />
        <div>
          <div className="ticket-n"><Num>{partner.name}</Num></div>
          <div className="ticket-c">{what}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="v-price" style={{ fontSize: 26 }}>{moneyShort(b.money.amountCents)}</div>
          {b.paidAt && <div style={{ fontSize: 12, color: 'var(--neutral-500)' }}>платено на {numericDate(b.paidAt)}</div>}
        </div>
      </div>
      <div className="ticket-grid">
        <div className="ticket-cell"><div className="kv-label">Дата</div><div className="kv-value">{date(b.eventDate)} <small>{b.eventWeekday}{b.startTime ? `, ${b.startTime}` : ''}</small></div></div>
        <div className="ticket-cell"><div className="kv-label">Локация</div><div className="kv-value">{venue ?? '—'}{venueSmall && <small>{venueSmall}</small>}</div></div>
        <div className="ticket-cell"><div className="kv-label">Гости</div><div className="kv-value">{b.guests} души</div></div>
        <div className="ticket-cell"><div className="kv-label">Резервация №</div><div className="kv-value">{b.number}</div></div>
      </div>
    </div>
  );
}

/**
 * The three cards under the ticket (client/confirmed.html). The prototype's lines
 * speak of a DJ (‹програмата и плейлиста›) at a wedding (‹следващите двойки›);
 * for other partners and events the same lines take the approved wording of the
 * `client-booking-confirmed` email (‹за да уточните програмата›) and of
 * client/bookings.html (‹следващите клиенти да избират›).
 */
export function NextSteps({ playlist, wedding }: { playlist: boolean; wedding: boolean }) {
  return (
    <div className="next">
      <div className="next-card">
        <span className="next-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>
        <div className="next-t">Изпълнителят ще се свърже</div>
        <div className="next-d">{playlist ? 'Обикновено до седмица преди събитието, за да уточните програмата и плейлиста.' : 'Обикновено до седмица преди събитието, за да уточните програмата.'}</div>
      </div>
      <div className="next-card">
        <span className="next-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg></span>
        <div className="next-t">Плащането е защитено</div>
        <div className="next-d">Сумата се превежда на изпълнителя чак след като събитието се проведе.</div>
      </div>
      <div className="next-card">
        <span className="next-i"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={STAR} /></svg></span>
        <div className="next-t">Оценете след събитието</div>
        <div className="next-d">{wedding ? 'Ще получите покана за ревю — то помага на следващите двойки да избират.' : 'Ще получите покана за ревю — то помага на следващите клиенти да избират.'}</div>
      </div>
    </div>
  );
}

/** NextSteps for a booking: a DJ's playlist, a wedding's couples. */
export function NextStepsFor({ b, partner }: { b: ClientBookingView; partner: PartnerCard }) {
  return <NextSteps playlist={partner.categorySlug === 'dj-i-ozvuchavane'} wedding={b.eventType.slug === 'svatba'} />;
}
