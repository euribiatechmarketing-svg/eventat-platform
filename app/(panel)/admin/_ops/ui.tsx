'use client';
// Client pieces of the admin-ops screens: URL-driven filter menus, dialogs that run a server
// action, table rows that open a record, notes saved on blur, mail links with a toast.
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { toast } from '@/components/ui/client';

export type ActionResult = { error?: string } | void | undefined;
export type FormAction = (fd: FormData) => Promise<ActionResult>;

/* ---------- filter dropdown (options are links, so the view lives in the URL) ---------- */
export function FilterMenu({ label, icon, options, className = 'filter-btn', align = 'right' }: {
  label: string; icon?: IconName; options: { label: string; href: string; on?: boolean }[]; className?: string; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <span ref={ref} className={`ui-anchor ops-menu${open ? ' is-open' : ''}`}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {icon && <Icon name={icon} />}{label}<Icon name="chevronDown" className="ops-caret" />
      </button>
      {open && (
        <div className={`ui-menu ui-menu--down ops-menu-list${align === 'left' ? ' ops-menu-list--left' : ''}`} role="menu">
          {options.map(o => (
            <Link key={o.href + o.label} href={o.href} role="menuitem" className={o.on ? 'is-on' : ''} onClick={() => setOpen(false)} scroll={false}>{o.label}</Link>
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
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    const first = formRef.current?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select');
    first?.focus();
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  return (
    <>
      <button type="button" className={triggerClass} style={triggerStyle} onClick={() => { setError(null); setOpen(true); if (onOpenToast) toast(onOpenToast); }}>{trigger}</button>
      {open && (
        <div className="modal-overlay ops-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className={`modal ops-modal${wide ? ' ops-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="ops-dialog-title">
            <div className="modal-header">
              <h2 className="ops-modal-title" id="ops-dialog-title">{title}</h2>
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
              {error && <div className="form-error ops-form-error" role="alert">{error}</div>}
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
  return (
    <form ref={ref} id={id} className={`${className ?? ''}${pending ? ' is-pending' : ''}`} aria-busy={pending}
      action={fd => start(async () => {
        setError(null);
        const r = await action(fd);
        if (r && r.error) setError(r.error);
        else if (resetOnSuccess) ref.current?.reset();
      })}>
      {children}
      {error && <div className="form-error" role="alert">{error}</div>}
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
        <textarea className="fld-i fld-i--area" name={name} rows={4} maxLength={2000} onBlur={save} disabled={pending} />
      </label>
      {hint}
      {error && <div className="form-error" role="alert">{error}</div>}
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

/* ---------- the topbar title of a record page (‹Изпълнител · Лунна Фотография›, ‹Клиент · Мария Димитрова›) ----------
   The shared TopbarTitle takes titles by path prefix only; like the other panel areas, this swaps the text
   of its node while the page is shown (the short form on a phone, where the topbar has room for the name only)
   and puts the rail label back when the page goes. */
export function TopbarTitleText({ text, short }: { text: string; short?: string }) {
  useEffect(() => {
    const node = document.querySelector('.shell .topbar .topbar-title')?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const before = node.nodeValue;
    const phone = window.matchMedia('(max-width: 640px)');
    const set = () => { node.nodeValue = phone.matches && short ? short : text; };
    set();
    phone.addEventListener('change', set);
    return () => {
      phone.removeEventListener('change', set);
      if (node.nodeValue === text || node.nodeValue === short) node.nodeValue = before;
    };
  }, [text, short]);
  return null;
}

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
