'use client';
// ‹Изпратете запитване› (client/request.html): the event fields, the space
// type and package picks, the note and the inspiration photos; the summary on
// the right follows the form as it changes.
import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { PartnerCard, ServiceOption } from '@/lib/domain/views-client-booking';
import { ActionForm, type FormState } from './ActionForm';
import { PhotoPicker, type UploadResult } from './PhotoPicker';
import { SubmitButton } from './SubmitButton';

const STAR = 'M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z';
const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const fmtDate = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '—'; };
const money = (c: number) => `${String(Math.round(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const SPACES = [['indoor', 'Закрита зала'], ['garden_hall', 'Градина и зала'], ['outdoor', 'На открито'], ['undecided', 'Още не е решено']] as const;

export type RequestFormProps = {
  partner: PartnerCard;
  slug: string;
  services: ServiceOption[];
  types: { id: string; name: string }[];
  prefill: { clientEventId: string | null; eventTypeId: string; date: string; startTime: string; endTime: string; guests: string; venueName: string; locality: string; serviceId: string };
  phone: string;
  today: string;
  maxGuests: number | null;
  dateTaken: boolean;
  maxPhotos: number;
  maxMb: number;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  upload: (fd: FormData) => Promise<UploadResult>;
};

export function RequestForm(p: RequestFormProps) {
  const [eventDate, setDate] = useState(p.prefill.date);
  const [guests, setGuests] = useState(p.prefill.guests);
  const [serviceId, setService] = useState(p.prefill.serviceId);
  const [photos, setPhotos] = useState(0);
  const onCount = useCallback((n: number) => setPhotos(n), []);
  const svc = p.services.find(s => s.id === serviceId) ?? null;
  const g = Number(guests) || 0;
  const total = !svc || svc.kind === 'quote' ? null : svc.perGuest ? svc.priceCents! * Math.max(g, svc.minGuests ?? 0) : svc.priceCents!;
  const pkg = svc ? (/^Пакет\s+„(.+)“$/.exec(svc.name)?.[1] ? `„${/^Пакет\s+„(.+)“$/.exec(svc.name)![1]}“` : svc.name) : '—';

  return (
    <div className="pv-grid">
      <ActionForm action={p.action} className="form-card">
        <input type="hidden" name="slug" value={p.slug} />
        {p.prefill.clientEventId && <input type="hidden" name="clientEventId" value={p.prefill.clientEventId} />}
        <div className="form-grid">
          <label className="fld"><span className="fld-l">Тип събитие</span>
            <select className="fld-i" name="eventTypeId" defaultValue={p.prefill.eventTypeId} required>
              {p.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="fld"><span className="fld-l">Дата на събитието</span>
            <input className="fld-i" type="date" name="eventDate" required min={p.today} value={eventDate} onChange={e => setDate(e.target.value)} />
            {p.dateTaken && eventDate === p.prefill.date && <div className="cb-fld-err">Датата е заета</div>}
          </label>
        </div>
        <div className="form-grid form-grid--3" style={{ marginTop: 18 }}>
          <label className="fld"><span className="fld-l">Начален час</span>
            <input className="fld-i" type="time" name="startTime" defaultValue={p.prefill.startTime} />
          </label>
          <label className="fld"><span className="fld-l">Край (ориентировъчно)</span>
            <input className="fld-i" type="time" name="endTime" defaultValue={p.prefill.endTime} />
          </label>
          <label className="fld"><span className="fld-l">Брой гости</span>
            <input className="fld-i" type="number" name="guests" required min={1} max={p.maxGuests ?? undefined} inputMode="numeric" value={guests} onChange={e => setGuests(e.target.value)} />
          </label>
        </div>
        <div className="form-grid" style={{ marginTop: 18 }}>
          <label className="fld"><span className="fld-l">Локация</span>
            <input className="fld-i" type="text" name="venueName" maxLength={120} defaultValue={p.prefill.venueName} />
          </label>
          <label className="fld"><span className="fld-l">Град / село</span>
            <input className="fld-i" type="text" name="locality" maxLength={120} defaultValue={p.prefill.locality} />
          </label>
        </div>
        <div className="form-grid" style={{ marginTop: 18 }}>
          <label className="fld"><span className="fld-l">Телефон за връзка</span>
            <input className="fld-i" type="text" value={p.phone || '—'} readOnly tabIndex={-1} />
          </label>
          <div className="fld-hint fld-hint--side">От профила ви. Изпълнителят го вижда едва след потвърдена резервация — дотогава си пишете в платформата.</div>
        </div>

        <div style={{ marginTop: 22 }} role="radiogroup" aria-label="Тип пространство">
          <span className="fld-l">Тип пространство</span>
          <div className="opt-row">
            {SPACES.map(([v, label]) => <label key={v} className="opt"><input type="radio" name="spaceType" value={v} />{label}</label>)}
          </div>
        </div>

        <div style={{ marginTop: 22 }} role="radiogroup" aria-label="Избран пакет">
          <span className="fld-l">Избран пакет</span>
          <div className="opt-row">
            {p.services.map(s => (
              <label key={s.id} className="opt">
                <input type="radio" name="serviceId" value={s.id} required checked={serviceId === s.id} onChange={() => setService(s.id)} />{s.label}
              </label>
            ))}
          </div>
        </div>

        <label className="fld" style={{ marginTop: 22 }}><span className="fld-l">Бележка към изпълнителя</span>
          <textarea className="fld-i fld-i--area" name="note" maxLength={2000} rows={4} />
        </label>
        <div className="fld-hint">Колкото повече детайли дадете, толкова по-точен е отговорът.</div>

        <div style={{ marginTop: 22 }}>
          <span className="fld-l">Снимки за вдъхновение</span>
          <div className="fld-hint" style={{ marginTop: 0, marginBottom: 11 }}>Референтните снимки помагат на изпълнителя да разбере стила, който търсите.</div>
          <PhotoPicker name="photo" title="Прикачете снимки за вдъхновение" max={p.maxPhotos} maxMb={p.maxMb} upload={p.upload} onCount={onCount} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
          <SubmitButton className="btn btn--primary">Изпрати заявката</SubmitButton>
          <Link className="btn btn--ghost" href={`/partnyori/${p.slug}`}>Назад</Link>
        </div>
      </ActionForm>

      <aside>
        <div className="sum">
          <div className="sum-v">
            <span className="sum-v-img" style={p.partner.thumb ? { backgroundImage: `url('${p.partner.thumb}')` } : undefined} />
            <div>
              <div className="sum-v-n">{p.partner.name}</div>
              <div className="sum-v-c">{[p.partner.category, p.partner.cityName].filter(Boolean).join(' · ')}</div>
              {p.partner.rating && (
                <div className="v-rate" style={{ marginTop: 5 }}>
                  <span className="v-stars">{[0, 1, 2, 3, 4].map(i => <svg key={i} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={STAR} /></svg>)}</span>
                  <b>{p.partner.rating}</b>
                </div>
              )}
            </div>
          </div>
          <div className="sum-row"><span>Пакет</span><b>{pkg}</b></div>
          <div className="sum-row"><span>Дата</span><b>{eventDate ? fmtDate(eventDate) : '—'}</b></div>
          <div className="sum-row"><span>Гости</span><b>{g || '—'}</b></div>
          {photos > 0 && <div className="sum-row"><span>Прикачени</span><b>{photos} {photos === 1 ? 'снимка' : 'снимки'} за вдъхновение</b></div>}
          <div className="sum-total"><span>Обща сума</span><b>{total != null ? money(total) : svc?.kind === 'quote' ? 'По оферта' : '—'}</b></div>
          <div className="book-note" style={{ marginTop: 16 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>Плащате едва след одобрение от изпълнителя.</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
