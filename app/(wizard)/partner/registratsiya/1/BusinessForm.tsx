'use client';
import { useState } from 'react';
import { EXPERIENCE, LEGAL_FORMS, RADIUS_CHOICES } from '@/lib/domain/onboarding-labels';
import { Field, WizardForm } from '../_ui/WizardForm';
import { SelectChevron, Shield } from '../_ui/icons';
import { businessAction } from './actions';

type Props = {
  values: Record<string, string>;
  categories: { id: string; name: string }[];
  cities: { id: string; name: string }[];
};

export function BusinessForm({ values: v, categories, cities }: Props) {
  const [legal, setLegal] = useState(v.legalForm);
  return (
    <WizardForm action={businessAction}>
      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Бизнес информация</h3>
            <p className="wiz-fieldset-sub">Това, което клиентите ще видят първо.</p>
          </div>
        </div>

        <div className="wiz-row--full">
          <Field name="businessName" label="Име на бизнеса" required message="Така ще се показва в каталога и в профила ви.">
            <input id="f-businessName" className="field-input" type="text" name="businessName" defaultValue={v.businessName} maxLength={120} autoComplete="organization" />
          </Field>
        </div>

        <div className="wiz-row">
          <Field name="legalForm" label="Тип на бизнеса" required>
            <div className="select-wrap">
              <select id="f-legalForm" className="field-select" name="legalForm" value={legal} onChange={e => setLegal(e.target.value)}>
                <option value="" disabled>Изберете</option>
                {LEGAL_FORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <SelectChevron />
            </div>
            {legal === 'other' && (
              <input className="field-input" type="text" name="legalFormOther" defaultValue={v.legalFormOther} maxLength={120} aria-label="Тип на бизнеса" />
            )}
          </Field>
          <Field name="eik" label="ЕИК / Булстат" required message="Не се показва публично.">
            <input id="f-eik" className="field-input" type="text" name="eik" defaultValue={v.eik} inputMode="numeric" maxLength={16} />
          </Field>
        </div>

        <div className="wiz-row--full">
          <Field name="primaryCategoryId" label="Основна категория" required message="Още категории можете да добавите по-късно, когато създавате услугите си.">
            <div className="select-wrap">
              <select id="f-primaryCategoryId" className="field-select" name="primaryCategoryId" defaultValue={v.primaryCategoryId}>
                <option value="" disabled>Изберете основна категория</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
        </div>

        <div className="wiz-row">
          <Field name="cityId" label="Основен град" required>
            <div className="select-wrap">
              <select id="f-cityId" className="field-select" name="cityId" defaultValue={v.cityId}>
                <option value="" disabled>Изберете</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
          <Field name="radius" label="Радиус на работа" required>
            <div className="select-wrap">
              <select id="f-radius" className="field-select" name="radius" defaultValue={v.radius}>
                <option value="" disabled>Изберете</option>
                {RADIUS_CHOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
        </div>

        <div className="wiz-row">
          <Field name="experienceBand" label="Опит" required>
            <div className="select-wrap">
              <select id="f-experienceBand" className="field-select" name="experienceBand" defaultValue={v.experienceBand}>
                <option value="" disabled>Изберете</option>
                {EXPERIENCE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <SelectChevron />
            </div>
          </Field>
          <Field name="languages" label="Езици на работа" required>
            <input id="f-languages" className="field-input" type="text" name="languages" defaultValue={v.languages} maxLength={200} />
          </Field>
        </div>
      </section>

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Контакти</h3>
            <p className="wiz-fieldset-sub">Използваме ги за проверката на профила и за известия по резервации.</p>
          </div>
        </div>

        <div className="wiz-row--3">
          <Field name="contactName" label="Лице за контакт" required>
            <input id="f-contactName" className="field-input" type="text" name="contactName" defaultValue={v.contactName} maxLength={120} autoComplete="name" />
          </Field>
          <Field name="notificationEmail" label="Имейл за известия" required message="Тук ще получавате новите заявки.">
            <input id="f-notificationEmail" className="field-input" type="email" name="notificationEmail" defaultValue={v.notificationEmail} maxLength={200} autoComplete="email" />
          </Field>
          <Field name="phone" label="Телефон" required>
            <input id="f-phone" className="field-input" type="tel" name="phone" defaultValue={v.phone} maxLength={30} autoComplete="tel" />
          </Field>
        </div>

        <div className="wiz-row">
          <Field name="websiteUrl" label="Уебсайт" hint="(незадължително)">
            <input id="f-websiteUrl" className="field-input" type="url" name="websiteUrl" defaultValue={v.websiteUrl} placeholder="https://" maxLength={300} />
          </Field>
          <Field name="socialHandle" label="Instagram / Facebook" required>
            <input id="f-socialHandle" className="field-input" type="text" name="socialHandle" defaultValue={v.socialHandle} maxLength={200} />
          </Field>
        </div>
      </section>

      <div className="alert">
        <Shield className="alert-icon" />
        <div><p className="alert-title">Контактите ви остават между нас</p><p className="alert-text">Одобряваме всеки изпълнител ръчно. Проверяваме контактите ви, но не ги показваме публично.</p></div>
      </div>
    </WizardForm>
  );
}
