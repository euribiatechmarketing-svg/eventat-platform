'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { WizardForm, useStepState } from '../_ui/WizardForm';
import { Clock } from '../_ui/icons';
import { submitAction } from './actions';

function Consents() {
  const { state } = useStepState();
  const err = (k: string) => (state.fields?.[k] ? ' m-check-error' : '');
  return (
    <section className="wiz-fieldset">
      <div className="wiz-fieldset-head">
        <div>
          <h3 className="wiz-fieldset-title">Условия и потвърждение</h3>
          <p className="wiz-fieldset-sub">Преди да подадете профила за одобрение.</p>
        </div>
      </div>
      <label className={`check${err('acceptTerms')}`}><input type="checkbox" name="acceptTerms" /><span className="check-box" /><span>Приемам <Link className="ob-link" href="/pravila#terms" target="_blank">Условията за партньори</Link> и <Link className="ob-link" href="/pravila#privacy" target="_blank">Политиката за поверителност</Link>.</span></label>
      <label className={`check${err('confirmInfo')}`}><input type="checkbox" name="confirmInfo" /><span className="check-box" /><span>Потвърждавам, че информацията е вярна и нося отговорност за нея.</span></label>
    </section>
  );
}

export function ReviewForm({ children, slaHours, email }: { children: ReactNode; slaHours: number; email: string }) {
  return (
    <WizardForm action={submitAction}>
      {children}
      <Consents />
      <div className="alert">
        <Clock className="alert-icon" />
        <div><p className="alert-title">Очаквайте отговор до {slaHours} часа</p><p className="alert-text">Преглеждаме всеки нов профил ръчно, за да поддържаме качеството в платформата. Ще ви пишем на {email} веднага щом приключим.</p></div>
      </div>
    </WizardForm>
  );
}
