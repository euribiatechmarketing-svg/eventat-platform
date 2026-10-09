'use client';
// Client pieces of the partner operations screens: the topbar search, filter
// dropdowns, clickable table rows, the request and booking action panels, the
// calendar's block dialogs and its ‹Днес› button.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/client';
import { focusSoon, useModal } from '@/components/ui/a11y';
import { usePopup } from '@/components/ui/popup';

type FormAction = (fd: FormData) => void | Promise<void>;

/* ---------- topbar search (SCREENS §1 ‹Търси по клиент, услуга или дата›) ---------- */
export function TopbarSearch() {
  const path = usePathname();
  const params = useSearchParams();
  const q = path === '/partner/tarsene' ? params.get('q') ?? '' : '';
  return (
    <>
      <form className="search po-search" action="/partner/tarsene" role="search" key={q}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input name="q" type="search" defaultValue={q} placeholder="Търси по клиент, услуга или дата" aria-label="Търси по клиент, услуга или дата" autoComplete="off" />
      </form>
      <Link className="icon-btn po-search-ico" href="/partner/tarsene" aria-label="Търси по клиент, услуга или дата"><Icon name="search" /></Link>
    </>
  );
}

/* ---------- topbar ‹BG› / ‹EN› (SCREENS §1; English is not published yet, D36) ---------- */
export function TopbarLang() {
  const en = () => toast('Английската версия идва скоро');
  return (
    <span className="lang po-lang" role="group" aria-label="Език">
      <b aria-current="true">BG</b>
      <span role="button" tabIndex={0} onClick={en} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); en(); } }}>EN</span>
    </span>
  );
}

/* ---------- filter dropdown (‹Филтри›, ‹Период›): options are links, so the view is shareable ---------- */
export function FilterMenu({ label, icon, options }: {
  label: string; icon: 'filter' | 'download'; options: { label: string; href: string; active: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  // A menu button (components/ui/popup.ts): focus goes to the chosen option, arrows move, Escape returns.
  const onArrow = usePopup({ open, setOpen, wrap: ref, trigger: btn, items: true });
  return (
    <span className="ui-anchor po-filter" ref={ref}>
      <button ref={btn} type="button" className="filter-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)} onKeyDown={onArrow}>
        {icon === 'filter'
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>}
        {label}
        <svg className="ui-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div id={id} className="ui-menu ui-menu--down" role="menu" aria-label={label}>
          {options.map(o => (
            <Link key={o.label} href={o.href} role="menuitemradio" aria-checked={o.active} tabIndex={-1} className={o.active ? 'is-on' : undefined} onClick={() => setOpen(false)} scroll={false}>{o.label}</Link>
          ))}
        </div>
      )}
    </span>
  );
}

/* ---------- a table row that opens its record ---------- */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr className="po-row" onClick={e => { if (!(e.target as HTMLElement).closest('a, button')) router.push(href); }}>
      {children}
    </tr>
  );
}

/* ---------- submit button that shows the form is working ---------- */
export function Submit({ className, children, name, value }: { className: string; children: ReactNode; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending} aria-busy={pending} name={name} value={value}>{children}</button>;
}

/* ---------- request page: ‹Одобри заявката› · ‹Поискай още информация› · ‹Откажи› ---------- */
export function RequestActions({ number, canApprove, canAsk, approveAction, askAction, declineAction }: {
  number: string; canApprove: boolean; canAsk: boolean;
  approveAction: FormAction; askAction: FormAction; declineAction: FormAction;
}) {
  const [mode, setMode] = useState<'idle' | 'ask' | 'decline'>('idle');
  const [reason, setReason] = useState<'date_taken' | 'other'>('date_taken');
  const box = useRef<HTMLDivElement>(null);
  // The panel's content is replaced when the mode changes: focus follows to the new content
  // (‹Назад› returns it to the button that opened the form).
  const back = useRef<'ask' | 'decline' | null>(null);
  const go = (m: 'idle' | 'ask' | 'decline') => {
    if (m === 'idle') back.current = mode === 'idle' ? null : mode; else back.current = null;
    setMode(m);
    focusSoon(() => {
      const b = box.current;
      if (!b) return null;
      if (m === 'decline') return b.querySelector<HTMLElement>('input[name="reason"]:checked');
      if (m === 'idle' && back.current) return b.querySelector<HTMLElement>(`[data-mode="${back.current}"]`);
      return null;
    });
  };
  let body: ReactNode;
  if (mode === 'ask') {
    body = (
      <form className="panel-actions" action={askAction}>
        <input type="hidden" name="number" value={number} />
        <textarea className="fld-i fld-i--area" name="body" required maxLength={4000} rows={4} aria-label="Поискай още информация" autoFocus />
        <Submit className="btn btn--primary btn--block">Изпрати</Submit>
        <button type="button" className="btn btn--ghost btn--block" onClick={() => go('idle')}>Назад</button>
      </form>
    );
  } else if (mode === 'decline') {
    body = (
      <form className="panel-actions" action={declineAction}>
        <input type="hidden" name="number" value={number} />
        <div className="po-picks" role="radiogroup" aria-label="Откажи">
          {([['date_taken', 'Датата е заета'], ['other', 'Друга причина']] as const).map(([v, l]) => (
            <label key={v} className={`po-pick${reason === v ? ' is-on' : ''}`}>
              <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} />
              <span className="po-dot" /><span className="po-pick-n">{l}</span>
            </label>
          ))}
        </div>
        {reason === 'other' && <textarea className="fld-i fld-i--area" name="text" required maxLength={500} rows={3} aria-label="Друга причина" autoFocus />}
        <Submit className="btn btn--primary btn--block">Откажи</Submit>
        <button type="button" className="btn btn--ghost btn--block" onClick={() => go('idle')}>Назад</button>
      </form>
    );
  } else {
    body = (
      <div className="panel-actions">
        {canApprove && (
          <form action={approveAction}>
            <input type="hidden" name="number" value={number} />
            <Submit className="btn btn--primary btn--block">Одобри заявката</Submit>
          </form>
        )}
        {canAsk && <button type="button" className="btn btn--outline btn--block" data-mode="ask" onClick={() => go('ask')}>Поискай още информация</button>}
        <button type="button" className="btn btn--ghost btn--block" data-mode="decline" onClick={() => go('decline')}>Откажи</button>
      </div>
    );
  }
  return <div ref={box} style={{ display: 'contents' }}>{body}</div>;
}

