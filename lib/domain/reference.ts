// Reference data every module relies on (DATA-MODEL §3 S1–S2, SPEC §2, §15):
// cities, categories (+ catering subtypes and tips), event types, the
// /sabitiya/svatba planning tiers, Bulgarian public holidays and the default
// of every platform setting.
//
// ensureReferenceData() is idempotent and safe for production: it only
// inserts what is missing (matched by slug / natural key) and never updates
// or deletes, so admin edits (hidden categories, changed settings) survive.
// Demo records (partners, bookings…) belong to scripts/seed.ts, not here.
import { inArray, sql } from 'drizzle-orm';
import type { Queryable } from '@/db';
import {
  category, categorySubtype, categoryTip, city, eventType, eventTypeService, platformSettings, publicHoliday,
  type PriceUnit, type ServiceTier,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, sofiaInstant, sofiaParts, type DateStr } from '@/lib/format';
import { SETTING_KEYS, settingDefaults } from './settings';

// ── Data ─────────────────────────────────────────────────────────────────

export const CITIES = [
  { slug: 'sofia', name: 'София', preposition: 'в', lat: 42.69751, lng: 23.32415, sortOrder: 1 },
  { slug: 'plovdiv', name: 'Пловдив', preposition: 'в', lat: 42.13585, lng: 24.74529, sortOrder: 2 },
  { slug: 'varna', name: 'Варна', preposition: 'във', lat: 43.20467, lng: 27.91054, sortOrder: 3 },
  { slug: 'burgas', name: 'Бургас', preposition: 'в', lat: 42.50606, lng: 27.46781, sortOrder: 4 },
] as const;

type CategorySeed = {
  slug: string; name: string; unit: PriceUnit; shortDescription?: string; visible: boolean;
  pluralNoun?: string; heroPhotoUrl?: string; tipsHeading?: string;
};

/** The 9 directory categories (order of /kategorii), then the hidden ones (D16). Icon key = slug. */
export const CATEGORIES: CategorySeed[] = [
  { slug: 'zali-i-lokatsii', name: 'Зали и локации', unit: 'per_event', visible: true,
    shortDescription: 'Мястото решава всичко останало — колко гости влизат, от колко часа е достъпът и има ли план за дъжд.' },
  { slug: 'ketaring', name: 'Кетъринг', unit: 'per_guest', visible: true,
    shortDescription: 'Меню, сервиз и персонал за масите. Повечето фирми канят на дегустация, преди да подпишете.',
    pluralNoun: 'кетъринг фирми', heroPhotoUrl: 'photos/thumbs/v1-caterer-warm.jpg', tipsHeading: 'Какво да питате кетъринга' },
  { slug: 'dj-i-ozvuchavane', name: 'DJ и озвучаване', unit: 'per_event', visible: true,
    shortDescription: 'Музиката за купона и микрофоните за речите. Техниката идва и се прибира с екипа.' },
  { slug: 'fotografiya', name: 'Фотография', unit: 'per_event', visible: true,
    shortDescription: 'Единственото, което остава след деня. Цял ден или само церемонията.' },
  { slug: 'videozasnemane', name: 'Видеозаснемане', unit: 'per_event', visible: true,
    shortDescription: 'Кратък филм от деня, с гласовете и музиката. Поръчва се отделно от фотографа.' },
  { slug: 'dekoratsiya', name: 'Декорация', unit: 'per_event', visible: true,
    shortDescription: 'Арка, цветя за масите и букет в един стил.' },
  { slug: 'fotokabini', name: 'Фотокабини', unit: 'per_event', visible: true,
    shortDescription: 'Гостите се снимат сами и си взимат снимката на хартия веднага.' },
  { slug: 'torti-i-deserti', name: 'Торти и десерти', unit: 'per_event', visible: true,
    shortDescription: 'Торта за рязането и сладък бар за късните часове.' },
  { slug: 'muzikanti', name: 'Музиканти', unit: 'per_event', visible: true,
    shortDescription: 'Струнен дует или квартет за церемонията и коктейла.' },
  { slug: 'transport-za-gosti', name: 'Транспорт за гости', unit: 'per_event', visible: false },
  { slug: 'kolichka-za-sladoled', name: 'Количка за сладолед', unit: 'per_event', visible: false },
  { slug: 'studeni-foyerverki', name: 'Студени фойерверки', unit: 'per_event', visible: false },
  { slug: 'bar-s-kokteyli', name: 'Бар с коктейли и барман', unit: 'per_event', visible: false },
  { slug: 'karaoke', name: 'Караоке', unit: 'per_event', visible: false },
  { slug: 'kasna-zakuska', name: 'Късна закуска за гостите', unit: 'per_event', visible: false },
  { slug: 'kat-za-detsa', name: 'Кът за деца с аниматор', unit: 'per_event', visible: false },
  { slug: 'kaligraf', name: 'Калиграф за табелки', unit: 'per_event', visible: false },
];

