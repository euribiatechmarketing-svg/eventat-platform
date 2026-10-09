'use client';
// The booking box on the public profile (client/vendor.html `aside .book`): date, event type,
// guests and package, defaulting to the client's chosen or next event (SPEC §13.10). Changing the
// date re-checks availability; a busy date swaps in ‹Заета дата› with ‹Уведоми ме, ако се освободи›.
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { date as fmtDate, weekdayName } from '@/lib/format';
import { NotifyButton } from '../../_components/client';
import { checkDateAction } from './actions';

/** The client's own live request or booking with this partner on the chosen date. */
type Own = { label: string; href: string } | null;

export type WidgetProps = {
  partnerId: string; slug: string;
  fromPrice: { text: string; unitLabel: string } | null;
  types: { slug: string; name: string }[];
  events: { id: string; date: string; guests: number | null; typeSlug: string }[];
  services: { id: string; label: string }[];
  initial: { date: string | null; typeSlug: string | null; guests: number | null; serviceId: string | null; eventId: string | null; busy: boolean; own: Own };
  today: string;
  /** client: requests and watches; guest: sent to sign up / sign in first; none: no request controls. */
  mode: 'client' | 'guest' | 'none';
  signIn: string;
  responseHours: number;
  policyLine: { label: string; text: string } | null;
};

const weekday = (d: string) => { const [y, m, day] = d.split('-').map(Number); return weekdayName(new Date(Date.UTC(y, m - 1, day)).getUTCDay()); };

export function Widget(w: WidgetProps) {
  const [d, setD] = useState(w.initial.date);
  const [type, setType] = useState(w.initial.typeSlug ?? w.types[0]?.slug ?? '');
  const [guests, setGuests] = useState(w.initial.guests ? String(w.initial.guests) : '');
  const [svc, setSvc] = useState(w.initial.serviceId ?? w.services[0]?.id ?? '');
  const [busy, setBusy] = useState(w.initial.busy);
  const [own, setOwn] = useState<Own>(w.initial.own);
  const [checking, start] = useTransition();
  const dateInput = useRef<HTMLInputElement>(null);

  const changeDate = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < w.today) return;
    setD(v);
    start(async () => {
      const r = await checkDateAction({ partnerId: w.partnerId, date: v });
      setBusy(!!r?.busy);
      setOwn(r?.own ?? null);
    });
  };

  // The request carries the client's event only while date and type still describe it.
  const ev = w.events.find(e => e.id === w.initial.eventId) ?? w.events.find(e => e.date === d && e.typeSlug === type) ?? null;
  const q = new URLSearchParams();
  if (svc) q.set('paket', svc);
  if (ev && ev.date === d && ev.typeSlug === type) q.set('sabitie-id', ev.id);
  if (d) q.set('data', d);
  if (guests && /^\d{1,5}$/.test(guests)) q.set('gosti', guests);
  const requestHref = `/zayavka/${encodeURIComponent(w.slug)}?${q.toString()}`;
  const ctaHref = w.mode === 'guest' ? `/registratsiya?next=${encodeURIComponent(requestHref)}` : requestHref;
  const openPicker = () => { const i = dateInput.current; if (!i) return; try { i.showPicker(); } catch { i.focus(); } };

  return (
    <div className="book">
      {w.fromPrice && <div className="book-price">{w.fromPrice.text} <small>{w.fromPrice.unitLabel}</small></div>}
      {w.mode !== 'none' && (
        <>
          <div className="book-f">
            <div className="book-f-row ui-click" onClick={openPicker}>
              <label className="book-f-l" htmlFor="w-date">Дата на събитието</label>
              <div className="book-f-sel">
                <div className="book-f-v" aria-hidden="true">{d ? `${fmtDate(d)} · ${weekday(d)}` : '—'}</div>
                <input ref={dateInput} id="w-date" className="book-f-date" type="date" min={w.today} value={d ?? ''}
                  onChange={e => changeDate(e.target.value)} />
                <svg className="sb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </div>
            </div>
            <div className="book-f-row">
              <label className="book-f-l" htmlFor="w-type">Тип събитие</label>
              <div className="book-f-sel">
                <select id="w-type" className="book-f-v" value={type} onChange={e => setType(e.target.value)}>
                  {w.types.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                </select>
                <svg className="sb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </div>
            </div>
            <div className="book-f-row">
              <label className="book-f-l" htmlFor="w-guests">Гости</label>
              <div className="book-f-guests">
                <input id="w-guests" className="book-f-v" inputMode="numeric" value={guests} placeholder="—" style={{ width: `${Math.max(guests.length, 1) + 0.15}ch` }}
                  onChange={e => setGuests(e.target.value.replace(/\D/g, '').slice(0, 5))} />
                {guests && <span className="book-f-v">души</span>}
              </div>
            </div>
            {w.services.length > 0 && (
              <div className="book-f-row">
                <label className="book-f-l" htmlFor="w-svc">Пакет</label>
                <div className="book-f-sel">
                  <select id="w-svc" className="book-f-v" value={svc} onChange={e => setSvc(e.target.value)}>
                    {w.services.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <svg className="sb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </div>
              </div>
            )}
          </div>
          {own && d ? (
            <div className="panel-actions" style={{ marginTop: 16 }}>
              <Link className="btn btn--primary btn--block" href={own.href}>{own.label}</Link>
            </div>
          ) : busy && d ? (
            <div aria-live="polite">
              <div className="book-rule"><strong style={{ color: 'var(--text)' }}>Заета дата:</strong> изпълнителят вече има ангажимент на {fmtDate(d)} г. Ще ви известим, ако датата се освободи.</div>
              <div className="panel-actions" style={{ marginTop: 12 }}>
                <NotifyButton partnerId={w.partnerId} date={d} sabitieId={ev?.date === d ? ev.id : null} signIn={w.mode === 'guest' ? w.signIn : null}
                  label="Уведоми ме, ако се освободи" className="btn btn--outline btn--block" />
              </div>
            </div>
          ) : (
            <div className="panel-actions" style={{ marginTop: 16 }}>
              <Link className="btn btn--primary btn--block" href={ctaHref} aria-disabled={checking}>Изпрати запитване</Link>
            </div>
          )}
          {!own && <div className="book-note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>Не плащате сега. Изпълнителят потвърждава до&nbsp;{w.responseHours}&nbsp;{w.responseHours === 1 ? 'час' : 'часа'}, след което плащате през платформата.</span>
          </div>}
        </>
      )}
      {w.policyLine && <div className="book-rule"><strong style={{ color: 'var(--text)' }}>{w.policyLine.label}</strong>{w.policyLine.text}</div>}
    </div>
  );
}
