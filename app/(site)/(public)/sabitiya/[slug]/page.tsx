// /sabitiya/[slug] (client/event-type.html, SCREENS §2, SPEC §13.10): the type pills, the hero
// (with the client's event facts), the bar, the three planning tiers with partners free on the
// date in the city, the client's ‹Вече уредено› / ‹Още липсва› panels and the call to action.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { parseSearchParams } from '@/lib/domain/search';
import { eventTypeView, searchChoices, publicTitle } from '@/lib/domain/views-public';
import { SearchBar, type BarMenu } from '../../_components/SearchBar';
import { barMenus, eventTypeHref } from '../../_components/bar';
import { CalendarSm, CategoryIcon, Guests, Pin } from '../../_components/icons';
import { Num, RichText, toSearch } from '../../_components/text';
import { viewerFor } from '../../_components/viewer';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const TIER_TITLE = { required: 'Задължително', common: 'Често добавяно', extra: 'Не сте се сетили за това' } as const;
const TIER_COLS = { required: 4, common: 5, extra: 4 } as const;
const BADGE: Record<string, string> = { 'Потвърдена': 'badge--success', 'Чака плащане': 'badge--warning', 'Чака отговор': 'badge--primary', 'Нова оферта': 'badge--pink' };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: (await publicTitle('eventType', decodeURIComponent(slug))) ?? 'Тип събитие' };
}

