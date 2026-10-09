'use client';
import { useRef, useState, useTransition } from 'react';
import { toast } from '@/components/ui/client';
import { moneyShort } from '@/lib/format';
import type { OnboardingService } from '@/lib/domain/views-partner-onboarding';
import { WizardForm, useStepState } from '../_ui/WizardForm';
import type { StepState } from '../flow';
import { ChevronUp, ListCheck, Plus, SelectChevron, Trash } from '../_ui/icons';
import { Num } from '../_ui/Num';
import { removeServiceAction, servicesAction } from './actions';

type Kind = 'package_fixed' | 'on_request';
type Pkg = OnboardingService & { key: string; isNew: boolean };
type Props = {
  offersFixedPackages: boolean; offersOnRequest: boolean; services: OnboardingService[];
  categories: { id: string; name: string }[]; defaultCategoryId: string | null; cityName: string; maxPackages: number; fallbackThumb: string | null;
};

const KIND_LABEL: Record<Kind, string> = { package_fixed: 'Пакет с фиксирана цена', on_request: 'По запитване' };
const newKey = () => `n${Math.random().toString(36).slice(2, 10)}`;
/** 145000 → '1 450' (the editor's price field, euro without cents when whole). */
const priceInput = (cents: number | null) => (cents == null ? '' : moneyShort(cents).replace(/\s*€$/, ''));
const bg = (url: string | null) => (url ? { backgroundImage: `url('${url}')` } : undefined);

function Err({ name }: { name: string }) {
  const { state } = useStepState();
  const e = state.fields?.[name];
  return e ? <span className="field-message">{e}</span> : null;
}
const errCls = (fields: StepState['fields'], name: string) => (fields?.[name] ? ' field--error' : '');