export const CATERING_SUBTYPES = [
  { slug: 'byufet', label: 'Бюфет' },
  { slug: 'servirano-menyu', label: 'Сервирано меню' },
  { slug: 'koktejl', label: 'Коктейл' },
  { slug: 'barbekyu', label: 'Барбекю на открито' },
  { slug: 'vegan', label: 'Веган опции' },
] as const;

export const CATERING_TIPS = [
  { title: 'Какво влиза в цената на гост', body: 'Прибори, чаши, покривки и персонал често се таксуват отделно. Питайте за пълната сума.' },
  { title: 'Кога идват на място', body: 'Разположението отнема два-три часа. Уточнете достъпа до залата предварително.' },
  { title: 'Има ли дегустация', body: 'Повечето предлагат дегустация за двама. Питайте дали е безплатна и кога най-късно може.' },
] as const;

export const EVENT_TYPES = [
  {
    slug: 'svatba', name: 'Сватба', namePluralLower: 'сватби', nameDefinite: 'сватбата', isPublic: true, sortOrder: 1,
    shortDescription: 'Зала, кетъринг, музика и фотограф — папката, която започва най-рано.',
    heroPhotoUrl: 'photos/bouquet.jpg',
    introText: 'Подредили сме услугите за сватба в три групи — от тези, без които не минава, до тези, за които обикновено се сеща някой друг. Цените са начални, за вашата дата и локация.',
    tierRequiredText: 'Четирите услуги, с които започва всяка сватбена папка. Залата и кетърингът се заемат най-рано — за юнски уикенд често още предишната есен.',
    tierCommonText: 'Не са задължителни, но се появяват в повечето сватбени папки — обикновено месец след като залата е резервирана.',
    tierExtraText: 'Малките неща, които гостите помнят най-дълго, а в плана обикновено ги няма. Всяко от тях се добавя и две седмици преди деня.',
  },
  {
    slug: 'rozhden-den', name: 'Рожден ден', namePluralLower: 'рождени дни', nameDefinite: 'рождения ден', isPublic: true, sortOrder: 2,
    shortDescription: 'Торта, украса и нещо за децата. Повечето неща се уреждат в рамките на месец.',
  },
  {
    slug: 'firmeno-sabitie', name: 'Фирмено събитие', namePluralLower: 'фирмени събития', nameDefinite: 'фирменото събитие', isPublic: true, sortOrder: 3,
    shortDescription: 'Зала с техника, кетъринг и програма. Фактура и условия за плащане по договор.',
  },
  {
    slug: 'abiturientski-bal', name: 'Абитуриентски бал', namePluralLower: 'абитуриентски балове', nameDefinite: 'абитуриентския бал', isPublic: true, sortOrder: 4,
    shortDescription: 'Зала, DJ и фотограф за класа. Обикновено се организира от родителски комитет.',
  },
  // Hidden from filters (D15); has no public page, so no plural.
  { slug: 'drugo', name: 'Друго', namePluralLower: '', nameDefinite: 'събитието', isPublic: false, sortOrder: 5 },
] as const;

type TierSeed = { category: string; tier: ServiceTier; displayName?: string; description?: string; photoUrl?: string };

/**
 * /sabitiya/svatba tiers. A null description means "use the category's
 * short_description"; a null photo means "show the category icon"
 * (client/event-type.html: photos on the first two tiers, icons on the third).
 */
