// /tarsene (client/search.html + client/catalog.html, SCREENS §2, SPEC §13): the search bar,
// the default state, the facets with live counts, chips, the results sentence, sorting, the
// cards (busy ones with ‹Уведоми ме›), the CTA block and the zero state. Everything is a GET
// parameter, so a view is a shareable URL.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { parseSearchParams, search, searchHref, toQuery } from '@/lib/domain/search';
import { ownOnDate } from '@/lib/domain/saved';
import { searchChoices, zeroWatchable } from '@/lib/domain/views-public';
import { SearchBar } from '../_components/SearchBar';
import { barMenus, searchPageHref, withoutQuery } from '../_components/bar';
import { Chips, Cta, Facets, Sort, VCard, Zero } from '../_components/Results';
import { SearchIcon } from '../_components/icons';
import { Num, RichText, hereUrl, toSearch } from '../_components/text';
import { viewerFor } from '../_components/viewer';
import { saveSearchAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Търсене' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const sp = toSearch(await searchParams);
  const p = parseSearchParams(sp);
  const here = hereUrl('/tarsene', sp);
  const { viewer, clientId } = await viewerFor(here);
  const choices = await searchChoices(clientId);
  // A date that has passed (an old link or saved search) is dropped: nothing can be booked on it.
  if (p.data && p.data < choices.today) redirect(searchHref({ ...p, data: null, drugaData: false }, '/tarsene'));
  const r = await search(p, { clientId, basePath: '/tarsene' });
  // A busy card that is the client's own booking offers no ‹Уведоми ме›.
  const own = clientId && p.data ? await ownOnDate(clientId, r.cards.filter(c => c.busy).map(c => c.partnerId), p.data) : new Map<string, { holdsDate: boolean }>();
  const watchable = clientId && r.zero?.dateCaused ? await zeroWatchable(p, clientId) : true;
  const href = searchPageHref('/tarsene');
  const canonical = toQuery(p);
  const brief = r.cta?.briefHref ?? r.zero?.buttons.find(b => b.kind === 'brief')?.href ?? '/zayavka/otvorena';
  const catName = p.kategoriya ? choices.categories.find(c => c.slug === p.kategoriya)?.name ?? null : null;
  const picked = !p.q && p.kategoriya && catName ? { slug: p.kategoriya, name: catName } : null;

  return (
    <>
      <SiteHeader active="/tarsene" />
      <main className="wrap" id="main">
        <div className="hold">
          <div className="h-row">
            <div>
              <h1 className="h-page"><Num>{r.h1}</Num></h1>
              {r.blank
                ? <p className="h-sub">Потърсете по дума, категория или тип събитие</p>
                : <p className="h-sub h-sub--ctx">{r.contextLine}</p>}
            </div>
          </div>

          <SearchBar key={canonical} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}
            query={{
              label: 'Търсене', placeholder: 'Търсете по име, услуга или категория', icon: true,
              text: picked ? picked.name : p.q, picked,
              baseQuery: picked ? withoutQuery(p) : toQuery({ ...p, q: '' }), vid: p.vid,
              submitPath: '/tarsene', date: p.data,
              briefHref: viewer.kind === 'guest' ? viewer.register(brief) : brief, record: viewer.kind === 'client',
            }}
            menus={barMenus(p, choices, href, '/tarsene', false)}
            submit={{ toast: r.blank ? 'Показваме намерените изпълнители' : null, again: r.blank ? null : 'Показваме намерените изпълнители' }} />

          {r.blank && r.defaultState ? (
            <div className="search-default">
              <div className="empty">
                <span className="empty-icon"><SearchIcon style={{ width: 22, height: 22 }} /></span>
                <h2 className="empty-title t-h3">Търсете, за да видите резултати</h2>
                <p className="empty-text">Може да търсите по име на изпълнител, по услуга или по категория.</p>
              </div>
              <div style={{ maxWidth: 1040, margin: '0 auto' }}>
                {r.defaultState.eventPills.length > 0 && (
                  <>
                    <div className="results-head" style={{ justifyContent: 'center', marginBottom: 10 }}>
                      <span className="results-n">Търсене за вашето събитие</span>
                    </div>
                    <div className="cat-pills" style={{ marginTop: 0, justifyContent: 'center', marginBottom: 26 }}>
                      {r.defaultState.eventPills.map(e => <Link key={e.href} className="cat-pill cat-pill--event" href={e.href}>{e.label}</Link>)}
                    </div>
                  </>
                )}
                <div className="results-head" style={{ justifyContent: 'center', margin: r.defaultState.eventPills.length ? '30px 0 10px' : '0 0 10px' }}>
                  <span className="results-n">По тип събитие</span>
                </div>
                <div className="cat-pills" style={{ marginTop: 0, justifyContent: 'center' }}>
                  {r.defaultState.typePills.map(t => <Link key={t.href} className="cat-pill" href={t.href}>{t.label}</Link>)}
                </div>
              </div>
            </div>
          ) : (
            <div className="search-results">
              <div className="cat-grid">
                <Facets r={r} basePath="/tarsene" baseQuery={canonical} />
                <div className="pub-results">
                  <div className="results-head">
                    <span className="results-n"><RichText value={r.countLine} /></span>
                    <Sort r={r} />
                  </div>
                  {(r.sentence || viewer.kind !== 'other') && (
                    <div className="results-head pub-say">
                      {r.sentence && <span className="results-n results-say"><RichText value={r.sentence} /></span>}
                      {viewer.kind === 'guest' && <Link className="btn btn--outline btn--sm pub-save" href={viewer.signIn}>Запази търсенето</Link>}
                      {viewer.kind === 'client' && (
                        <form action={saveSearchAction} className="pub-save">
                          <input type="hidden" name="qs" value={canonical} />
                          <input type="hidden" name="back" value={here} />
                          <button type="submit" className="btn btn--outline btn--sm">Запази търсенето</button>
                        </form>
                      )}
                    </div>
                  )}
                  <Chips chips={r.chips} clearHref={r.clearHref} />
                  {r.cards.length > 0 && (
                    <div className="v-grid">
                      {r.cards.map(c => <VCard key={c.partnerId} c={c} date={p.data} sabitieId={p.sabitieId} viewer={viewer} ownBooking={!!own.get(c.partnerId)?.holdsDate} />)}
                    </div>
                  )}
                  {r.zero && <Zero r={r} qs={canonical} back={here} viewer={viewer} watchable={watchable} />}
                  {/* The open-request invitation is for clients and guests; a partner or the team has nothing to send. */}
                  {r.cta && viewer.kind !== 'other' && <Cta r={r} viewer={viewer} />}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
