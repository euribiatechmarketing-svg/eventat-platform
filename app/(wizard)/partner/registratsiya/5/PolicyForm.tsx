'use client';
import { useState, type ReactNode } from 'react';
import { RESCHEDULE } from '@/lib/domain/onboarding-labels';
import { Field, WizardForm, useStepState } from '../_ui/WizardForm';
import { CircleCheck, SelectChevron } from '../_ui/icons';
import { policyAction } from './actions';

type Policy = 'flexible' | 'moderate' | 'strict';
type Props = {
  values: { cancellationPolicy: Policy | ''; depositPercent: number; reschedulePolicy: string };
  days: { flexibleFree: number; moderateFree: number; moderateDeposit: number; strictRemainder: number };
};

const CHECK = <span className="option-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>;
const Cell = ({ tone, pill, when, what }: { tone: 'refund' | 'partial' | 'none'; pill: string; when: string; what: string }) => (
  <div className={`policy-tl-cell policy-tl-cell--${tone}`}><span className="policy-tl-pill">{pill}</span><strong>{when}</strong><span>{what}</span></div>
);

function Cards({ initial, days: d }: { initial: Policy | ''; days: Props['days'] }) {
  const { state } = useStepState();
  const [policy, setPolicy] = useState<Policy | ''>(initial);
  const cards: { key: Policy; title: ReactNode; sub: string; body: ReactNode; icon: ReactNode; cells: ReactNode }[] = [
    {
      key: 'flexible', title: 'Гъвкава', sub: 'Подходяща за по-малки събития',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 8l-4 4-2-2" /></svg>,
      body: <>Безплатно анулиране до <strong>{d.flexibleFree} дни</strong> преди събитието. След това депозитът остава за вас, а в деня на събитието — цялата сума.</>,
      cells: <>
        <Cell tone="refund" pill="Цялата сума" when={`Над ${d.flexibleFree} дни преди`} what="Пълно възстановяване" />
        <Cell tone="partial" pill="Без депозита" when={`По-малко от ${d.flexibleFree} дни`} what="Депозитът се задържа" />
        <Cell tone="none" pill="Нищо" when="В деня на събитието" what="Сумата не се връща" />
      </>,
    },
    {
      key: 'moderate', title: <>Умерена <span className="badge badge--primary">Препоръчана</span></>, sub: 'Балансирана защита и за двете страни',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
      body: <>Безплатно анулиране до <strong>{d.moderateFree} дни</strong> преди събитието. След това се задържа депозитът, а в последните <strong>{d.moderateDeposit} дни</strong> — цялата сума.</>,
      cells: <>
        <Cell tone="refund" pill="Цялата сума" when={`Над ${d.moderateFree} дни преди`} what="Пълно възстановяване" />
        <Cell tone="partial" pill="Без депозита" when={`От ${d.moderateFree} до ${d.moderateDeposit} дни преди`} what="Депозитът се задържа" />
        <Cell tone="none" pill="Нищо" when={`По-малко от ${d.moderateDeposit} дни`} what="Сумата не се връща" />
      </>,
    },
    {
      key: 'strict', title: 'Строга', sub: 'Подходяща за сватби и големи фирмени събития',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
      body: <>Депозитът не се връща след потвърждение. Останалата сума се възстановява при анулиране до <strong>{d.strictRemainder} дни</strong> преди събитието.</>,
      cells: <>
        <Cell tone="partial" pill="Без депозита" when="След потвърждение" what="Депозитът не се връща" />
        <Cell tone="partial" pill="Без депозита" when={`Над ${d.strictRemainder} дни преди`} what="Връща се остатъкът" />
        <Cell tone="none" pill="Нищо" when={`По-малко от ${d.strictRemainder} дни`} what="Сумата не се връща" />
      </>,
    },
  ];
  return (
    <section className="wiz-fieldset">
      <div className="wiz-fieldset-head">
        <div>
          <h3 className="wiz-fieldset-title">Политика за анулиране</h3>
          <p className="wiz-fieldset-sub">Една политика за всички ваши пакети и услуги.</p>
        </div>
      </div>
      <div className="ob-policy-list">
        {cards.map(c => (
          <label key={c.key} className={`option-card${policy === c.key ? ' is-selected' : ''}`}>
            <input type="radio" name="cancellationPolicy" value={c.key} checked={policy === c.key} onChange={() => setPolicy(c.key)} />
            <div className="option-card-head">
              <div className="option-card-icon">{c.icon}</div>
              <div><p className="option-card-title">{c.title}</p><p className="option-card-sub">{c.sub}</p></div>
              {CHECK}
            </div>
            <p className="option-card-body">{c.body}</p>
            <div className="policy-timeline">{c.cells}</div>
          </label>
        ))}
      </div>
      {state.fields?.cancellationPolicy && <p className="m-section-error" role="alert">{state.fields.cancellationPolicy}</p>}
    </section>
  );
}

export function PolicyForm({ values: v, days }: Props) {
  return (
    <WizardForm action={policyAction}>
      <Cards initial={v.cancellationPolicy} days={days} />

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Размер на депозита</h3>
            <p className="wiz-fieldset-sub">Каква част от общата цена се смята за депозит при анулиране.</p>
          </div>
        </div>
        <div className="wiz-row">
          <Field name="depositPercent" label="Депозит" required message="Обичайният депозит в бранша е 20–30%.">
            <div className="select-wrap">
              <select id="f-depositPercent" className="field-select" name="depositPercent" defaultValue={String(v.depositPercent)}>
                {[20, 30, 40, 50].map(n => <option key={n} value={n}>{n}%</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
          <Field name="reschedulePolicy" label="Промяна на датата">
            <div className="select-wrap">
              <select id="f-reschedulePolicy" className="field-select" name="reschedulePolicy" defaultValue={v.reschedulePolicy}>
                {RESCHEDULE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
        </div>
      </section>

      <div className="alert alert--success">
        <CircleCheck className="alert-icon" />
        <div><p className="alert-title">Възстановяванията са автоматични</p><p className="alert-text">Не е нужно сами да връщате пари на клиента — платформата задържа сумата и я връща според избраната политика.</p></div>
      </div>
    </WizardForm>
  );
}
