'use client';
// The 6-digit code step of verify.html: six cells (typing moves on, Backspace moves back, a pasted
// code fills them all), ‹Потвърди›, and ‹Не получихте кода? Поискайте нов след 0:42›.
import { useEffect, useRef, useState } from 'react';
import { useSubmit } from './useSubmit';
import type { FormState } from './messages';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function CodeForm({ verify, resend, fields, waitMs, spamHint = true, error: initialError }: {
  verify: Action;
  resend: (fd: FormData) => Promise<void>;
  fields: Record<string, string>;
  /** Milliseconds until ‹Поискайте нов› may be used. */
  waitMs: number;
  spamHint?: boolean;
  error?: string | null;
}) {
  const { state, onSubmit, pending } = useSubmit(verify);
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [focus, setFocus] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [left, setLeft] = useState(Math.ceil(waitMs / 1000));

  useEffect(() => { setLeft(Math.ceil(waitMs / 1000)); }, [waitMs]);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  useEffect(() => { if (state?.error) { setDigits(['', '', '', '', '', '']); refs.current[0]?.focus(); } }, [state]);

  const put = (i: number, raw: string) => {
    const only = raw.replace(/\D/g, '');
    if (!only) { setDigits(d => d.map((x, k) => (k === i ? '' : x))); return; }
    setDigits(d => {
      const next = [...d];
      for (let k = 0; k < only.length && i + k < 6; k++) next[i + k] = only[k];
      return next;
    });
    const to = Math.min(5, i + only.length);
    refs.current[to]?.focus();
  };
  const error = state?.error ?? initialError ?? null;
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');

  return (
    <>
      <form onSubmit={onSubmit}>
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="code" value={digits.join('')} />
        <div className={`ver-code${error ? ' is-error' : ''}`} aria-label="Код за потвърждение" role="group">
          {digits.map((d, i) => (
            <input key={i} ref={el => { refs.current[i] = el; }} className={`ver-cell${focus === i ? ' is-next' : ''}`}
              value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={i === 0 ? 6 : 1}
              aria-label={`${i + 1}`} autoFocus={i === 0}
              onFocus={e => { setFocus(i); e.currentTarget.select(); }}
              onChange={e => put(i, e.currentTarget.value)}
              onPaste={e => { e.preventDefault(); put(i, e.clipboardData.getData('text')); }}
              onKeyDown={e => {
                if (e.key === 'Backspace' && !digits[i] && i > 0) { e.preventDefault(); setDigits(x => x.map((v, k) => (k === i - 1 ? '' : v))); refs.current[i - 1]?.focus(); }
                if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
                if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
              }} />
          ))}
        </div>
        {error && <p className="acc-err acc-err--box" role="alert">{error}</p>}
        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={pending || digits.join('').length !== 6}>Потвърди</button>
      </form>

      <form action={resend} className="auth-alt ver-resend">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        Не получихте кода? <button type="submit" className="acc-linkbtn" disabled={left > 0}>Поискайте нов</button>
        {left > 0 && <> <span className="ver-timer">след {mm}:{ss}</span></>}
      </form>

      {spamHint && (
        <div className="ver-hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.6h.01" /></svg>
          <span>Не виждате писмото? Проверете папка „Спам“.</span>
        </div>
      )}
    </>
  );
}

/** The envelope mark above the code screens. */
export function MailMark() {
  return (
    <div className="ver-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7.5l8.5 6 8.5-6" /></svg>
    </div>
  );
}