export const SVATBA_TIERS: TierSeed[] = [
  { category: 'zali-i-lokatsii', tier: 'required', displayName: 'Зала и локация', photoUrl: 'photos/thumbs/hero-bg.jpg' },
  { category: 'ketaring', tier: 'required', photoUrl: 'photos/thumbs/catering.jpg' },
  { category: 'dj-i-ozvuchavane', tier: 'required', photoUrl: 'photos/thumbs/dj-working.jpg' },
  { category: 'fotografiya', tier: 'required', photoUrl: 'photos/thumbs/photographer.jpg' },
  { category: 'dekoratsiya', tier: 'common', description: 'Арка, цветя за масите и булчински букет в един стил.', photoUrl: 'photos/thumbs/cat-decor.jpg' },
  { category: 'fotokabini', tier: 'common', displayName: 'Фотокабина', photoUrl: 'photos/thumbs/cat-booth.jpg' },
  { category: 'torti-i-deserti', tier: 'common', displayName: 'Торта и десерти', photoUrl: 'photos/thumbs/cake-celebration.jpg' },
  { category: 'muzikanti', tier: 'common', description: 'Струнен дует или квартет за церемонията и коктейла, преди DJ-ят да поеме вечерта.', photoUrl: 'photos/thumbs/violinist.jpg' },
  { category: 'videozasnemane', tier: 'common', description: 'Кратък филм от деня, с гласовете и музиката.', photoUrl: 'photos/thumbs/cat-photo.jpg' },
  { category: 'transport-za-gosti', tier: 'extra', displayName: 'Транспорт за гостите', description: 'Автобус от града до залата и обратно след края.' },
  { category: 'kolichka-za-sladoled', tier: 'extra', description: 'Сладолед на двора, докато гостите чакат вечерята.' },
  { category: 'studeni-foyerverki', tier: 'extra', description: 'Искри за първия танц и за рязането на тортата, без дим в залата.' },
  { category: 'bar-s-kokteyli', tier: 'extra', description: 'Коктейли на място, вместо гостите да чакат на бара в залата.' },
  { category: 'karaoke', tier: 'extra', description: 'За късните часове, когато гостите вече искат микрофона.' },
  { category: 'kasna-zakuska', tier: 'extra', description: 'Топла супа или баница към два часа — за онези, които остават до края.' },
  { category: 'kat-za-detsa', tier: 'extra', description: 'Децата са заети на едно място, а родителите остават на дансинга.' },
  { category: 'kaligraf', tier: 'extra', description: 'Имената на гостите и планът на масите, написани на ръка.' },
];

/** Settings defaults are written as in force from 1 July 2025 (‹в сила от 1 юли›, DATA-MODEL S1). */
export const SETTINGS_EPOCH: DateStr = '2025-07-01';
/** First year of holiday data (the demo's history starts in 2025). */
export const HOLIDAYS_FROM_YEAR = 2025;

// ── Bulgarian public holidays (Labour Code art. 154) ─────────────────────

/** Orthodox Easter Sunday (Meeus' Julian algorithm + 13 days, valid 1900–2099). */
export function orthodoxEaster(year: number): DateStr {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return addDays(julian, 13);
}

const weekday = (d: DateStr) => new Date(`${d}T12:00:00Z`).getUTCDay(); // 0 = Sunday

/**
 * Official holidays of one year, plus the substitute days off the Labour Code
 * gives when a fixed holiday falls on a Saturday or Sunday (art. 154(2): the
 * first working day(s) after it). Easter days get no substitutes. Extra
 * bridge days decreed by the Council of Ministers are not predictable and are
 * not included.
 */
export function bulgarianHolidays(year: number): { date: DateStr; name: string }[] {
  const y = String(year);
  const fixed = [
    [`${y}-01-01`, 'Нова година'],
    [`${y}-03-03`, 'Ден на Освобождението на България'],
    [`${y}-05-01`, 'Ден на труда'],
    [`${y}-05-06`, 'Гергьовден, Ден на храбростта и Българската армия'],
    [`${y}-05-24`, 'Ден на светите братя Кирил и Методий'],
    [`${y}-09-06`, 'Ден на Съединението'],
    [`${y}-09-22`, 'Ден на Независимостта на България'],
    [`${y}-12-24`, 'Бъдни вечер'],
    [`${y}-12-25`, 'Рождество Христово'],
    [`${y}-12-26`, 'Рождество Христово'],
  ] as const;
  const easter = orthodoxEaster(year);
  const easterDays = [
    [addDays(easter, -2), 'Велики петък'],
    [addDays(easter, -1), 'Велика събота'],
    [easter, 'Великден'],
    [addDays(easter, 1), 'Великден'],
  ] as const;
  const days = new Map<DateStr, string>();
  for (const [d, n] of [...fixed, ...easterDays]) if (!days.has(d)) days.set(d, n);
  for (const [d, n] of fixed) {
    if (weekday(d) !== 0 && weekday(d) !== 6) continue;
    let s = addDays(d, 1);
    while (weekday(s) === 0 || weekday(s) === 6 || days.has(s)) s = addDays(s, 1);
    days.set(s, `Почивен ден (${n})`);
  }
  return [...days].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}

// ── ensureReferenceData ──────────────────────────────────────────────────

