// vendor/reviews.html → /partner/revyuta?tab= (SCREENS §7)
import '@/styles/m-partner-catalogue.css';
import Link from 'next/link';
import { initials } from '@/lib/initials';
import { REVIEWS_TAB_PARAM, reviewsPage, type ReviewsTab } from '@/lib/domain/views-partner-catalogue';
import { partnerActor } from '../_catalogue/server';
import { CopyLink, Stars } from '../_catalogue/ui';
import { ReplyBox } from './ReplyBox';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ревюта' };

const TAB_PARAM: Record<ReviewsTab, string | null> = { all: null, unanswered: 'bez-otgovor', five: '5-zvezdi' };

/** ‹Петя и Николай› → ‹ПН› (the couple, not the conjunction). */
const avatar = (name: string) => initials(name.split(/\s+/).filter(w => w !== 'и' && w !== '&').join(' '));

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ tab?: string; stranitsa?: string }> }) {
  const sp = await searchParams;
  const actor = await partnerActor('/partner/revyuta');
  const tab = REVIEWS_TAB_PARAM[sp.tab ?? ''] ?? 'all';
  const page = Math.max(1, Math.min(100, Number(sp.stranitsa) || 1));
  const v = await reviewsPage(actor, { tab, page });
  const href = (t: ReviewsTab, p = 1) => {
    const q = new URLSearchParams();
    if (TAB_PARAM[t]) q.set('tab', TAB_PARAM[t]!);
    if (p > 1) q.set('stranitsa', String(p));
    const s = q.toString();
    return `/partner/revyuta${s ? `?${s}` : ''}`;
  };
  const tabs: { key: ReviewsTab; label: string; count: number }[] = [
    { key: 'all', label: 'Всички', count: v.counts.all },
    { key: 'unanswered', label: 'Без отговор', count: v.counts.unanswered },
    { key: 'five', label: '5 звезди', count: v.counts.five },
  ];

  return (
    <div className="pc-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Ревюта</h1>
          <p className="page-sub">Клиентите оценяват след приключено събитие{v.responsiveness != null ? ` · ${v.responsiveness}% отзивчивост` : ''}</p>
        </div>
        <div className="page-head-right">
          <CopyLink path={`/partnyori/${v.slug}`} className="btn btn--outline btn--sm">Сподели профила</CopyLink>
        </div>
      </div>

      {v.summary && (
        <section className="dcard" style={{ marginBottom: 20 }}>
          <div className="rev-hero">
            <div className="rev-score">
              <div className="rev-score-v">{v.summary.avgText}</div>
              <Stars n={Math.round(v.summary.avg)} style={{ justifyContent: 'center', marginLeft: 0 }} />
              <div className="rev-score-n">от {v.summary.countLabel}</div>
            </div>
            <div className="dist">
              {v.summary.distribution.map(d => (
                <div key={d.stars} className="dist-row">
                  <span>{d.stars} ★</span><span className="dist-bar"><i style={{ width: `${d.pct}%` }} /></span><span className="dist-n">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="toolbar">
        <nav className="tab-bar" aria-label="Ревюта">
          {tabs.map(t => (
            <Link key={t.key} href={href(t.key)} className={`tab-bar-item${tab === t.key ? ' is-active' : ''}`} aria-current={tab === t.key ? 'page' : undefined}>
              {t.label} <span className="tab-count">{t.count}</span>
            </Link>
          ))}
        </nav>
      </div>

      <section className="dcard">
        {v.items.length === 0 && <div className="ui-empty">Няма записи в този изглед.</div>}
        {v.items.map(r => (
          <div key={r.id} className="rev" data-review={r.id}>
            <div className="rev-head">
              <span className="avatar">{avatar(r.author)}</span>
              <div><div className="rev-name">{r.author}</div><div className="rev-meta">{r.meta}</div></div>
              <Stars n={r.rating} />
            </div>
            <p className="rev-text">{r.body}</p>
            {r.reply ? (
              <div className="rev-reply">
                <div className="rev-reply-h">Вашият отговор</div>
                <div className="rev-reply-t">{r.reply}</div>
              </div>
            ) : (
              <ReplyBox reviewId={r.id} author={r.author} />
            )}
          </div>
        ))}
        {v.hasMore && (
          <div className="pc-more"><Link className="btn btn--outline btn--sm" href={href(tab, page + 1)} scroll={false}>Покажи още</Link></div>
        )}
      </section>
    </div>
  );
}
