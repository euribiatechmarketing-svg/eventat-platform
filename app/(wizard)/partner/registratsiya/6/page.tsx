// Step 6 ‹Преглед и подаване› (prototype onboarding/review.html; SCREENS §6). A returned
// application shows the team's note on top (vendor-application-returned: ‹Бележка от екипа›).
import type { Metadata } from 'next';
import { Fragment } from 'react';
import Link from 'next/link';
import { moneyShort } from '@/lib/format';
import { stepReview } from '@/lib/domain/views-partner-onboarding';
import { guardStep } from '../guard';
import { Num } from '../_ui/Num';
import { Alert } from '../_ui/icons';
import { ReviewForm } from './ReviewForm';

export const metadata: Metadata = { title: 'Преглед и подаване' };

const B = '/partner/registratsiya';

function Section({ title, step, children }: { title: string; step: number; children: React.ReactNode }) {
  return (
    <div className="review-section">
      <div className="review-section-head"><h2 id={`review-${step}`}>{title}</h2><Link href={`${B}/${step}`} aria-describedby={`review-${step}`}>Редактирай</Link></div>
      {children}
    </div>
  );
}

export default async function ReviewStep() {
  const { actor, chrome } = await guardStep(6);
  const r = await stepReview(actor);
  const p = r.partner;
  const firstFixed = r.services.find(s => s.kind === 'package_fixed');
  const perDay = p.bookingsPerDayMode === 'one' ? <><strong>Една</strong> резервация на ден</>
    : p.bookingsPerDayMode === 'limit' ? <><strong>До {p.maxBookingsPerDate}</strong> резервации на ден</> : <><strong>Без лимит</strong> на ден</>;
  return (
    <>
      <header className="wiz-step-header">
        <span className="wiz-step-counter">Стъпка 6 от 6</span>
        <h1 className="wiz-step-title">Готови ли сте?</h1>
        <p className="wiz-step-intro">Прегледайте всичко още веднъж. След подаването екипът ни проверява профила ви до&nbsp;{r.slaHours}&nbsp;часа.</p>
      </header>

      <ReviewForm slaHours={r.slaHours} email={p.notificationEmail}>
        {chrome.lastDecisionNote && (
          <div className="alert alert--warning" role="note">
            <Alert className="alert-icon" />
            <div><p className="alert-title">Бележка от екипа</p><p className="alert-text">{chrome.lastDecisionNote}</p></div>
          </div>
        )}

        <div className="preview-card">
          <div className="preview-card-cover ob-cover" style={r.coverUrl ? { backgroundImage: `url('${r.coverUrl}')` } : undefined} />
          <div className="preview-card-body">
            <div className="preview-card-head">
              <span className="avatar avatar--lg">{r.avatarUrl && <img src={r.avatarUrl} alt="" />}</span>
              <div>
                <p className="t-overline">{[r.categoryName, r.cityName].filter(Boolean).join(' · ')}</p>
                <h2 className="t-h3" style={{ margin: '4px 0 4px' }}><Num>{p.businessName}</Num></h2>
                <p className="t-body t-muted">{p.shortDescription}</p>
              </div>
            </div>
            <div className="preview-card-meta">
              <span><strong>{r.packages}</strong> {r.packages === 1 ? 'пакет' : 'пакета'}{r.onRequest > 0 && <> · <strong>{r.onRequest}</strong> по запитване</>}</span>
              {r.experience && <span><strong>{r.experience}</strong> опит</span>}
              {r.policyName && <span><strong>{r.policyName}</strong> политика</span>}
              <span>{perDay}</span>
            </div>
          </div>
        </div>

        <Section title="Бизнес информация" step={1}>
          <dl className="review-grid">
            <dt>Име на бизнеса</dt><dd>{p.businessName}</dd>
            <dt>Тип на бизнеса</dt><dd>{r.legalForm || '—'}</dd>
            <dt>ЕИК / Булстат</dt><dd>{p.eik || '—'}</dd>
            <dt>Основна категория</dt><dd>{r.categoryName || '—'}</dd>
            <dt>Основен град</dt><dd>{r.cityName || '—'}</dd>
            <dt>Радиус на работа</dt><dd>{r.radius || '—'}</dd>
            <dt>Опит</dt><dd>{r.experience || '—'}</dd>
            <dt>Езици на работа</dt><dd>{p.languages.join(', ') || '—'}</dd>
            <dt>Лице за контакт</dt><dd>{p.contactName}</dd>
            <dt>Имейл за известия</dt><dd>{p.notificationEmail}</dd>
            <dt>Телефон</dt><dd>{r.phone}</dd>
            {p.websiteUrl && <><dt>Уебсайт</dt><dd>{p.websiteUrl}</dd></>}
            <dt>Instagram / Facebook</dt><dd>{p.socialHandle || '—'}</dd>
          </dl>
        </Section>

        <Section title="Профил и галерия" step={2}>
          <dl className="review-grid">
            <dt>Профилна снимка</dt><dd>{r.avatarUrl ? 'Качена' : '—'}</dd>
            <dt>Заглавна снимка</dt><dd>{r.coverUrl ? 'Качена' : '—'}</dd>
            <dt>Галерия</dt><dd>{r.photoCount} {r.photoCount === 1 ? 'снимка' : 'снимки'}</dd>
            <dt>Кратко описание</dt><dd className="ob-balance">{p.shortDescription || '—'}</dd>
            <dt>Дълго описание</dt><dd className="ob-pretty">{p.description || '—'}</dd>
            <dt>Видео</dt><dd>{p.videoUrl || '—'}</dd>
            <dt>Специализации</dt><dd>{r.specialisations.join(', ') || '—'}</dd>
          </dl>
        </Section>

        <Section title="Пакети и услуги" step={3}>
          <div className="stack">
            {r.services.map(s => {
              // ‹1 450 € · До 10 часа · Препоръчан› / ‹По запитване · {описание}›; the text item shortens on a phone.
              const meta = [
                { t: s.kind === 'on_request' ? 'По запитване' : s.priceCents ? moneyShort(s.priceCents) : null },
                { t: s.kind === 'on_request' ? s.description || null : s.durationLabel || null, text: true },
                { t: s === firstFixed ? 'Препоръчан' : null },
              ].filter(m => m.t) as { t: string; text?: boolean }[];
              return (
                <div key={s.id} className="service-row">
                  <div className="service-row-thumb" style={s.thumbUrl ? { backgroundImage: `url('${s.thumbUrl}')` } : undefined} />
                  <div className="service-row-info">
                    <p className="service-row-title">{s.name}</p>
                    <div className="service-row-meta">{meta.map((m, i) => (
                      <Fragment key={i}>{i > 0 && <span>·</span>}<span className={m.text ? 'm-meta-text' : undefined}>{m.t}</span></Fragment>
                    ))}</div>
                  </div>
                  {s.complete
                    ? <span className="badge badge--success badge--dot">Готов</span>
                    : <span className="badge badge--warning badge--dot">Чернова</span>}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Наличност" step={4}>
          <dl className="review-grid">
            <dt>Резервации на ден</dt><dd>{p.bookingsPerDayMode === 'one' ? 'Една резервация' : p.bookingsPerDayMode === 'limit' ? `До ${p.maxBookingsPerDate} резервации` : 'Без лимит'}</dd>
            <dt>Минимум предварително</dt><dd>{r.leadTime}</dd>
            <dt>Максимум напред</dt><dd>{r.horizon}</dd>
            <dt>Работни дни</dt><dd>{r.workingDays}</dd>
            <dt>Блокирани дати</dt><dd>{r.blocks}</dd>
          </dl>
        </Section>

        <Section title="Политика за анулиране" step={5}>
          <dl className="review-grid">
            <dt>Политика</dt><dd>{r.policy}</dd>
            <dt>Депозит</dt><dd>{p.depositPercent}%</dd>
            <dt>Промяна на датата</dt><dd>{r.reschedule}</dd>
          </dl>
        </Section>
      </ReviewForm>
    </>
  );
}