export type ReferenceSummary = {
  cities: number; categories: number; subtypes: number; tips: number; eventTypes: number; tierServices: number; holidays: number; settings: number;
};

/** Insert whatever reference data is missing. Returns how many rows each step inserted (all 0 on a second run). */
export async function ensureReferenceData(tx: Queryable, opts: { holidaysThroughYear?: number } = {}): Promise<ReferenceSummary> {
  const at = await now();
  const s: ReferenceSummary = { cities: 0, categories: 0, subtypes: 0, tips: 0, eventTypes: 0, tierServices: 0, holidays: 0, settings: 0 };

  s.cities = (await tx.insert(city).values(CITIES.map(c => ({ ...c })))
    .onConflictDoNothing({ target: city.slug }).returning({ id: city.id })).length;

  s.categories = (await tx.insert(category).values(CATEGORIES.map((c, i) => ({
    slug: c.slug, name: c.name, icon: c.slug, defaultPriceUnit: c.unit,
    shortDescription: c.shortDescription ?? null, pluralNoun: c.pluralNoun ?? null,
    heroPhotoUrl: c.heroPhotoUrl ?? null, tipsHeading: c.tipsHeading ?? null,
    isVisible: c.visible, inDirectory: c.visible, sortOrder: i + 1,
  }))).onConflictDoNothing({ target: category.slug }).returning({ id: category.id })).length;

  const cats = new Map((await tx.select({ id: category.id, slug: category.slug }).from(category)
    .where(inArray(category.slug, CATEGORIES.map(c => c.slug)))).map(r => [r.slug, r.id]));
  const catId = (slug: string) => {
    const v = cats.get(slug);
    if (!v) throw new Error(`Reference category missing: ${slug}`);
    return v;
  };

  const ketaring = catId('ketaring');
  s.subtypes = (await tx.insert(categorySubtype).values(CATERING_SUBTYPES.map((t, i) => ({
    categoryId: ketaring, slug: t.slug, label: t.label, sortOrder: i + 1,
  }))).onConflictDoNothing().returning({ id: categorySubtype.id })).length;

  // Tips have no natural key: seed them only while the category has none.
  const [{ n: tipCount }] = await tx.select({ n: sql<number>`count(*)::int` }).from(categoryTip)
    .where(sql`${categoryTip.categoryId} = ${ketaring}`);
  if (tipCount === 0) {
    s.tips = (await tx.insert(categoryTip).values(CATERING_TIPS.map((t, i) => ({
      categoryId: ketaring, title: t.title, body: t.body, sortOrder: i + 1,
    }))).returning({ id: categoryTip.id })).length;
  }

  s.eventTypes = (await tx.insert(eventType).values(EVENT_TYPES.map(e => ({ ...e })))
    .onConflictDoNothing({ target: eventType.slug }).returning({ id: eventType.id })).length;

  const [svatba] = await tx.select({ id: eventType.id }).from(eventType).where(sql`${eventType.slug} = 'svatba'`);
  s.tierServices = (await tx.insert(eventTypeService).values(SVATBA_TIERS.map((t, i) => ({
    eventTypeId: svatba.id, categoryId: catId(t.category), tier: t.tier,
    displayName: t.displayName ?? null, description: t.description ?? null, photoUrl: t.photoUrl ?? null, sortOrder: i + 1,
  }))).onConflictDoNothing().returning({ id: eventTypeService.id })).length;

  const throughYear = opts.holidaysThroughYear ?? sofiaParts(at).y + 2;
  const holidays = [];
  for (let y = HOLIDAYS_FROM_YEAR; y <= throughYear; y++) holidays.push(...bulgarianHolidays(y));
  if (holidays.length) {
    s.holidays = (await tx.insert(publicHoliday).values(holidays)
      .onConflictDoNothing({ target: publicHoliday.date }).returning({ date: publicHoliday.date })).length;
  }

  // Settings: a key gets its default only if it has never been written.
  const existing = new Set((await tx.selectDistinct({ key: platformSettings.key }).from(platformSettings)).map(r => r.key));
  const defaults = settingDefaults();
  const effectiveFrom = sofiaInstant(SETTINGS_EPOCH, 0, 0);
  const missing = SETTING_KEYS.filter(k => !existing.has(k));
  if (missing.length) {
    s.settings = (await tx.insert(platformSettings).values(missing.map(k => ({
      key: k,
      // JSON null must be the jsonb literal, not SQL NULL.
      value: defaults[k] === null ? sql`'null'::jsonb` : defaults[k],
      effectiveFrom,
    }))).returning({ id: platformSettings.id })).length;
  }
  return s;
}
