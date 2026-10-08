// The simulated provider's checkout (SCREENS §5 `/plashtane/test/[chargeId]`):
// demo and test only, never with stripe. Shows what is being paid and lets the
// payer choose the provider's answer.
import { notFound, redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { actorFromUser } from '@/lib/domain/actor';
import { getTestCheckout } from '@/lib/domain/charges';
import { money } from '@/lib/format';
import { requireRole } from '@/lib/session';
import { failTestChargeAction, payTestChargeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Плащане' };

export default async function TestCheckoutPage({ params }: { params: Promise<{ chargeId: string }> }) {
  const { chargeId } = await params;
  const u = await requireRole('client', `/plashtane/test/${chargeId}`);
  const view = await getTestCheckout(await actorFromUser(u), chargeId);
  if (!view) notFound();
  const n = encodeURIComponent(view.number);
  if (view.status === 'succeeded') redirect(`/akaunt/rezervacii/${n}`);
  if (view.status !== 'pending' && view.status !== 'awaiting_transfer') redirect(`/plashtane/${n}`);

  return (
    <>
      <SiteHeader />
      <main className="wrap" id="main">
        <div className="hold hold--narrow">
          <div className="h-row">
            <div><h1 className="h-page">Плащане</h1><p className="h-sub">{view.partnerName} · {view.description}</p></div>
          </div>
          <div className="form-card">
            <div className="sum-row"><span>Заявка №</span><b>{view.number}</b></div>
            <div className="sum-total"><span>За плащане сега</span><b>{money(view.amountCents)}</b></div>
            <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
              <form action={payTestChargeAction}>
                <input type="hidden" name="chargeId" value={view.chargeId} />
                <button className="btn btn--primary" type="submit">Плати</button>
              </form>
              <form action={failTestChargeAction}>
                <input type="hidden" name="chargeId" value={view.chargeId} />
                <button className="btn btn--ghost" type="submit">Откажи плащането</button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
