'use client';
// vendor/payout-account.html › ‹Промяна на сметката›: IBAN, holder, bank, the bank document, ‹Запази сметката›.
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { toast } from '@/components/ui/client';
import { FilePick } from '../_catalogue/ui';
import { focusSoon } from '@/components/ui/a11y';
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
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  // Field names and errors for screen readers: the visible label names the field, its error describes it.
  const field = (n: string) => ({ 'aria-labelledby': `${uid}-${n}-l`, 'aria-describedby': f[n] ? `${uid}-${n}-e` : undefined, 'aria-invalid': !!f[n] });
  useEffect(() => {
    if (state.error) toast(state.error, 'error');
    else if (state.fields && Object.keys(state.fields).length) {
      toast('Проверете попълнените полета.', 'error');
      focusSoon(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]'));
    }
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
    <form id="pa-form" ref={formRef} action={formAction} noValidate>
      <input type="hidden" name="proofMediaId" value={proof?.id ?? ''} />
      <section className="dcard">
        <div className="dcard-head"><h2 className="dcard-title">Промяна на сметката</h2></div>
        <div className="pa-fields">
          <label className="fld"><span className="fld-l" id={`${uid}-iban-l`}>IBAN</span>
            <input className="fld-i" name="iban" value={iban} onChange={e => setIban(e.target.value)} placeholder="Въведете новия IBAN" autoComplete="off" spellCheck={false} {...field('iban')} />
            {f.iban && <span className="form-error" id={`${uid}-iban-e`}>{f.iban}</span>}
          </label>
          <label className="fld"><span className="fld-l" id={`${uid}-holderName-l`}>Титуляр</span>
            <input className="fld-i" name="holderName" value={holder} onChange={e => setHolder(e.target.value)} placeholder="Име по банков документ" {...field('holderName')} />
            {f.holderName && <span className="form-error" id={`${uid}-holderName-e`}>{f.holderName}</span>}
          </label>
          <label className="fld"><span className="fld-l" id={`${uid}-bankName-l`}>Банка</span>
            <span className="pa-sel">
              <select className="fld-i" name="bankName" required value={bank} onChange={e => setBank(e.target.value)} {...field('bankName')}>
                <option value="" disabled>Изберете банка</option>
                {banks.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <span className="pa-sel-ic">{CHEV}</span>
            </span>
            {f.bankName && <span className="form-error" id={`${uid}-bankName-e`}>{f.bankName}</span>}
          </label>
        </div>
        {legalName && <div className="fld-hint">Сметката трябва да е на името на фирмата от профила ви — {legalName}.</div>}
        <div className="pa-up">
          <span className="pa-up-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /><path d="M9 14h6M9 17h4" /></svg>
          </span>
          <div>
            <div className="pa-up-t" id={`${uid}-proof-t`}>Документ за потвърждение</div>
            {proof
              ? <div className="pa-up-d is-file" id={`${uid}-proof-d`}>{proof.name}</div>
              : <div className="pa-up-d" id={`${uid}-proof-d`}>Извлечение или удостоверение от банката, в което се виждат IBAN и титулярят.</div>}
          </div>
          <FilePick accept="application/pdf,image/jpeg,image/png" className="btn btn--outline btn--sm" onFile={upload} disabled={uploading}
            describedBy={[`${uid}-proof-t`, `${uid}-proof-d`, f.proof && `${uid}-proof-e`].filter(Boolean).join(' ')}>Качи документ</FilePick>
        </div>
        {f.proof && <span className="form-error" id={`${uid}-proof-e`}>{f.proof}</span>}
        <p className="note pa-note">Смяната на сметката спира временно изплащанията, докато екипът потвърди новите данни. Задържаните {heldText} остават заделени за вас и тръгват по новата сметка по обичайния график — на 1-во или 15-то число след съответното събитие.</p>
      </section>
      <div className="pa-foot">
        <button type="submit" className="btn btn--primary btn--sm" disabled={saving || uploading}>Запази сметката</button>
      </div>
    </form>
  );
}
