'use client';
// client/settings.html. Profile fields, the two-step and marketing switches and the notification
// switches are one form: ‹Запази промените› saves them, ‹Откажи› puts back what is stored.
// Photo, password, sessions, deletion and invoice data are their own actions.
import { useActionState, useEffect, useState } from 'react';
import { toast } from '@/components/ui/client';
import type { settingsView } from '@/lib/domain/views-auth-account';
import { useSubmit } from '../../../(auth)/_ui/useSubmit';
import {
  changePasswordAction, changePhotoAction, requestDeletionAction, saveInvoiceAction, saveSettingsAction, signOutEverywhereAction,
} from './actions';

type View = Awaited<ReturnType<typeof settingsView>>;

const NOTIF: [key: string, name: string, desc: string][] = [
  ['client.request-response', 'Отговор по заявка', 'Изпълнителят одобри или отказа'],
  ['client.payment-deadline', 'Срок за плащане', 'Напомняне 6 и 2 часа преди изтичане'],
  ['client.booking-confirmed', 'Потвърдена резервация', 'Разписка и детайли за събитието'],
  ['client.messages', 'Съобщение от изпълнител', 'Ново съобщение в разговора'],
  ['client.event-reminder', 'Напомняне преди събитието', '7 дни и 1 ден преди датата'],
  ['client.review-invite', 'Покана за ревю', 'На следващия ден след събитието'],
];
const LOCKED = 'Този имейл е служебен\u00a0— идва винаги, за да имате потвърждение и разписка';
const FORM = 'acc-settings';

