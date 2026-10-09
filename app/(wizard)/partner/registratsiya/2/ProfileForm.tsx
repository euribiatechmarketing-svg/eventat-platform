'use client';
import { useRef, useState, useTransition } from 'react';
import { toast } from '@/components/ui/client';
import { Field, WizardForm, useStepState } from '../_ui/WizardForm';
import { Close, Plus } from '../_ui/icons';
import { addPhotosAction, profileAction, removePhotoAction, uploadAvatarAction, uploadCoverAction, type UploadResult } from './actions';

type Chip = { label: string; custom: boolean; on: boolean };
type Props = {
  avatarUrl: string | null; coverUrl: string | null;
  photos: { id: string; url: string }[]; galleryMin: number; galleryMax: number;
  values: { shortDescription: string; description: string; videoUrl: string };
  eventTypes: { id: string; label: string; on: boolean }[];
  tags: Chip[];
};

const bg = (url: string | null) => (url ? { backgroundImage: `url('${url}')` } : undefined);

const MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_RULE = 'JPG или PNG · до 5 MB';
const AVATAR_RULE = 'JPG или PNG · до 5 MB · поне 400 × 400';
const TYPES = ['image/jpeg', 'image/png'];

/**
 * A hidden file input opened by its control. Each chosen file goes up in its own request
 * (media.upload() through a server action), so several photos never exceed the request limit;
 * a file of the wrong type or over 5 MB is refused here with the upload rule.
 */
function useUpload(action: (fd: FormData) => Promise<UploadResult>, okToast: string, rule: string) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const onFiles = (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    start(async () => {
      let added = 0;
      let error: string | null = null;
      for (const f of list) {
        if (!TYPES.includes(f.type) || f.size > MAX_BYTES) { error = rule; break; }
        const fd = new FormData();
        fd.append('file', f);
        const r = await action(fd).catch((): UploadResult => ({ ok: false, error: rule }));
        if (!r.ok) { error = r.error ?? rule; break; }
        added++;
      }
      if (added) toast(okToast);
      if (error) toast(error, 'error');
      if (input.current) input.current.value = '';
    });
  };
  return { input, pending, open: () => input.current?.click(), onFiles };
}

function Counter({ value, max, note }: { value: string; max: number; note: string }) {
  return <><span className="m-counter">{value.length}</span> / {max} · {note}</>;
}

function Specialisations({ eventTypes, tags: initialTags }: Pick<Props, 'eventTypes' | 'tags'>) {
  const { state, touch } = useStepState();
  const [types, setTypes] = useState(() => new Set(eventTypes.filter(t => t.on).map(t => t.id)));
  const [tags, setTags] = useState<Chip[]>(initialTags);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const toggleType = (id: string) => { setTypes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); touch(); };
  const toggleTag = (label: string) => { setTags(ts => ts.map(t => (t.label === label ? { ...t, on: !t.on } : t))); touch(); };
  const commit = () => {
    const label = addRef.current?.value.trim().slice(0, 60) ?? '';
    setAdding(false);
    if (!label) return;
    const exists = tags.find(t => t.label.toLowerCase() === label.toLowerCase());
    setTags(ts => (exists ? ts.map(t => (t === exists ? { ...t, on: true } : t)) : [...ts, { label, custom: true, on: true }]));
    toast('Категорията е добавена');
    touch();
  };
  const err = state.fields?.eventTypes;
  return (
    <section className="wiz-fieldset">
      <div className="wiz-fieldset-head">
        <div>
          <h3 className="wiz-fieldset-title">Специализации</h3>
          <p className="wiz-fieldset-sub">Помагат на клиентите да ви открият по-точно.</p>
        </div>
      </div>
      <div className="chips">
        {eventTypes.map(t => (
          <button key={t.id} type="button" className={`chip${types.has(t.id) ? ' chip--active' : ''}`} aria-pressed={types.has(t.id)} onClick={() => toggleType(t.id)}>{t.label}</button>
        ))}
        {tags.map(t => (
          <button key={t.label} type="button" className={`chip${t.on ? ' chip--active' : ''}`} aria-pressed={t.on} onClick={() => toggleTag(t.label)}>{t.label}</button>
        ))}
        {adding ? (
          <input ref={addRef} className="m-chip-input" aria-label="Друго" maxLength={60} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setAdding(false); }}
            onBlur={commit} />
        ) : (
          <button type="button" className="chip chip--add" onClick={() => setAdding(true)}><Plus size={12} sw={2.5} />Друго</button>
        )}
      </div>
      {[...types].map(id => <input key={id} type="hidden" name="eventTypeIds" value={id} />)}
      {tags.filter(t => t.on).map(t => <input key={t.label} type="hidden" name={t.custom ? 'customTags' : 'tags'} value={t.label} />)}
      {err && <p className="m-section-error" role="alert">{err}</p>}
    </section>
  );
}

