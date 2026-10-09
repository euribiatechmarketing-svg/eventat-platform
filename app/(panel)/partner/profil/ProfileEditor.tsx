'use client';
// vendor/profile.html: the public profile form (saved at once), the gallery and the listing toggles.
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/client';
import { Num, Segs } from '../_catalogue/num';
import { FilePick, Stars, Switch } from '../_catalogue/ui';
import { focusSoon, onRadioKeys } from '@/components/ui/a11y';
import { usePopup } from '@/components/ui/popup';
import {
  addGalleryPhotoAction, removeGalleryPhotoAction, reorderGalleryAction, setListingAction, updateProfileAction, type ProfileState,
} from './actions';

type Photo = { id: string; mediaId: string; url: string };
type Tag = { label: string; isCustom: boolean };
export type ProfileData = {
  slug: string; businessName: string; categoryName: string; updatedAgo: string;
  nameWindow: { lastChangedOn: string | null; nextFrom: string | null };
  description: string; socialHandle: string; cityId: string | null; cities: { id: string; name: string }[];
  radius: 50 | 100 | 150 | 'nationwide';
  eventTypes: { id: string; label: string }[]; eventTypeIds: string[]; tags: Tag[]; tagSuggestions: string[];
  gallery: Photo[]; galleryMin: number; galleryMax: number;
  policy: 'flexible' | 'moderate' | 'strict' | null; policyFreeDays: { flexible: number | null; moderate: number | null; strict: number | null };
  isListed: boolean; acceptingRequests: boolean; deactivated: boolean;
  rating: { text: string; rounded: number; countLabel: string } | null;
  fromPrice: { amount: string; unitLabel: string } | null;
};

const X = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const CHEV = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 10l5 5 5-5" /></svg>;
const RADIUS: { value: ProfileData['radius']; label: string }[] = [
  { value: 50, label: 'до 50 км' }, { value: 100, label: 'до 100 км' }, { value: 150, label: 'до 150 км' }, { value: 'nationwide', label: 'В цялата страна' },
];