export default async function EventTypePage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).slug);
  const sp = toSearch(await searchParams);
  const { viewer, clientId } = await viewerFor(`/sabitiya/${slug}${sp.toString() ? `?${sp}` : ''}`);
  const [v, choices] = await Promise.all([
    eventTypeView(slug, { grad: sp.get('grad'), data: sp.get('data'), gosti: sp.get('gosti'), sabitieId: sp.get('sabitie-id') }, { clientId }),
    searchChoices(clientId),
  ]);
  if (!v) notFound();

  // The bar shows what the page uses: the chosen values, else the client's event.
  const p = parseSearchParams({ grad: v.city ? [v.city.slug] : [], data: v.date ?? undefined, gosti: v.guests ?? undefined, 'sabitie-id': v.event?.id ?? undefined });
  const href = eventTypeHref(slug, !!v.event);
  const keep = new URLSearchParams();
  if (v.city) keep.set('grad', v.city.slug);
  if (v.date) keep.set('data', v.date);
  if (v.guests) keep.set('gosti', v.guests);
  const typeMenu: BarMenu = {
    label: 'Тип събитие', value: v.type.name, empty: false,
    options: v.types.map(t => ({ label: t.name, href: `/sabitiya/${t.slug}${keep.toString() ? `?${keep}` : ''}`, on: t.slug === slug })),
  };
  const tiers = (['required', 'common', 'extra'] as const).map(t => ({ tier: t, cards: v.tiers.filter(c => c.tier === t), text: v.tierText[t] }));
  const brief = viewer.kind === 'guest' ? viewer.register(v.briefHref) : v.briefHref;

  return (
    <>
      <SiteHeader active="/kategorii" />
      <main className="wrap" id="main">
        <div className="hold">
          <div className="results-head pub-types" style={{ marginBottom: 24 }}>
            <span className="results-n" style={{ marginRight: 16 }}>Тип събитие</span>
            <div className="cat-pills" style={{ marginTop: 0 }}>
              {v.types.map(t => <Link key={t.slug} className={`cat-pill${t.slug === slug ? ' is-on' : ''}`} href={`/sabitiya/${t.slug}`} aria-current={t.slug === slug ? 'page' : undefined}>{t.name}</Link>)}
            </div>
          </div>

          <div className="cat-hero">
            <div>
              {v.event && <div className="hero-eyebrow">Вашето събитие</div>}
              <h1 className="hero-t" style={{ fontSize: 40 }}><Num>{`${v.type.name} · всичко необходимо`}</Num></h1>
              {v.event && (
                <div className="nx-line" style={{ marginTop: 14 }}>
                  <span><CalendarSm />{v.event.dateLine}</span>
                  {v.event.guestsLine && <span><Guests />{v.event.guestsLine}</span>}
                  {v.event.venueLine && <span><Pin />{v.event.venueLine}</span>}
                </div>
              )}
              {v.type.introText && <p className="hero-d" style={{ margin: '16px 0 0', maxWidth: 540 }}>{v.type.introText}</p>}
            </div>
            <div className="cat-shot" style={v.heroPhoto ? { backgroundImage: `url('${v.heroPhoto}')` } : undefined} />
          </div>

          <SearchBar key={`${slug}?${keep}`} type={typeMenu} menus={barMenus(p, choices, href, `/sabitiya/${slug}`)} submit={{ href: v.catalogHref }} />

          <div className="results-head">
            <span className="results-n"><RichText value={v.countLine} /></span>
          </div>

          {tiers.filter(t => t.cards.length).map((t, i) => (
            <div key={t.tier} style={i ? { marginTop: 40 } : undefined}>
              <div className="sec-head sec-head--left">
                <h2 className="sec-t" style={{ fontSize: 26 }}>{TIER_TITLE[t.tier]}</h2>
                {t.text && <p className="sec-d" style={{ marginLeft: 0 }}>{t.text}</p>}
              </div>
              <div className={`feats pub-feats-${TIER_COLS[t.tier]}`}>
                {t.cards.map(c => (
                  <Link key={c.categoryId} className={`feat feat--link${c.photoUrl ? ' feat--img' : ''}`} href={c.href}>
                    {c.photoUrl
                      ? <span className="feat-img" style={{ backgroundImage: `url('${c.photoUrl}')` }} />
                      : <span className="feat-i"><CategoryIcon slug={c.icon} /></span>}
                    <span className="feat-t">{c.label}</span>
                    {c.description && <span className="feat-d">{c.description}</span>}
                    {(c.count > 0 || t.tier !== 'extra') && (
                      <span className="feat-foot">
                        <span className="feat-free">{c.countLabel}</span>
                        {c.priceLabel && <span className="feat-from">{c.priceLabel}</span>}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {v.panels && (v.panels.arranged.length > 0 || v.panels.missing.length > 0) && (
            <div className="et-two" style={{ marginTop: 40 }}>
              {v.panels.arranged.length > 0 && <section className="dcard">
                <div className="dcard-head">
                  <h2 className="dcard-title">Вече уредено</h2>
                  <Link className="btn btn--outline btn--sm" href="/akaunt/sabitiya" style={{ marginLeft: 'auto' }}>Моите събития</Link>
                </div>
                {v.panels.arranged.map((x, i) => (
                  <Link key={i} className="set-row" href={x.eventHref}>
                    <div className="set-t">
                      <div className="set-n">{x.partnerName}</div>
                      <div className="set-d">{[x.categoryName, x.serviceTitle].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className={`badge ${BADGE[x.badge] ?? 'badge--primary'} badge--dot`}>{x.badge}</span>
                  </Link>
                ))}
              </section>}
              {v.panels.missing.length > 0 && <section className="dcard">
                <div className="dcard-head">
                  <h2 className="dcard-title">Още липсва</h2>
                  <Link className="btn btn--outline btn--sm" href="/akaunt/sabitiya" style={{ marginLeft: 'auto' }}>Моите събития</Link>
                </div>
                {v.panels.missing.map(m => (
                  <div key={m.categorySlug} className="set-row">
                    <div className="set-t">
                      <div className="set-n">{m.label}</div>
                      <div className="set-d">{m.line.slice(0, m.line.lastIndexOf(' · ') + 3)}<span className="pub-nw">{m.line.slice(m.line.lastIndexOf(' · ') + 3)}</span></div>
                    </div>
                    <Link className="btn btn--outline btn--sm" href={m.href}>Виж изпълнители</Link>
                  </div>
                ))}
              </section>}
            </div>
          )}

          <div className="cta" style={{ marginTop: 40 }}>
            <div>
              <div className="cta-t"><Num>{v.ctaTitle}</Num></div>
              {v.ctaText && <p className="cta-d">{v.ctaText}</p>}
            </div>
            <div className="cta-act">
              <Link className="btn btn--lg btn--onDark" href={v.catalogHref}>Отвори каталога</Link>
              {viewer.kind !== 'other' && <Link className="btn btn--lg btn--onDarkGhost" href={brief}>Опиши заявка</Link>}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
