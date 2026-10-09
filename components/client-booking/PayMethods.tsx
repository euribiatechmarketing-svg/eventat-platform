'use client';
// ‹Карта› / ‹Банков превод› and the pay button. Card data is entered only on
// the provider's hosted form (SPEC §7.1), so the card choice has no fields here.
// Once a bank transfer is open, its instructions show under ‹Банков превод›
// and there is nothing left to press for it: the button comes back with ‹Карта›.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { SubmitButton } from './SubmitButton';

export function PayMethods({ bank, initial, transfer, children, payLabel, backHref }: {
  bank: boolean; initial: 'card' | 'bank_transfer';
  /** The open transfer's instructions (null until the client chooses a transfer). */
  transfer: ReactNode;
  /** ‹Парите ви са защитени…› */
  children: ReactNode;
  payLabel: string; backHref: string;
}) {
  const [m, setM] = useState(initial);
  const transferShown = m === 'bank_transfer' && !!transfer;
  return (
    <>
      <div role="radiogroup" aria-label="Начин на плащане">
        <label className="pay-method">
          <input type="radio" name="method" value="card" checked={m === 'card'} onChange={() => setM('card')} />
          <span className="pay-dot" />
          <div><div className="pay-n">Карта</div><div className="pay-d">Visa, Mastercard, Maestro</div></div>
          <span className="pay-logos"><span className="pay-logo">VISA</span><span className="pay-logo">MC</span></span>
        </label>
        {bank && (
          <label className="pay-method">
            <input type="radio" name="method" value="bank_transfer" checked={m === 'bank_transfer'} onChange={() => setM('bank_transfer')} />
            <span className="pay-dot" />
            <div><div className="pay-n">Банков превод</div><div className="pay-d">Потвърждението отнема до 2 работни дни</div></div>
          </label>
        )}
      </div>
      {transferShown && transfer}
      {children}
      <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
        {!transferShown && <SubmitButton className="btn btn--primary">{payLabel}</SubmitButton>}
        <Link className="btn btn--ghost" href={backHref}>Назад</Link>
      </div>
    </>
  );
}