export function ProfileEditor({ d }: { d: ProfileData }) {
  const router = useRouter();
  const [state, formAction, saving] = useActionState(updateProfileAction, {} as ProfileState);
  const [description, setDescription] = useState(d.description);
  const [social, setSocial] = useState(d.socialHandle);
  const [cityId, setCityId] = useState(d.cityId ?? d.cities[0]?.id ?? '');
  const [radius, setRadius] = useState<ProfileData['radius']>(d.radius);
  const [eventTypeIds, setEventTypeIds] = useState(d.eventTypeIds);
  const [tags, setTags] = useState<Tag[]>(d.tags);
  const [policy, setPolicy] = useState(d.policy ?? 'moderate');
  const [listed, setListed] = useState(d.isListed);
  const [accepting, setAccepting] = useState(d.acceptingRequests);
  const [busy, start] = useTransition();
  const f = state.fields ?? {};
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.ok && state.message) { toast(state.message); router.refresh(); }
    else if (state.error) toast(state.error, 'error');
    else if (state.fields && Object.keys(state.fields).length) {
      toast('Проверете попълнените полета.', 'error');
      focusSoon(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]'));
    }
  }, [state, router]);
  /** After a chip's × removes it, focus moves to the next chip's ×, else to ‹+ Добави›. */
  const chipGone = (i: number) => focusSoon(() => {
    const xs = [...(chipsRef.current?.querySelectorAll<HTMLElement>('.pc-chip-x') ?? [])];
    return xs[Math.min(i, xs.length - 1)] ?? chipsRef.current?.querySelector<HTMLElement>('.chip-add');
  });

  const payload = JSON.stringify({ description, socialHandle: social, cityId, radius, eventTypeIds, tags, cancellationPolicy: policy });
  const cityName = d.cities.find(c => c.id === cityId)?.name ?? '';
  const cover = d.gallery[0]?.url ?? null;

  const listing = (patch: { isListed?: boolean; acceptingRequests?: boolean }) => {
    start(async () => {
      const r = await setListingAction(patch);
      if (!r.ok) { toast(r.error, 'error'); return; }
      if (patch.isListed !== undefined) setListed(patch.isListed);
      if (patch.acceptingRequests !== undefined) setAccepting(patch.acceptingRequests);
      toast(r.message);
    });
  };

  const fd = (n: number | null) => n ?? 0;
  const POLICIES = [
    { key: 'flexible' as const, name: 'Гъвкава', desc: `Безплатно анулиране до ${fd(d.policyFreeDays.flexible)} дни преди събитието.` },
    { key: 'moderate' as const, name: 'Умерена', desc: `Безплатно до ${fd(d.policyFreeDays.moderate)} дни; след това депозитът остава за вас.` },
    { key: 'strict' as const, name: 'Строга', desc: 'Депозитът не се възстановява след потвърждение.' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Публичен профил</h1>
          <p className="page-sub"><Segs parts={['Това виждат клиентите, преди да изпратят заявка', `последна промяна ${d.updatedAgo}`]} /></p>
        </div>
        <div className="page-head-right">
          <a className="btn btn--outline btn--sm" href={`/partnyori/${d.slug}`}>Виж като клиент</a>
          <button type="submit" form="profile-form" className="btn btn--primary btn--sm" disabled={saving}>Запази промените</button>
        </div>
      </div>

      <form id="profile-form" ref={formRef} action={formAction} noValidate>
        <input type="hidden" name="payload" value={payload} />
        <div className="dash-grid">
          <div>
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title">Основна информация</h2></div>
              <div className="field-row">
                <div className="fld"><span className="fld-l">Име на бизнеса</span><span className="fld-i is-ro">{d.businessName}</span></div>
                <div className="fld"><span className="fld-l">Категория</span><span className="fld-i is-ro">{d.categoryName}</span></div>
              </div>
              <div className="fld-hint">
                Името се сменя веднъж месечно.
                {d.nameWindow.lastChangedOn && d.nameWindow.nextFrom ? ` Последна промяна на ${d.nameWindow.lastChangedOn} — следваща от ${d.nameWindow.nextFrom}.` : ''}
              </div>
              <label className="fld" style={{ marginTop: 16 }}><span className="fld-l">Описание</span>
                <textarea className="fld-i fld-i--area" name="description" value={description} maxLength={600} onChange={e => setDescription(e.target.value)} aria-invalid={!!f.description}
                  aria-describedby={[f.description && `${uid}-desc-e`, `${uid}-desc-n`].filter(Boolean).join(' ')} />
              </label>
              <div className="fld-hint" id={`${uid}-desc-n`}>{description.length} / 600 знака</div>
              {f.description && <span className="form-error" id={`${uid}-desc-e`}>{f.description}</span>}
              <div className="field-row" style={{ marginTop: 16 }}>
                <label className="fld"><span className="fld-l" id={`${uid}-soc-l`}>Instagram / Facebook<span className="required-mark">*</span></span>
                  <input className="fld-i" name="socialHandle" value={social} maxLength={200} onChange={e => setSocial(e.target.value)} aria-invalid={!!f.socialHandle} required
                    aria-labelledby={`${uid}-soc-l`} aria-describedby={f.socialHandle ? `${uid}-soc-e` : undefined} />
                  {f.socialHandle && <span className="form-error" id={`${uid}-soc-e`}>{f.socialHandle}</span>}
                </label>
              </div>
            </section>

            <Gallery photos={d.gallery} min={d.galleryMin} max={d.galleryMax} />

            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title">Локация и обхват</h2></div>
              <div className="field-row">
                <label className="fld"><span className="fld-l">Основен град</span>
                  <span className="pa-sel">
                    <select className="fld-i" name="cityId" value={cityId} onChange={e => setCityId(e.target.value)}>
                      {d.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <span className="pa-sel-ic">{CHEV}</span>
                  </span>
                </label>
                <label className="fld"><span className="fld-l">Работя и в радиус</span>
                  <span className="pa-sel">
                    <select className="fld-i" name="radius" value={String(radius)} onChange={e => setRadius(e.target.value === 'nationwide' ? 'nationwide' : (Number(e.target.value) as 50 | 100 | 150))}>
                      {RADIUS.map(r => <option key={String(r.value)} value={String(r.value)}>{r.label}</option>)}
                    </select>
                    <span className="pa-sel-ic">{CHEV}</span>
                  </span>
                </label>
              </div>
              <div style={{ marginTop: 18 }} role="group" aria-labelledby={`${uid}-skills`} aria-describedby={f.eventTypeIds ? `${uid}-skills-e` : undefined}>
                <span className="fld-l" id={`${uid}-skills`}>Умения и специализации</span>
                <div className="chips" ref={chipsRef}>
                  {eventTypeIds.map((id, i) => {
                    const t = d.eventTypes.find(x => x.id === id);
                    return t ? (
                      <span key={id} className="chip-tag">{t.label}
                        <button type="button" className="pc-chip-x" aria-label={`Премахни ${t.label}`} onClick={() => { setEventTypeIds(ids => ids.filter(x => x !== id)); chipGone(i); }}>{X}</button>
                      </span>
                    ) : null;
                  })}
                  {tags.map((t, i) => (
                    <span key={t.label} className="chip-tag">{t.label}
                      <button type="button" className="pc-chip-x" aria-label={`Премахни ${t.label}`} onClick={() => { setTags(list => list.filter(x => x.label !== t.label)); chipGone(eventTypeIds.length + i); }}>{X}</button>
                    </span>
                  ))}
                  <AddChip
                    types={d.eventTypes.filter(t => !eventTypeIds.includes(t.id))}
                    suggestions={d.tagSuggestions.filter(s => !tags.some(t => t.label === s))}
                    onType={id => setEventTypeIds(ids => [...ids, id])}
                    onTag={(label, isCustom) => setTags(list => (list.some(t => t.label.toLocaleLowerCase('bg') === label.toLocaleLowerCase('bg')) ? list : [...list, { label, isCustom }]))} />
                </div>
                {f.eventTypeIds && <span className="form-error" id={`${uid}-skills-e`}>{f.eventTypeIds}</span>}
              </div>
            </section>
          </div>

          <aside className="pc-sticky">
            <div className="panel">
              <h3 className="panel-title">Как изглежда в търсенето</h3>
              <div className="svc-card" style={{ borderRadius: 12 }}>
                <div className="svc-cover" style={{ height: 120, ...(cover ? { backgroundImage: `url('${cover}')` } : {}) }} />
                <div className="svc-body" style={{ padding: '14px 16px 16px' }}>
                  <div className="svc-title" style={{ fontSize: 17, margin: '0 0 4px' }}><Num>{d.businessName}</Num></div>
                  <div className="svc-text">{[d.categoryName, cityName].filter(Boolean).join(' · ')}</div>
                  {d.rating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                      <Stars n={d.rating.rounded} style={{ color: 'var(--gold-500)', marginLeft: 0 }} />
                      <span style={{ fontSize: 12.5, color: 'var(--neutral-600)' }}>{d.rating.text} · {d.rating.countLabel}</span>
                    </div>
                  )}
                  {d.fromPrice && (
                    <div style={{ marginTop: 10, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--primary-800)', fontVariantNumeric: 'lining-nums' }}>
                      от <span className="num">{d.fromPrice.amount}</span> € <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 500, color: 'var(--neutral-600)' }}>{d.fromPrice.unitLabel}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <h3 className="panel-title">Политика за анулиране</h3>
              <p className="panel-text">Клиентът вижда политиката още преди да изпрати заявка.</p>
              <div className="pol" role="radiogroup" aria-label="Политика за анулиране" onKeyDown={onRadioKeys}>
                {POLICIES.map(p => (
                  <button key={p.key} type="button" role="radio" aria-checked={policy === p.key} tabIndex={policy === p.key ? 0 : -1} className={`pol-opt${policy === p.key ? ' is-on' : ''}`} onClick={() => setPolicy(p.key)}>
                    <span className="pol-dot" />
                    <div><div className="pol-name">{p.name}</div><div className="pol-desc">{p.desc}</div></div>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <h3 className="panel-title">Видимост</h3>
              <div className="set-row" style={{ paddingTop: 0 }}>
                <div className="set-t"><div className="set-n">Профилът е активен</div><div className="set-d" id={`${uid}-listed`}>Виден в каталога и търсенето.</div></div>
                {/* a deactivated profile is hidden whatever this says: it comes back with ‹Активирай› in Настройки (P9) */}
                <Switch on={listed && !d.deactivated} onChange={v => listing({ isListed: v })} label="Профилът е активен" disabled={busy || d.deactivated} describedBy={`${uid}-listed`} />
              </div>
              <div className="set-row">
                <div className="set-t"><div className="set-n">Приемам нови заявки</div><div className="set-d" id={`${uid}-acc`}>Изключете временно, ако сте заети.</div></div>
                <Switch on={accepting} onChange={v => listing({ acceptingRequests: v })} label="Приемам нови заявки" disabled={busy} describedBy={`${uid}-acc`} />
              </div>
            </div>
          </aside>
        </div>
      </form>
    </>
  );
}

/** ‹+ Добави›: an event type, a suggested skill, or ‹Друго› typed in. */
function AddChip({ types, suggestions, onType, onTag }: {
  types: { id: string; label: string }[]; suggestions: string[]; onType: (id: string) => void; onTag: (label: string, isCustom: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  // The list mixes choices with a text field, so it is a disclosure (components/ui/popup.ts), not a menu:
  // Tab moves through it, Escape or a choice closes it and gives focus back to ‹+ Добави›.
  usePopup({ open, setOpen, wrap: ref, trigger: btn });
  const done = () => { setOpen(false); focusSoon(() => btn.current); };
  const addOther = () => {
    const t = other.trim().slice(0, 60);
    if (!t) return;
    onTag(t, true);
    setOther('');
    done();
  };
  return (
    <span ref={ref} className="ui-menu-wrap">
      <button ref={btn} type="button" className="chip-tag chip-add pc-click" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)}>+ Добави</button>
      {open && (
        <div id={id} className="ui-menu ui-menu--down pc-add-menu" role="group" aria-label="Умения и специализации">
          {types.map(t => <button key={t.id} type="button" className="ui-menu-item" onClick={() => { onType(t.id); done(); }}>{t.label}</button>)}
          {types.length > 0 && suggestions.length > 0 && <hr />}
          {suggestions.map(s => <button key={s} type="button" className="ui-menu-item" onClick={() => { onTag(s, false); done(); }}>{s}</button>)}
          <hr />
          <div className="pc-add-other">
            <input className="fld-i" placeholder="Друго" aria-label="Друго" value={other} maxLength={60} onChange={e => setOther(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } }} />
            <button type="button" className="btn btn--outline btn--sm" onClick={addOther}>Добави</button>
          </div>
        </div>
      )}
    </span>
  );
}

/** Галерия: ‹+› uploads, × removes, drag or the arrows order; the first is ‹Главна›. */
function Gallery({ photos, min, max }: { photos: Photo[]; min: number; max: number }) {
  const router = useRouter();
  const [list, setList] = useState(photos);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [busy, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  // The buttons are disabled while a change is saved, which drops keyboard focus: once it is saved,
  // focus goes back to where the partner was (the moved photo's arrow, the next photo, ‹Добави снимка›).
  const after = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => { setList(photos); }, [photos]);
  useEffect(() => {
    if (busy || !after.current) return;
    const get = after.current;
    after.current = null;
    if (document.activeElement === document.body || document.activeElement === null) focusSoon(get);
  }, [busy, list]);

  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, rollback?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast(r.error, 'error'); rollback?.(); return; }
    toast(r.message);
    router.refresh();
  });
  const photoButton = (id: string, label: string) => () => {
    const item = box.current?.querySelector<HTMLElement>(`[data-photo="${id}"]`);
    const want = item?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    return want && !want.disabled ? want : item?.querySelector<HTMLElement>('button:not([disabled])');
  };
  const move = (from: number, to: number, label?: string) => {
    if (to < 0 || to >= list.length || from === to) return;
    const before = list;
    const next = [...list];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setList(next);
    if (label) after.current = photoButton(it.id, label);
    run(() => reorderGalleryAction(next.map(p => p.id)), () => setList(before));
  };
  const remove = (i: number, id: string) => {
    const nextId = list[i + 1]?.id ?? list[i - 1]?.id;
    after.current = () => (nextId ? photoButton(nextId, 'Премахни')() : null) ?? box.current?.querySelector<HTMLElement>('.gal-add');
    run(() => removeGalleryPhotoAction(id));
  };
  const add = (file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    after.current = () => box.current?.querySelector<HTMLElement>('.gal-add') ?? box.current?.querySelector<HTMLElement>('[data-photo]:last-of-type button:not([disabled])');
    run(() => addGalleryPhotoAction(fd));
  };
  const n = list.length;
  return (
    <section className="dcard">
      <div className="dcard-head"><h2 className="dcard-title">Галерия</h2><span className="badge badge--primary">{n === 1 ? '1 снимка' : `${n} снимки`}</span></div>
      <div className="gal" ref={box}>
        {list.map((p, i) => (
          <span key={p.id} className={`gal-item${i === 0 ? ' is-cover' : ''}${over === i ? ' is-over' : ''}`} style={{ backgroundImage: `url('${p.url}')` }}
            data-photo={p.id} draggable={!busy} role="group" aria-label={`Снимка ${i + 1} от ${n}`}
            onDragStart={() => setDrag(i)} onDragEnd={() => { setDrag(null); setOver(null); }}
            onDragOver={e => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(o => (o === i ? null : o))}
            onDrop={e => { e.preventDefault(); setOver(null); if (drag !== null) move(drag, i); setDrag(null); }}>
            <span className="pc-gal-acts">
              <button type="button" aria-label="Премести наляво" disabled={i === 0 || busy} onClick={() => move(i, i - 1, 'Премести наляво')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <button type="button" aria-label="Премести надясно" disabled={i === n - 1 || busy} onClick={() => move(i, i + 1, 'Премести надясно')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <button type="button" aria-label="Премахни" disabled={n <= min || busy} onClick={() => remove(i, p.id)}>{X}</button>
            </span>
          </span>
        ))}
        {n < max && (
          <FilePick accept="image/jpeg,image/png" className="gal-add" onFile={add} disabled={busy} label="Добави снимка">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </FilePick>
        )}
      </div>
      <div className="fld-hint">Първата снимка е главна и се показва в каталога.</div>
    </section>
  );
}
