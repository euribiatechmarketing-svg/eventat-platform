// One booking (client/confirmed.html as the detail → SCREENS §4 /akaunt/rezervacii/[nomer]).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Crumbs } from '@/components/client-booking/parts';
import { SubmitButton } from '@/components/client-booking/SubmitButton';
import { NextSteps, Ticket } from '@/components/client-booking/Ticket';
import { getBookingForClient } from '@/lib/domain/bookings';
import { policyStrings } from '@/lib/domain/cancellation';
import { bookingExtras } from '@/lib/domain/views-client-booking';
import { date } from '@/lib/format';
import { numberParam, orNotFound, requireClient } from '@/lib/client-booking/guard';
import { writeToPartnerAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Резервация' };

const LABEL: Record<string, { tone: string; text: string }> = {
  confirmed: { tone: 'success', text: 'Потвърдена' },
  cancellation_requested: { tone: 'success', text: 'Потвърдена' },
  completed: { tone: 'success', text: 'Приключила' },
  cancelled: { tone: 'danger', text: 'Анулирана' },
};

export default async function BookingPage({ params }: { params: Promise<{ nomer: string }> }) {
  const { nomer } = await params;
  const number = numberParam(nomer);
  const n = encodeURIComponent(number);
  const { actor } = await requireClient(`/akaunt/rezervacii/${n}`);
  const b = await orNotFound(getBookingForClient(actor, number));
  // Not paid yet (or never paid): that is a request.
  if (!LABEL[b.status]) redirect(`/akaunt/zayavki/${n}`);
  const x = await bookingExtras(actor, number);
  const badge = b.status === 'completed' && b.canReview ? { tone: 'primary', text: 'Чака вашето ревю' } : LABEL[b.status];
  const policy = policyStrings(b.policy.policy, b.eventDate);
  const live = b.status === 'confirmed' || b.status === 'cancellation_requested';
  const href = `/akaunt/rezervacii/${n}`;

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: 'Моите резервации', href: '/akaunt/rezervacii' }, { label: `№ ${b.number}` }]} />
      <div className="h-row" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="h-page">Резервация № <span className="num">{b.number}</span></h1>
          <p className="h-sub">{x.eventTitle} · {date(b.eventDate)}</p>
        </div>
        <div className="h-right"><span className={`badge badge--${badge.tone} badge--dot`}>{badge.text}</span></div>
      </div>

      <Ticket b={b} partner={x.partner} />

      {live && (
        <div className="book-rule" style={{ background: '#fff', border: '1px solid var(--app-line)', borderRadius: 12, padding: '14px 18px', marginTop: 16 }}>
          <strong style={{ color: 'var(--text)' }}>{policy.title}:</strong> {policy.description}.
          {policy.freeCancelLine && b.policy.freeCancelUntil && b.daysToEvent >= 0 && <> {policy.freeCancelLine}</>}
        </div>
      )}

      {live && b.daysToEvent >= 0 && <NextSteps />}

      <div className="cb-actions cb-center-actions" style={{ justifyContent: 'center', marginTop: 30 }}>
        <form action={writeToPartnerAction}>
          <input type="hidden" name="number" value={b.number} />
          <SubmitButton className="btn btn--primary">Пиши на изпълнителя</SubmitButton>
        </form>
        {b.invoices.length > 0 && <Link className="btn btn--outline" href={`${href}/faktura`}>Свали фактура</Link>}
        {b.canReview && <Link className="btn btn--primary" href={`${href}/revyu`}>Остави ревю</Link>}
        {b.canCancel && <Link className="btn btn--ghost" href={`${href}/anulirane`}>Анулиране</Link>}
        {(live || b.status === 'completed') && <Link className="btn btn--ghost" href={`/akaunt/poddrazhka/nov?rezervaciya=${n}`}>Сигнал до екипа</Link>}
        <Link className="btn btn--outline" href="/tarsene">Търси друга услуга</Link>
      </div>
    </div>
  );
}
