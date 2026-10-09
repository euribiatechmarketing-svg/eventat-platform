'use client';
// Client pieces of the admin-ops screens: URL-driven filter menus, dialogs that run a server
// action, table rows that open a record, notes saved on blur, mail links with a toast.
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { toast } from '@/components/ui/client';
import { usePopup } from '@/components/ui/popup';

export type ActionResult = { error?: string } | void | undefined;
export type FormAction = (fd: FormData) => Promise<ActionResult>;

/* ---------- filter dropdown (options are links, so the view lives in the URL) ---------- */
export function FilterMenu({ label, icon, options, className = 'filter-btn', align = 'right' }: {
  label: string; icon?: IconName; options: { label: string; href: string; on?: boolean }[]; className?: string; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const onArrow = usePopup({ open, setOpen, wrap: ref, trigger: btn, items: true });
  return (
    <span ref={ref} className={`ui-anchor ops-menu${open ? ' is-open' : ''}`}>
      <button ref={btn} type="button" className={className} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)} onKeyDown={onArrow}>
        {icon && <Icon name={icon} />}{label}<Icon name="chevronDown" className="ops-caret" />
      </button>
      {open && (
        <div id={id} className={`ui-menu ui-menu--down ops-menu-list${align === 'left' ? ' ops-menu-list--left' : ''}`} role="menu" aria-label={label}>
          {options.map(o => (
            <Link key={o.href + o.label} href={o.href} role="menuitemradio" aria-checked={!!o.on} tabIndex={-1} className={o.on ? 'is-on' : ''} onClick={() => setOpen(false)} scroll={false}>{o.label}</Link>
          ))}
        </div>
      )}
    </span>
  );
}

