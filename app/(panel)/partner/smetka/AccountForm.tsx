'use client';
// vendor/payout-account.html › ‹Промяна на сметката›: IBAN, holder, bank, the bank document, ‹Запази сметката›.
import { useActionState, useEffect, useState, useTransition } from 'react';
import { toast } from '@/components/ui/client';
import { FilePick } from '../_catalogue/ui';
import { submitAccountAction, uploadBankProofAction, type AccountState } from './actions';

const CHEV = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 10l5 5 5-5" /></svg>;

export function AccountForm({ legalName, heldText, banks }: { legalName: string | null; heldText: string; banks: string[] }) {
  const [state, formAction, saving] = useActionState(submitAccountAction, {} as AccountState);
  const [proof, setProof] = useState<{ id: string; name: string } | null>(null);
  const [iban, setIban] = useState('');
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [uploading, start] = useTransition();
  const f = state.fields ?? {};
  useEffect(() => {
    if (state.error) toast(state.error, 'error');
    else if (state.fields && Object.keys(state.fields).length) toast('Проверете попълнените полета.', 'error');
  }, [state]);

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    start(async () => {
      const r = await uploadBankProofAction(fd);
      if (!r.ok) { toast(r.error, 'error'); return; }
      setProof({ id: r.mediaId, name: r.name });
      toast(r.message);
    });
  };

  return (
    <form id="pa-form" action={formAction} noValidate>
      <input type="hidden" name="proofMediaId" value={proof?.id ?? ''} />
      <section className="dcard">
        <div className="dcard-head"><h2 className="dcard-title">Промяна на сметката</h2></div>
        <div className="pa-fields">
          <label className="fld"><span className="fld-l">IBAN</span>
            <input className="fld-i" name="iban" value={iban} onChange={e => setIban(e.target.value)} placeholder="Въведете новия IBAN" autoComplete="off" spellCheck={false} aria-invalid={!!f.iban} />
            {f.iban && <span className="form-error">{f.iban}</span>}
          </label>
          <label className="fld"><span className="fld-l">Титуляр</span>
            <input className="fld-i" name="holderName" value={holder} onChange={e => setHolder(e.target.value)} placeholder="Име по банков документ" aria-invalid={!!f.holderName} />
            {f.holderName && <span className="form-error">{f.holderName}</span>}
          </label>
          <label className="fld"><span className="fld-l">Банка</span>
            <span className="pa-sel">
              <select className="fld-i" name="bankName" required value={bank} onChange={e => setBank(e.target.value)} aria-invalid={!!f.bankName}>
                <option value="" disabled>Изберете банка</option>
                {banks.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <span className="pa-sel-ic">{CHEV}</span>
            </span>
            {f.bankName && <span className="form-error">{f.bankName}</span>}
          </label>
        </div>
        {legalName && <div className="fld-hint">Сметката трябва да е на името на фирмата от профила ви — {legalName}.</div>}
        <div className="pa-up">
          <span className="pa-up-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /><path d="M9 14h6M9 17h4" /></svg>
          </span>
          <div>
            <div className="pa-up-t">Документ за потвърждение</div>
            {proof
              ? <div className="pa-up-d is-file">{proof.name}</div>
              : <div className="pa-up-d">Извлечение или удостоверение от банката, в което се виждат IBAN и титулярят.</div>}
          </div>
          <FilePick accept="application/pdf,image/jpeg,image/png" className="btn btn--outline btn--sm" onFile={upload} disabled={uploading}>Качи документ</FilePick>
        </div>
        {f.proof && <span className="form-error">{f.proof}</span>}
        <p className="note pa-note">Смяната на сметката спира временно изплащанията, докато екипът потвърди новите данни. Задържаните {heldText} остават заделени за вас и тръгват по новата сметка по обичайния график — на 1-во или 15-то число след съответното събитие.</p>
      </section>
      <div className="pa-foot">
        <button type="submit" className="btn btn--primary btn--sm" disabled={saving || uploading}>Запази сметката</button>
      </div>
    </form>
  );
}
