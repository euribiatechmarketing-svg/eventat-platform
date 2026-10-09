// The simulated provider's checkout (SCREENS §5 `/plashtane/test/[chargeId]`):
// demo and test only, never with stripe. Drawn like the payment page; the
// payer chooses the provider's answer.
import { notFound, redirect } from 'next/navigation';
import { Crumbs, PartnerSum } from '@/components/client-booking/parts';
import { SubmitButton } from '@/components/client-booking/SubmitButton';
import { actorFromUser } from '@/lib/domain/actor';
import { getTestCheckout } from '@/lib/domain/charges';
import { paymentAside } from '@/lib/domain/views-client-booking';
import { date, money, moneyShort } from '@/lib/format';
import { requireRole } from '@/lib/session';
import { failTestChargeAction, payTestChargeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Плащане' };

export default async function TestCheckoutPage({ params }: { params: Promise<{ chargeId: string }> }) {
  const { chargeId } = await params;
  const u = await requireRole('client', `/plashtane/test/${chargeId}`);
  const actor = await actorFromUser(u);
  const view = await getTestCheckout(actor, chargeId);
  if (!view) notFound();
  const n = encodeURIComponent(view.number);
  if (view.status === 'succeeded') redirect(`/akaunt/rezervacii/${n}`);
  if (view.status !== 'pending' && view.status !== 'awaiting_transfer') redirect(`/plashtane/${n}`);
  const a = await paymentAside(actor, view.number);

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: `Заявка № ${view.number}`, href: `/akaunt/zayavki/${n}` }, { label: 'Плащане', href: `/plashtane/${n}` }]} />
      <div className="h-row">
        <div><h1 className="h-page">Плащане</h1><p className="h-sub">{view.partnerName} · {view.description}</p></div>
      </div>
      <div className="pv-grid">
        <div className="form-card">
          <h2 className="pv-sec-t" style={{ marginTop: 0 }}>Начин на плащане</h2>
          {view.method === 'card' ? (
            <div className="pay-method is-on">
              <span className="pay-dot" />
              <div><div className="pay-n">Карта</div><div className="pay-d">Visa, Mastercard, Maestro</div></div>
              <span className="pay-logos"><span className="pay-logo">VISA</span><span className="pay-logo">MC</span></span>
            </div>
          ) : (
            <div className="pay-method is-on">
              <span className="pay-dot" />
              <div><div className="pay-n">Банков превод</div><div className="pay-d">Потвърждението отнема до 2 работни дни</div></div>
            </div>
          )}
          <div className="sum-row cb-test-note"><span>Заявка №</span><b>{view.number}</b></div>
          <div className="sum-total"><span>За плащане сега</span><b>{moneyShort(view.amountCents)}</b></div>
          <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
            <form action={payTestChargeAction}>
              <input type="hidden" name="chargeId" value={view.chargeId} />
              <SubmitButton className="btn btn--primary">Плати</SubmitButton>
            </form>
            <form action={failTestChargeAction}>
              <input type="hidden" name="chargeId" value={view.chargeId} />
              <SubmitButton className="btn btn--ghost">Откажи плащането</SubmitButton>
            </form>
          </div>
        </div>
        <aside>
          <div className="sum">
            <PartnerSum p={a.partner} />
            <div className="sum-row"><span>{a.booking.serviceTitle}</span><b>{money(a.booking.amountCents)}</b></div>
            <div className="sum-row"><span>Дата</span><b>{date(a.booking.eventDate)}</b></div>
            <div className="sum-total"><span>За плащане сега</span><b>{moneyShort(view.amountCents)}</b></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
