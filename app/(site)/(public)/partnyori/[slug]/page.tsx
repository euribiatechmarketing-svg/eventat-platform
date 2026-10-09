// /partnyori/[slug] (client/vendor.html, SCREENS §2, SPEC §13.10): breadcrumbs, the gallery,
// the head with rating and responsiveness, ‹За нас› with specialisations, the packages with
// ‹Избери›, reviews, and the booking box. `?preview=1` lets the owner or the team see a profile
// before it is public.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { actorFromUser } from '@/lib/domain/actor';
import { searchChoices, partnerView, widgetAvailability, publicTitle } from '@/lib/domain/views-public';
import { isDate } from '@/lib/domain/availability';
import { monthName } from '@/lib/format';
import { CrumbChevron, Stars } from '../../_components/icons';
import { Num, toSearch } from '../../_components/text';
import { viewerFor } from '../../_components/viewer';
import { Widget } from './Widget';

export const dynamic = 'force-dynamic';

/** ‹Петя и Николай› → ‹ПН›: the joining ‹и› is not a name. */
const initialsOf = (name: string) => name.split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => w[0]!.toLocaleUpperCase('bg')).join('');

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: (await publicTitle('partner', decodeURIComponent(slug))) ?? 'Изпълнител' };
}

export default async function PartnerPage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).slug);
  const sp = toSearch(await searchParams);
  const path = `/partnyori/${encodeURIComponent(slug)}`;
  const { user, viewer, clientId } = await viewerFor(sp.toString() ? `${path}?${sp}` : path);
  const actor = user ? await actorFromUser(user) : null;
  const preview = sp.get('preview') === '1';
  const choices = await searchChoices(null);
  // A date from the link counts only from today on (an old shared link opens on no date).
  const urlDate = sp.get('data');
  const askedDate = isDate(urlDate) && urlDate >= choices.today ? urlDate : null;
  const v = await partnerView(slug, { preview, data: askedDate, sabitieId: sp.get('sabitie-id'), reviewPages: Number(sp.get('revyuta')) || 1 }, actor);
  if (!v) notFound();
  const p = v.partner;
  const w = v.widget;
  const initialDate = w?.date ?? askedDate;
  const avail = initialDate && !p.preview ? await widgetAvailability(p.id, initialDate, clientId) : null;
  const canRequest = p.acceptingRequests && !p.preview && viewer.kind !== 'other';
  const mode = !canRequest ? 'none' : viewer.kind === 'guest' ? 'guest' : 'client';
  const choose = (serviceId: string) => {
    const q = new URLSearchParams({ paket: serviceId });
    if (w?.eventId) q.set('sabitie-id', w.eventId);
    const href = `/zayavka/${encodeURIComponent(p.slug)}?${q.toString()}`;
    return viewer.kind === 'guest' ? viewer.register(href) : href;
  };
  const location = p.location.replace(' · до ', ' · работи до ');
  // ‹Тип събитие› offers the types this partner serves (its specialisations), else every public type.
  const served = new Set(v.eventTypes.map(t => t.href.replace('/sabitiya/', '')));
  const widgetTypes = choices.types.some(t => served.has(t.slug)) ? choices.types.filter(t => served.has(t.slug)) : choices.types;
  const widgetType = w?.typeSlug && widgetTypes.some(t => t.slug === w.typeSlug) ? w.typeSlug : null;
  const photos = v.photos.filter(ph => ph.url);
  const more = new URLSearchParams(sp);
  more.set('revyuta', String(v.reviewPages + 1));
  const moreReviews = `${path}?${more.toString()}#revyuta`;

  return (
    <>
      <SiteHeader active="/kategorii" />
      <main className="wrap" id="main">
        <div className="hold">
          <div className="crumbs">
            <Link href="/tarsene?q=">Каталог</Link><CrumbChevron />
            {p.categorySlug && <><Link href={`/kategorii/${p.categorySlug}`}>{p.categoryName}</Link><CrumbChevron /></>}
            <span>{p.name}</span>
          </div>

          {photos.length > 0 && (
            <div className={`pv-gal pv-gal--n${photos.length}`}>
              {photos.map(ph => <span key={ph.id} style={{ backgroundImage: `url('${ph.url}')` }} />)}
            </div>
          )}

          <div className="pv-grid">
            <div>
              <div className="pv-head">
                <div>
                  <div className="v-cat">{p.categoryName}</div>
                  <h1 className="pv-name"><Num>{p.name}</Num></h1>
                  <div className="pv-meta">
                    {v.rating && (
                      <>
                        <Stars className="v-stars" n={Math.round(v.rating.avg)} />
                        <span><b style={{ color: 'var(--primary-900)', fontVariantNumeric: 'lining-nums' }}>{v.rating.avgText}</b> · {v.rating.countLabel}</span>
                        <span className="pub-meta-sep">·</span>
                      </>
                    )}
                    <span>{location}</span>
                    {v.respondsWithin24 && <span className="badge badge--success badge--dot">Отговаря до 24 ч</span>}
                  </div>
                </div>
              </div>

              {(p.description || p.shortDescription || v.specialisations.length > 0 || v.skills.length > 0) && (
                <div className="pv-sec">
                  <h2 className="pv-sec-t">За нас</h2>
                  {(p.description || p.shortDescription) && <p className="pv-text">{p.description ?? p.shortDescription}</p>}
                  {(v.specialisations.length > 0 || v.skills.length > 0) && (
                    <div className="chips" style={{ marginTop: 16 }}>
                      {v.specialisations.map(s => <Link key={s.href} className="chip-tag" href={s.href}>{s.label}</Link>)}
                      {v.skills.map(s => <Link key={s.href} className="chip-tag" href={s.href}>{s.label}</Link>)}
                    </div>
                  )}
                </div>
              )}

              {v.services.length > 0 && (
                <div className="pv-sec">
                  <h2 className="pv-sec-t">Пакети и услуги</h2>
                  {v.services.map(s => (
                    <div key={s.id} className="pk">
                      <div><div className="pk-n">{s.name}</div>{s.description && <div className="pk-d">{s.description}</div>}</div>
                      <div className="pk-p">
                        <b>{s.price ? s.price.text : 'По запитване'}</b>
                        <span>{s.price ? (s.price.unitLabel === 'на гост' ? 'на гост' : 'фиксирана цена') : `отговор до ${v.responseHours} ч`}</span>
                      </div>
                      {canRequest && s.acceptingRequests && <Link className="btn btn--outline btn--sm" href={choose(s.id)}>Избери</Link>}
                    </div>
                  ))}
                </div>
              )}

              {v.reviews.items.length > 0 && (
                <div className="pv-sec" id="revyuta">
                  <h2 className="pv-sec-t">Ревюта</h2>
                  <div className="dcard">
                    {v.reviews.items.map((r, i) => {
                      const [y, m] = r.eventDate.split('-').map(Number);
                      return (
                        <div key={r.id} className="rev" style={i === 0 ? { paddingTop: 0 } : undefined}>
                          <div className="rev-head">
                            <span className="avatar">{initialsOf(r.author)}</span>
                            <div><div className="rev-name">{r.author}</div><div className="rev-meta">{r.eventType} · {monthName(m)} {y}</div></div>
                            <Stars className="rev-stars" n={r.rating} />
                          </div>
                          <p className="rev-text">{r.body}</p>
                          {r.reply && (
                            <div className="rev-reply">
                              <div className="rev-reply-h">{p.name}</div>
                              <div className="rev-reply-t">{r.reply}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {v.reviews.hasMore && (
                    <div className="pub-more">
                      <Link className="btn btn--outline btn--sm" href={moreReviews} scroll={false}>Покажи още</Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            <aside>
              <Widget
                partnerId={p.id} slug={p.slug} fromPrice={p.fromPrice ? { text: p.fromPrice.text, unitLabel: p.fromPrice.unitLabel } : null}
                types={widgetTypes}
                events={(w?.events ?? []).map(e => ({ id: e.id, date: e.date, guests: e.guests, typeSlug: e.typeSlug }))}
                services={v.services.filter(s => s.acceptingRequests).map(s => ({ id: s.id, label: `${s.name} · ${s.price ? (s.price.unitLabel === 'на гост' ? `${s.price.text} на гост` : s.price.text) : 'По запитване'}` }))}
                initial={{ date: initialDate, typeSlug: widgetType, guests: w?.guests ?? null, serviceId: w?.serviceId ?? null, eventId: w?.eventId ?? null, busy: !!avail?.busy, own: avail?.own ?? null }}
                today={choices.today} mode={mode} signIn={viewer.signIn} responseHours={v.responseHours} policyLine={v.policyLine} />
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