/* ---------- dialog that submits a server action ---------- */
export function ActionDialog({ trigger, triggerClass = 'btn btn--outline btn--sm', triggerStyle, title, submitLabel, submitClass = 'btn btn--primary', action, children, hidden, wide = false, onOpenToast }: {
  trigger: ReactNode; triggerClass?: string; triggerStyle?: React.CSSProperties; title: ReactNode; submitLabel: string; submitClass?: string;
  action: FormAction; children?: ReactNode; hidden?: Record<string, string>; wide?: boolean; onOpenToast?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    // Focus goes to the first field, or to ‹Затвори› when the dialog only confirms; Tab stays inside.
    const focusables = () => [...(boxRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])];
    const first = formRef.current?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select') ?? boxRef.current?.querySelector<HTMLElement>('.ops-x');
    first?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const xs = focusables();
      const i = xs.indexOf(document.activeElement as HTMLElement);
      if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === xs.length - 1)) { e.preventDefault(); (e.shiftKey ? xs[xs.length - 1] : xs[0])?.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('keydown', keys);
      // back to the button that opened it (unless the action moved focus elsewhere, e.g. the page changed)
      if (trigger?.isConnected && (!document.activeElement || document.activeElement === document.body || boxRef.current?.contains(document.activeElement))) trigger.focus();
    };
  }, [open]);
  // A refused action: the message is announced (role=alert) and describes the dialog's fields.
  useEffect(() => {
    const fields = formRef.current?.querySelectorAll<HTMLElement>('input:not([type=hidden]), textarea, select') ?? [];
    fields.forEach(f => { if (error) f.setAttribute('aria-describedby', `${id}-err`); else f.removeAttribute('aria-describedby'); });
  }, [error, id, open]);
  return (
    <>
      <button ref={triggerRef} type="button" className={triggerClass} style={triggerStyle} aria-haspopup="dialog" onClick={() => { setError(null); setOpen(true); if (onOpenToast) toast(onOpenToast); }}>{trigger}</button>
      {open && (
        <div className="modal-overlay ops-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div ref={boxRef} className={`modal ops-modal${wide ? ' ops-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
            <div className="modal-header">
              <h2 className="ops-modal-title" id={`${id}-title`}>{title}</h2>
              <button type="button" className="ops-x" aria-label="Затвори" onClick={() => setOpen(false)}><Icon name="close" /></button>
            </div>
            <form ref={formRef} action={fd => start(async () => {
              setError(null);
              const r = await action(fd);
              if (r && r.error) setError(r.error);
              else setOpen(false);
            })}>
              {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {children}
              {error && <div className="form-error ops-form-error" role="alert" id={`${id}-err`}>{error}</div>}
              <div className="modal-footer ops-modal-footer">
                <button type="submit" className={submitClass} disabled={pending}>{submitLabel}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- a form whose submit buttons run server actions, with inline errors ---------- */
export function ActionForm({ action, children, className, id, resetOnSuccess = false }: {
  action: FormAction; children: ReactNode; className?: string; id?: string; resetOnSuccess?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const errId = useId();
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('input:not([type=hidden]), textarea, select')
      .forEach(f => { if (error) f.setAttribute('aria-describedby', errId); else f.removeAttribute('aria-describedby'); });
  }, [error, errId]);
  return (
    <form ref={ref} id={id} className={`${className ?? ''}${pending ? ' is-pending' : ''}`} aria-busy={pending}
      action={fd => start(async () => {
        setError(null);
        const r = await action(fd);
        if (r && r.error) setError(r.error);
        else if (resetOnSuccess) ref.current?.reset();
      })}>
      {children}
      {error && <div className="form-error" role="alert" id={errId}>{error}</div>}
    </form>
  );
}

/* ---------- a table row that opens a record (the first cell keeps a real link) ---------- */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr className="ops-row" onClick={e => { if (!(e.target as HTMLElement).closest('a, button')) router.push(href); }}>
      {children}
    </tr>
  );
}

/* ---------- a note saved when the field loses focus (notes.add) ---------- */
export function NoteOnBlur({ action, label, hint, name = 'body', hidden }: {
  action: FormAction; label: string; hint?: ReactNode; name?: string; hidden?: Record<string, string>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const save = () => {
    const f = ref.current;
    if (!f) return;
    const fd = new FormData(f);
    if (!String(fd.get(name) ?? '').trim()) return;
    start(async () => {
      const r = await action(fd);
      if (r && r.error) setError(r.error);
      else { setError(null); f.reset(); }
    });
  };
  return (
    <form ref={ref} className="ops-note" onSubmit={e => { e.preventDefault(); save(); }} aria-busy={pending}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="fld">
        <span className="fld-l">{label}</span>
        <textarea className="fld-i fld-i--area" name={name} rows={4} maxLength={2000} onBlur={save} disabled={pending} aria-describedby={error ? errId : undefined} />
      </label>
      {hint}
      {error && <div className="form-error" role="alert" id={errId}>{error}</div>}
    </form>
  );
}

/* ---------- a mailto link that also confirms with a toast ---------- */
export function MailLink({ href, className, children, toastText }: { href: string; className?: string; children: ReactNode; toastText: string }) {
  return <a className={className} href={href} onClick={() => toast(toastText)}>{children}</a>;
}

/* ---------- a button that only shows a toast (no record changes) ---------- */
export function ToastButton({ className, children, text }: { className?: string; children: ReactNode; text: string }) {
  return <button type="button" className={className} onClick={() => toast(text)}>{children}</button>;
}

/* ---------- submit button with a pending state ---------- */
export function Submit({ className = 'btn btn--primary', children, name, value, formNoValidate, style }: {
  className?: string; children: ReactNode; name?: string; value?: string; formNoValidate?: boolean; style?: React.CSSProperties;
}) {
  return <button type="submit" className={className} name={name} value={value} formNoValidate={formNoValidate} style={style}>{children}</button>;
}

/** The page's own topbar title (shared store in components/panel/RailNav). */
export { PageTitle as TopbarTitleText } from '@/components/panel/RailNav';

/* ---------- ‹Чести бележки› on the moderation page: picked notes start the next ‹Върни с бележка› note ---------- */
let pickedNotes: string[] = [];
const pickListeners = new Set<() => void>();
const notePrefill = () => pickedNotes.map(t => `${t}.`).join(' ');

export function CommonNotePicks({ items }: { items: string[] }) {
  const [picked, setPicked] = useState<string[]>(pickedNotes);
  useEffect(() => {
    const on = () => setPicked([...pickedNotes]);
    pickListeners.add(on);
    return () => { pickListeners.delete(on); };
  }, []);
  const flip = (t: string) => {
    pickedNotes = pickedNotes.includes(t) ? pickedNotes.filter(x => x !== t) : [...pickedNotes, t];
    pickListeners.forEach(f => f());
  };
  return (
    <div className="chips">
      {items.map(t => (
        <button key={t} type="button" className={`chip ops-pick${picked.includes(t) ? ' is-on' : ''}`} aria-pressed={picked.includes(t)} onClick={() => flip(t)}>{t}</button>
      ))}
    </div>
  );
}

/** The required note of ‹Върни с бележка›: starts with the common notes picked on the page. */
export function ReturnNoteField({ name = 'note' }: { name?: string }) {
  const [initial] = useState(notePrefill);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // once a note is sent, the picks have done their job
    const form = ref.current?.form;
    if (!form) return;
    const sent = () => { if (pickedNotes.length) { pickedNotes = []; pickListeners.forEach(f => f()); } };
    form.addEventListener('submit', sent);
    return () => form.removeEventListener('submit', sent);
  }, []);
  return <textarea ref={ref} className="fld-i fld-i--area" name={name} rows={4} maxLength={2000} required defaultValue={initial} />;
}

/* ---------- chips that put a ready-made sentence into the form's note (‹Чести бележки›) ---------- */
export function InsertChips({ items, field = 'note' }: { items: string[]; field?: string }) {
  return (
    <div className="chips">
      {items.map(t => (
        <button key={t} type="button" className="chip" onClick={e => {
          const ta = e.currentTarget.closest('form')?.querySelector<HTMLTextAreaElement>(`textarea[name="${field}"]`);
          if (!ta) return;
          const cur = ta.value.trim();
          ta.value = cur ? (cur.includes(t) ? cur : `${cur} ${t}.`) : `${t}.`;
          ta.focus();
        }}>{t}</button>
      ))}
    </div>
  );
}
