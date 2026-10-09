'use client';
// ‹Опишете събитието си› (client/brief.html): categories, event type, date,
// guests, city, budget, description and photos; the summary follows the form.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ActionForm, type FormState } from './ActionForm';
import { PhotoPicker, type UploadResult } from './PhotoPicker';
import { SubmitButton } from './SubmitButton';

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const fmtDate = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '—'; };

type Opt = { slug: string; name: string };
export type BriefFormProps = {
  categories: Opt[]; types: Opt[]; cities: Opt[];
  budgets: readonly { value: string; label: string }[];
  prefill: { categories: string[]; type: string; city: string; date: string; guests: string };
  phone: string; today: string; maxPhotos: number; maxMb: number;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  upload: (fd: FormData) => Promise<UploadResult>;
};

export function BriefForm(p: BriefFormProps) {
  const [cats, setCats] = useState<string[]>(p.prefill.categories);
  const [type, setType] = useState(p.prefill.type);
  const [date, setDate] = useState(p.prefill.date);
  const [guests, setGuests] = useState(p.prefill.guests);
  const [city, setCity] = useState(p.prefill.city);
  const [back, setBack] = useState<string | null>(null);
  const noop = useCallback(() => {}, []);
  // ‹Назад› returns to the page the client came from (one of ours), else the catalogue.
  useEffect(() => {
    try {
      const ref = document.referrer && new URL(document.referrer);
      // A plain link to that page, not history.back(): a tab opened from our page has no history to go back to.
      if (ref && ref.origin === location.origin && ref.pathname !== location.pathname) setBack(ref.pathname + ref.search);
    } catch { /* no referrer */ }
  }, []);
  const toggle = (slug: string) => setCats(c => (c.includes(slug) ? c.filter(x => x !== slug) : [...c, slug]));
  const names = p.categories.filter(c => cats.includes(c.slug)).map(c => c.name);

  return (
    <div className="pv-grid">
      <ActionForm action={p.action} className="form-card">
        <span className="fld-l">Какво търсите</span>
        <div className="rw-chips bf-cats" style={{ marginTop: 4 }} role="group" aria-label="Какво търсите">
          {p.categories.map(c => (
            <label key={c.slug} className="rw-chip">
              <input type="checkbox" name="category" value={c.slug} checked={cats.includes(c.slug)} onChange={() => toggle(c.slug)} />{c.name}
            </label>
          ))}
        </div>
        <div className="fld-hint">Изберете една или няколко — запитването отива до изпълнителите във всяка.</div>

        <div style={{ marginTop: 22 }} role="radiogroup" aria-label="Тип събитие">
          <span className="fld-l">Тип събитие</span>
          <div className="opt-row bf-type">
            {p.types.map(t => (
              <label key={t.slug} className="opt"><input type="radio" name="eventType" value={t.slug} checked={type === t.slug} onChange={() => setType(t.slug)} required />{t.name}</label>
            ))}
          </div>
        </div>

        <div className="form-grid form-grid--3" style={{ marginTop: 22 }}>
          <label className="fld"><span className="fld-l">Дата на събитието</span>
            <input className="fld-i bf-date" type="date" name="eventDate" required min={p.today} value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label className="fld"><span className="fld-l">Брой гости</span>
            <input className="fld-i bf-guests" type="number" name="guests" required min={1} inputMode="numeric" placeholder="Въведете брой" value={guests} onChange={e => setGuests(e.target.value)} />
          </label>
          <label className="fld"><span className="fld-l">Град</span>
            <select className="fld-i bf-city" name="city" required value={city} onChange={e => setCity(e.target.value)}>
              <option value="" disabled>Въведете град</option>
              {p.cities.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="form-grid" style={{ marginTop: 18 }}>
          <label className="fld"><span className="fld-l">Телефон за връзка</span>
            <input className="fld-i" type="text" value={p.phone || '—'} readOnly tabIndex={-1} />
          </label>
          <div className="fld-hint fld-hint--side">От профила ви. Вижда го само изпълнителят, когото изберете, след потвърдена резервация.</div>
        </div>

        <div style={{ marginTop: 22 }} role="radiogroup" aria-label="Бюджет">
          <span className="fld-l">Бюджет</span>
          <div className="opt-row">
            {p.budgets.map(b => <label key={b.value} className="opt"><input type="radio" name="budget" value={b.value} defaultChecked={b.value === 'unknown'} />{b.label}</label>)}
          </div>
        </div>

        <label className="fld" style={{ marginTop: 22 }}><span className="fld-l">Описание</span>
          <textarea className="fld-i fld-i--area" name="description" maxLength={2000} rows={4}
            placeholder="Опишете какво си представяте — атмосфера, стил, важните моменти от програмата." />
        </label>
        <div className="fld-hint">Колкото повече детайли дадете, толкова по-точни са офертите.</div>

        <div style={{ marginTop: 22 }}>
          <span className="fld-l">Снимки за вдъхновение</span>
          <div className="fld-hint" style={{ marginTop: 0, marginBottom: 11 }}>Референтните снимки помагат на изпълнителите да разберат стила, който търсите.</div>
          <PhotoPicker name="photo" title="Прикачете снимки за вдъхновение" max={p.maxPhotos} maxMb={p.maxMb} upload={p.upload} onCount={noop} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
          <SubmitButton className="btn btn--primary" disabled={!cats.length}>Изпрати запитването</SubmitButton>
          <Link className="btn btn--ghost bf-back" href={back ?? '/tarsene'}>Назад</Link>
        </div>
      </ActionForm>

      <aside>
        <div className="sum">
          <div className="sum-v">
            <span className="sum-v-img bf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 01-9 8.4 9 9 0 01-3.8-.8L3 20.5l1.4-4.2A8.4 8.4 0 013 11.5 8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z" /></svg></span>
            <div>
              <div className="sum-v-n">До свободните изпълнители</div>
              <div className="sum-v-c">които отговарят на описанието ви</div>
            </div>
          </div>
          <div className="sum-row"><span>Услуги</span><b className="bf-s-cats">{names.length ? names.join(', ') : 'изберете поне една'}</b></div>
          <div className="sum-row"><span>Събитие</span><b className="bf-s-type">{p.types.find(t => t.slug === type)?.name ?? '—'}</b></div>
          <div className="sum-row"><span>Дата</span><b className="bf-s-date">{date ? fmtDate(date) : '—'}</b></div>
          <div className="sum-row"><span>Град</span><b className="bf-s-city">{p.cities.find(c => c.slug === city)?.name ?? '—'}</b></div>
          <div className="sum-row"><span>Гости</span><b className="bf-s-guests">{Number(guests) > 0 ? guests : '—'}</b></div>
          <div className="book-note" style={{ marginTop: 16 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>Плащате едва след като изберете оферта и изпълнителят я потвърди.</span>
          </div>
        </div>
        <div className="sum" style={{ marginTop: 16 }}>
          <div className="sum-v-n" style={{ marginBottom: 12 }}>Какво следва</div>
          <div className="bf-step"><span className="bf-n">1</span><span>Изпращаме описанието до свободните изпълнители в избраните услуги.</span></div>
          <div className="bf-step"><span className="bf-n">2</span><span>Офертите идват в „Моите заявки“ до 24 часа.</span></div>
          <div className="bf-step"><span className="bf-n">3</span><span>Избирате една, а другите изпълнители получават учтив отказ.</span></div>
        </div>
      </aside>
    </div>
  );
}
