'use client';
// client/auth.html: tabs, role cards (they switch the photo and carry ?as= to sign-up), email,
// password, ‹Запомни ме›, ‹Забравена парола?›, ‹Влез›, the social buttons and the two links below.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from '@/components/ui/client';
import { AuthSides, type AuthRole } from '../_ui/AuthSides';
import { carry } from '../_ui/messages';
import { useSubmit } from '../_ui/useSubmit';
import { forgotPasswordAction, signInAction, socialSignInAction } from './actions';

const SOCIAL_LABEL = { google: 'Продължи с Google', facebook: 'Продължи с Facebook' } as const;

export function SignInForm({ as, next, email, social }: { as: AuthRole; next: string | null; email: string; social: ('google' | 'facebook')[] }) {
  const [role, setRole] = useState<AuthRole>(as);
  const { state, onSubmit, pending } = useSubmit(signInAction);
  const { state: fstate, run: forgot, pending: fpending } = useSubmit(forgotPasswordAction);
  const formRef = useRef<HTMLFormElement>(null);
  const [mail, setMail] = useState(email);
  const [remember, setRemember] = useState(true);
  useEffect(() => { if (fstate?.ok) toast(fstate.ok); }, [fstate]);
  useEffect(() => { const v = state?.values?.email ?? fstate?.values?.email; if (v !== undefined) setMail(v); }, [state, fstate]);

  const errs = { ...(fstate?.errors ?? {}), ...(state?.errors ?? {}) };
  // ‹Вход за администратори› (→ /admin → /vhod?next=/admin): the team's sign-in has no role cards,
  // no sign-up and no client lead line, so the click visibly lands on a different screen.
  const team = next === '/admin' || !!next?.startsWith('/admin/') || !!next?.startsWith('/admin?');
  const lead = next?.startsWith('/zayavka') && role === 'client'
    ? 'Ще изпратите запитването веднага след като влезете.'
    : 'Влезте, за да проследите заявките и резервациите си.';
  const toRegister = `/registratsiya${carry(role, next)}`;

  return (
    <div className="auth">
      <div className="auth-form">
        <div className="auth-box">
          <h1 className="auth-t">Добре дошли отново</h1>
          {!team && <p className="auth-d">{lead}</p>}

          {!team && (<>
          <div className="auth-tabs">
            <span className="auth-tab is-on" aria-current="page">Вход</span>
            <Link className="auth-tab" href={toRegister}>Регистрация</Link>
          </div>

          <div className="auth-role" role="radiogroup" aria-label="Профил">
            <button type="button" role="radio" aria-checked={role === 'client'} className={`role${role === 'client' ? ' is-on' : ''}`} onClick={() => setRole('client')}>
              <span className="role-t">Клиент</span>
              <span className="role-d">Организирам събитие</span>
            </button>
            <button type="button" role="radio" aria-checked={role === 'partner'} className={`role${role === 'partner' ? ' is-on' : ''}`} onClick={() => setRole('partner')}>
              <span className="role-t">Изпълнител</span>
              <span className="role-d">Предлагам услуги за събития</span>
            </button>
          </div>
          </>)}

          <form ref={formRef} className={team ? 'acc-team' : undefined} onSubmit={onSubmit} noValidate>
            <input type="hidden" name="next" value={next ?? ''} />
            <div className={`field${errs.email ? ' field--error' : ''}`} style={{ marginBottom: 14 }}>
              <label className="field-label" htmlFor="vhod-email">Имейл</label>
              <input id="vhod-email" className="field-input" name="email" type="email" autoComplete="email" autoFocus={team} value={mail} onChange={e => setMail(e.target.value)} />
              {errs.email && <span className="acc-err">{errs.email}</span>}
            </div>
            <div className={`field${errs.password ? ' field--error' : ''}`}>
              <label className="field-label" htmlFor="vhod-password">Парола</label>
              <input id="vhod-password" className="field-input" name="password" type="password" autoComplete="current-password" />
              {errs.password && <span className="acc-err">{errs.password}</span>}
            </div>

            <div className="acc-remember" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 22px' }}>
              <label className="f-item" style={{ padding: 0 }}>
                <input type="checkbox" name="remember" checked={remember} onChange={e => setRemember(e.target.checked)} />
                <span className={`f-box${remember ? ' is-on' : ''}`}></span>Запомни ме
              </label>
              <button type="button" className="acc-linkbtn" disabled={fpending} onClick={() => forgot(formRef.current)}>Забравена парола?</button>
            </div>

            {state?.error && <p className="acc-err acc-err--box" role="alert">{state.error}</p>}
            <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={pending}>Влез</button>
          </form>

          {social.length > 0 && !team && (
            <>
              <div className="reg-or">
                <span className="reg-or-line"></span>
                <span className="reg-or-t">или</span>
                <span className="reg-or-line"></span>
              </div>
              <div className="reg-social">
                {social.map(p => (
                  <form key={p} action={socialSignInAction}>
                    <input type="hidden" name="provider" value={p} />
                    <input type="hidden" name="as" value={role} />
                    <input type="hidden" name="next" value={next ?? ''} />
                    <button className="btn btn--outline btn--block" type="submit">{SOCIAL_LABEL[p]}</button>
                  </form>
                ))}
              </div>
            </>
          )}

          {!team && (<>
            <div className="auth-alt">Нямате профил? <Link href={toRegister}>Регистрирайте се безплатно</Link></div>
            <div className="auth-alt" style={{ marginTop: 8 }}>Екип на EventAT? <Link href="/admin">Вход за администратори</Link></div>
          </>)}
        </div>
      </div>
      <AuthSides role={role} />
    </div>
  );
}
