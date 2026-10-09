'use client';
// ‹Карта› / ‹Банков превод› and the pay button. Card data is entered only on
// the provider's hosted form (SPEC §7.1), so the card choice has no fields here.
import { useState } from 'react';

export function PayMethods({ bank, initial }: { bank: boolean; initial: 'card' | 'bank_transfer' }) {
  const [m, setM] = useState(initial);
  return (
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
  );
}
