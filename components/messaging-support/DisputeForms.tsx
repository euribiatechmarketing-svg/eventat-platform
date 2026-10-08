'use client';
// ‹Изпрати сигнала› forms (client/dispute.html, vendor/dispute.html) and the case page's reply
// (‹Отговори на екипа›). Real <form>s posting to the route's server actions; the evidence is
// uploaded as it is chosen.
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Evidence } from './Evidence';

type Upload = { ok: true; id: string; name: string; mime: string } | { ok: false; error: string };
type FormState = { error?: string };
type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

export type ClientChoice = { id: string; number: string; title: string; sub: string; imageUrl: string | null };
export type PartnerChoice = { id: string; number: string; title: string; sub: string };

/** client/dispute.html .form-card */
export function ClientDisputeForm({ choices, reasons, preselect, action, upload, maxPhotos, maxMb }: {
  choices: ClientChoice[]; reasons: { value: string; label: string }[]; preselect: string | null;
  action: FormAction; upload: (fd: FormData) => Promise<Upload>; maxPhotos: number; maxMb: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const initial = choices.find(c => c.number === preselect)?.id ?? (choices.length === 1 ? choices[0].id : '');
  const [booking, setBooking] = useState(initial);
  const [reason, setReason] = useState('');
  // Controlled, so a refused submission (React resets uncontrolled fields) keeps the text.
  const [text, setText] = useState('');
  return (
    <form className="form-card" action={formAction}>
      <h2 className="dp-h">За коя резервация е сигналът</h2>
      {choices.length ? (
        <div className="dp-picks" role="radiogroup" aria-label="За коя резервация е сигналът">
          {choices.map(c => (
            <label key={c.id} className={`dp-pick${booking === c.id ? ' is-on' : ''}`}>
              <input className="sr-only" type="radio" name="bookingId" value={c.id} checked={booking === c.id} required onChange={() => setBooking(c.id)} />
              <span className="dp-dot" />
              <span className="dp-pick-img" style={c.imageUrl ? { backgroundImage: `url('${c.imageUrl}')` } : undefined} />
              <span className="dp-pick-b">
                <span className="dp-pick-n">{c.title}</span>
                <span className="dp-pick-s">{c.sub}</span>
              </span>
            </label>
          ))}
        </div>
      ) : <div className="ui-empty">Няма записи в този изглед.</div>}

      <div className="dp-sec">
        <h2 className="dp-h">Какъв е проблемът</h2>
        <div className="opt-row" role="radiogroup" aria-label="Какъв е проблемът">
          {reasons.map(r => (
            <button key={r.value} type="button" role="radio" aria-checked={reason === r.value} className={`opt${reason === r.value ? ' is-on' : ''}`} onClick={() => setReason(r.value)}>{r.label}</button>
          ))}
        </div>
        <input type="hidden" name="reason" value={reason} />
      </div>

      <div className="dp-sec">
        <div className="field">
          <label className="field-label" htmlFor="dp-description">Опишете какво се случи<span className="field-label-hint">колкото по-конкретно, толкова по-бързо решаваме</span></label>
          <textarea id="dp-description" className="field-textarea" name="description" style={{ minHeight: 118, lineHeight: 1.65 }} maxLength={2000} required
            value={text} onChange={e => setText(e.target.value)} />
        </div>
        <div style={{ marginTop: 20 }}>
          <Evidence variant="client" upload={upload} max={maxPhotos} maxMb={maxMb} />
        </div>
      </div>

      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      <div className="ms-actions">
        <button className="btn btn--primary" type="submit" disabled={pending || !choices.length}>Изпрати сигнала</button>
        <Link className="btn btn--ghost" href="/akaunt/rezervacii">Назад</Link>
      </div>
    </form>
  );
}

/** vendor/dispute.html: the main column of .dash-grid (the aside is passed in). */
export function PartnerDisputeForm({ choices, reasons, preselect, action, upload, maxPhotos, maxMb, aside }: {
  choices: PartnerChoice[]; reasons: { value: string; label: string; desc: string }[]; preselect: string | null;
  action: FormAction; upload: (fd: FormData) => Promise<Upload>; maxPhotos: number; maxMb: number; aside: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const initial = choices.find(c => c.number === preselect)?.id ?? (choices.length === 1 ? choices[0].id : '');
  const [booking, setBooking] = useState(initial);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  return (
    <form className="dash-grid ms-dispute" action={formAction}>
      <div>
        <section className="dcard">
          <div className="dcard-head"><h2 className="dcard-title">За коя резервация</h2></div>
          {choices.length ? (
            <div className="pol" role="radiogroup" aria-label="За коя резервация">
              {choices.map(c => (
                <label key={c.id} className={`pol-opt${booking === c.id ? ' is-on' : ''}`}>
                  <input className="sr-only" type="radio" name="bookingId" value={c.id} checked={booking === c.id} required onChange={() => setBooking(c.id)} />
                  <span className="pol-dot" />
                  <div>
                    <div className="pol-name">{c.title}</div>
                    <div className="pol-desc">{c.sub}</div>
                  </div>
                </label>
              ))}
            </div>
          ) : <div className="ui-empty">Няма записи в този изглед.</div>}
        </section>

        <section className="dcard">
          <div className="dcard-head"><h2 className="dcard-title">Причина</h2></div>
          <div className="pol dp-reasons" role="radiogroup" aria-label="Причина">
            {reasons.map(r => (
              <label key={r.value} className={`pol-opt${reason === r.value ? ' is-on' : ''}`}>
                <input className="sr-only" type="radio" name="reason" value={r.value} checked={reason === r.value} required onChange={() => setReason(r.value)} />
                <span className="pol-dot" />
                <div>
                  <div className="pol-name">{r.label}</div>
                  <div className="pol-desc">{r.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="dcard">
          <div className="dcard-head"><h2 className="dcard-title">Какво се случи</h2></div>
          <label className="fld">
            <span className="fld-l">Описание</span>
            <textarea className="fld-i fld-i--area" name="description" maxLength={2000} required value={text} onChange={e => setText(e.target.value)}
              placeholder="Опишете по дати какво се случи, какво сте направили и какво искате от екипа." />
          </label>
          <div className="fld-hint">Конкретните дати, часове и имена помагат случаят да се реши по-бързо.</div>
        </section>

        <section className="dcard">
          <div className="dcard-head"><h2 className="dcard-title">Доказателства</h2></div>
          <Evidence variant="partner" upload={upload} max={maxPhotos} maxMb={maxMb} />
        </section>

        {state.error && <div className="form-error" role="alert">{state.error}</div>}
        <div className="dp-foot">
          <Link className="btn btn--ghost btn--sm" href="/partner/rezervacii">Назад</Link>
          <button className="btn btn--primary btn--sm" type="submit" disabled={pending || !choices.length}>Изпрати сигнала</button>
        </div>
      </div>
      {aside}
    </form>
  );
}

/** The case page's reply: ‹Отговори на екипа› (client: ‹Изпрати›; partner: ‹Изпрати позицията› while its position is asked). */
export function StatementForm({ variant, disputeId, number, submitLabel, action, upload, maxPhotos, maxMb }: {
  variant: 'client' | 'partner'; disputeId: string; number: string; submitLabel: string;
  action: FormAction; upload: (fd: FormData) => Promise<Upload>; maxPhotos: number; maxMb: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [text, setText] = useState('');
  if (variant === 'client') {
    return (
      <form className="form-card" action={formAction}>
        <input type="hidden" name="disputeId" value={disputeId} />
        <input type="hidden" name="number" value={number} />
        <h2 className="dp-h">Отговори на екипа</h2>
        <div className="field">
          <label className="field-label" htmlFor="st-body">Опишете какво се случи<span className="field-label-hint">колкото по-конкретно, толкова по-бързо решаваме</span></label>
          <textarea id="st-body" className="field-textarea" name="body" style={{ minHeight: 118, lineHeight: 1.65 }} maxLength={4000} required
            value={text} onChange={e => setText(e.target.value)} />
        </div>
        <div style={{ marginTop: 20 }}>
          <Evidence variant="client" upload={upload} max={maxPhotos} maxMb={maxMb} />
        </div>
        {state.error && <div className="form-error" role="alert">{state.error}</div>}
        <div className="ms-actions">
          <button className="btn btn--primary" type="submit" disabled={pending}>{submitLabel}</button>
        </div>
      </form>
    );
  }
  return (
    <form className="dcard" action={formAction}>
      <input type="hidden" name="disputeId" value={disputeId} />
      <input type="hidden" name="number" value={number} />
      <div className="dcard-head"><h2 className="dcard-title">Отговори на екипа</h2></div>
      <label className="fld">
        <span className="fld-l">Описание</span>
        <textarea className="fld-i fld-i--area" name="body" maxLength={4000} required value={text} onChange={e => setText(e.target.value)}
          placeholder="Опишете по дати какво се случи, какво сте направили и какво искате от екипа." />
      </label>
      <div className="fld-hint">Конкретните дати, часове и имена помагат случаят да се реши по-бързо.</div>
      <div style={{ marginTop: 18 }}>
        <Evidence variant="partner" upload={upload} max={maxPhotos} maxMb={maxMb} />
      </div>
      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      <div className="dp-foot">
        <button className="btn btn--primary btn--sm" type="submit" disabled={pending}>{submitLabel}</button>
      </div>
    </form>
  );
}
