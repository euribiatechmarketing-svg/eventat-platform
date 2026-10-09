'use client';
// client/register.html: tabs, role cards (client / partner fields, photo, ?as=), the password meter,
// the consent line, ‹Създай профил›, the social buttons (clients, when configured) and ‹Влезте›.
import { useRef, useState } from 'react';
import { radioKeys, radioTab } from '@/components/ui/dropdown';
import { errorProps, useFocusInvalid } from '@/components/ui/forms';
import Link from 'next/link';
import { AuthSides, type AuthRole } from '../_ui/AuthSides';
import { PasswordField } from '../_ui/PasswordField';
import { carry } from '../_ui/messages';
import { useSubmit } from '../_ui/useSubmit';
import { socialSignInAction } from '../vhod/actions';
import { registerAction } from './actions';

const SOCIAL_LABEL = { google: 'Продължи с Google', facebook: 'Продължи с Facebook' } as const;
type Values = { name: string; businessName: string; contactName: string; email: string; phone: string };
const EMPTY: Values = { name: '', businessName: '', contactName: '', email: '', phone: '' };

export function RegisterForm({ as, next, social }: { as: AuthRole; next: string | null; social: ('google' | 'facebook')[] }) {
  const [role, setRole] = useState<AuthRole>(as);
  const { state, onSubmit, pending } = useSubmit(registerAction);
  const [v, setV] = useState<Values>(EMPTY);
  const [consent, setConsent] = useState(false);
  const errs = state?.errors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalid(formRef, state);
  const field = (k: keyof Values, label: string, opts: { type?: string; auto?: string; wide?: boolean } = {}) => (
    <div className={`field${opts.wide ? ' reg-wide' : ''}${errs[k] ? ' field--error' : ''}`}>
      <label className="field-label" htmlFor={`reg-${k}`}>{label}</label>
      <input id={`reg-${k}`} className="field-input" name={k} type={opts.type ?? 'text'} autoComplete={opts.auto} value={v[k]} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} {...errorProps(`reg-${k}`, errs[k])} />
      {errs[k] && <span className="acc-err" id={`reg-${k}-err`}>{errs[k]}</span>}
    </div>
  );
  const lead = next?.startsWith('/zayavka') && role === 'client'
    ? 'Ще изпратите запитването веднага след регистрацията.'
    : 'Безплатно е\u00a0— и за клиенти, и за изпълнители.';

  return (
    <div className="auth">
      <div className="auth-form">
        <div className="auth-box reg-box">
          <h1 className="auth-t">Създайте профил</h1>
          <p className="auth-d">{lead}</p>

          <div className="auth-tabs">
            <Link className="auth-tab" href={`/vhod${carry(role, next)}`}>Вход</Link>
            <span className="auth-tab is-on" aria-current="page">Регистрация</span>
          </div>

          <div className="auth-role" role="radiogroup" aria-label="Профил" onKeyDown={radioKeys}>
            <button type="button" role="radio" aria-checked={role === 'client'} tabIndex={radioTab(role === 'client', 0, true)} data-role="client" className={`role${role === 'client' ? ' is-on' : ''}`} onClick={() => setRole('client')}>
              <span className="role-t">Клиент</span>
              <span className="role-d">Организирам събитие</span>
            </button>
            <button type="button" role="radio" aria-checked={role === 'partner'} tabIndex={radioTab(role === 'partner', 1, true)} data-role="partner" className={`role${role === 'partner' ? ' is-on' : ''}`} onClick={() => setRole('partner')}>
              <span className="role-t">Изпълнител</span>
              <span className="role-d">Предлагам услуги за събития</span>
            </button>
          </div>

          <form ref={formRef} method="post" onSubmit={onSubmit} noValidate>
            <input type="hidden" name="role" value={role} />
            <input type="hidden" name="next" value={next ?? ''} />
            {role === 'client' ? (
              <div className="reg-fields" data-fields="client">
                {field('name', 'Име и фамилия', { wide: true, auto: 'name' })}
                {field('email', 'Имейл', { type: 'email', auto: 'email' })}
                {field('phone', 'Телефон', { type: 'tel', auto: 'tel' })}
                <PasswordField id="reg-password" error={errs.password} />
              </div>
            ) : (
              <div className="reg-fields" data-fields="partner">
                {field('businessName', 'Име на бизнеса', { auto: 'organization' })}
                {field('contactName', 'Лице за контакт', { auto: 'name' })}
                {field('email', 'Имейл', { type: 'email', auto: 'email' })}
                {field('phone', 'Телефон', { type: 'tel', auto: 'tel' })}
                <PasswordField id="reg-password" error={errs.password} />
              </div>
            )}

            <div className={`reg-consent${errs.consent ? ' field--error' : ''}`}>
              <label className="f-item">
                <input type="checkbox" name="consent" checked={consent} onChange={e => setConsent(e.target.checked)} {...errorProps('reg-consent', errs.consent)} />
                <span className={`f-box${consent ? ' is-on' : ''}`}></span>
                <span>Приемам <Link href="/pravila#terms">Общите условия</Link> и <Link href="/pravila#privacy">Политиката за поверителност</Link></span>
              </label>
              {errs.consent && <p className="acc-err" id="reg-consent-err">{errs.consent}</p>}
            </div>

            {state?.error && <p className="acc-err acc-err--box" role="alert">{state.error}</p>}
            <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={pending}>Създай профил</button>
          </form>

          {social.length > 0 && role === 'client' && (
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
                    <input type="hidden" name="as" value="client" />
                    <input type="hidden" name="next" value={next ?? ''} />
                    <button className="btn btn--outline btn--block" type="submit">{SOCIAL_LABEL[p]}</button>
                  </form>
                ))}
              </div>
            </>
          )}

          <div className="auth-alt">Вече имате профил? <Link href={`/vhod${carry(role, next)}`}>Влезте</Link></div>
        </div>
      </div>
      <AuthSides role={role} />
    </div>
  );
}
