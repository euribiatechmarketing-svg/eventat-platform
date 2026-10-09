'use client';
// The review form's controls (client/review.html): the overall stars, the four
// criteria, the comment, the tags and the photos. Each star row is a set of
// buttons writing one hidden value; ‹Публикувай ревюто› waits for every rating
// and a comment of at least 40 characters (SPEC V2).
import { useState } from 'react';
import { radioKeys, radioTab } from '@/components/ui/dropdown';
import Link from 'next/link';
import { PhotoPicker, type UploadResult } from './PhotoPicker';
import { SubmitButton } from './SubmitButton';

const STAR = 'M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z';
const CRITERIA = [
  ['ratingCommunication', 'Комуникация'],
  ['ratingAccuracy', 'Точност'],
  ['ratingQuality', 'Качество'],
  ['ratingValue', 'Съотношение цена'],
] as const;
type Key = 'ratingOverall' | (typeof CRITERIA)[number][0];

export function ReviewFields({ tags, minChars, maxPhotos, maxMb, upload }: {
  tags: readonly string[]; minChars: number; maxPhotos: number; maxMb: number; upload: (fd: FormData) => Promise<UploadResult>;
}) {
  const [r, setR] = useState<Record<Key, number>>({ ratingOverall: 0, ratingCommunication: 0, ratingAccuracy: 0, ratingQuality: 0, ratingValue: 0 });
  const [body, setBody] = useState('');
  const ready = Object.values(r).every(v => v > 0) && body.trim().length >= minChars;
  const set = (k: Key, v: number) => setR(x => ({ ...x, [k]: v }));

  return (
    <>
      {(Object.keys(r) as Key[]).map(k => <input key={k} type="hidden" name={k} value={r[k] || ''} />)}
      <div className="field-label" style={{ marginBottom: 12 }}>Обща оценка</div>
      <div className="rw-stars" role="radiogroup" aria-label="Обща оценка" onKeyDown={radioKeys}>
        {[1, 2, 3, 4, 5].map(i => (
          <button key={i} type="button" role="radio" aria-checked={r.ratingOverall === i} tabIndex={radioTab(r.ratingOverall === i, i - 1, r.ratingOverall > 0)} aria-label={i === 1 ? '1 звезда' : `${i} звезди`}
            className={i <= r.ratingOverall ? 'is-on' : undefined} onClick={() => set('ratingOverall', i)}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={STAR} /></svg>
          </button>
        ))}
      </div>
      {r.ratingOverall === 5 && <div className="rw-verdict">Отлично — бих ги препоръчала</div>}

      <div style={{ marginTop: 26, paddingTop: 24, borderTop: '1px solid var(--app-line)' }}>
        <div className="field-label" style={{ marginBottom: 14 }}>По категории</div>
        <div className="rw-grid">
          {CRITERIA.map(([k, label]) => (
            <div key={k} className="rw-item">
              <span className="rw-item-n">{label}</span>
              <span className="rw-mini" role="radiogroup" aria-label={label} onKeyDown={radioKeys}>
                {[1, 2, 3, 4, 5].map(i => (
                  <button key={i} type="button" role="radio" aria-checked={r[k] === i} tabIndex={radioTab(r[k] === i, i - 1, r[k] > 0)} aria-label={`${label}: ${i}`}
                    className={i > r[k] ? 'is-off' : undefined} onClick={() => set(k, i)}>
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={STAR} /></svg>
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 26, paddingTop: 24, borderTop: '1px solid var(--app-line)' }}>
        <div className="field">
          <label className="field-label" htmlFor="rw-body">Вашият коментар<span className="field-label-hint">поне {minChars} символа</span></label>
          <textarea id="rw-body" className="field-textarea" name="body" required minLength={minChars} maxLength={4000}
            style={{ minHeight: 118, lineHeight: 1.65 }} value={body} onChange={e => setBody(e.target.value)} />
        </div>
        <div className="rw-chips">
          {tags.map(t => (
            <label key={t} className="rw-chip"><input type="checkbox" name="tag" value={t} />{t}</label>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <PhotoPicker name="photo" title="Добавете снимки от събитието" max={maxPhotos} maxMb={maxMb} upload={upload} inline />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 26, flexWrap: 'wrap' }}>
        <SubmitButton className="btn btn--primary" disabled={!ready}>Публикувай ревюто</SubmitButton>
        <Link className="btn btn--outline" href="/akaunt/rezervacii">Откажи</Link>
      </div>
    </>
  );
}
