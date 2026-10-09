// /kategorii?grad= (client/categories.html, SCREENS §2, SPEC §13.10): the directory with, per
// selected city, the partners serving weddings there and the lowest from-price; then the event
// types.
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { Menu } from '@/components/ui/client';
import { categoryCards } from '@/lib/domain/search';
import { CategoryIcon, EventTypeIcon } from '../_components/icons';
import { toSearch } from '../_components/text';
import { viewerFor } from '../_components/viewer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Категории' };

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = toSearch(await searchParams);
  const grad = sp.get('grad');
  const { clientId } = await viewerFor('/kategorii');
  const d = await categoryCards({ grad }, { clientId });

  return (
    <>
      <SiteHeader active="/kategorii" />
      <main className="wrap" id="main">
        <div className="hold">
          <section>
            <div className="h-row">
              <div>
                <h1 className="h-page">Категории услуги</h1>
                <p className="h-sub">Всичко, което можете да резервирате през EventAT. Броят партньори е за сватба в избрания град.</p>
              </div>
              <div className="h-right">
                <Menu label="Град" align="down" items={d.cities.map(c => ({ label: c.name, href: c.href }))}
                  trigger={
                    <span className="filter-btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M12 21s-7-5.2-7-11a7 7 0 1114 0c0 5.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
                      {d.city.label}
                      <svg className="proto-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                    </span>
                  } />
              </div>
            </div>

            <div className="feats">
              {d.cards.map(c => (
                <Link key={c.slug} className="feat feat--link" href={c.href}>
                  <span className="feat-i"><CategoryIcon slug={c.icon} /></span>
                  <span className="feat-t">{c.name}</span>
                  {c.shortDescription && <span className="feat-d">{c.shortDescription}</span>}
                  <span className="feat-foot">
                    <span className="feat-free">{c.countLabel}</span>
                    {c.priceLabel && <span className="feat-from">{c.priceLabel}</span>}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <div style={{ marginTop: 40 }}>
            <div className="sec-head sec-head--left">
              <h2 className="sec-t" style={{ fontSize: 26 }}>Най-търсени по тип събитие</h2>
              <p className="sec-d" style={{ marginLeft: 0 }}>Отворете типа събитие и ще видите кои услуги се заемат първи, кои се добавят по-късно и кои обикновено се пропускат.</p>
            </div>
            <div className="feats pub-feats-4">
              {d.eventTypes.map(t => (
                <Link key={t.slug} className="feat feat--link" href={t.href}>
                  <span className="feat-i"><EventTypeIcon slug={t.slug} /></span>
                  <span className="feat-t">{t.name}</span>
                  {t.shortDescription && <span className="feat-d">{t.shortDescription}</span>}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
