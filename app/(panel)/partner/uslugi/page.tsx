// vendor/services.html → /partner/uslugi?tab=&kategoriya= (SCREENS §7)
import '@/styles/m-partner-catalogue.css';
import { partnerActor } from '../_catalogue/server';
import { SERVICES_TAB_PARAM, servicesPage, type ServicesTab } from '@/lib/domain/views-partner-catalogue';
import { ServicesBoard } from './ServicesBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Услуги и пакети' };

const TAB_PARAM: Record<ServicesTab, string> = { active: 'aktivni', draft: 'chernovi', archived: 'arhiv', review: 'v-pregled' };

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; kategoriya?: string }> }) {
  const sp = await searchParams;
  const actor = await partnerActor('/partner/uslugi');
  const tab = SERVICES_TAB_PARAM[sp.tab ?? ''] ?? 'active';
  const v = await servicesPage(actor, { tab, categorySlug: sp.kategoriya ?? null });

  const sub = [
    v.counts.active === 1 ? '1 активна услуга' : `${v.counts.active} активни услуги`,
    v.counts.review ? `${v.counts.review} в преглед` : null,
    v.counts.draft ? (v.counts.draft === 1 ? '1 чернова' : `${v.counts.draft} чернови`) : null,
    v.lastChange ? `последна промяна ${v.lastChange}` : null,
  ].filter((x): x is string => !!x);

  const href = (t: ServicesTab, cat: string | null) => {
    const q = new URLSearchParams();
    if (t !== 'active') q.set('tab', TAB_PARAM[t]);
    if (cat) q.set('kategoriya', cat);
    const s = q.toString();
    return `/partner/uslugi${s ? `?${s}` : ''}`;
  };
  const tabs = ([['active', 'Активни'], ['draft', 'Чернови'], ['archived', 'Архив'], ['review', 'В преглед']] as const)
    .filter(([t]) => t !== 'review' || v.counts.review > 0 || tab === 'review')
    .map(([t, label]) => ({ key: t, label, count: v.counts[t], href: href(t, v.category?.slug ?? null), active: t === tab }));
  const categories = [
    { label: 'Всички категории', href: href(tab, null), active: !v.category },
    ...v.categories.map(c => ({ label: c.name, href: href(tab, c.slug), active: v.category?.id === c.id })),
  ];

  // keyed by the view: another tab or category starts outside ‹Подреди› with that view's cards
  return (
    <div className="pc-page">
      <ServicesBoard key={`${tab}:${v.category?.slug ?? ''}`} sub={sub} tabs={tabs} categories={categories} categoryLabel={v.category?.name ?? 'Категория'}
        items={v.items} order={v.order} slug={v.slug} />
    </div>
  );
}
