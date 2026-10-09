'use client';
// Client pieces of the admin money screens: filter dropdowns, clickable rows,
// submit buttons with a pending state, dialogs, the case decision form, the
// note field that saves on blur.
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { toast } from '@/components/ui/client';
import { usePopup } from '@/components/ui/popup';
import { money, parseMoney } from '@/lib/format';

type FormAction = (fd: FormData) => void | Promise<void>;

/* ---------- filter dropdown: options are links, so the view is shareable ---------- */
export function FilterMenu({ label, icon, options, align = 'right' }: {
  label: string; icon: 'calendar' | 'filter'; options: { label: string; href: string; active: boolean }[]; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const onArrow = usePopup({ open, setOpen, wrap: ref, trigger: btn, items: true });
  return (
    <span className="ui-anchor am-filter" ref={ref}>
      <button ref={btn} type="button" className="filter-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)} onKeyDown={onArrow}>
        {icon === 'calendar'
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>}
        {label}
        <svg className="am-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div id={id} className={`ui-menu ui-menu--down am-menu${align === 'left' ? ' am-menu--left' : ''}`} role="menu" aria-label={label}>
          {options.map(o => (
            <Link key={o.href + o.label} href={o.href} role="menuitemradio" aria-checked={o.active} tabIndex={-1} className={o.active ? 'is-on' : undefined} onClick={() => setOpen(false)} scroll={false}>{o.label}</Link>
          ))}
        </div>
      )}
    </span>
  );
}

/* ---------- a table row that opens its record: a click anywhere; keyboard and screen readers use the
   real link in its first cell (<CellLink>), so the row itself is not a second tab stop ---------- */
export function RowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr className={`am-row${className ? ` ${className}` : ''}`}
      onClick={e => { if (!(e.target as HTMLElement).closest('a, button, form')) router.push(href); }}>
      {children}
    </tr>
  );
}

/** The row's link, drawn as the cell's text. */
export function CellLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="am-cell-link" href={href}>{children}</Link>;
}

/* ---------- a table row that runs a form when clicked (history row → report) ---------- */
export function RowAction({ formId, label, children }: { formId: string; label: string; children: ReactNode }) {
  const run = () => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
  return (
    <tr className="am-row" tabIndex={0} aria-label={label}
      onClick={e => { if (!(e.target as HTMLElement).closest('a, button')) run(); }}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); run(); } }}>
      {children}
    </tr>
  );
}

/* ---------- submit button that shows the form is working ---------- */
export function Submit({ className, children, name, value, disabled, form }: {
  className: string; children: ReactNode; name?: string; value?: string; disabled?: boolean; form?: string;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending} name={name} value={value} form={form}>{children}</button>;
}

