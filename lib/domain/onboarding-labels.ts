// Labels and option lists of the partner sign-up wizard (SPEC §15, onboarding/*.html).
// Pure data: shared by the server read models and the client step forms.
import type { ExperienceBand, LegalForm, ReschedulePolicy } from '@/db/schema/enums';


export const STEP_TITLES = ['Бизнес информация', 'Профил и галерия', 'Пакети и услуги', 'Наличност', 'Политика за анулиране', 'Преглед и подаване'] as const;
/** Sidebar meta while a step is not done (the prototype's defaults). */
export const STEP_HINTS = [
  'Име, категория, локация', 'Представяне и снимки', 'Какво предлагате и на каква цена', 'Колко резервации на ден',
  'Гъвкава, умерена или строга', 'За одобрение от екипа',
] as const;

export const LEGAL_FORMS: [LegalForm, string][] = [
  ['freelancer', 'Свободна професия'], ['sole_trader', 'ЕТ'], ['eood', 'ЕООД'], ['ood', 'ООД'], ['other', 'Друго'],
];
export const RADIUS_CHOICES: [string, string][] = [['50', 'до 50 км'], ['100', 'до 100 км'], ['150', 'до 150 км'], ['nationwide', 'В цялата страна']];
export const EXPERIENCE: [ExperienceBand, string][] = [
  ['lt_1', 'До 1 година'], ['y1_3', '1 – 3 години'], ['y3_5', '3 – 5 години'], ['y5_10', '5 – 10 години'], ['gt_10', 'Над 10 години'],
];
export const LEAD_TIMES: [number, string][] = [[0, 'Същия ден'], [1, '1 ден'], [3, '3 дни'], [7, '7 дни'], [14, '14 дни'], [30, '30 дни']];
export const HORIZONS: [number, string][] = [[3, '3 месеца'], [6, '6 месеца'], [12, '12 месеца'], [24, '24 месеца']];
export const DEPOSITS = [20, 30, 40, 50] as const;
export const RESCHEDULE: [ReschedulePolicy, string][] = [
  ['free_if_available', 'Безплатно, ако има свободна дата'], ['one_free', 'Една безплатна промяна'], ['not_allowed', 'Не се допуска'],
];
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'] as const;
/** Skill chips (SPEC §15 Specialisations; ‹Детски рождени дни› has no event type, so it is a tag). */
export const STANDARD_TAGS = [
  'Озвучаване', 'Диско осветление', 'Годежи', 'Моминско парти', 'Ергенско парти', 'Парти изненада', 'Кръщенета', 'Детски рождени дни', 'Тематични партита',
] as const;

const label = <K extends string | number>(list: [K, string][], k: K | null | undefined) => list.find(([v]) => v === k)?.[1] ?? '';
export const legalFormLabel = (k: LegalForm | null) => label(LEGAL_FORMS, k);
export const experienceLabel = (k: ExperienceBand | null) => label(EXPERIENCE, k);
export const leadTimeLabel = (n: number) => label(LEAD_TIMES, n);
export const horizonLabel = (n: number) => label(HORIZONS, n);
export const rescheduleLabel = (k: ReschedulePolicy) => label(RESCHEDULE, k);
export const radiusValue = (p: { servesNationwide: boolean; serviceRadiusKm: number | null }) =>
  p.servesNationwide ? 'nationwide' : p.serviceRadiusKm != null ? String(p.serviceRadiusKm) : '';
export function radiusLabel(p: { servesNationwide: boolean; serviceRadiusKm: number | null }): string {
  if (p.servesNationwide) return 'В цялата страна';
  return p.serviceRadiusKm != null ? `до ${p.serviceRadiusKm} км` : '';
}
/** 'Мартин Стоянов' → 'Мартин'. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

