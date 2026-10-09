// ‹Резервацията е потвърдена› (client/confirmed.html → SCREENS §5 /plashtane/[nomer]/potvardena).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NextStepsFor, Ticket } from '@/components/client-booking/Ticket';
import { getBookingForClient } from '@/lib/domain/bookings';
import { bookingExtras } from '@/lib/domain/views-client-booking';
import { dateShort } from '@/lib/format';
import { numberParam, orNotFound, requireClient } from '@/lib/client-booking/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Резервацията е потвърдена' };

export default async function ConfirmedPage({ params }: { params: Promise<{ nomer: string }> }) {
  const { nomer } = await params;
  const number = numberParam(nomer);
  const n = encodeURIComponent(number);
  const { actor } = await requireClient(`/plashtane/${n}/potvardena`);
  const b = await orNotFound(getBookingForClient(actor, number));
  // Not paid (yet): back to the payment page, which shows what is still due.
  if (b.status === 'awaiting_payment') redirect(`/plashtane/${n}`);
  if (b.status !== 'confirmed' && b.status !== 'cancellation_requested') redirect(`/akaunt/rezervacii/${n}`);
  const x = await bookingExtras(actor, number);

  return (
    <div className="hold hold--narrow">
      <div className="done">
        <div className="done-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg></div>
        <h1 className="done-t">Резервацията е потвърдена</h1>
        <p className="done-d">Изпратихме потвърждение на <b style={{ color: 'var(--primary-900)' }}>{x.email}</b>. {x.partner.name} вече е блокирал {dateShort(b.eventDate)} за вашето събитие.</p>
      </div>

      <Ticket b={b} partner={x.partner} />
      <NextStepsFor b={b} partner={x.partner} />

      <div className="cb-actions cb-center-actions" style={{ justifyContent: 'center', marginTop: 30 }}>
        <Link className="btn btn--primary" href={`/akaunt/rezervacii/${n}`}>Виж резервацията</Link>
        <Link className="btn btn--outline" href="/tarsene">Търси друга услуга</Link>
      </div>
    </div>
  );
}