function Editor({ p, first, categories, defaultCategoryId, cityName, collapsed, onCollapse, onRemove, onName }: {
  p: Pkg; first: boolean; categories: Props['categories']; defaultCategoryId: string | null; cityName: string;
  collapsed: boolean; onCollapse: () => void; onRemove: () => void; onName: (v: string) => void;
}) {
  const { state, touch } = useStepState();
  const f = state.fields;
  const k = `pkg.${p.key}`;
  const [points, setPoints] = useState(() => (p.inclusions.length ? p.inclusions : ['']).map(v => ({ k: newKey(), v })));
  const listRef = useRef<HTMLDivElement>(null);
  const isFixed = p.kind === 'package_fixed';
  const addPoint = () => {
    setPoints(ps => [...ps, { k: newKey(), v: '' }]);
    toast('Добавена е нова точка');
    setTimeout(() => (listRef.current?.querySelector('.checklist-item:last-of-type input') as HTMLInputElement | null)?.focus(), 0);
  };
  return (
    <div className={`card card--raised m-pkg${collapsed ? ' m-pkg-collapsed' : ''}`} data-key={p.key}>
      <input type="hidden" name="pkg" value={p.key} />
      <input type="hidden" name={`${k}.id`} value={p.id} />
      <input type="hidden" name={`${k}.kind`} value={p.kind} />
      <div className="wiz-fieldset-head">
        <div style={{ minWidth: 0 }}>
          <div className="m-pkg-title">
            <h4 className="wiz-fieldset-title"><Num>{p.name || KIND_LABEL[p.kind]}</Num></h4>
            {first && <span className="badge badge--primary">Препоръчан</span>}
          </div>
          {first && <p className="wiz-fieldset-sub">Този пакет ще се показва първи сред пакетите ви.</p>}
        </div>
        <div className="m-pkg-actions">
          <button type="button" className="btn btn--outline btn--icon btn--sm" aria-label="Премахни" onClick={onRemove}><Trash /></button>
          <button type="button" className="btn btn--outline btn--icon btn--sm" aria-label={collapsed ? 'Разгъни' : 'Свий'} aria-expanded={!collapsed} onClick={onCollapse}><ChevronUp /></button>
        </div>
      </div>

      <div className="m-pkg-body" hidden={collapsed} style={{ marginTop: 'var(--space-5)' }}>
        <div className="wiz-row">
          <div className={`field${errCls(f, `${k}.name`)}`}>
            <label className="field-label" htmlFor={`${k}.name`}>{isFixed ? 'Име на пакета' : 'Име на услугата'}<span className="required-mark">*</span></label>
            <input id={`${k}.name`} className="field-input" type="text" name={`${k}.name`} value={p.name} maxLength={80} onChange={e => onName(e.target.value)} />
            <Err name={`${k}.name`} />
          </div>
          <div className={`field${errCls(f, `${k}.categoryId`)}`}>
            <label className="field-label" htmlFor={`${k}.categoryId`}>Категория<span className="required-mark">*</span></label>
            <div className="select-wrap">
              <select id={`${k}.categoryId`} className="field-select" name={`${k}.categoryId`} defaultValue={p.categoryId || defaultCategoryId || ''}>
                <option value="" disabled>Изберете</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <SelectChevron />
            </div>
            <Err name={`${k}.categoryId`} />
          </div>
        </div>

        <div className="wiz-row--full">
          <div className={`field${errCls(f, `${k}.description`)}`}>
            <label className="field-label" htmlFor={`${k}.description`}>Кратко описание<span className="required-mark">*</span></label>
            <textarea id={`${k}.description`} className="field-textarea" name={`${k}.description`} defaultValue={p.description} maxLength={600} />
            <Err name={`${k}.description`} />
          </div>
        </div>

        <div className="wiz-row--full">
          <div className="field">
            <label className="field-label">Какво е включено</label>
            <div className="checklist-editor" ref={listRef}>
              {points.map((pt, i) => (
                <div key={pt.k} className="checklist-item">
                  <ListCheck />
                  <input className="field-input field-input--ghost" type="text" name={`${k}.inc`} defaultValue={pt.v} maxLength={120} aria-label={`Какво е включено ${i + 1}`}
                    onKeyDown={e => { if (e.key === 'Enter' && points.length < 12) { e.preventDefault(); addPoint(); } }} />
                </div>
              ))}
              {points.length < 12 && (
                <button type="button" className="checklist-add" onClick={addPoint}><Plus />Добави точка</button>
              )}
            </div>
          </div>
        </div>

        <div className="wiz-row">
          {isFixed && (
            <div className={`field${errCls(f, `${k}.price`)}`}>
              <label className="field-label" htmlFor={`${k}.price`}>Цена<span className="required-mark">*</span></label>
              <div className="input-with-suffix">
                <input id={`${k}.price`} className="field-input" type="text" inputMode="decimal" name={`${k}.price`} defaultValue={priceInput(p.priceCents)} maxLength={12} />
                <span className="input-suffix">€</span>
              </div>
              {f?.[`${k}.price`] ? <Err name={`${k}.price`} /> : <span className="field-message">Цена за целия пакет.</span>}
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor={`${k}.duration`}>Продължителност</label>
            <input id={`${k}.duration`} className="field-input" type="text" name={`${k}.duration`} defaultValue={p.durationLabel} maxLength={80} />
          </div>
        </div>

        {isFixed && (
          <div className="wiz-row m-pkg-checks">
            <label className={`check${errCls(f, `${k}.extraHourPrice`) ? ' m-check-error' : ''}`}>
              <input type="checkbox" name={`${k}.extraHour`} defaultChecked={p.extraHourEnabled} />
              <span className="check-box" />
              <span>Допълнителен час: <strong>+<input className="m-inline-amount" type="text" inputMode="decimal" name={`${k}.extraHourPrice`}
                defaultValue={priceInput(p.extraHourPriceCents)} maxLength={8} aria-label="Допълнителен час" onClick={e => e.preventDefault()}
                onFocus={touch} /> €</strong></span>
            </label>
            <label className="check">
              <input type="checkbox" name={`${k}.travel`} defaultChecked={p.travelFeeEnabled} />
              <span className="check-box" />
              <span>Пътуване извън {cityName || 'града'}: <strong>+ пътни разходи</strong></span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ p, onEdit, onRemove, busy }: { p: Pkg; onEdit: () => void; onRemove: () => void; busy: boolean }) {
  const meta = [p.kind === 'on_request' ? 'По запитване' : p.priceCents ? moneyShort(p.priceCents) : null, p.durationLabel || p.description || null].filter(Boolean);
  return (
    <div className={`service-row${busy ? ' m-busy' : ''}`} data-key={p.key}>
      <div className="service-row-thumb" style={bg(p.thumbUrl)} />
      <div className="service-row-info">
        <p className="service-row-title">{p.name}</p>
        <div className="service-row-meta">
          {meta.map((m, i) => <span key={i} style={{ display: 'contents' }}>{i > 0 && <span>·</span>}<span>{m}</span></span>)}
        </div>
      </div>
      <div className="service-row-actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit}>Редактирай</button>
        <button type="button" className="btn btn--outline btn--icon btn--sm" aria-label="Премахни" onClick={onRemove}><Trash /></button>
      </div>
    </div>
  );
}

export function ServicesForm(props: Props) {
  const { categories, defaultCategoryId, cityName, maxPackages, fallbackThumb } = props;
  const [fixed, setFixed] = useState(props.offersFixedPackages);
  const [onRequest, setOnRequest] = useState(props.offersOnRequest);
  const blank = (kind: Kind): Pkg => ({
    key: newKey(), isNew: true, id: '', kind, name: '', categoryId: defaultCategoryId ?? '', description: '', priceCents: null, durationLabel: '',
    extraHourEnabled: false, extraHourPriceCents: null, travelFeeEnabled: false, inclusions: [], thumbUrl: fallbackThumb, status: 'draft', complete: false,
  });
  const [pkgs, setPkgs] = useState<Pkg[]>(() => {
    const list: Pkg[] = props.services.map(s => ({ ...s, key: s.id, isNew: false }));
    if (!list.some(s => s.kind === 'package_fixed')) list.unshift(blank('package_fixed'));
    return list;
  });
  // Open editors (the rest are rows with ‹Редактирай›) and folded ones (‹Свий›).
  const [open, setOpen] = useState<Set<string>>(() => {
    const firstFixed = pkgs.find(p => p.kind === 'package_fixed');
    return new Set([...pkgs.filter(p => p.isNew || !p.complete).map(p => p.key), ...(firstFixed ? [firstFixed.key] : [])]);
  });
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const [, start] = useTransition();

  const toggle = (set: Set<string>, key: string, on?: boolean) => { const n = new Set(set); if (on ?? !n.has(key)) n.add(key); else n.delete(key); return n; };
  const onResult = (s: StepState, form: HTMLFormElement) => {
    if (s.created) {
      // Into the DOM at once as well: a submission waiting for this save reads the form next.
      for (const [key, id] of Object.entries(s.created)) {
        const el = form.querySelector<HTMLInputElement>(`input[name="pkg.${key}.id"]`);
        if (el) el.value = id;
      }
      setPkgs(ps => ps.map(p => (s.created![p.key] ? { ...p, id: s.created![p.key], isNew: false } : p)));
    }
    if (s.fields) {
      const keys = new Set(Object.keys(s.fields).map(f => f.split('.')[1]).filter(Boolean));
      setOpen(o => new Set([...o, ...keys]));
      setFolded(fo => new Set([...fo].filter(k => !keys.has(k))));
    }
  };
  const add = (kind: Kind) => {
    const p = blank(kind);
    setPkgs(ps => {
      if (kind === 'on_request') return [...ps, p];
      const lastFixed = ps.map(x => x.kind).lastIndexOf('package_fixed');
      return [...ps.slice(0, lastFixed + 1), p, ...ps.slice(lastFixed + 1)];
    });
    setOpen(o => toggle(o, p.key, true));
    toast(kind === 'package_fixed' ? 'Добавен е нов пакет' : 'Добавена е услуга по запитване');
    setTimeout(() => (document.getElementById(`pkg.${p.key}.name`) as HTMLInputElement | null)?.focus(), 0);
  };
  const removePkg = (p: Pkg) => {
    const drop = () => { setPkgs(ps => ps.filter(x => x.key !== p.key)); toast('Пакетът е премахнат'); };
    if (!p.id) { drop(); return; }
    setRemoving(p.key);
    start(async () => {
      const r = await removeServiceAction(p.id);
      setRemoving(null);
      if (r.ok) drop();
    });
  };

  const fixedPkgs = pkgs.filter(p => p.kind === 'package_fixed');
  const requestPkgs = pkgs.filter(p => p.kind === 'on_request');
  const render = (p: Pkg) => open.has(p.key)
    ? <Editor key={p.key} p={p} first={p === fixedPkgs[0]} categories={categories} defaultCategoryId={defaultCategoryId} cityName={cityName}
        collapsed={folded.has(p.key)} onCollapse={() => setFolded(f => toggle(f, p.key))} onRemove={() => removePkg(p)}
        onName={v => setPkgs(ps => ps.map(x => (x.key === p.key ? { ...x, name: v } : x)))} />
    : <Row key={p.key} p={p} busy={removing === p.key} onEdit={() => setOpen(o => toggle(o, p.key, true))} onRemove={() => removePkg(p)} />;

  return (
    <WizardForm action={servicesAction} onResult={onResult}>
      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Как определяте цената?</h3>
            <p className="wiz-fieldset-sub">Можете да комбинирате двата подхода — например пакети за сватби и оферта за фирмени събития.</p>
          </div>
        </div>
        <div className="wiz-row">
          <label className={`option-card${fixed ? ' is-selected' : ''}`}>
            <input type="checkbox" name="offersFixedPackages" checked={fixed} onChange={e => setFixed(e.target.checked)} />
            <div className="option-card-head">
              <div className="option-card-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
              </div>
              <div>
                <p className="option-card-title">Фиксирани пакети</p>
                <p className="option-card-sub">Ясна цена, ясно включено</p>
              </div>
              <span className="option-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
            </div>
            <p className="option-card-body">Подходящо, ако услугата ви е еднаква за всяко събитие&nbsp;— клиентите виждат цената, преди да ви пишат.</p>
          </label>
          <label className={`option-card${onRequest ? ' is-selected' : ''}`}>
            <input type="checkbox" name="offersOnRequest" checked={onRequest} onChange={e => setOnRequest(e.target.checked)} />
            <div className="option-card-head">
              <div className="option-card-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
              </div>
              <div>
                <p className="option-card-title">По запитване</p>
                <p className="option-card-sub">Цената зависи от събитието</p>
              </div>
              <span className="option-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
            </div>
            <p className="option-card-body">Подходящо за по-сложни услуги — клиентът описва събитието, а вие изпращате индивидуална оферта.</p>
          </label>
        </div>
      </section>

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Вашите пакети</h3>
            <p className="wiz-fieldset-sub">Подредете ги по популярност. Първият се откроява в каталога.</p>
          </div>
        </div>
        <div>{fixedPkgs.map(render)}</div>
        <button type="button" className="btn btn--outline m-add-btn" onClick={() => add('package_fixed')} disabled={fixedPkgs.length >= maxPackages}>
          <Plus className="btn-icon" />Добави пакет
        </button>
      </section>

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Услуги по запитване <span className="t-caption t-muted">(незадължително)</span></h3>
            <p className="wiz-fieldset-sub">Услуги без фиксирана цена — клиентите ви пишат и получават индивидуална оферта.</p>
          </div>
        </div>
        {requestPkgs.length > 0 && <div>{requestPkgs.map(render)}</div>}
        <button type="button" className="btn btn--outline m-add-btn" onClick={() => add('on_request')}>
          <Plus className="btn-icon" />Добави услуга по запитване
        </button>
      </section>
    </WizardForm>
  );
}