function Gallery({ photos, galleryMax }: Pick<Props, 'photos' | 'galleryMax'>) {
  const { state } = useStepState();
  const add = useUpload(addPhotosAction, 'Снимката е добавена', PHOTO_RULE);
  const [removing, setRemoving] = useState<string | null>(null);
  const [, start] = useTransition();
  const remove = (id: string) => {
    setRemoving(id);
    start(async () => {
      const r = await removePhotoAction(id);
      setRemoving(null);
      if (r.ok) toast('Снимката е премахната');
    });
  };
  const err = state.fields?.gallery;
  return (
    <section className="wiz-fieldset">
      <div className="wiz-fieldset-head">
        <div>
          <h3 className="wiz-fieldset-title">Галерия</h3>
          <p className="wiz-fieldset-sub">Поне 4 снимки от ваши събития. Първата е главна и се показва в каталога.</p>
        </div>
        <span className="badge badge--primary">{photos.length} / {galleryMax}</span>
      </div>
      <div className="gallery-grid">
        {photos.map((ph, i) => (
          <div key={ph.id} className={`gallery-item${i === 0 ? ' gallery-item--cover' : ''}${removing === ph.id ? ' m-busy' : ''}`} style={bg(ph.url)}>
            {i === 0 && <span className="gallery-tag">Главна</span>}
            <button type="button" className="gallery-action" aria-label="Премахни" onClick={() => remove(ph.id)}><Close /></button>
          </div>
        ))}
        {photos.length < galleryMax && (
          <button type="button" className={`gallery-add${add.pending ? ' m-busy' : ''}`} onClick={add.open}>
            <Plus size={22} sw={1.8} />
            <span>Добави снимка</span>
          </button>
        )}
        <input ref={add.input} type="file" accept="image/jpeg,image/png" multiple hidden onChange={e => add.onFiles(e.target.files)} aria-label="Добави снимка" />
      </div>
      {err && <p className="m-section-error" role="alert">{err}</p>}
    </section>
  );
}

