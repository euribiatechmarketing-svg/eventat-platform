// Pieces shared by the approval queue and the application page: decision dialogs, check rows, notes.
import Link from 'next/link';
import { dateTime } from '@/lib/format';
import { shortName } from '@/lib/initials';
import { ActionDialog, ActionForm, NoteOnBlur } from '../_ops/ui';
import { initials } from '../_ops/fmt';
import { addPartnerNoteAction, decidePartnerAction, setCheckAction } from './actions';

const OkBox = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>;
const WaitBox = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;

/** The note field the decision dialogs share (‹Бележка до изпълнителя›). */
function NoteField({ required, defaultValue }: { required: boolean; defaultValue?: string }) {
  return (
    <>
      <label className="fld">
        <span className="fld-l">Бележка до изпълнителя{required && <span className="required-mark">*</span>}</span>
        <textarea className="fld-i fld-i--area" name="note" rows={4} maxLength={2000} required={required} defaultValue={defaultValue} />
      </label>
      <div className="fld-hint">Текстът се изпраща на изпълнителя заедно с решението.</div>
    </>
  );
}

/** ‹Одобри› / ‹Върни за поправка› / ‹Откажи заявката› as note dialogs (queue side panel). */
export function DecisionDialogs({ partnerId, name }: { partnerId: string; name: string }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
        <ActionDialog trigger="Одобри" triggerClass="btn btn--primary" triggerStyle={{ flex: 1 }} title={name} submitLabel="Одобри"
          action={decidePartnerAction} hidden={{ partnerId, decision: 'approve' }}>
          <NoteField required={false} />
        </ActionDialog>
        <ActionDialog trigger="Върни за поправка" triggerClass="btn btn--outline" title={name} submitLabel="Върни за поправка"
          action={decidePartnerAction} hidden={{ partnerId, decision: 'return' }}>
          <NoteField required />
        </ActionDialog>
      </div>
      <ActionDialog trigger="Откажи заявката" triggerClass="btn btn--ghost btn--sm btn--block" triggerStyle={{ marginTop: 8, color: 'var(--danger-600)' }}
        title={name} submitLabel="Откажи заявката" submitClass="btn btn--danger" action={decidePartnerAction} hidden={{ partnerId, decision: 'reject' }}>
        <NoteField required />
      </ActionDialog>
    </>
  );
}

/** The decision panel of the application page: the note is typed once, each button sends it with its decision. */
export function DecisionForm({ partnerId, defaultNote }: { partnerId: string; defaultNote?: string }) {
  return (
    <ActionForm action={decidePartnerAction}>
      <input type="hidden" name="partnerId" value={partnerId} />
      <label className="fld">
        <span className="fld-l">Бележка до изпълнителя</span>
        <textarea className="fld-i fld-i--area" name="note" rows={4} maxLength={2000} defaultValue={defaultNote} />
      </label>
      <div className="fld-hint">Текстът се изпраща на изпълнителя заедно с решението.</div>
      <div className="vrev-acts">
        <button type="submit" className="btn btn--primary btn--block" name="decision" value="approve">Одобри</button>
        <button type="submit" className="btn btn--outline btn--block" name="decision" value="return">Върни за поправка</button>
        <button type="submit" className="btn btn--ghost btn--block vrev-danger" name="decision" value="reject">Откажи заявката</button>
      </div>
    </ActionForm>
  );
}

export type CheckView = { kind: string; state: string; label: string; detail: string | null };

/**
 * A check row. Team checks (company, contacts, gallery) can be set from the application page: the box
 * toggles, ‹Провери› marks a waiting one ok. In the queue panel ‹Провери› opens the application.
 */
export function CheckRow({ c, partnerId, editable, back, openHref }: { c: CheckView; partnerId: string; editable: boolean; back: string; openHref?: string }) {
  const ok = c.state === 'ok';
  const team = ['company', 'contacts', 'gallery'].includes(c.kind);
  const box = <>{ok ? <OkBox /> : <WaitBox />}</>;
  return (
    <div className={`chk ${ok ? 'is-ok' : 'is-wait'}`}>
      {editable && team ? (
        <ActionForm action={setCheckAction} className="ops-chk-form">
          <input type="hidden" name="partnerId" value={partnerId} />
          <input type="hidden" name="kind" value={c.kind} />
          <input type="hidden" name="state" value={ok ? 'waiting' : 'ok'} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className="chk-box ops-chk-btn" role="checkbox" aria-checked={ok} aria-label={c.label}>{box}</button>
        </ActionForm>
      ) : <span className="chk-box">{box}</span>}
      <span><span className="chk-n">{c.label}</span>{c.detail && <span className="chk-d">{c.detail}</span>}</span>
      {!ok && editable && team && (
        <span className="chk-a">
          <ActionForm action={setCheckAction} className="ops-inline">
            <input type="hidden" name="partnerId" value={partnerId} />
            <input type="hidden" name="kind" value={c.kind} />
            <input type="hidden" name="state" value="ok" />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="btn btn--outline btn--sm">Провери</button>
          </ActionForm>
        </span>
      )}
      {!ok && !editable && openHref && <span className="chk-a"><Link className="btn btn--outline btn--sm" href={openHref}>Провери</Link></span>}
    </div>
  );
}

/** ‹Бележки от модерацията› with the team's notes and a field that saves on blur. */
export function NotesCard({ partnerId, notes, back }: { partnerId: string; notes: { id: string; body: string; at: Date; authorName: string }[]; back: string }) {
  return (
    <section className="dcard">
      <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Бележки от модерацията</h2></div>
      {notes.map(x => (
        <div className="rev" key={x.id}>
          <div className="rev-head">
            <span className="avatar avatar--sm">{initials(x.authorName)}</span>
            <div><div className="rev-name">{shortName(x.authorName)}</div><div className="rev-meta">{dateTime(x.at)}</div></div>
          </div>
          <div className="rev-text">{x.body}</div>
        </div>
      ))}
      <NoteOnBlur action={addPartnerNoteAction} label="Вътрешна бележка" hidden={{ partnerId, back }}
        hint={<div className="cprof-only"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg><span>Бележката се вижда само от екипа на платформата.</span></div>} />
    </section>
  );
}