/* ---------- booking page: ‹Анулиране› asks once more before it sends the request ---------- */
export function CancelBooking({ number, action }: { number: string; action: FormAction }) {
  const [confirm, setConfirm] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const flip = (on: boolean) => {
    setConfirm(on);
    focusSoon(() => box.current?.querySelector<HTMLElement>(on ? 'button[type="submit"]' : 'button'));
  };
  return (
    <div ref={box} style={{ display: 'contents' }}>
      {!confirm
        ? <button type="button" className="btn btn--ghost btn--block" onClick={() => flip(true)}>Анулиране</button>
        : (
          <form className="panel-actions po-confirm" action={action}>
            <input type="hidden" name="number" value={number} />
            <Submit className="btn btn--danger btn--block">Анулиране</Submit>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => flip(false)}>Назад</button>
          </form>
        )}
    </div>
  );
}

/* ---------- calendar: ‹Блокирай период› / ‹Блокирай дата› dialogs ---------- */
export function BlockButtons({ today, back, rangeAction, dateAction }: { today: string; back: string; rangeAction: FormAction; dateAction: FormAction }) {
  const [open, setOpen] = useState<null | 'range' | 'date'>(null);
  const dialog = useRef<HTMLFormElement>(null);
  const titleId = useId();
  useModal(!!open, () => setOpen(null), dialog);
  const title = open === 'range' ? 'Блокирай период' : 'Блокирай дата';
  return (
    <>
      <button type="button" className="btn btn--outline btn--sm" aria-haspopup="dialog" onClick={() => setOpen('range')}>Блокирай период</button>
      <button type="button" className="btn btn--primary btn--sm" aria-haspopup="dialog" onClick={() => setOpen('date')}>Блокирай дата</button>
      {open && (
        <div className="modal-overlay po-modal" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(null); }}>
          <form ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} action={open === 'range' ? rangeAction : dateAction}>
            <input type="hidden" name="back" value={back} />
            <div className="modal-header">
              <h2 className="modal-title panel-title" id={titleId}>{title}</h2>
              <button type="button" className="blk-x" aria-label="Затвори" onClick={() => setOpen(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {open === 'range' ? (
              <div className="fld" role="group" aria-labelledby={`${titleId}-p`}>
                <span className="fld-l" id={`${titleId}-p`}>Период</span>
                <div className="po-range">
                  <input className="fld-i" type="date" name="from" min={today} required aria-label="Период от" />
                  <span aria-hidden="true">–</span>
                  <input className="fld-i" type="date" name="to" min={today} required aria-label="Период до" />
                </div>
              </div>
            ) : (
              <label className="fld">
                <span className="fld-l">Дата</span>
                <input className="fld-i" type="date" name="date" min={today} required />
              </label>
            )}
            <label className="fld po-fld">
              <span className="fld-l">Причина</span>
              <input className="fld-i" type="text" name="reason" maxLength={80} />
            </label>
            <div className="modal-footer">
              <Submit className="btn btn--primary">{title}</Submit>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/* ---------- flash toasts that repeat (the root FlashToast only fires when the text changes) ---------- */
export function FlashAgain({ message, kind = 'ok', nonce }: { message: string | null; kind?: 'ok' | 'error'; nonce: string }) {
  useEffect(() => {
    if (!message) return;
    toast(message, kind);
    document.cookie = 'flash=; Max-Age=0; path=/';
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The page's own topbar title (shared store in components/panel/RailNav). */
export { PageTitle as TopbarTitleText } from '@/components/panel/RailNav';

/* ---------- calendar ‹Днес›: back to the current month, toast ‹Показваме текущия месец› ---------- */
export function TodayButton({ href }: { href: string }) {
  const router = useRouter();
  return (
    <button type="button" className="btn btn--outline btn--sm" onClick={() => { router.push(href); toast('Показваме текущия месец'); }}>Днес</button>
  );
}
