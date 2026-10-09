'use client';
// The editable part of /admin/nastroyki: one form (‹Запази промените› / ‹Откажи›) across the cards.
// Controls sit in their cards and join the form through the `form` attribute, so the category dialog
// and the demo clock keep their own forms.
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from '@/components/ui/client';
import type { FormAction } from '../_ops/ui';

export const SETTINGS_FORM = 'settings-form';

type Tier = { minDaysBefore: number; retained: 'none' | 'deposit' | 'total' };
type Policies = Record<'flexible' | 'moderate' | 'strict', { tiers: Tier[] }>;
export type SettingsState = {
  standard: string; intro: string; business: string; paymentHours: number; responseHours: number;
  policies: Policies; moderation: boolean; en: boolean; bankTransfer: boolean; categories: Record<string, boolean>;
};

const POLICY_NAME = { flexible: 'Гъвкава', moderate: 'Умерена', strict: 'Строга' } as const;
const RETAINED = { none: 'Пълно възстановяване', deposit: 'Депозитът се задържа', total: 'Сумата не се връща' } as const;

function summary(p: Policies): string {
  const one = (k: keyof Policies) => {
    const d = p[k].tiers.find(t => t.retained === 'none')?.minDaysBefore;
    return `${POLICY_NAME[k]} (${d != null ? `до ${d} дни` : 'депозитът не се връща'})`;
  };
  return [one('flexible'), one('moderate'), one('strict')].join(' · ');
}

/**
 * Holds the form element and remounts the controls on ‹Откажи› (reset), so every toggle and field
 * returns to the saved values.
 */
export function SettingsRoot({ action, children }: { action: FormAction; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [pending, start] = useTransition();
  return (
    <>
      <form id={SETTINGS_FORM} hidden aria-busy={pending}
        onReset={() => { setVersion(v => v + 1); toast('Промените са отменени'); }}
        action={fd => start(async () => { const r = await action(fd); if (r && r.error) toast(r.error, 'error'); })} />
      <div key={version} className={pending ? 'is-pending' : undefined}>{children}</div>
    </>
  );
}

/** Page-head buttons: ‹Откажи› resets every control, ‹Запази промените› submits. */
export function SettingsButtons() {
  return (
    <>
      <button type="reset" form={SETTINGS_FORM} className="btn btn--outline btn--sm">Откажи</button>
      <button type="submit" form={SETTINGS_FORM} className="btn btn--primary btn--sm">Запази промените</button>
    </>
  );
}

export function Toggle({ name, initial, label, locked = false }: { name?: string; initial: boolean; label: string; locked?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <>
      <button type="button" className={`toggle${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`} role="switch" aria-checked={on} aria-label={label}
        disabled={locked} onClick={() => setOn(!on)} />
      {name && !locked && <input type="hidden" form={SETTINGS_FORM} name={name} value={on ? '1' : '0'} />}
    </>
  );
}

export function RateInput({ name, initial, label }: { name: string; initial: string; label: string }) {
  return (
    <span className="rate-f">
      <input className="rate-in" form={SETTINGS_FORM} name={name} defaultValue={initial} inputMode="decimal" aria-label={label} required pattern="\d{1,3}([.,]\d{1,2})?" />
      <span className="rate-u">%</span>
    </span>
  );
}

/** ‹Политики›: the deadlines and the cancellation table, read-only until ‹Редактирай›. */
export function PoliciesCard({ s, hiddenRows }: { s: Pick<SettingsState, 'paymentHours' | 'responseHours' | 'policies'>; hiddenRows: Set<string> }) {
  const [edit, setEdit] = useState(false);
  const [pol, setPol] = useState(s.policies);
  const row = (key: string) => (hiddenRows.has(key) ? ' ops-hidden-row' : '');
  const hoursField = (name: string, value: number, label: string) => edit
    ? <span className="rate-f"><input className="rate-in" form={SETTINGS_FORM} name={name} type="number" min={1} max={1440} defaultValue={value} aria-label={label} required /><span className="ops-rate-u">часа</span></span>
    : <span className="set-v">{value} часа</span>;
  return (
    <>
      <div className={`set-row${row('payment')}`}>
        <div className="set-t">
          <div className="set-n">Срок за плащане след одобрение</div>
          <div className="set-d">След изтичане датата се освобождава автоматично</div>
        </div>
        {hoursField('payment.window_hours', s.paymentHours, 'Срок за плащане след одобрение')}
      </div>
      <div className={`set-row${row('response')}`}>
        <div className="set-t">
          <div className="set-n">Срок за отговор от изпълнител</div>
        </div>
        {hoursField('request.response_hours', s.responseHours, 'Срок за отговор от изпълнител')}
      </div>
      <div className={`set-row${row('policies')}`} style={{ flexWrap: 'wrap' }}>
        <div className="set-t">
          <div className="set-n">Политики за анулиране</div>
          <div className="set-d">{summary(pol)}</div>
        </div>
        {!edit && <button type="button" className="btn btn--outline btn--sm" onClick={() => { setEdit(true); toast('Можете да редактирате данните'); }}>Редактирай</button>}
        {edit && (
          <div className="ops-pol" style={{ width: '100%' }}>
            {(Object.keys(POLICY_NAME) as (keyof Policies)[]).map(k => (
              <div key={k}>
                <div className="ops-pol-h">{POLICY_NAME[k]}</div>
                {pol[k].tiers.map((t, i) => (
                  <div className="rate" key={i}>
                    <span className="rate-n">{RETAINED[t.retained]}</span>
                    {t.minDaysBefore > 0 ? (
                      <span className="rate-f">
                        <input className="rate-in" form={SETTINGS_FORM} name={`policy.${k}.${i}`} type="number" min={1} max={365} required defaultValue={t.minDaysBefore}
                          aria-label={`${POLICY_NAME[k]} · ${RETAINED[t.retained]}`}
                          onChange={e => {
                            const v = Number(e.currentTarget.value);
                            if (!Number.isFinite(v) || v < 1) return;
                            setPol({ ...pol, [k]: { tiers: pol[k].tiers.map((x, j) => (j === i ? { ...x, minDaysBefore: v } : x)) } });
                          }} />
                        <span className="ops-rate-u">дни преди</span>
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
