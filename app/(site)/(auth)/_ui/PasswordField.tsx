'use client';
// ‹Парола› with the 4-segment strength meter of register.html (SPEC §16: 4/4 = ‹Силна парола›;
// the other levels have no approved label, so they show the bar only).
import { useState } from 'react';

export function strength(pw: string): number {
  if (pw.length < 8) return pw.length ? 1 : 0;
  let s = 1;
  if (/[a-zа-я]/.test(pw) && /[A-ZА-Я]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-zА-Яа-я0-9]/.test(pw) || pw.length >= 12) s++;
  return s;
}

export function PasswordField({ id, name = 'password', error, wide = true, autoComplete = 'new-password' }: {
  id: string; name?: string; error?: string; wide?: boolean; autoComplete?: string;
}) {
  const [pw, setPw] = useState('');
  const s = strength(pw);
  return (
    <div className={`field${wide ? ' reg-wide' : ''}${error ? ' field--error' : ''}`}>
      <label className="field-label" htmlFor={id}>Парола</label>
      <input id={id} className="field-input" name={name} type="password" autoComplete={autoComplete} value={pw} onChange={e => setPw(e.target.value)} />
      <div className="reg-meter" aria-hidden={s < 4}>
        <span className="reg-meter-bar">{[0, 1, 2, 3].map(i => <i key={i} className={i < s ? 'is-on' : undefined}></i>)}</span>
        {s === 4 && <span className="reg-meter-t">Силна парола</span>}
      </div>
      {error && <span className="acc-err">{error}</span>}
    </div>
  );
}
