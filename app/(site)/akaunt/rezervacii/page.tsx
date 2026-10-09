// ‹Моите резервации› (client/bookings.html → SCREENS §4 /akaunt/rezervacii?sabitie-id=).
import Link from 'next/link';
import { AccountToolbar, MineGroup, Num } from '@/components/client-booking/parts';
import { SubmitButton } from '@/components/client-booking/SubmitButton';
import { clientBookingList, type BookingListRow } from '@/lib/domain/views-client-booking';
import { one, requireClient, withQuery } from '@/lib/client-booking/guard';
import { writeToPartnerAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Моите резервации' };

type SP = Promise<Record<string, string | string[] | undefined>>;

const ICON = {
  pin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M12 21s-7-5.2-7-11a7 7 0 1114 0c0 5.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  guests: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 6.2a3.4 3.4 0 010 6.6M17.5 20a6.5 6.5 0 00-2.2-4.9" /></svg>,
  no: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M4 7h16v13H4z" /><path d="M4 11h16M9 4v4" /></svg>,
};

export default async function BookingsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireClient(withQuery('/akaunt/rezervacii', sp));
  const v = await clientBookingList(actor, { eventId: one(sp['sabitie-id']) });
  const h = v.hero;

  return (
    <div className="hold">
      <div className="h-row">
        <div>
          <h1 className="h-page">Моите резервации</h1>
          <p className="h-sub">Платени и потвърдени услуги за вашите събития</p>
        </div>
        <div className="h-right">
          <Link className="btn btn--outline btn--sm" href="/tarsene">Търси още услуги</Link>
        </div>
      </div>

      <AccountToolbar active="bookings" counts={v.counts} events={v.events} eventId={v.eventId} />

      {h && (
        <div className="nx">
          <div className="nx-date">
            <div className="nx-d">{h.day}</div>
            <div className="nx-m">{h.month}</div>
            <div className="nx-y">{h.year} · {h.weekday}</div>
          </div>
          <div>
            <div className="badge badge--success badge--dot" style={{ marginBottom: 11 }}>Потвърдена · платена</div>
            <div className="nx-t"><Link href={h.href}><Num>{h.title}</Num></Link></div>
            <div className="nx-line">
              {h.location && <span>{ICON.pin}{h.location}</span>}
              {h.time && <span>{ICON.clock}{h.time}</span>}
              <span>{ICON.guests}{h.guests} гости</span>
              <span>{ICON.no}№ {h.number}</span>
            </div>
            <div className="cb-actions" style={{ marginTop: 20 }}>
              <form action={writeToPartnerAction}>
                <input type="hidden" name="number" value={h.number} />
                <SubmitButton className="btn btn--primary btn--sm">Пиши на изпълнителя</SubmitButton>
              </form>
              {h.hasInvoice && <Link className="btn btn--outline btn--sm" href={`${h.href}/faktura`}>Свали фактура</Link>}
              {h.canCancel && <Link className="btn btn--ghost btn--sm" href={`${h.href}/anulirane`}>Анулиране</Link>}
            </div>
          </div>
          <div className="nx-side">
            <div className="nx-in">{h.daysTo}<small>{h.daysTo === 1 ? 'ден до събитието' : 'дни до събитието'}</small></div>
            {h.freeCancel?.freeCancelLine && (
              <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--neutral-600)', lineHeight: 1.55, maxWidth: 272, textAlign: 'right' }}>
                <FreeCancel line={h.freeCancel.freeCancelLine} />
              </div>
            )}
          </div>
        </div>
      )}

      {v.upcoming.length > 0 && (
        <MineGroup title="Предстоящи" count={v.upcoming.length} hint="Изпълнителите се свързват до седмица преди събитието" style={h ? { marginTop: 22 } : undefined}>
          {v.upcoming.map(r => <Row key={r.number} r={r} />)}
        </MineGroup>
      )}
      {v.past.length > 0 && (
        <MineGroup title="Минали" count={v.past.length} hint="Оценката помага на следващите клиенти да избират" style={!v.upcoming.length && h ? { marginTop: 22 } : undefined}>
          {v.past.map(r => <Row key={r.number} r={r} />)}
        </MineGroup>
      )}
      {!h && !v.upcoming.length && !v.past.length && <div className="cb-empty"><div className="ui-empty">Няма записи в този изглед.</div></div>}
    </div>
  );
}

/** ‹Безплатно анулиране до <b>15 май 2026</b> — 30 дни преди събитието.› */
function FreeCancel({ line }: { line: string }) {
  const m = /^(Безплатно анулиране до )(.+?)( — .+)$/.exec(line);
  if (!m) return <>{line}</>;
  return <>{m[1]}<b style={{ color: 'var(--primary-900)' }}>{m[2]}</b>{m[3]}</>;
}

function Row({ r }: { r: BookingListRow }) {
  return (
    <div className={`mrow cb-mrow${r.off ? ' is-off' : ''}`}>
      <Link className="cb-mrow-link" href={r.href} aria-label={`${r.partner.name} · ${r.number}`} />
      <span className="mrow-img" style={r.partner.thumb ? { backgroundImage: `url('${r.partner.thumb}')` } : undefined} />
      <span className="mrow-main">
        <span className="mrow-n">{r.partner.name}</span>
        <span className="mrow-s">{r.subtitle}</span>
      </span>
      <span className="mrow-meta">
        {r.cols.map(c => <span key={c.label} className="mrow-col"><span className="mrow-l">{c.label}</span><span className="mrow-v">{c.value}</span></span>)}
      </span>
      <span className="mrow-end">
        <span className="mrow-status">
          {r.badge && <span className={`badge badge--${r.badge.tone} badge--dot`}>{r.badge.text}</span>}
          {r.age && <span className="mrow-age">{r.age}</span>}
        </span>
        <span className="mrow-price">{r.price}</span>
        <Link className={`btn ${r.action.primary ? 'btn--primary' : 'btn--outline'} btn--sm`} href={r.action.href}>{r.action.label}</Link>
      </span>
    </div>
  );
}
