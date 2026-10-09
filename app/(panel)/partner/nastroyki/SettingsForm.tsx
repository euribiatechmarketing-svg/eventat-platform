'use client';
// vendor/settings.html: account fields, name change, password link, notification switches,
// deactivate / delete, language, payout summary.
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/client';
import { Switch } from '../_catalogue/ui';
import { focusSoon } from '@/components/ui/a11y';
import {
  changeNameAction, deactivateAction, reactivateAction, requestDeletionAction, requestPasswordResetAction, saveSettingsAction, setLocaleAction,
} from './actions';

export type SettingsData = {
  status: string; businessName: string; contactName: string; notificationEmail: string; phone: string; eik: string; socialHandle: string;
  locale: string; nameWindow: { allowed: boolean; lastChangedOn: string | null; nextFrom: string | null };
  passwordAgo: string | null; prefs: Record<string, boolean>; canDelete: boolean;
  account: { holder: string; masked: string; bank: string } | null;
};
type Result = { ok: true; message: string } | { ok: false; error: string; fields?: Record<string, string> };

const PREFS = [
  { key: 'partner.new-request', name: 'Нова заявка', desc: 'Имейл и известие в платформата веднага щом клиент изпрати заявка.' },
  { key: 'partner.payment-reminder', name: 'Напомняне за 24-часовия срок', desc: 'Съобщение, ако клиентът не е платил 6 часа преди изтичане.' },
  { key: 'partner.new-review', name: 'Ново ревю', desc: 'Известие при получена оценка.' },
  { key: 'partner.news', name: 'Новини от EventAT', desc: 'Съвети за профила и промоции. Максимум веднъж месечно.' },
];

