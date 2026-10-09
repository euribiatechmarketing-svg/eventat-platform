// /kategorii/[slug] (client/category.html, SCREENS §2, SPEC §13.10): the category hero with its
// computed count and from-price, the sub-type pills, the bar, the results with sorting and chips,
// the zero state, and the tips.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { parseSearchParams, searchHref, toQuery } from '@/lib/domain/search';
import { ownOnDate } from '@/lib/domain/saved';
import { categoryView, searchChoices, publicTitle, zeroWatchable } from '@/lib/domain/views-public';
import { SearchBar } from '../../_components/SearchBar';
import { barMenus, searchPageHref, withoutQuery } from '../../_components/bar';
import { Chips, Sort, VCard, Zero } from '../../_components/Results';
import { TipIcon } from '../../_components/icons';
import { Num, RichText, hereUrl, toSearch } from '../../_components/text';
import { viewerFor } from '../../_components/viewer';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: (await publicTitle('category', decodeURIComponent(slug))) ?? 'Категории' };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).slug);
  const sp = toSearch(await searchParams);
  sp.delete('kategoriya');
  const basePath = `/kategorii/${slug}`;
  const here = hereUrl(basePath, sp);
  const { viewer, clientId } = await viewerFor(here);
  const p = parseSearchParams(sp);
  const choices = await searchChoices(clientId);
  // A date that has passed (an old link) is dropped: nothing can be booked on it.
  if (p.data && p.data < choices.today) redirect(searchHref({ ...p, kategoriya: slug, data: null, drugaData: false }, basePath));
  const v = await categoryView(slug, p, { clientId });
  if (!v) notFound();
  const { hero, result: r } = v;
  const pc = { ...p, kategoriya: slug };
  const href = searchPageHref(basePath);
  const own = clientId && p.data ? await ownOnDate(clientId, r.cards.filter(c => c.busy).map(c => c.partnerId), p.data) : new Map<string, { holdsDate: boolean }>();
  const watchable = clientId && r.zero?.dateCaused ? await zeroWatchable(pc, clientId) : true;
  const brief = r.zero?.buttons.find(b => b.kind === 'brief')?.href ?? `/zayavka/otvorena?cat=${slug}`;

  return (
    <>
      <SiteHeader active="/kategorii" />
      <main className="wrap" id="main">
        <div className="hold">
          <div className="cat-hero">
            <div>
              <div className="hero-eyebrow">Категория</div>
              <h1 className="hero-t" style={{ fontSize: 40 }}><Num>{hero.h1}</Num></h1>
              <p className="hero-d" style={{ marginLeft: 0, maxWidth: 520 }}>{hero.countText}.{hero.category.intro ? ` ${hero.category.intro}` : ''}</p>
              {r.facets.subtypes.length > 0 && (
                <div className="cat-pills">
                  <Link className={`cat-pill${p.vid ? '' : ' is-on'}`} href={href({ ...pc, vid: null })} scroll={false} aria-current={p.vid ? undefined : 'true'}>Всички</Link>
                  {r.facets.subtypes.map(s => (
                    <Link key={s.value} className={`cat-pill${s.active ? ' is-on' : ''}`} href={href({ ...pc, vid: s.value })} scroll={false} aria-current={s.active ? 'true' : undefined}>{s.label}</Link>
                  ))}
                </div>
              )}
            </div>
            <div className="cat-shot" style={v.heroPhoto ? { backgroundImage: `url('${v.heroPhoto}')` } : undefined} />
          </div>

          <SearchBar key={toQuery(pc)}
            query={{
              label: 'Услуга', placeholder: 'Всички услуги', icon: false,
              text: p.q || hero.h1, picked: p.q ? null : { slug, name: hero.h1 },
              baseQuery: withoutQuery(pc), vid: p.vid,
              submitPath: '/tarsene', date: p.data,
              briefHref: viewer.kind === 'guest' ? viewer.register(brief) : brief, record: viewer.kind === 'client',
            }}
            menus={barMenus(pc, choices, href, basePath)}
            submit={{}} />

          <div className="results-head">
            <span className="results-n"><RichText value={v.countLine} /></span>
            <Sort r={r} />
          </div>
          <Chips chips={r.chips} clearHref={r.clearHref} />
          {r.cards.length > 0 && (
            <div className="v-grid">
              {r.cards.map(c => <VCard key={c.partnerId} c={c} date={p.data} sabitieId={p.sabitieId} viewer={viewer} ownBooking={!!own.get(c.partnerId)?.holdsDate} />)}
            </div>
          )}
          {r.zero && <Zero r={r} qs={toQuery(pc)} back={here} viewer={viewer} watchable={watchable} />}

          {hero.tips.length > 0 && (
            <div style={{ marginTop: 44 }}>
              <div className="sec-head sec-head--left">
                <h2 className="sec-t" style={{ fontSize: 26 }}>{hero.tipsHeading ?? hero.category.name}</h2>
                {hero.tipsSubheading && <p className="sec-d" style={{ marginLeft: 0 }}>{hero.tipsSubheading}</p>}
              </div>
              <div className="feats">
                {hero.tips.map((t, i) => (
                  <div key={t.id} className="feat">
                    <span className="feat-i"><TipIcon index={i} /></span>
                    <div className="feat-t">{t.title}</div>
                    <p className="feat-d">{t.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
