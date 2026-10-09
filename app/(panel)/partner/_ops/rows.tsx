// Rows shared by the requests inbox, the bookings ledger and the topbar search results.
import Link from 'next/link';
import type { BookingRowView, RequestRowView } from '@/lib/domain/views-partner-ops';
import { ago, hhmm } from '@/lib/domain/views-partner-ops';
import { BOOKING_BADGE } from '@/lib/domain/views-partner-ops';
import { date, dateShort, money, moneyShort } from '@/lib/format';
import { RowLink } from './ui';

const timer = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;

/** One `.req` row (vendor/requests.html); every row opens its record, new requests show ‹Разгледай›. */
export function RequestRow({ r, now }: { r: RequestRowView; now: Date }) {
  const body = (
    <>
      <span className="avatar">{r.initials}</span>
      <div className="req-main">
        <div className="req-name"><span className="po-name">{r.clientName}</span>{r.badge && <span className={`badge ${r.badge.cls} badge--dot`}>{r.badge.label}</span>}</div>
        <div className="req-service">{r.eventType} · <strong>{r.serviceLabel}</strong>{r.group === 'new' && r.serviceSummary ? ` — ${r.serviceSummary}` : ''}</div>
      </div>
      <div className="req-meta">
        <div className="req-meta-item"><span className="req-meta-label">Дата</span><span className="req-meta-value">{date(r.eventDate)}</span></div>
        <div className="req-meta-item"><span className="req-meta-label">Гости</span><span className="req-meta-value">{r.guests} души</span></div>
        <div className="req-meta-item"><span className="req-meta-label">Локация</span><span className="req-meta-value">{r.place}</span></div>
      </div>
      <div className="req-end">
        <div className="req-price">{r.amountCents == null ? '—' : moneyShort(r.amountCents)}<small>{r.priceNote}</small></div>
        <div className="req-status">
          {r.group === 'new' && <><span className="btn btn--primary btn--sm">Разгледай</span><span className="req-age">{ago(r.sentAt, now)}</span></>}
          {r.group === 'pay' && r.booking && <>
            <span className="pill-timer">{timer}остават {hhmm(now, r.booking.paymentDueAt)}</span>
            <span className="req-age">одобрена {ago(r.booking.approvedAt, now, true)}</span>
          </>}
          {r.group !== 'new' && r.group !== 'pay' && <span className="req-age">{ago(r.sentAt, now)}</span>}
        </div>
      </div>
    </>
  );
  // The whole row opens the request (it highlights on hover like a link); ‹Разгледай› is its visible call to action.
  return <Link className="req po-req-link" href={r.href}>{body}</Link>;
}

/** The bookings ledger table (vendor/bookings.html .tbl). */
export function BookingTable({ rows, fullDate = false }: { rows: BookingRowView[]; fullDate?: boolean }) {
  return (
    <div className="po-tbl-wrap">
      <table className="tbl po-tbl">
        <colgroup><col style={{ width: '13%' }} /><col /><col style={{ width: '8%' }} /><col style={{ width: '13%' }} /><col style={{ width: '14%' }} /><col style={{ width: '17%' }} /></colgroup>
        <thead>
          <tr><th>Дата</th><th>Събитие</th><th style={{ textAlign: 'right' }}>Гости</th><th style={{ textAlign: 'right' }}>Сума</th><th style={{ textAlign: 'right' }}>Получавате</th><th>Статус</th></tr>
        </thead>
        <tbody>
          {rows.map(b => {
            const badge = BOOKING_BADGE[b.status];
            return (
              <RowLink key={b.number} href={b.href}>
                <td><div className="tbl-event">{fullDate ? date(b.eventDate) : dateShort(b.eventDate)}</div><div className="tbl-sub">{b.weekday}</div></td>
                <td><Link className="tbl-event" href={b.href}>{b.title}</Link><div className="tbl-sub">{b.sub}</div></td>
                <td className="num muted" data-label="Гости">{b.guests}</td>
                <td className="num" data-label="Сума">{money(b.amountCents)}</td>
                <td className="num strong" data-label="Получавате">{b.partnerCents == null ? '—' : money(b.partnerCents)}</td>
                <td><span className={`badge ${badge.cls} badge--dot`}>{badge.label}</span></td>
              </RowLink>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
