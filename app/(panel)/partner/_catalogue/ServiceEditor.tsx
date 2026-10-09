'use client';
// vendor/service-new.html + vendor/service-edit.html: one editor for a new service,
// an unpublished draft, a service in review, a published one (moderated edit) and an archived one (read-only).
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Menu, toast } from '@/components/ui/client';
import { Num } from './num';
import { FilePick, Switch } from './ui';
import { focusSoon, onRadioKeys } from '@/components/ui/a11y';
import type { EditorState } from './service-form';

export type EditorMode = 'new' | 'draft' | 'review' | 'edit' | 'archived';
type Kind = 'package_fixed' | 'on_request' | 'addon';

export type EditorInitial = {
  kind: Kind; name: string; categoryId: string; description: string; eventTypeIds: string[]; inclusions: string[];
  priceCents: number | null; priceUnit: 'per_event' | 'per_guest'; minGuests: number | null; durationLabel: string;
  extraHourEnabled: boolean; extraHourPriceCents: number | null; travelFeeEnabled: boolean; coverMediaId: string | null;
  showInProfile: boolean; acceptingRequests: boolean; coverUrl: string | null;
};

export type EditorLive = {
  status: string; statusLabel: string; name: string; kindLabel: string; category: string; price: string | null;
  coverUrl: string | null; bookings: number; inquiries: number; activeSince: string | null;
};

const KINDS: { kind: Kind; name: string; desc: string }[] = [
  { kind: 'package_fixed', name: 'Пакет с фиксирана цена', desc: 'Една цена за целия пакет.' },
  { kind: 'on_request', name: 'По запитване', desc: 'Индивидуална оферта за всяко събитие.' },
  { kind: 'addon', name: 'Допълнителна услуга', desc: 'Добавка към основен пакет.' },
];
const TONE: Record<string, string> = { active: 'badge--success', draft: 'badge--warning', pending_review: 'badge--info', returned: 'badge--danger', archived: '' };

/** 145000 → ‹1 450›; 145050 → ‹1 450,50› (what the partner sees in the price field). */
function centsToField(c: number | null): string {
  if (c == null) return '';
  const whole = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return c % 100 ? `${whole},${String(c % 100).padStart(2, '0')}` : whole;
}
/** The price as the card shows it while typing: ‹420 €›. */
function previewPrice(v: string, unit: string): string {
  const t = v.replace(/\s/g, '');
  if (!t) return '—';
  return `${v.trim()} €${unit === 'per_guest' ? ' на гост' : ''}`;
}

const X = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const ok = (className: string) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;
const PLUS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
const BACK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>;
const CHEV = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 10l5 5 5-5" /></svg>;