function Toggle({ on, locked, label, onChange }: { on: boolean; locked?: boolean; label: string; onChange?: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={`toggle${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
      title={locked ? 'Служебен имейл\u00a0— не се изключва' : undefined}
      onClick={() => (locked ? toast(LOCKED) : onChange?.(!on))} />
  );
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

export function SettingsForm({ view }: { view: View }) {
  const start = {
    name: view.user.name, phone: view.user.phone, email: view.user.email, cityId: view.cityId ?? '',
    twoFactor: view.user.twoFactor, marketing: view.marketing,
    prefs: Object.fromEntries(view.preferences.map(p => [p.key, { email: p.email, sms: p.sms }])) as Record<string, { email: boolean; sms: boolean | null }>,
  };
  const [f, setF] = useState(start);
  const { state, onSubmit: save, pending: saving } = useSubmit(saveSettingsAction);
  const [photo, sendPhoto] = useActionState(changePhotoAction, null);
  useEffect(() => { if (state?.error) toast(state.error, 'error'); }, [state]);
  useEffect(() => { if (photo?.error) toast(photo.error, 'error'); }, [photo]);
  const errs = state?.errors ?? {};
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const pref = (key: string, ch: 'email' | 'sms', v: boolean) => setF(x => ({ ...x, prefs: { ...x.prefs, [key]: { ...x.prefs[key], [ch]: v } } }));
  const prefsJson = JSON.stringify(Object.entries(f.prefs).flatMap(([key, p]) => [
    { key, channel: 'email', enabled: p.email },
    ...(p.sms === null ? [] : [{ key, channel: 'sms', enabled: p.sms }]),
  ]));
  const cancel = () => { setF(start); toast('Промените са отменени'); };
  const input = (k: 'name' | 'phone' | 'email', label: string, type = 'text', auto?: string) => (
    <div className={`field${errs[k] ? ' field--error' : ''}`}>
      <label className="field-label" htmlFor={`set-${k}`}>{label}</label>
      <input id={`set-${k}`} form={FORM} name={k} className="field-input" type={type} autoComplete={auto} value={f[k]} onChange={e => set(k, e.target.value)} />
      {errs[k] && <span className="acc-err">{errs[k]}</span>}
    </div>
  );

  return (
    <>
      <form id={FORM} onSubmit={save} noValidate>
        <input type="hidden" name="twoFactor" value={f.twoFactor ? '1' : '0'} />
        <input type="hidden" name="marketing" value={f.marketing ? '1' : '0'} />
        <input type="hidden" name="prefs" value={prefsJson} />
      </form>

      <div className="h-row">
        <div>
          <h1 className="h-page">Настройки</h1>
          <p className="h-sub">Профил, сигурност и известия</p>
        </div>
        <div className="h-right">
          <button className="btn btn--outline btn--sm" type="button" onClick={cancel}>Откажи</button>
          <button className="btn btn--primary btn--sm" type="submit" form={FORM} disabled={saving}>Запази промените</button>
        </div>
      </div>

      <div className="set-grid">
        <div>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Профил</h2></div>
            <div className="acc-prof">
              <span className="avatar avatar--lg">{view.user.image ? <img src={view.user.image} alt="" /> : initials(view.user.name)}</span>
              <div>
                <div className="acc-prof-n">{view.user.name}</div>
                <div className="acc-prof-d">Клиентски профил · регистрация от {view.user.registeredOn}</div>
              </div>
              <form className="acc-prof-act" action={sendPhoto}>
                <input id="set-photo" className="acc-file" type="file" name="photo" accept="image/jpeg,image/png" onChange={e => e.currentTarget.form?.requestSubmit()} />
                <label htmlFor="set-photo" className="btn btn--outline btn--sm" role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (document.getElementById('set-photo') as HTMLInputElement | null)?.click(); } }}>Смени снимката</label>
              </form>
            </div>
            <div className="form-grid">
              {input('name', 'Име и фамилия', 'text', 'name')}
              {input('phone', 'Телефон', 'tel', 'tel')}
              {input('email', 'Имейл', 'email', 'email')}
              <div className="field">
                <label className="field-label" htmlFor="set-city">Град</label>
                <div className="select-wrap">
                  <select id="set-city" form={FORM} name="cityId" className="field-select" value={f.cityId} onChange={e => set('cityId', e.target.value)}>
                    {!f.cityId && <option value="">—</option>}
                    {view.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <svg className="select-chevron" viewBox="0 0 20 20"><path d="M5.5 8l4.5 4.5L14.5 8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              </div>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Сигурност</h2></div>
            <div className="set-row">
              <div className="set-t">
                <div className="set-n">Парола</div>
                <div className="set-d">Последна промяна на {view.passwordChangedOn}</div>
              </div>
              <form action={changePasswordAction}><button className="btn btn--outline btn--sm" type="submit">Смени паролата</button></form>
            </div>
            <div className="set-row">
              <div className="set-t">
                <div className="set-n">Потвърждение в две стъпки</div>
                <div className="set-d">Код по SMS при вход от ново устройство</div>
              </div>
              <Toggle on={f.twoFactor} label="Потвърждение в две стъпки" onChange={v => set('twoFactor', v)} />
            </div>
            <div className="set-row">
              <div className="set-t">
                <div className="set-n">Активни сесии</div>
                <div className="set-d set-sessions">
                  {view.sessions.map((s, i) => (
                    <span key={s.id}>{i > 0 && <span className="acc-sep">{'  ·  '}</span>}{[s.device, s.city, s.age].filter(Boolean).join(' · ')}</span>
                  ))}
                </div>
              </div>
              <form action={signOutEverywhereAction}><button className="btn btn--outline btn--sm" type="submit">Излез навсякъде</button></form>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Език и предпочитания</h2></div>
            <div className="set-row">
              <div className="set-t">
                <div className="set-n">Език на интерфейса</div>
                <div className="set-d">Ползва се и за имейлите от платформата</div>
              </div>
              <span className="set-v">Български</span>
            </div>
            <div className="set-row">
              <div className="set-t">
                <div className="set-n">Валута</div>
                <div className="set-d">Цените се показват в избраната валута</div>
              </div>
              <span className="set-v">EUR (€)</span>
            </div>
            <div className="set-row">
              <div className="set-t">
                <div className="set-n">Маркетингови съобщения</div>
                <div className="set-d">Идеи и оферти за предстоящи събития, максимум веднъж месечно</div>
              </div>
              <Toggle on={f.marketing} label="Маркетингови съобщения" onChange={v => set('marketing', v)} />
            </div>
          </section>

          <section className="dcard danger-zone">
            <div className="dcard-head"><h2 className="dcard-title">Изтриване на профила</h2></div>
            <div className="set-row" style={{ paddingTop: 0 }}>
              <div className="set-t">
                <div className="set-n">Изтрий профила си</div>
                <div className="set-d">Активните резервации остават валидни до събитието. Данните за плащане се пазят според закона.</div>
              </div>
              <form action={requestDeletionAction}><button className="btn btn--danger btn--sm" type="submit">Изтрий профила</button></form>
            </div>
          </section>
        </div>

        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Известия</h2></div>
            <div className="notif notif-head">
              <span></span>
              <span className="notif-ch">Имейл</span>
              <span className="notif-ch">SMS</span>
            </div>
            {NOTIF.map(([key, name, desc]) => {
              const p = f.prefs[key];
              const locked = view.preferences.find(x => x.key === key)?.emailLocked;
              if (!p) return null;
              return (
                <div className="notif" key={key}>
                  <div>
                    <div className="notif-n">{name}</div>
                    <div className="notif-d">{desc}</div>
                  </div>
                  <Toggle on={p.email} locked={locked} label={`${name} · Имейл`} onChange={v => pref(key, 'email', v)} />
                  {p.sms === null ? <span /> : <Toggle on={p.sms} label={`${name} · SMS`} onChange={v => pref(key, 'sms', v)} />}
                </div>
              );
            })}
            <p className="notif-foot">Имейлите за регистрация, отговор по заявка, плащане, анулиране и сигнали до екипа идват винаги&nbsp;— те са служебни и съдържат потвърждения и разписки.</p>
          </section>

          <InvoiceCard invoice={view.invoice} />
        </aside>
      </div>
    </>
  );
}

function InvoiceCard({ invoice }: { invoice: View['invoice'] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(invoice.recipientType);
  const { state, onSubmit: save, pending: saving } = useSubmit(saveInvoiceAction);
  useEffect(() => { if (state?.error) toast(state.error, 'error'); }, [state]);
  const errs = state?.errors ?? {};
  const v = state?.values ?? {};
  const summary = invoice.recipientType === 'company'
    ? ['Фирма', invoice.companyName, invoice.eik ? `ЕИК ${invoice.eik}` : null].filter(Boolean).join(' · ')
    : `Частно лице · ${invoice.name}`;
  const fld = (name: string, label: string, value: string | null) => (
    <div className={`field${errs[name] ? ' field--error' : ''}`}>
      <label className="field-label" htmlFor={`inv-${name}`}>{label}</label>
      <input id={`inv-${name}`} className="field-input" name={name} defaultValue={v[name] ?? value ?? ''} />
      {errs[name] && <span className="acc-err">{errs[name]}</span>}
    </div>
  );
  return (
    <section className="dcard">
      <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Данни за фактура</h2></div>
      <div className="set-row" style={{ paddingTop: 0 }}>
        <div className="set-t">
          <div className="set-n">Издавай фактура на</div>
          <div className="set-d">{summary}</div>
        </div>
        {!open && <button className="btn btn--outline btn--sm" type="button" onClick={() => { setOpen(true); toast('Можете да редактирате данните'); }}>Промени</button>}
      </div>
      {open && (
        <form className="acc-inv" onSubmit={save} noValidate>
          <input type="hidden" name="recipientType" value={type} />
          <div className="opt-row" role="radiogroup" aria-label="Издавай фактура на">
            <button type="button" role="radio" aria-checked={type === 'individual'} className={`opt${type === 'individual' ? ' is-on' : ''}`} onClick={() => setType('individual')}>Частно лице</button>
            <button type="button" role="radio" aria-checked={type === 'company'} className={`opt${type === 'company' ? ' is-on' : ''}`} onClick={() => setType('company')}>Фирма</button>
          </div>
          {fld('name', 'Име и фамилия', invoice.name)}
          {type === 'company' && (
            <>
              {fld('companyName', 'Име на фирмата', invoice.companyName)}
              {fld('eik', 'ЕИК / Булстат', invoice.eik)}
              {fld('mol', 'МОЛ', invoice.mol)}
            </>
          )}
          {fld('address', 'Адрес', invoice.address)}
          <div className="acc-inv-act">
            <button className="btn btn--outline btn--sm" type="button" onClick={() => { setOpen(false); setType(invoice.recipientType); toast('Промените са отменени'); }}>Откажи</button>
            <button className="btn btn--primary btn--sm" type="submit" disabled={saving}>Запази промените</button>
          </div>
        </form>
      )}
      <div className="book-note" style={{ marginTop: 4 }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg><span>За фирмена фактура добавете ЕИК и МОЛ&nbsp;— фактурите се издават автоматично след всяко плащане.</span></div>
    </section>
  );
}