function Photos({ avatarUrl, coverUrl }: Pick<Props, 'avatarUrl' | 'coverUrl'>) {
  const { state } = useStepState();
  const avatar = useUpload(uploadAvatarAction, 'Снимката е обновена', AVATAR_RULE);
  const cover = useUpload(uploadCoverAction, 'Снимката е качена', PHOTO_RULE);
  return (
    <section className="wiz-fieldset">
      <div className="wiz-fieldset-head">
        <div>
          <h3 className="wiz-fieldset-title">Профилна и заглавна снимка</h3>
          <p className="wiz-fieldset-sub">Профилната снимка се показва до името ви, а заглавната — най-горе в профила.</p>
        </div>
      </div>
      <div className="wiz-row">
        <div className={`field${state.fields?.avatar ? ' field--error' : ''}`}>
          <label className="field-label">Профилна снимка<span className="required-mark">*</span></label>
          <div className={`upload upload--circle${avatar.pending ? ' m-busy' : ''}`}>
            {avatarUrl
              ? <span className="avatar avatar--xl"><img src={avatarUrl} alt="" /></span>
              : <span className="upload-preview upload-preview--placeholder" aria-hidden="true" />}
            <div className="upload-meta">
              <button type="button" className="btn btn--outline btn--sm" onClick={avatar.open}>{avatarUrl ? 'Смени снимката' : 'Качи снимка'}</button>
              <p className="t-caption t-muted">{AVATAR_RULE}</p>
            </div>
            <input ref={avatar.input} type="file" accept="image/jpeg,image/png" hidden onChange={e => avatar.onFiles(e.target.files)} aria-label="Профилна снимка" />
          </div>
          {state.fields?.avatar && <span className="field-message">{state.fields.avatar}</span>}
        </div>
        <div className={`field${state.fields?.cover ? ' field--error' : ''}`}>
          <label className="field-label">Заглавна снимка<span className="required-mark">*</span></label>
          <div className={`upload upload--cover${cover.pending ? ' m-busy' : ''}`}>
            <div className={`upload-preview${coverUrl ? '' : ' upload-preview--placeholder'}`} style={bg(coverUrl)}
              role="button" tabIndex={0} aria-label={coverUrl ? 'Смени снимката' : 'Качи снимка'} onClick={cover.open}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cover.open(); } }}>
              {!coverUrl && <><Plus size={22} sw={1.8} /><span>Качи снимка</span></>}
            </div>
            <input ref={cover.input} type="file" accept="image/jpeg,image/png" hidden onChange={e => cover.onFiles(e.target.files)} aria-label="Заглавна снимка" />
          </div>
          <span className="field-message">{state.fields?.cover ?? 'Препоръчителен размер 1600 × 900.'}</span>
        </div>
      </div>
    </section>
  );
}

export function ProfileForm(p: Props) {
  const [short, setShort] = useState(p.values.shortDescription);
  const [long, setLong] = useState(p.values.description);
  return (
    <WizardForm action={profileAction}>
      <Photos avatarUrl={p.avatarUrl} coverUrl={p.coverUrl} />

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Представяне</h3>
            <p className="wiz-fieldset-sub">Едно изречение за каталога и по-дълъг текст за профила ви.</p>
          </div>
        </div>
        <div className="wiz-row--full">
          <Field name="shortDescription" label="Кратко описание" required hint="(до 140 знака)"
            message={<Counter value={short} max={140} note="показва се в картата ви в каталога" />}>
            <input id="f-shortDescription" className="field-input" type="text" name="shortDescription" value={short} onChange={e => setShort(e.target.value)}
              placeholder="Напр. DJ за елегантни сватби и фирмени събития в София." maxLength={140} />
          </Field>
        </div>
        <div className="wiz-row--full">
          <Field name="description" label="Дълго описание" required hint="(до 600 знака)"
            message={<Counter value={long} max={600} note="показва се в публичния ви профил" />}>
            <textarea id="f-description" className="field-textarea" name="description" value={long} onChange={e => setLong(e.target.value)}
              placeholder="Разкажете историята си — защо клиентите избират вас и какво ви отличава." style={{ minHeight: 160 }} maxLength={600} />
          </Field>
        </div>
      </section>

      <Gallery photos={p.photos} galleryMax={p.galleryMax} />

      <section className="wiz-fieldset">
        <div className="wiz-fieldset-head">
          <div>
            <h3 className="wiz-fieldset-title">Видео презентация <span className="t-caption t-muted">(незадължително)</span></h3>
            <p className="wiz-fieldset-sub">Линк към YouTube или Vimeo. Показва се в галерията на профила ви.</p>
          </div>
        </div>
        <div className="wiz-row--full">
          <Field name="videoUrl" label="Линк към видеото">
            <input id="f-videoUrl" className="field-input" type="url" name="videoUrl" defaultValue={p.values.videoUrl} placeholder="https://youtube.com/watch?v=..." maxLength={300} />
          </Field>
        </div>
      </section>

      <Specialisations eventTypes={p.eventTypes} tags={p.tags} />
    </WizardForm>
  );
}
