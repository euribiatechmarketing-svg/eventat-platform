// Builds the search bar's dropdown cells on the server: every option is the URL of the view
// it leads to (SPEC §13.1), so the bar works as plain links.
import { date as fmtDate } from '@/lib/format';
import { GUEST_BANDS, searchHref, toQuery, type SearchParams } from '@/lib/domain/search';
import type { BarMenu } from './SearchBar';

type Choices = { cities: { slug: string; name: string }[]; eventDates: { value: string; label: string }[]; today: string };

export function guestsLabel(g: string | null): string | null {
  if (!g) return null;
  return g in GUEST_BANDS ? GUEST_BANDS[g as keyof typeof GUEST_BANDS].label : g;
}

/**
 * ‹Локация› · ‹Дата› · ‹Гости›. `href` turns a changed parameter set into the page's URL.
 * `greyNeutral`: neutral values (‹Всички градове›, ‹Всяка дата›, ‹Без значение›) in the hint
 * colour, as on the category and event-type pages (search.html prints them plain).
 */
export function barMenus(p: SearchParams, choices: Choices, href: (next: SearchParams) => string, basePath: string, greyNeutral = true): BarMenu[] {
  const cityNames = p.grad.map(s => choices.cities.find(c => c.slug === s)?.name).filter(Boolean) as string[];
  const gl = guestsLabel(p.gosti);
  const dateBase = href({ ...p, data: null, drugaData: false });
  const [path, qs = ''] = dateBase.split('?');
  return [
    {
      label: 'Локация', value: cityNames.length ? cityNames.join(', ') : 'Всички градове', empty: greyNeutral && !cityNames.length,
      options: [
        { label: 'Всички градове', href: href({ ...p, grad: [] }), on: !p.grad.length },
        ...choices.cities.map(c => ({ label: c.name, href: href({ ...p, grad: [c.slug] }), on: p.grad.length === 1 && p.grad[0] === c.slug })),
      ],
    },
    {
      label: 'Дата', value: p.data ? fmtDate(p.data) : 'Всяка дата', empty: greyNeutral && !p.data,
      options: [
        { label: 'Всяка дата', href: href({ ...p, data: null, drugaData: false }), on: !p.data },
        ...choices.eventDates.map(d => ({ label: d.label, href: href({ ...p, data: d.value }), on: p.data === d.value })),
      ],
      date: { min: choices.today, value: p.data, basePath: path || basePath, baseQuery: qs },
    },
    {
      label: 'Гости', value: gl ?? 'Без значение', empty: greyNeutral && !gl,
      options: [
        { label: 'Без значение', href: href({ ...p, gosti: null }), on: !p.gosti },
        ...Object.entries(GUEST_BANDS).map(([k, b]) => ({ label: b.label, href: href({ ...p, gosti: k }), on: p.gosti === k })),
      ],
    },
  ];
}

/** Search-style pages: `/tarsene`, or the category page for its own category. */
export const searchPageHref = (basePath: string) => (next: SearchParams) => searchHref(next, basePath);

/**
 * `/sabitiya/[slug]`: the planner keeps only city, date, guests and the client's event. When the
 * client's event fills in the defaults, a cleared choice is written as an empty value (`grad=`)
 * so the event does not fill it back in.
 */
export const eventTypeHref = (slug: string, eventDefaults: boolean) => (next: SearchParams) => {
  const u = new URLSearchParams(toQuery({ grad: next.grad, data: next.data, gosti: next.gosti, sabitieId: next.sabitieId }));
  if (eventDefaults) {
    if (!next.grad.length) u.set('grad', '');
    if (!next.data) u.set('data', '');
    if (!next.gosti) u.set('gosti', '');
  }
  const qs = u.toString();
  return `/sabitiya/${slug}${qs ? `?${qs}` : ''}`;
};

/** The query string of a parameter set without the query field's own parameters (q, kategoriya, vid). */
export const withoutQuery = (p: SearchParams) => toQuery({ ...p, q: '', kategoriya: null, vid: null });
