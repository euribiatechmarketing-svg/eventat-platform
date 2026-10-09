// ‹Остави ревю› (client/review.html → SCREENS §4 /akaunt/rezervacii/[nomer]/revyu).
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/client-booking/ActionForm';
import { Crumbs, Num, PartnerSum } from '@/components/client-booking/parts';
import { ReviewFields } from '@/components/client-booking/ReviewFields';
import { REVIEW_MIN_CHARS, REVIEW_TAGS } from '@/lib/domain/reviews';
import { reviewPageData, shortDate } from '@/lib/domain/views-client-booking';
import { date, moneyShort } from '@/lib/format';
import { numberParam, orNotFound, requireClient } from '@/lib/client-booking/guard';
import { publishReviewAction, uploadReviewPhotoAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Остави ревю' };

export default async function ReviewPage({ params }: { params: Promise<{ nomer: string }> }) {
  const { nomer } = await params;
  const number = numberParam(nomer);
  const n = encodeURIComponent(number);
  const { actor } = await requireClient(`/akaunt/rezervacii/${n}/revyu`);
  const v = await orNotFound(reviewPageData(actor, number));
  if (!v.reviewable) redirect(`/akaunt/rezervacii/${n}`);
  const { booking: b, partner: p } = v;

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: 'Моите резервации', href: '/akaunt/rezervacii' }, { label: 'Остави ревю' }]} />
      <h1 className="sr-only">Остави ревю</h1>

      <div className="pv-grid">
        <div>
          <ActionForm action={publishReviewAction} className="form-card">
            <input type="hidden" name="number" value={b.number} />
            <div className="rw-top">
              <span className="rw-img" style={p.thumb ? { backgroundImage: `url('${p.thumb}')` } : undefined} />
              <div>
                <div className="rw-n"><Num>{p.name}</Num></div>
                <div className="rw-s">{[p.category, `${v.eventTitle}, ${date(b.eventDate)}`, `${b.guests} гости`].join(' · ')}</div>
              </div>
            </div>
            <ReviewFields tags={REVIEW_TAGS} minChars={REVIEW_MIN_CHARS} maxPhotos={v.maxPhotos} maxMb={v.maxMb} upload={uploadReviewPhotoAction} />
          </ActionForm>
        </div>

        <aside>
          <div className="sum">
            <PartnerSum p={p} />
            <div className="sum-row"><span>Резервация №</span><b>{b.number}</b></div>
            <div className="sum-row"><span>Дата</span><b>{shortDate(b.eventDate, true)}</b></div>
            <div className="sum-row"><span>Платено</span><b>{moneyShort(v.paidCents)}</b></div>
            <div className="book-note" style={{ marginTop: 16 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>
              <span>Ревюто се публикува само от клиенти с платена резервация — затова оценките тук са реални.</span>
            </div>
          </div>

          <div className="dcard" style={{ marginTop: 16 }}>
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Какво помага</h2></div>
            <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc', fontSize: 13, lineHeight: 1.75, color: 'var(--neutral-700)' }}>
              <li>Опишете какво точно наехте и за какво събитие.</li>
              <li>Кажете какво е било различно от очакваното — в добра или лоша посока.</li>
              <li>Без лични данни и телефонни номера.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