export function ServiceEditor({ mode, serviceId, options, initial, live, revision, canPublish, saveAction, archiveAction, visibilityAction, uploadAction }: {
  mode: EditorMode;
  serviceId?: string;
  options: { categories: { id: string; name: string }[]; eventTypes: { id: string; label: string }[]; gallery: { mediaId: string; url: string }[]; cityName: string | null };
  initial: EditorInitial;
  live?: EditorLive;
  revision?: { status: string; type: string; note: string | null } | null;
  canPublish: boolean;
  saveAction: (prev: EditorState, fd: FormData) => Promise<EditorState>;
  archiveAction?: (fd: FormData) => Promise<void>;
  visibilityAction?: (active: boolean) => Promise<{ ok: boolean; message: string }>;
  uploadAction: (fd: FormData) => Promise<{ ok: true; mediaId: string; url: string } | { ok: false; error: string }>;
}) {
  const p = mode === 'new' ? 'sn' : 'se';
  const ro = mode === 'archived';
  const [state, formAction, saving] = useActionState(saveAction, {} as EditorState);
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [name, setName] = useState(initial.name);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [description, setDescription] = useState(initial.description);
  const [eventTypeIds, setEventTypeIds] = useState<string[]>(initial.eventTypeIds);
  const [inclusions, setInclusions] = useState<string[]>(initial.inclusions);
  const [adding, setAdding] = useState<string | null>(null);
  const [price, setPrice] = useState(centsToField(initial.priceCents));
  const [priceUnit, setPriceUnit] = useState(initial.priceUnit);
  const [minGuests, setMinGuests] = useState(initial.minGuests ? String(initial.minGuests) : '');
  const [duration, setDuration] = useState(initial.durationLabel);
  const [extraHour, setExtraHour] = useState(initial.extraHourEnabled);
  const [extraPrice, setExtraPrice] = useState(centsToField(initial.extraHourPriceCents));
  const [travel, setTravel] = useState(initial.travelFeeEnabled);
  const [cover, setCover] = useState<{ id: string | null; url: string | null }>({ id: initial.coverMediaId, url: initial.coverUrl });
  const [picking, setPicking] = useState(false);
  const [showInProfile, setShowInProfile] = useState(initial.showInProfile);
  const [accepting, setAccepting] = useState(initial.acceptingRequests);
  const [visible, setVisible] = useState(live?.status === 'active');
  const [busy, start] = useTransition();
  const addRef = useRef<HTMLInputElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const f = state.fields ?? {};
  // Field names and errors for screen readers: the visible label names the field, its error describes it.
  const uid = useId();
  const lid = (n: string) => `${uid}-${n}-l`;
  const eid = (n: string) => `${uid}-${n}-e`;
  const field = (n: string, err?: string) => ({ 'aria-labelledby': lid(n), 'aria-describedby': err ? eid(n) : undefined, 'aria-invalid': !!err });

  useEffect(() => { if (adding !== null) addRef.current?.focus(); }, [adding]);
  useEffect(() => {
    const fx = state.fields ?? {};
    if (state.error || fx.form) toast(state.error ?? fx.form!, 'error');
    else if (Object.keys(fx).length) {
      toast('Проверете попълнените полета.', 'error');
      focusSoon(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]'));
    }
  }, [state]);

  const payload = JSON.stringify({
    kind, name, categoryId, description, eventTypeIds, inclusions, price, priceUnit, minGuests, durationLabel: duration,
    extraHourEnabled: extraHour, extraHourPrice: extraPrice, travelFeeEnabled: travel, coverMediaId: cover.id, showInProfile, acceptingRequests: accepting,
  });

  const commitAdd = (refocus = false) => {
    const t = (adding ?? '').trim();
    setAdding(null);
    // Enter or Escape in the new point's field: focus goes back to ‹Добави точка› (the field is gone).
    if (refocus) focusSoon(() => addBtn.current);
    if (!t) return;
    setInclusions(list => [...list, t.slice(0, 120)]);
    toast('Добавена е нова точка');
  };
  const listRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  /** After a × removes its row or chip, focus moves to the next one's ×, else to the add control. */
  const refocusAfterRemove = (box: () => HTMLElement | null, sel: string, i: number, fallback: () => HTMLElement | null | undefined) => focusSoon(() => {
    const b = box();
    const xs = b?.isConnected ? [...b.querySelectorAll<HTMLElement>(sel)] : [];
    return xs[Math.min(i, xs.length - 1)] ?? fallback();
  });
  const removeInclusion = (i: number) => {
    setInclusions(list => list.filter((_, k) => k !== i));
    toast('Точката е премахната');
    refocusAfterRemove(() => listRef.current, `.${p}-li-x`, i, () => addBtn.current);
  };

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    start(async () => {
      const r = await uploadAction(fd);
      if (!r.ok) { toast(r.error, 'error'); return; }
      setCover({ id: r.mediaId, url: r.url });
      setPicking(false);
      toast('Снимката е качена');
    });
  };

  const setVisibility = (on: boolean) => {
    if (!visibilityAction || on === visible) return;
    start(async () => {
      const r = await visibilityAction(on);
      if (!r.ok) { toast(r.message, 'error'); return; }
      setVisible(on);
      toast(r.message);
    });
  };

  const remaining = options.eventTypes.filter(t => !eventTypeIds.includes(t.id));
  const pricePreview = kind === 'on_request' ? '—' : previewPrice(price, priceUnit);
  const pending = saving || busy;
  const title = mode === 'new' ? 'Нова услуга' : 'Редактиране на услуга';
  const sub = mode === 'edit' || mode === 'archived'
    ? 'Екипът на EventAT преглежда промените, преди клиентите да ги видят.'
    : 'Екипът на EventAT преглежда новите услуги преди публикуване.';

  const buttons = (
    <>
      {mode !== 'new' && mode !== 'archived' && archiveAction && (
        <button type="submit" form="svc-archive" className="btn btn--outline btn--sm" disabled={pending}>Архивирай</button>
      )}
      {(mode === 'new' || mode === 'draft') && (
        <button type="submit" form="svc-form" name="intent" value="draft" className="btn btn--outline btn--sm" disabled={pending}>Запази като чернова</button>
      )}
      {(mode === 'new' || mode === 'draft' || mode === 'review') && (
        <button type="submit" form="svc-form" name="intent" value="submit" className="btn btn--primary btn--sm" disabled={pending || !canPublish}>Изпрати за преглед</button>
      )}
      {mode === 'edit' && (
        <button type="submit" form="svc-form" name="intent" value="change" className="btn btn--primary btn--sm" disabled={pending}>Запази промените</button>
      )}
    </>
  );

  return (
    <>
      <Link className="crumb" href="/partner/uslugi">{BACK}Назад към услугите</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{sub}</p>
        </div>
        <div className="page-head-right">{buttons}</div>
      </div>

      {live && (
        <div className="se-live">
          <span className="se-live-thumb" style={live.coverUrl ? { backgroundImage: `url('${live.coverUrl}')` } : undefined} />
          <div className="se-live-id">
            <div className="se-live-name"><Num>{live.name}</Num></div>
            <div className="se-live-kind">{live.kindLabel}{live.category ? ` · ${live.category}` : ''}</div>
          </div>
          <div className="se-live-stats">
            <div className="se-live-i"><div className="se-live-v">{live.price ?? '—'}</div><div className="se-live-l">{live.price ? 'Цена' : 'По оферта'}</div></div>
            <div className="se-live-i"><div className="se-live-v">{live.bookings}</div><div className="se-live-l">Резервации</div></div>
            <div className="se-live-i"><div className="se-live-v">{live.inquiries}</div><div className="se-live-l">Запитвания</div></div>
            {live.activeSince && <div className="se-live-i"><div className="se-live-v">{live.activeSince}</div><div className="se-live-l">Активна от</div></div>}
          </div>
          <span className={`badge ${TONE[live.status] ?? ''} badge--dot`}>{live.statusLabel}</span>
        </div>
      )}

      {revision?.status === 'returned' && revision.note && (
        <p className="note pc-banner"><strong>Бележка от екипа:</strong> {revision.note}</p>
      )}
      {f.form && <div className="form-alert">{f.form}</div>}

      <form id="svc-form" ref={formRef} action={formAction} noValidate>
        <input type="hidden" name="payload" value={payload} />
        <fieldset className="pc-fieldset" disabled={ro}>
          <div className="dash-grid">
            <div>
              <section className="dcard">
                <div className="dcard-head"><h2 className="dcard-title">Вид на услугата</h2></div>
                <div className={`${p}-kinds`} role="radiogroup" aria-label="Вид на услугата" onKeyDown={onRadioKeys}>
                  {KINDS.map(k => (
                    <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} tabIndex={kind === k.kind ? 0 : -1} className={`pol-opt${kind === k.kind ? ' is-on' : ''}`} onClick={() => setKind(k.kind)}>
                      <span className="pol-dot" />
                      <div><div className="pol-name">{k.name}</div><div className="pol-desc">{k.desc}</div></div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="dcard">
                <div className="dcard-head"><h2 className="dcard-title">Основни данни</h2></div>
                <div className="field-row">
                  <label className="fld"><span className="fld-l" id={lid('name')}>Име на услугата</span>
                    <input className="fld-i" name="name" value={name} maxLength={80} onChange={e => setName(e.target.value)} {...field('name', f.name)} />
                    {f.name && <span className="form-error" id={eid('name')}>{f.name}</span>}
                  </label>
                  <label className="fld"><span className="fld-l" id={lid('categoryId')}>Категория</span>
                    <span className="pa-sel">
                      <select className="fld-i" name="categoryId" value={categoryId} onChange={e => setCategoryId(e.target.value)} {...field('categoryId', f.categoryId)}>
                        {!categoryId && <option value="">Изберете</option>}
                        {options.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <span className="pa-sel-ic">{CHEV}</span>
                    </span>
                    {f.categoryId && <span className="form-error" id={eid('categoryId')}>{f.categoryId}</span>}
                  </label>
                </div>
                <label className="fld" style={{ marginTop: 16 }}><span className="fld-l" id={lid('description')}>Кратко описание</span>
                  <textarea className="fld-i fld-i--area" name="description" value={description} maxLength={600} onChange={e => setDescription(e.target.value)}
                    {...field('description', f.description)} aria-describedby={[f.description && eid('description'), `${uid}-desc-h`].filter(Boolean).join(' ')} />
                </label>
                <div className={`${p}-hintrow`}>
                  <span className="fld-hint" id={`${uid}-desc-h`}>Показва се под името на услугата в профила ви.</span>
                  <span className="fld-hint" style={{ marginLeft: 'auto' }}>{description.length} / 600 знака</span>
                </div>
                {f.description && <span className="form-error" id={eid('description')}>{f.description}</span>}
                <div style={{ marginTop: 18 }} role="group" aria-labelledby={lid('eventTypeIds')} aria-describedby={f.eventTypeIds ? eid('eventTypeIds') : undefined}>
                  <span className="fld-l" id={lid('eventTypeIds')}>Подходящи събития</span>
                  <div className="chips" ref={chipsRef}>
                    {eventTypeIds.map((id, i) => {
                      const t = options.eventTypes.find(x => x.id === id);
                      if (!t) return null;
                      return (
                        <span key={id} className="chip-tag">{t.label}
                          {!ro && <button type="button" className="pc-chip-x" aria-label={`Премахни ${t.label}`} onClick={() => {
                            setEventTypeIds(ids => ids.filter(x => x !== id));
                            refocusAfterRemove(() => chipsRef.current, '.pc-chip-x', i, () => chipsRef.current?.querySelector<HTMLElement>('.chip-add'));
                          }}>{X}</button>}
                        </span>
                      );
                    })}
                    {remaining.length > 0 && !ro && (
                      <Menu label="Добави събитие" items={remaining.map(t => ({ label: t.label, onSelect: () => {
                        setEventTypeIds(ids => [...ids, t.id]);
                        // The chosen item is gone with the menu: focus goes back to ‹+ Добави› (or the last chip's ×).
                        focusSoon(() => chipsRef.current?.querySelector<HTMLElement>('.chip-add') ?? [...(chipsRef.current?.querySelectorAll<HTMLElement>('.pc-chip-x') ?? [])].pop());
                      } }))}
                        trigger={<span className="chip-tag chip-add pc-click">+ Добави</span>} />
                    )}
                  </div>
                  {f.eventTypeIds && <span className="form-error" id={eid('eventTypeIds')}>{f.eventTypeIds}</span>}
                </div>
              </section>

              {(!ro || inclusions.length > 0) && <section className="dcard">
                <div className="dcard-head"><h2 className="dcard-title">Какво е включено</h2></div>
                {(inclusions.length > 0 || adding !== null) && (
                  <div className={`${p}-list`} ref={listRef}>
                    {inclusions.map((t, i) => (
                      <div key={`${i}-${t}`} className={`${p}-li`}>
                        {ok(`${p}-li-ok`)}
                        <span className={`${p}-li-t`}>{t}</span>
                        {!ro && <button type="button" className={`${p}-li-x`} aria-label={`Премахни ${t}`} onClick={() => removeInclusion(i)}>{X}</button>}
                      </div>
                    ))}
                    {adding !== null && (
                      <div className={`${p}-li`}>
                        {ok(`${p}-li-ok`)}
                        <input ref={addRef} className="pc-li-input" value={adding} maxLength={120} aria-label="Нова точка"
                          onChange={e => setAdding(e.target.value)} onBlur={() => commitAdd()}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(true); } if (e.key === 'Escape') { setAdding(null); focusSoon(() => addBtn.current); } }} />
                      </div>
                    )}
                  </div>
                )}
                {inclusions.length < 12 && adding === null && !ro && (
                  <button ref={addBtn} type="button" className={`${p}-add`} onClick={() => setAdding('')}>{PLUS}Добави точка</button>
                )}
                {f.inclusions && <span className="form-error" role="alert">{f.inclusions}</span>}
              </section>}

              <section className="dcard">
                <div className="dcard-head"><h2 className="dcard-title">Цена и продължителност</h2></div>
                <div className="field-row">
                  <label className="fld"><span className="fld-l" id={lid('price')}>Цена</span>
                    {kind === 'on_request' ? (
                      <span className="fld-i is-ro">По оферта</span>
                    ) : (
                      <span className="pc-price-row">
                        <span className={`${p}-price`}>
                          <input className={`fld-i ${p}-nums`} name="price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)}
                            {...field('price', f.price)} aria-describedby={[f.price && eid('price'), `${uid}-price-h`].filter(Boolean).join(' ')} />
                          <span className={`${p}-cur`}>€</span>
                        </span>
                        <span className="pa-sel pc-unit">
                          <select className="fld-i" aria-label="Единица" value={priceUnit} onChange={e => setPriceUnit(e.target.value as 'per_event' | 'per_guest')}>
                            <option value="per_event">за събитие</option>
                            <option value="per_guest">на гост</option>
                          </select>
                          <span className="pa-sel-ic">{CHEV}</span>
                        </span>
                      </span>
                    )}
                    {f.price && <span className="form-error" id={eid('price')}>{f.price}</span>}
                    <span className="fld-hint" id={`${uid}-price-h`}>Клиентите виждат тази цена в профила ви.</span>
                  </label>
                  <label className="fld"><span className="fld-l">Продължителност</span>
                    <input className={`fld-i ${p}-nums`} name="durationLabel" value={duration} maxLength={80} onChange={e => setDuration(e.target.value)} />
                  </label>
                </div>
                {kind !== 'on_request' && priceUnit === 'per_guest' && (
                  <div className="field-row" style={{ marginTop: 16 }}>
                    <label className="fld"><span className="fld-l" id={lid('minGuests')}>Минимум гости</span>
                      <input className={`fld-i ${p}-nums`} inputMode="numeric" value={minGuests} onChange={e => setMinGuests(e.target.value)} {...field('minGuests', f.minGuests)} />
                      {f.minGuests && <span className="form-error" id={eid('minGuests')}>{f.minGuests}</span>}
                    </label>
                  </div>
                )}
                <div className={`field-row ${p}-addons`}>
                  {kind !== 'on_request' && (
                    <div className="pc-extra">
                      <label className="check"><input type="checkbox" checked={extraHour} onChange={e => setExtraHour(e.target.checked)} /><span className="check-box" /><span>Допълнителен час:</span></label>
                      <span className="pc-extra-amt"><strong>+</strong><input className="pc-inline" inputMode="decimal" aria-label="Цена за допълнителен час" value={extraPrice}
                        aria-invalid={!!f.extraHour} aria-describedby={f.extraHour ? eid('extraHour') : undefined}
                        onChange={e => { setExtraPrice(e.target.value); if (e.target.value.trim()) setExtraHour(true); }} /><strong>€</strong></span>
                    </div>
                  )}
                  <label className="check"><input type="checkbox" checked={travel} onChange={e => setTravel(e.target.checked)} /><span className="check-box" />
                    <span>Пътуване извън {options.cityName ?? 'града'}: <strong>+ пътни разходи</strong></span></label>
                </div>
                {f.extraHour && <span className="form-error" id={eid('extraHour')}>{f.extraHour}</span>}
              </section>

              <section className="dcard">
                <div className="dcard-head"><h2 className="dcard-title">Корица</h2></div>
                <div className={`${p}-cover`}>
                  <span className="gal-item is-cover" style={cover.url ? { backgroundImage: `url('${cover.url}')` } : undefined} />
                  <div>
                    {!ro && <p className={`${p}-cover-t`}>Изберете снимка от галерията си или качете нова. Тя се показва в картата на услугата, затова е добре да е кадър от подобно събитие.</p>}
                    {!ro && (
                      <div className={`${p}-cover-acts`}>
                        <button type="button" className="btn btn--outline btn--sm" disabled={!options.gallery.length || pending} aria-expanded={picking}
                          onClick={() => { setPicking(v => !v); if (!picking) toast('Изберете снимка от галерията си'); }}>Избери от галерията</button>
                        <FilePick accept="image/jpeg,image/png" className="btn btn--ghost btn--sm" onFile={upload} disabled={pending}>Качи снимка</FilePick>
                      </div>
                    )}
                  </div>
                </div>
                {picking && (
                  <div className="pc-pick" role="group" aria-label="Галерия">
                    {options.gallery.map((g, i) => (
                      <button key={g.mediaId} type="button" aria-pressed={cover.id === g.mediaId} aria-label={`Снимка ${i + 1}`}
                        className={`gal-item pc-pick-item${cover.id === g.mediaId ? ' is-picked' : ''}`} style={{ backgroundImage: `url('${g.url}')` }}
                        onClick={() => { setCover({ id: g.mediaId, url: g.url }); setPicking(false); }} />
                    ))}
                  </div>
                )}
              </section>

              {!ro && <div className={`${p}-foot`}>{buttons}</div>}
            </div>

            <aside className="pc-sticky">
              <div className="panel">
                <h3 className="panel-title">Как изглежда в „Услуги и пакети“</h3>
                <article className="svc-card">
                  <div className="svc-cover" style={cover.url ? { backgroundImage: `url('${cover.url}')` } : undefined}>
                    {live && <span className={`badge ${TONE[live.status] ?? ''} badge--dot`}>{live.statusLabel}</span>}
                  </div>
                  <div className="svc-body">
                    <span className="svc-kind">{KINDS.find(k => k.kind === kind)!.name}</span>
                    <h4 className="svc-title"><Num>{name}</Num></h4>
                    <p className="svc-text">{description}</p>
                    <div className="svc-meta">
                      <div><div className="svc-meta-v">{pricePreview}</div><div className="svc-meta-l">{kind === 'on_request' ? 'По оферта' : 'Цена'}</div></div>
                      {duration.trim() && <div><div className="svc-meta-v">{duration}</div><div className="svc-meta-l">Продължителност</div></div>}
                    </div>
                  </div>
                </article>
                {!ro && <p className={`${p}-prev-note`}>{mode === 'new' ? 'Изгледът се обновява, докато попълвате полетата.' : 'Изгледът се обновява, докато редактирате полетата.'}</p>}
              </div>

              <div className="panel">
                <h3 className="panel-title">Видимост</h3>
                {mode === 'edit' ? (
                  <>
                    <div className="se-status" role="radiogroup" aria-label="Видимост" onKeyDown={onRadioKeys}>
                      <button type="button" role="radio" aria-checked={visible} tabIndex={visible ? 0 : -1} className={`pol-opt${visible ? ' is-on' : ''}`} onClick={() => setVisibility(true)} disabled={busy}>
                        <span className="pol-dot" />
                        <div><div className="pol-name">Активна</div><div className="pol-desc">Вижда се в профила ви и приема заявки.</div></div>
                      </button>
                      <button type="button" role="radio" aria-checked={!visible} tabIndex={!visible ? 0 : -1} className={`pol-opt${!visible ? ' is-on' : ''}`} onClick={() => setVisibility(false)} disabled={busy}>
                        <span className="pol-dot" />
                        <div><div className="pol-name">Чернова</div><div className="pol-desc">Само за вас, докато я подготвяте.</div></div>
                      </button>
                    </div>
                    <p className="panel-note">Докато трае прегледът, клиентите виждат услугата такава, каквато е сега.</p>
                  </>
                ) : (
                  <>
                    <div className="set-row" style={{ paddingTop: 0 }}>
                      <div className="set-t"><div className="set-n">Показвай в профила ми</div><div className="set-d">Услугата се появява там веднага щом екипът я одобри.</div></div>
                      <Switch on={showInProfile} onChange={setShowInProfile} label="Показвай в профила ми" disabled={ro} />
                    </div>
                    <div className="set-row">
                      <div className="set-t"><div className="set-n">Приемам заявки за нея</div><div className="set-d">Изключете, ако още подготвяте техниката.</div></div>
                      <Switch on={accepting} onChange={setAccepting} label="Приемам заявки за нея" disabled={ro} />
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        </fieldset>
      </form>
      {archiveAction && serviceId && (
        <form id="svc-archive" action={archiveAction} hidden>
          <input type="hidden" name="id" value={serviceId} />
        </form>
      )}
    </>
  );
}