/* ---------- a dialog opened by a button ---------- */
export function Dialog({ label, title, className, children, disabled }: {
  label: ReactNode; title: string; className: string; children: ReactNode; disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} className="am-dialog" aria-label={title} onClick={e => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="am-dialog-h">
          <h2 className="dcard-title">{title}</h2>
          <button type="button" className="am-dialog-x" aria-label="Затвори" onClick={() => ref.current?.close()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="am-dialog-b">{children}</div>
      </dialog>
    </>
  );
}

/** Closes the dialog the button sits in (‹Откажи›). */
export function DialogClose({ className, children }: { className: string; children: ReactNode }) {
  return <button type="button" className={className} onClick={e => (e.currentTarget.closest('dialog') as HTMLDialogElement | null)?.close()}>{children}</button>;
}

/* ---------- the case decision: options, the motive, ‹Приложи решението› ---------- */
export function DecisionForm({ action, disputeId, number, options, paidCents }: {
  action: FormAction; disputeId: string; number: string; paidCents: number;
  options: { id: string | null; kind: string; label: string; description: string | null; compose?: 'obligation' | 'refund' }[];
}) {
  const [sel, setSel] = useState(0);
  const o = options[sel];
  return (
    <form action={action} className="am-decide">
      <input type="hidden" name="disputeId" value={disputeId} />
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="optionId" value={o?.id ?? ''} />
      <input type="hidden" name="kind" value={o?.kind ?? ''} />
      <div className="res" role="radiogroup" aria-label="Решение">
        {options.map((x, i) => (
          <Fragment key={i}>
            <label className={`res-opt${i === sel ? ' is-on' : ''}`}>
              <input type="radio" name="opt" className="sr-only" checked={i === sel} onChange={() => setSel(i)} />
              <span className="res-dot" />
              <span><span className="res-n">{x.label}</span>{x.description ? <span className="res-d">{x.description}</span> : null}</span>
            </label>
            {i === sel && x.compose === 'obligation' && (
              <div className="am-compose">
                <input className="fld-i" name="obligation" required maxLength={300} autoComplete="off" aria-label={x.label} />
              </div>
            )}
            {i === sel && x.compose === 'refund' && <PartialRefund paidCents={paidCents} />}
          </Fragment>
        ))}
      </div>
      <label className="fld cs-motive">
        <span className="fld-l">Мотив към двете страни</span>
        <textarea className="fld-i fld-i--area" name="motive" required maxLength={4000} rows={4}
          placeholder="Напишете мотива — той отива до клиента и до изпълнителя заедно с решението." />
      </label>
      <div className="cs-acts">
        <Submit className="btn btn--primary btn--block">Приложи решението</Submit>
      </div>
    </form>
  );
}

/* ---------- a partial refund: ‹Връща се› more than nothing and never more than was paid; ‹Задържа се› follows ---------- */
function PartialRefund({ paidCents }: { paidCents: number }) {
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const cents = parseMoney(v);
  const ok = cents !== null && cents > 0 && cents <= paidCents;
  useEffect(() => { ref.current?.setCustomValidity(ok ? '' : 'Проверете сумата за връщане'); }, [ok]);
  return (
    <div className="am-compose">
      <label className="split am-refund"><span>Връща се</span>
        <span className="rate-f"><input ref={ref} className="rate-in am-refund-in" name="refund" inputMode="decimal" autoComplete="off" value={v} onChange={e => setV(e.target.value)} aria-label="Връща се" aria-invalid={v.trim() !== '' && !ok} /><span className="rate-u">€</span></span>
      </label>
      <div className="split is-fee"><span>Задържа се</span><b>{ok ? money(paidCents - (cents ?? 0)) : '—'}</b></div>
    </div>
  );
}

/* ---------- the team cancellation's refund: ‹Задържа се› follows what is typed, never more than was paid ---------- */
export function RefundSplit({ paidCents, refundCents }: { paidCents: number; refundCents: number }) {
  const [v, setV] = useState((refundCents / 100).toFixed(2).replace('.', ','));
  const ref = useRef<HTMLInputElement>(null);
  const cents = parseMoney(v);
  const ok = cents !== null && cents <= paidCents;
  useEffect(() => { ref.current?.setCustomValidity(ok ? '' : 'Проверете сумата за връщане'); }, [ok]);
  return (
    <>
      <label className="split am-refund"><span>Връща се</span>
        <span className="rate-f"><input ref={ref} className="rate-in am-refund-in" name="refund" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} aria-label="Връща се" aria-invalid={!ok} /><span className="rate-u">€</span></span>
      </label>
      <div className="split is-fee"><span>Задържа се</span><b>{ok ? money(paidCents - (cents ?? 0)) : '—'}</b></div>
    </>
  );
}

/* ---------- ‹Вътрешна бележка›: saved when the field loses focus ---------- */
export function NoteField({ action, hidden }: { action: FormAction; hidden: Record<string, string> }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} className="am-note-form">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="fld">
        <span className="fld-l">Вътрешна бележка</span>
        <textarea className="fld-i fld-i--area" name="body" rows={3} maxLength={2000}
          onBlur={e => { if (e.currentTarget.value.trim()) ref.current?.requestSubmit(); }} />
      </label>
    </form>
  );
}

/* ---------- the email preview: its links take the focus inside the frame, which the page cannot style
   (the frame never matches :focus), so the frame is marked while a keyboard focus is inside it ---------- */
export function PreviewFrame({ src, title, className }: { src: string; title: string; className: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let win: Window | null = null;
    // Synchronous, so the ring is there as soon as the focus is; a mouse click inside shows none.
    const sync = () => {
      const d = f.contentDocument, at = d?.activeElement;
      f.classList.toggle('is-focused', document.activeElement === f && !!d?.hasFocus() && !!at && at !== d.body && at.matches(':focus-visible'));
    };
    const attach = () => {
      win?.removeEventListener('focusin', sync); win?.removeEventListener('blur', sync);
      win = f.contentWindow;  // a new page in the frame (another email) is a new window
      win?.addEventListener('focusin', sync); win?.addEventListener('blur', sync);
      sync();
    };
    attach();
    f.addEventListener('load', attach);
    return () => { f.removeEventListener('load', attach); win?.removeEventListener('focusin', sync); win?.removeEventListener('blur', sync); };
  }, []);
  return <iframe ref={ref} className={className} src={src} title={title} />;
}

/* ---------- open a print view in a new tab (‹Свали PDF›) ---------- */
export function PrintLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return <a className={className} href={href} target="_blank" rel="noopener">{children}</a>;
}

/* ---------- flash toasts that repeat (the root FlashToast only fires when the text changes) ---------- */
export function FlashAgain({ message, kind = 'ok', nonce }: { message: string | null; kind?: 'ok' | 'error'; nonce: string }) {
  useEffect(() => {
    if (!message) return;
    // A page restored from the router cache (back/forward) must not replay its toast.
    try { if (sessionStorage.getItem('am-flash') === nonce) return; sessionStorage.setItem('am-flash', nonce); } catch { /* storage off */ }
    toast(message, kind);
    document.cookie = 'flash=; Max-Age=0; path=/';
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The page's own topbar title (shared store in components/panel/RailNav). */
export { PageTitle as TopbarTitleText } from '@/components/panel/RailNav';