export function SettingsForm({ d }: { d: SettingsData }) {
  const router = useRouter();
  const [contactName, setContactName] = useState(d.contactName);
  const [email, setEmail] = useState(d.notificationEmail);
  const [phone, setPhone] = useState(d.phone);
  const [social, setSocial] = useState(d.socialHandle);
  const [prefs, setPrefs] = useState(d.prefs);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState(d.businessName);
  const [pending, start] = useTransition();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nameBtn = useRef<HTMLButtonElement>(null);
  // Field names and errors for screen readers: the visible label names the field, its error describes it.
  const field = (n: string) => ({ 'aria-labelledby': `${uid}-${n}-l`, 'aria-describedby': fields[n] ? `${uid}-${n}-e` : undefined, 'aria-invalid': !!fields[n] });
  // A refused save: focus goes to the first field with an error.
  useEffect(() => { if (Object.keys(fields).length) focusSoon(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')); }, [fields]);
  const closeNaming = () => { setNaming(false); focusSoon(() => nameBtn.current); };

  const run = (fn: () => Promise<Result>, after?: (r: Result) => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast(r.error, 'error'); setFields(r.fields ?? {}); return; }
    setFields({});
    toast(r.message);
    after?.(r);
    router.refresh();
  });
  const save = () => run(() => saveSettingsAction({ contactName, notificationEmail: email, phone, socialHandle: social, prefs }));
  const nameNote = d.nameWindow.lastChangedOn && d.nameWindow.nextFrom
    ? ` Последна промяна на ${d.nameWindow.lastChangedOn} — следваща от ${d.nameWindow.nextFrom}.` : '';
  const deactivated = d.status === 'deactivated';

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Настройки</h1>
          <p className="page-sub">Акаунт, известия и език</p>
        </div>
        <div className="page-head-right">
          <button type="submit" form="settings-form" className="btn btn--primary btn--sm" disabled={pending}>Запази промените</button>
        </div>
      </div>

      <div className="dash-grid">
        <div>
          <form id="settings-form" ref={formRef} action={save} noValidate>
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title">Данни за акаунта</h2></div>
              <div className="field-row">
                <label className="fld"><span className="fld-l" id={`${uid}-contactName-l`}>Лице за контакт</span>
                  <input className="fld-i" name="contactName" value={contactName} onChange={e => setContactName(e.target.value)} autoComplete="name" {...field('contactName')} />
                  {fields.contactName && <span className="form-error" id={`${uid}-contactName-e`}>{fields.contactName}</span>}
                </label>
                <label className="fld"><span className="fld-l" id={`${uid}-notificationEmail-l`}>Имейл</span>
                  <input className="fld-i" name="notificationEmail" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" {...field('notificationEmail')} />
                  {fields.notificationEmail && <span className="form-error" id={`${uid}-notificationEmail-e`}>{fields.notificationEmail}</span>}
                </label>
              </div>
              <div className="field-row" style={{ marginTop: 16 }}>
                <label className="fld"><span className="fld-l" id={`${uid}-phone-l`}>Телефон</span>
                  <input className="fld-i" name="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" {...field('phone')} />
                  {fields.phone && <span className="form-error" id={`${uid}-phone-e`}>{fields.phone}</span>}
                </label>
                <div className="fld"><span className="fld-l">ЕИК / Булстат</span><span className="fld-i is-ro">{d.eik}</span></div>
              </div>
              <div className="field-row" style={{ marginTop: 16 }}>
                <label className="fld"><span className="fld-l" id={`${uid}-socialHandle-l`}>Instagram / Facebook<span className="required-mark">*</span></span>
                  <input className="fld-i" name="socialHandle" value={social} onChange={e => setSocial(e.target.value)} required {...field('socialHandle')} />
                  {fields.socialHandle && <span className="form-error" id={`${uid}-socialHandle-e`}>{fields.socialHandle}</span>}
                </label>
              </div>
              <div className="set-row" style={{ marginTop: 8 }}>
                <div className="set-t"><div className="set-n">Име на бизнеса</div><div className="set-d">{d.businessName} · сменя се веднъж месечно.{nameNote}</div></div>
                {!naming && <button ref={nameBtn} type="button" className="btn btn--outline btn--sm" disabled={!d.nameWindow.allowed || pending} onClick={() => setNaming(true)}>Смени името</button>}
              </div>
              {naming && (
                <div className="pc-name-form">
                  <input className="fld-i" aria-label="Име на бизнеса" value={newName} maxLength={120} autoFocus onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); run(() => changeNameAction(newName), closeNaming); }
                      if (e.key === 'Escape') { setNewName(d.businessName); closeNaming(); }
                    }} />
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => { closeNaming(); setNewName(d.businessName); }} disabled={pending}>Откажи</button>
                  <button type="button" className="btn btn--primary btn--sm" disabled={pending || !newName.trim() || newName.trim() === d.businessName}
                    onClick={() => run(() => changeNameAction(newName), closeNaming)}>Смени името</button>
                </div>
              )}
              <div className="set-row">
                <div className="set-t"><div className="set-n">Парола</div>{d.passwordAgo && <div className="set-d">Последна промяна {d.passwordAgo}</div>}</div>
                <button type="button" className="btn btn--outline btn--sm" disabled={pending} onClick={() => run(requestPasswordResetAction)}>Смени паролата</button>
              </div>
            </section>

            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title">Известия</h2></div>
              {PREFS.map((p, i) => (
                <div key={p.key} className="set-row" style={i === 0 ? { paddingTop: 0 } : undefined}>
                  <div className="set-t"><div className="set-n">{p.name}</div><div className="set-d" id={`${uid}-${i}-d`}>{p.desc}</div></div>
                  <Switch on={!!prefs[p.key]} onChange={v => setPrefs(x => ({ ...x, [p.key]: v }))} label={p.name} describedBy={`${uid}-${i}-d`} />
                </div>
              ))}
              <p className="panel-note" style={{ marginTop: 14 }}>Имейлите за одобрение на профила и на услугите, потвърдени и анулирани резервации, изплащания и сигнали идват винаги — те са служебни.</p>
            </section>
          </form>

          <section className="dcard danger-zone">
            <div className="dcard-head"><h2 className="dcard-title">Опасна зона</h2></div>
            {deactivated ? (
              <div className="set-row" style={{ paddingTop: 0 }}>
                <div className="set-t"><div className="set-n">Профилът е деактивиран</div><div className="set-d">Профилът не се показва в каталога, но резервациите остават.</div></div>
                <button type="button" className="btn btn--outline btn--sm" disabled={pending} onClick={() => run(reactivateAction)}>Активирай</button>
              </div>
            ) : (
              <div className="set-row" style={{ paddingTop: 0 }}>
                <div className="set-t"><div className="set-n">Деактивирай профила</div><div className="set-d">Профилът изчезва от каталога, но резервациите остават.</div></div>
                <button type="button" className="btn btn--outline btn--sm" disabled={pending} onClick={() => run(deactivateAction)}>Деактивирай</button>
              </div>
            )}
            <div className="set-row">
              <div className="set-t"><div className="set-n">Изтрий акаунта</div><div className="set-d">Необратимо. Възможно само без предстоящи резервации.</div></div>
              <button type="button" className="btn btn--danger btn--sm" disabled={!d.canDelete || pending} onClick={() => run(requestDeletionAction)}>Изтрий</button>
            </div>
          </section>
        </div>

        <aside>
          <div className="panel">
            <h3 className="panel-title">Език и регион</h3>
            <div className="set-row" style={{ paddingTop: 0 }}>
              <div className="set-t"><div className="set-n">Език на панела</div><div className="set-d">Клиентите виждат профила и на двата езика.</div></div>
              <span className="lang" role="group" aria-label="Език на панела">
                <button type="button" aria-pressed={d.locale !== 'en'} disabled={pending} onClick={() => run(() => setLocaleAction('bg'))}>{d.locale !== 'en' ? <b>BG</b> : <span>BG</span>}</button>
                <button type="button" aria-pressed={d.locale === 'en'} onClick={() => toast('Английската версия идва скоро')}>{d.locale === 'en' ? <b>EN</b> : <span>EN</span>}</button>
              </span>
            </div>
            <div className="set-row">
              <div className="set-t"><div className="set-n">Валута</div><div className="set-d">Всички цени в платформата.</div></div>
              <span className="set-v">EUR (€)</span>
            </div>
            <div className="set-row">
              <div className="set-t"><div className="set-n">Часова зона</div></div>
              <span className="set-v">GMT+2 · София</span>
            </div>
          </div>
          <div className="panel">
            <h3 className="panel-title">Сметка за изплащане</h3>
            {d.account && (
              <div className="payout-acc">
                <span className="payout-logo">BG</span>
                <div>
                  <div className="payout-name">{d.account.holder}</div>
                  <div className="payout-sub">{d.account.masked} · {d.account.bank}</div>
                </div>
              </div>
            )}
            <div className="panel-actions" style={{ marginTop: d.account ? 16 : 0 }}>
              <Link className="btn btn--outline btn--block" href="/partner/prihodi">Виж приходите</Link>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
