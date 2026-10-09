// ‹Плащане› (client/payment.html → SCREENS §5 /plashtane/[nomer]).
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/client-booking/ActionForm';
import { Countdown } from '@/components/client-booking/Countdown';
import { PayMethods } from '@/components/client-booking/PayMethods';
import { Crumbs, PartnerSum } from '@/components/client-booking/parts';
import { now } from '@/lib/clock';
import { policyStrings } from '@/lib/domain/cancellation';
import { getPaymentPage } from '@/lib/domain/charges';
import { paymentAside } from '@/lib/domain/views-client-booking';
import { date, dateTime, money, moneyShort } from '@/lib/format';
import { numberParam, orNotFound, requireClient } from '@/lib/client-booking/guard';
import { payAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Плащане' };

export default async function PaymentPage({ params }: { params: Promise<{ nomer: string }> }) {
  const { nomer } = await params;
  const number = numberParam(nomer);
  const n = encodeURIComponent(number);
  const { actor } = await requireClient(`/plashtane/${n}`, 'registratsiya');
  const v = await orNotFound(getPaymentPage(actor, number));
  if (!v.payable) redirect(v.status === 'awaiting_payment' || v.status === 'payment_expired' || v.status === 'approval_withdrawn' ? `/akaunt/zayavki/${n}` : `/akaunt/rezervacii/${n}`);
  const a = await paymentAside(actor, number);
  const at = await now();
  const policy = policyStrings(a.booking.cancellationPolicy, a.booking.eventDate);
  const rule = policy.vendorWidget ? policy.vendorWidget.replace(/^Анулиране:\s*/, '') : `${policy.title} — ${policy.description.charAt(0).toLowerCase()}${policy.description.slice(1)}.`;
  const t = v.openTransfer;
  const method = t ? 'bank_transfer' : 'card';

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: `Заявка № ${v.number}`, href: `/akaunt/zayavki/${n}` }, { label: 'Плащане' }]} />
      <div className="h-row">
        <div>
          <h1 className="h-page">Плащане</h1>
          {v.status === 'awaiting_payment' && (
            <p className="h-sub">Остават <Countdown to={v.paymentDueAt.toISOString()} now={at.toISOString()} /> часа · след плащането датата е окончателно ваша</p>
          )}
        </div>
      </div>

      <div className="pv-grid">
        <ActionForm action={payAction} className="form-card">
          <input type="hidden" name="number" value={v.number} />
          {v.lastAttemptFailed && <div className="form-alert" role="alert">Плащането не е преминало. Опитайте отново.</div>}
          <h2 className="pv-sec-t" style={{ marginTop: 0 }}>Начин на плащане</h2>
          <PayMethods bank={v.bankTransferEnabled} initial={method} payLabel={`Плати ${moneyShort(v.amountDueCents)}`} backHref={`/akaunt/zayavki/${n}`}
            transfer={t && (
              <div className="cb-transfer">
                <h3 className="cx-h" style={{ margin: '12px 0 4px', fontSize: 16 }}>Данни за банковия превод</h3>
                <div className="sum-row"><span>Сума</span><b>{money(t.amountCents)}</b></div>
                <div className="sum-row"><span>Получател</span><b>{t.recipient}</b></div>
                <div className="sum-row"><span>IBAN</span><b>{t.iban}</b></div>
                <div className="sum-row"><span>Основание</span><b>{t.reference}</b></div>
                <div className="sum-row"><span>Платете до</span><b>{dateTime(v.paymentDueAt)}</b></div>
              </div>
            )}>
            <div className="safe">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>
              <span><strong>Парите ви са защитени.</strong> Сумата се задържа от платформата и се превежда на изпълнителя чак след като събитието се проведе. При анулиране в срок се възстановява автоматично.</span>
            </div>
          </PayMethods>
        </ActionForm>

        <aside>
          <div className="sum">
            <PartnerSum p={a.partner} />
            <div className="sum-row"><span>{v.serviceTitle}</span><b>{money(v.amountCents)}</b></div>
            <div className="sum-row"><span>Такса резервация</span><b>{money(v.bookingFeeCents)}</b></div>
            <div className="sum-row"><span>Дата</span><b>{date(v.eventDate)}</b></div>
            <div className="sum-total"><span>За плащане сега</span><b>{moneyShort(v.amountDueCents)}</b></div>
            <div className="book-rule"><strong style={{ color: 'var(--text)' }}>Анулиране:</strong> {rule}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
