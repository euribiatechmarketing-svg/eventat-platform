// The prototype's demo data as records (DATA-MODEL §3 S1–S14). Every value is
// copied from DATA-MODEL §3 or the prototype screen it names; values the
// prototype does not contain are marked (a) and listed in scripts/seed/README.md.
// Instants are Sofia wall-clock strings 'YYYY-MM-DD HH:MM[:SS]'.
import type {
  BookingStatus, CancellationPolicy, DisputeDecisionKind, DisputeParty, DisputeReason, ExperienceBand, PriceUnit, ServiceKind,
  ServiceStatus, SpaceType, TeamRole,
} from '@/db/schema';

/** S1: business "now" (D4). */
export const DEMO_NOW = '2025-08-31 12:00';
export const DEMO_PASSWORD = 'eventat-demo';
/** S8: rail of the historical batches. */
export const PAYOUT_RAIL = 'Обединена банка · SEPA';
/** S1: the KPI snapshot was refreshed 12 minutes before "now". */
export const METRICS_REFRESHED_AT = '2025-08-31 11:48';

/** (a) Placeholder phone numbers: +359 followed by 0 is not a dialable Bulgarian number. */
const placeholderPhone = (n: number) => `+3590000000${String(n).padStart(2, '0')}`;

// ── S3 Team ───────────────────────────────────────────────────────────────

export type TeamSeed = {
  key: string; name: string; email: string; role: TeamRole; title?: string; isOwner?: boolean;
  joinedAt: string; lastActiveAt?: string;
};
export const TEAM: TeamSeed[] = [
  { key: 'monika', name: 'Моника Ковачева', email: 'monika.kovacheva@eventat.bg', role: 'admin', isOwner: true,
    joinedAt: '2025-01-15 10:00' /* (a) */, lastActiveAt: '2025-08-31 09:12' },
  { key: 'georgi', name: 'Георги Петров', email: 'georgi.petrov@eventat.bg', role: 'moderator',
    joinedAt: '2025-05-01 10:00' /* ‹В екипа от май 2025›, day (a) */, lastActiveAt: '2025-08-31 11:35' /* ‹Преди 25 минути› */ },
  { key: 'daniela', name: 'Даниела Вълчева', email: 'daniela.valcheva@eventat.bg', role: 'support',
    joinedAt: '2025-07-01 10:00' /* ‹В екипа от юли 2025›, day (a) */, lastActiveAt: '2025-08-31 09:00' /* ‹Преди 3 часа› */ },
  { key: 'krasimir', name: 'Красимир Йотов', email: 'krasimir.yotov@eventat.bg', role: 'accounting', title: 'Външен счетоводител',
    joinedAt: '2025-03-01 10:00' /* (a) */, lastActiveAt: '2025-08-30 17:40' },
];

export const TEAM_INVITES = [
  { email: 'ivan.marinov@eventat.bg', role: 'support' as TeamRole, sentAt: '2025-08-29 12:00' /* (a) ‹преди 2 дни› */ },
  { email: 'kalina.stefanova@eventat.bg', role: 'moderator' as TeamRole, sentAt: '2025-08-30 12:00' /* (a) ‹вчера› */ },
];

// ── S4 Clients ────────────────────────────────────────────────────────────

export type ClientSeed = {
  key: string; name: string; email: string; phone: string; city: string; type: 'private' | 'business';
  /** Registration; (a) for everyone but Мария = two days before the client's first request. */
  registeredAt?: string;
};
export const CLIENTS: ClientSeed[] = [
  { key: 'maria', name: 'Мария Димитрова', email: 'maria.dimitrova@gmail.com', phone: '+359884127730', city: 'sofia', type: 'private', registeredAt: '2025-03-12 10:00' },
  { key: 'technolink', name: 'Технолинк ЕООД', email: 'events@technolink.bg', phone: placeholderPhone(1), city: 'sofia', type: 'business' },
  { key: 'ivelina', name: 'Ивелина Тодорова', email: 'i.todorova@abv.bg', phone: placeholderPhone(2), city: 'plovdiv', type: 'private' },
  { key: 'petya', name: 'Петя и Николай', email: 'petya.n@gmail.com', phone: placeholderPhone(3), city: 'varna', type: 'private' },
  { key: 'stefka', name: 'Стефка Илиева', email: 'stefka.ilieva@gmail.com', phone: placeholderPhone(4), city: 'burgas', type: 'private' },
  { key: 'botev', name: 'СУ „Христо Ботев“', email: 'office@sou-botev.bg', phone: placeholderPhone(5), city: 'sofia', type: 'business' },
  { key: 'kolev', name: 'Георги Колев', email: 'georgi.kolev@example.invalid', phone: placeholderPhone(6), city: 'sofia', type: 'private' },
  { key: 'denitsa', name: 'Деница и Иван', email: 'denitsa.ivan@example.invalid', phone: placeholderPhone(7), city: 'sofia', type: 'private' },
  { key: 'ralitsa', name: 'Ралица и Георги', email: 'ralitsa.georgi@example.invalid', phone: placeholderPhone(8), city: 'sofia', type: 'private' },
  // Contact Мартин Маринов (the review author, S11).
  { key: 'netera', name: 'Нетера', email: 'netera@example.invalid', phone: placeholderPhone(9), city: 'sofia', type: 'business' },
  { key: 'anaviktor', name: 'Ана и Виктор', email: 'ana.viktor@example.invalid', phone: placeholderPhone(10), city: 'sofia', type: 'private' },
];

/** Мария's account details (S4). */
export const MARIA = {
  passwordChangedAt: '2025-08-09 12:00', // time (a)
  lastLoginAt: '2025-08-31 08:50',
  lastLoginCity: 'София',
  sessions: [
    { deviceLabel: 'MacBook', city: 'София', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', lastActiveAt: '2025-08-31 08:50' },
    { deviceLabel: 'iPhone', city: 'София', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)', lastActiveAt: '2025-08-29 21:00' /* time (a) */ },
  ],
  invoiceProfile: { recipientType: 'individual' as const, name: 'Мария Димитрова', address: 'гр. София, България' },
  // Newest first; times (a).
  searchHistory: [
    { query: 'сватба софия', at: '2025-08-31 09:30' },
    { query: 'кетъринг коледно парти', at: '2025-08-30 18:10' },
    { query: 'фотокабина 14 юни', at: '2025-08-29 20:15' },
  ],
  card: { brand: 'Visa', last4: '4242' },
};

// ── S5 Partners ───────────────────────────────────────────────────────────

export type PartnerSeed = {
  slug: string; businessName: string; category: string; city: string;
  radiusKm: number | null; nationwide?: boolean; policy: CancellationPolicy; depositPercent?: 20 | 30 | 40 | 50;
  eventTypes: string[]; maxGuests?: number; verified: boolean;
  status: 'approved' | 'submitted';
  /** Partner user (owner) and the contact on the partner record. (a): contact = business name, email @example.invalid. */
  contactName: string; contactRole?: string; email: string; phone: string;
  /** approved: approval time; submitted: submission time. */
  approvedAt?: string; submittedAt?: string;
  /** Catalogue photo (gallery position 0) and the rest of the gallery, in order. */
  gallery: string[];
  avatar?: string; cover?: string;
  payout?: { last4: string; bank: string; branch?: string; status: 'confirmed' | 'pending_verification' };
  /** partner_check states; omitted kinds are ok. */
  waitingChecks?: ('company' | 'contacts' | 'gallery' | 'bank_account')[];
  checkDetails?: Partial<Record<'company' | 'contacts' | 'gallery' | 'services' | 'cancellation_policy' | 'bank_account', string>>;
  tags?: string[];
  blocks?: { start: string; end?: string; reason?: string }[];
  extra?: Partial<{
    legalName: string; legalForm: 'eood'; eik: string; registeredAddress: string; managerName: string; socialHandle: string;
    experienceBand: ExperienceBand; activeSinceYear: number; languages: string[]; shortDescription: string; description: string;
    alsoServesNote: string; businessNameChangedAt: string; updatedAt: string; offersOnRequest: boolean;
  }>;
};

const ALL_EVENT_TYPES = ['svatba', 'rozhden-den', 'firmeno-sabitie', 'abiturientski-bal'];
const exampleEmail = (slug: string) => `${slug}@example.invalid`;
const APPROVED_AT_ASSUMED = '2025-03-01 10:00'; // (a) every approved partner but Студио Мелодия

export const PARTNERS: PartnerSeed[] = [
  {
    slug: 'studio-melodiya', businessName: 'Студио Мелодия', category: 'dj-i-ozvuchavane', city: 'sofia', radiusKm: 150,
    policy: 'moderate', depositPercent: 30, eventTypes: ALL_EVENT_TYPES, maxGuests: 250, verified: true, status: 'approved',
    contactName: 'Мартин Стоянов', contactRole: 'управител', email: 'studio.melodia@gmail.com', phone: '+359881234567',
    approvedAt: '2025-02-01 10:00', // D86; time (a)
    gallery: ['v1-dj-mod', 'v1-dj-perf', 'v1-dj-doc', 'dancers', 'booth'], avatar: 'v1-dj-doc', cover: 'v1-dj-mod',
    payout: { last4: '5272', bank: 'Postbank', branch: 'София', status: 'confirmed' },
    // (a) Not in the prototype: the SPEC §4.2 ok examples with Студио Мелодия's own data.
    checkDetails: {
      company: 'ЕИК 204512389 · Студио Мелодия ЕООД · проверено в Търговския регистър',
      contacts: 'Телефон и имейл потвърдени',
      gallery: '5 снимки · няма водни знаци от други студия',
    },
    // S5 tags; ‹Годежи› is the service-form chip S6 maps to a partner tag.
    tags: ['Озвучаване', 'Диско осветление', 'Годежи'],
    blocks: [
      { start: '2026-06-17', end: '2026-06-18', reason: 'Отпуска' },
      { start: '2026-08-03', end: '2026-08-10', reason: 'Лятна почивка' },
      { start: '2026-12-24', reason: 'Семеен празник' },
    ],
    extra: {
      legalName: 'Студио Мелодия ЕООД', legalForm: 'eood', eik: '204512389', registeredAddress: 'гр. София, България',
      managerName: 'Мартин Стоянов', socialHandle: '@studio.melodia', experienceBand: 'gt_10', languages: ['Български', 'английски'],
      shortDescription: 'DJ, озвучаване и диско осветление за сватби, рождени дни и фирмени събития в София и страната.',
      description: 'Над 12 години озвучаваме сватби, рождени дни и фирмени събития в София и страната. Работим с професионална техника, съобразяваме плейлиста с вашия вкус и водим събитието спокойно — без излишно шоу. Идваме на оглед на залата преди деня на събитието.',
      businessNameChangedAt: '2025-08-12 12:00', // time (a)
      updatedAt: '2025-08-25 12:00', // ‹последна промяна преди 6 дни›, time (a)
      offersOnRequest: true,
    },
  },
  {
    slug: 'ana-petrova-photography', businessName: 'Ана Петрова Photography', category: 'fotografiya', city: 'sofia', radiusKm: 200,
    policy: 'strict', eventTypes: ['svatba', 'rozhden-den'], verified: true, status: 'approved',
    contactName: 'Ана Петрова Photography', email: exampleEmail('ana-petrova-photography'), phone: placeholderPhone(21),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['v1-photographer-mod'],
    payout: { last4: '7788', bank: 'Обединена банка' /* (a) */, status: 'confirmed' },
    blocks: [{ start: '2026-06-14' }],
  },
  {
    slug: 'vkusna-istoriya', businessName: 'Вкусна История', category: 'ketaring', city: 'sofia', radiusKm: 80,
    policy: 'moderate', eventTypes: ['svatba', 'firmeno-sabitie', 'rozhden-den'], maxGuests: 250, verified: false, status: 'approved',
    contactName: 'Вкусна История', email: exampleEmail('vkusna-istoriya'), phone: placeholderPhone(22),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['v1-caterer-warm'],
    payout: { last4: '9023', bank: 'Обединена банка' /* (a) */, status: 'confirmed' },
    waitingChecks: ['company'],
  },
  {
    slug: 'flora-studio', businessName: 'Флора Студио', category: 'dekoratsiya', city: 'sofia', radiusKm: 120,
    policy: 'flexible', eventTypes: ['svatba', 'rozhden-den'], verified: true, status: 'approved',
    contactName: 'Флора Студио', email: exampleEmail('flora-studio'), phone: placeholderPhone(23),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['bouquet'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a)
  },
  {
    slug: 'snap360', businessName: 'Snap360', category: 'fotokabini', city: 'sofia', radiusKm: 100,
    policy: 'flexible', eventTypes: ALL_EVENT_TYPES, verified: false, status: 'approved',
    contactName: 'Snap360', email: exampleEmail('snap360'), phone: placeholderPhone(24),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['booth'],
    payout: { last4: '1150', bank: 'Обединена банка' /* (a) */, status: 'confirmed' },
    waitingChecks: ['company'],
    blocks: [{ start: '2026-12-19' }],
  },
  {
    slug: 'kvartet-adazhio', businessName: 'Квартет „Адажио“', category: 'muzikanti', city: 'sofia', radiusKm: null, nationwide: true,
    policy: 'moderate', eventTypes: ['svatba'], verified: false, status: 'approved',
    contactName: 'Квартет „Адажио“', email: exampleEmail('kvartet-adazhio'), phone: placeholderPhone(25),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['violinist'],
    payout: { last4: '3306', bank: 'Обединена банка' /* (a) */, status: 'confirmed' },
    waitingChecks: ['company'],
    blocks: [{ start: '2026-12-19' }],
  },
  {
    slug: 'sladkarnitsa-med-i-mlyako', businessName: 'Сладкарница „Мед и мляко“', category: 'torti-i-deserti', city: 'sofia', radiusKm: 60,
    policy: 'flexible', eventTypes: ['svatba', 'rozhden-den'], maxGuests: 150, verified: false, status: 'approved',
    contactName: 'Сладкарница „Мед и мляко“', email: exampleEmail('sladkarnitsa-med-i-mlyako'), phone: placeholderPhone(26),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['cake-celebration'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a)
    waitingChecks: ['company'],
  },
  {
    slug: 'trapeza-and-co', businessName: 'Трапеза & Co', category: 'ketaring', city: 'sofia', radiusKm: 120,
    policy: 'flexible', eventTypes: ['svatba', 'firmeno-sabitie'], verified: true, status: 'approved',
    contactName: 'Трапеза & Co', email: exampleEmail('trapeza-and-co'), phone: placeholderPhone(27),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['catering'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a)
  },
  {
    slug: 'folklorna-trapeza', businessName: 'Фолклорна Трапеза', category: 'ketaring', city: 'plovdiv', radiusKm: null, nationwide: true,
    policy: 'strict', eventTypes: ['svatba', 'firmeno-sabitie'], verified: true, status: 'approved',
    contactName: 'Фолклорна Трапеза', email: exampleEmail('folklorna-trapeza'), phone: placeholderPhone(28),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['dancers'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a)
  },
  {
    slug: 'gradina-i-masa', businessName: 'Градина и Маса', category: 'ketaring', city: 'sofia' /* D33 */, radiusKm: 150,
    policy: 'moderate', eventTypes: ['svatba', 'rozhden-den'], verified: false, status: 'approved',
    contactName: 'Градина и Маса', email: exampleEmail('gradina-i-masa'), phone: placeholderPhone(29),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['photographer'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a)
    waitingChecks: ['company'],
  },
  {
    slug: 'byala-pokrivka', businessName: 'Бяла Покривка', category: 'ketaring', city: 'varna' /* D33 */, radiusKm: 100,
    policy: 'moderate', eventTypes: ['svatba', 'firmeno-sabitie'], verified: true, status: 'approved',
    contactName: 'Бяла Покривка', email: exampleEmail('byala-pokrivka'), phone: placeholderPhone(30),
    approvedAt: APPROVED_AT_ASSUMED, gallery: ['decorator'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a)
  },
  // Pending applications (D17: submitted, not public).
  {
    slug: 'lunna-fotografiya', businessName: 'Лунна Фотография', category: 'fotografiya', city: 'plovdiv', radiusKm: null,
    policy: 'moderate', eventTypes: ['svatba', 'abiturientski-bal'], verified: true, status: 'submitted',
    contactName: 'Емилия Стоянова', contactRole: 'управител', email: 'lunna.photo@gmail.com', phone: '+359887642019',
    submittedAt: '2025-08-29 12:00',
    // admin/vendor.html gallery order; only the 7 files that exist (D77).
    gallery: ['v1-photographer-mod', 'photographer', 'bouquet', 'dancers', 'violinist', 'cake-celebration', 'decorator'],
    payout: { last4: '0000' /* (a) */, bank: 'Пощенска банка', status: 'pending_verification' },
    waitingChecks: ['bank_account'],
    checkDetails: {
      company: 'ЕИК 207845112 · Лунна Фотография ЕООД · проверено в Търговския регистър',
      contacts: 'Телефон и имейл потвърдени',
      gallery: '14 снимки · няма водни знаци от други студия',
      services: '3 пакета · от 780 € до 2 400 €',
      cancellation_policy: 'Умерена · безплатно до 30 дни',
      bank_account: 'IBAN подаден, чака потвърждение от банката',
    },
    tags: ['Сватбена фотография', 'Семейни фотосесии', 'Видеозаснемане'],
    extra: {
      legalName: 'Лунна Фотография ЕООД', legalForm: 'eood', eik: '207845112', registeredAddress: 'Пловдив',
      managerName: 'Емилия Стоянова', alsoServesNote: 'приема поръчки и в София', activeSinceYear: 2019,
    },
  },
  {
    slug: 'balon-gradina', businessName: 'Балон Градина', category: 'dekoratsiya', city: 'sofia', radiusKm: null,
    policy: 'flexible', eventTypes: ['rozhden-den', 'svatba'], verified: true, status: 'submitted',
    contactName: 'Радост Иванова', email: exampleEmail('balon-gradina'), phone: placeholderPhone(31),
    submittedAt: '2025-08-30 12:00', gallery: ['decorator'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a) 6 of 6 checks ⇒ a confirmed account
    blocks: [{ start: '2026-06-21' }],
  },
  {
    slug: 'dj-zhivko', businessName: 'DJ Живко', category: 'dj-i-ozvuchavane', city: 'varna', radiusKm: null,
    policy: 'moderate', eventTypes: ['rozhden-den', 'abiturientski-bal', 'svatba'], verified: true, status: 'submitted',
    contactName: 'Живко Петров', email: exampleEmail('dj-zhivko'), phone: placeholderPhone(32),
    submittedAt: '2025-08-31 06:00', gallery: ['v1-dj-perf'],
    waitingChecks: ['gallery', 'bank_account'], // (a) which two are waiting
    blocks: [{ start: '2026-12-19' }],
  },
  {
    slug: 'tortite-na-mimi', businessName: 'Тортите на Мими', category: 'torti-i-deserti', city: 'burgas', radiusKm: null,
    policy: 'moderate', eventTypes: ['rozhden-den', 'svatba'], maxGuests: 120, verified: true, status: 'submitted',
    contactName: 'Мими Ангелова', email: exampleEmail('tortite-na-mimi'), phone: placeholderPhone(33),
    submittedAt: '2025-08-31 09:00', gallery: ['catering'],
    payout: { last4: '0000', bank: 'Обединена банка', status: 'confirmed' }, // (a) 6 of 6 checks
  },
];

// ── S6 Services ───────────────────────────────────────────────────────────

export type ServiceSeed = {
  key: string; partner: string; kind: ServiceKind; name: string; category: string;
  /** '' = (a): the prototype shows no description. */
  description: string;
  priceCents: number | null; unit?: PriceUnit; minGuests?: number; duration?: string;
  status: ServiceStatus; sort: number; cover?: string;
  /** Default (a): the partner's event types. */
  eventTypes?: string[];
  inclusions?: string[]; extraHourCents?: number; travelFee?: boolean;
  /** pending_review: when the `new` revision was submitted. */
  submittedAt?: string;
  updatedAt?: string;
};

export const SERVICES: ServiceSeed[] = [
  // Студио Мелодия (vendor/services.html, service-edit.html)
  { key: 'sm-full', partner: 'studio-melodiya', kind: 'package_fixed', name: 'Пакет „Цял ден“', category: 'dj-i-ozvuchavane',
    description: 'DJ, озвучаване за церемония и парти, диско осветление, безжичен микрофон. До 10 часа.',
    priceCents: 145_000, duration: 'До 10 часа', status: 'active', sort: 0, cover: 'v1-dj-doc', eventTypes: ['svatba'],
    inclusions: ['DJ за цялото събитие', 'Озвучаване за церемония и парти', 'Диско осветление', 'Безжичен микрофон'],
    extraHourCents: 15_000, travelFee: true, updatedAt: '2025-08-27 12:00' /* ‹последна промяна преди 4 дни›, time (a) */ },
  { key: 'sm-evening', partner: 'studio-melodiya', kind: 'package_fixed', name: 'Пакет „Вечер“', category: 'dj-i-ozvuchavane',
    description: '5 часа музика, озвучаване и базово осветление. Подходящ за рождени дни и балове.',
    priceCents: 64_000, status: 'active', sort: 1, cover: 'v1-dj-perf', eventTypes: ['rozhden-den', 'abiturientski-bal'] },
  { key: 'sm-corporate', partner: 'studio-melodiya', kind: 'on_request', name: 'Фирмени събития', category: 'dj-i-ozvuchavane',
    description: 'Индивидуална оферта според мащаба — озвучаване, сцена, техник на място.',
    priceCents: null, status: 'active', sort: 2, cover: 'v1-dj-mod', eventTypes: ['firmeno-sabitie'] },
  { key: 'sm-booth360', partner: 'studio-melodiya', kind: 'addon', name: 'Фотокабина 360°', category: 'fotokabini',
    description: 'Видео 360° с реквизит и оператор. Може да се добави към всеки пакет.',
    priceCents: 38_000, status: 'draft', sort: 3, cover: 'v1-caterer-warm' },
  // Вкусна История
  { key: 'vi-garden', partner: 'vkusna-istoriya', kind: 'package_fixed', name: 'Меню „Градина“', category: 'ketaring', description: '',
    priceCents: 2_800, unit: 'per_guest', minGuests: 60, status: 'active', sort: 0, cover: 'v1-caterer-warm' },
  { key: 'vi-xmas', partner: 'vkusna-istoriya', kind: 'package_fixed', name: 'Коледно меню за 40 гости', category: 'ketaring', description: '',
    priceCents: 198_000, status: 'active', sort: 1 },
  // Флора Студио
  { key: 'fl-arch', partner: 'flora-studio', kind: 'package_fixed', name: 'Арка, маси и букет', category: 'dekoratsiya', description: '',
    priceCents: 118_000, status: 'active', sort: 0 },
  { key: 'fl-xmas', partner: 'flora-studio', kind: 'package_fixed', name: 'Коледна украса на залата и масите', category: 'dekoratsiya', description: '',
    priceCents: 46_000, status: 'active', sort: 1 },
  { key: 'fl-pastel', partner: 'flora-studio', kind: 'package_fixed', name: 'Сватбена арка „Пастел“', category: 'dekoratsiya',
    description: 'Арка с живи цветя, монтаж на място.', priceCents: 118_000, status: 'pending_review', sort: 2, cover: 'bouquet',
    eventTypes: ['svatba'], submittedAt: '2025-08-31 10:00' },
  // Snap360
  { key: 'sn-4h', partner: 'snap360', kind: 'package_fixed', name: 'Фотокабина · 4 часа с оператор и реквизит', category: 'fotokabini', description: '',
    priceCents: 56_000, status: 'active', sort: 0 },
  { key: 'sn-3h', partner: 'snap360', kind: 'package_fixed', name: 'Фотокабина · 3 часа с оператор и реквизит', category: 'fotokabini', description: '',
    priceCents: 42_000, status: 'active', sort: 1 },
  { key: 'sn-premium', partner: 'snap360', kind: 'package_fixed', name: 'Фотокабина „360 Premium“', category: 'fotokabini',
    description: '360° кабина с оператор и реквизит.', priceCents: 89_000, duration: 'до 5 часа', status: 'pending_review', sort: 2,
    cover: 'booth', submittedAt: '2025-08-31 04:00' },
  // Квартет „Адажио“
  { key: 'ad-ceremony', partner: 'kvartet-adazhio', kind: 'package_fixed', name: 'Церемония и коктейл, 90 минути', category: 'muzikanti', description: '',
    priceCents: 74_000, status: 'active', sort: 0 },
  { key: 'ad-duo', partner: 'kvartet-adazhio', kind: 'package_fixed', name: 'Струнен дует за церемония', category: 'muzikanti',
    description: 'Цигулка и виолончело, репертоар по избор.', priceCents: 42_000, duration: '60 минути', status: 'pending_review', sort: 1,
    cover: 'violinist', submittedAt: '2025-08-30 15:00' /* (a) */ },
  // Сладкарница „Мед и мляко“
  { key: 'mm-xmas', partner: 'sladkarnitsa-med-i-mlyako', kind: 'package_fixed', name: 'Коледна торта за 40 гости', category: 'torti-i-deserti', description: '',
    priceCents: 42_000, status: 'active', sort: 0 },
  { key: 'mm-cake', partner: 'sladkarnitsa-med-i-mlyako', kind: 'package_fixed', name: 'Торта и десерти', category: 'torti-i-deserti', description: '',
    priceCents: 38_000, status: 'active', sort: 1 },
  // Ана Петрова Photography
  { key: 'ap-full', partner: 'ana-petrova-photography', kind: 'package_fixed', name: 'Цял ден с втори фотограф', category: 'fotografiya', description: '',
    priceCents: 190_000, status: 'active', sort: 0 },
  // The four catering partners: one package named after the category, at the card's from-price (a).
  { key: 'tc-catering', partner: 'trapeza-and-co', kind: 'package_fixed', name: 'Кетъринг', category: 'ketaring', description: '', priceCents: 98_000, status: 'active', sort: 0 },
  { key: 'ft-catering', partner: 'folklorna-trapeza', kind: 'package_fixed', name: 'Кетъринг', category: 'ketaring', description: '', priceCents: 145_000, status: 'active', sort: 0 },
  { key: 'gm-catering', partner: 'gradina-i-masa', kind: 'package_fixed', name: 'Кетъринг', category: 'ketaring', description: '', priceCents: 89_000, status: 'active', sort: 0 },
  { key: 'bp-catering', partner: 'byala-pokrivka', kind: 'package_fixed', name: 'Кетъринг', category: 'ketaring', description: '', priceCents: 110_000, status: 'active', sort: 0 },
  // Лунна Фотография (admin/vendor.html), `ready` until approval.
  { key: 'lf-half', partner: 'lunna-fotografiya', kind: 'package_fixed', name: 'Пакет „Половин ден“', category: 'fotografiya',
    description: '4 часа заснемане · около 200 обработени кадъра · онлайн галерия', priceCents: 78_000, status: 'ready', sort: 0, cover: 'bouquet' },
  { key: 'lf-full', partner: 'lunna-fotografiya', kind: 'package_fixed', name: 'Пакет „Цял ден“', category: 'fotografiya',
    description: '10 часа · две локации · около 500 обработени кадъра', priceCents: 148_000, status: 'ready', sort: 1, cover: 'photographer' },
  { key: 'lf-second', partner: 'lunna-fotografiya', kind: 'package_fixed', name: 'Пакет „Цял ден с втори фотограф“', category: 'fotografiya',
    description: '12 часа · втори фотограф · печатен албум и видеоклип', priceCents: 240_000, status: 'ready', sort: 2, cover: 'decorator' },
  // The other three applicants' cards (S5): one package each named after the category, at the card's from-price (a).
  { key: 'bg-decor', partner: 'balon-gradina', kind: 'package_fixed', name: 'Декорация', category: 'dekoratsiya', description: '', priceCents: 32_000, status: 'ready', sort: 0 },
  { key: 'dz-dj', partner: 'dj-zhivko', kind: 'package_fixed', name: 'DJ и озвучаване', category: 'dj-i-ozvuchavane', description: '', priceCents: 52_000, status: 'ready', sort: 0 },
  { key: 'tm-cakes', partner: 'tortite-na-mimi', kind: 'package_fixed', name: 'Торти и десерти', category: 'torti-i-deserti', description: '', priceCents: 29_000, status: 'ready', sort: 0 },
];

/** S6: the pending edit of Меню „Градина“ (admin ‹Беше› / ‹Става›). */
export const SERVICE_EDITS = [
  { service: 'vi-garden', submittedAt: '2025-08-31 04:40', payload: { priceCents: [2_800, 3_200], minGuests: [60, 40] } },
];

// ── S4 Client events ──────────────────────────────────────────────────────

export type EventSeed = {
  key: string; client: string; type: string; title: string; hosts?: string; date: string; start?: string; end?: string;
  venue?: string; locality?: string; city: string; guests: number; notes?: string; notesUpdatedAt?: string;
};
export const EVENTS: EventSeed[] = [
  { key: 'm-wedding', client: 'maria', type: 'svatba', title: 'Сватба', hosts: 'Мария и Стефан', date: '2026-06-14', start: '17:00', end: '02:00',
    venue: 'Вила Екатерина', locality: 'с. Панчарево', city: 'sofia', guests: 120 },
  { key: 'm-xmas', client: 'maria', type: 'firmeno-sabitie', title: 'Коледно парти', date: '2026-12-19', start: '19:00',
    venue: 'Ресторант „Виа Верде“', city: 'sofia', guests: 40,
    notes: 'Достъп до залата от 17:00 за монтаж. Паркингът е отзад — да го напишем на екипите.\nТортата да излезе след речта на управителя, около 21:30.',
    notesUpdatedAt: '2025-08-12 18:20' },
  { key: 'm-anniv', client: 'maria', type: 'drugo', title: 'Годишнина', date: '2025-04-24', venue: 'Ресторант „Стария бряст“', city: 'sofia', guests: 40 },
  { key: 't-corp', client: 'technolink', type: 'firmeno-sabitie', title: 'Фирмено събитие', date: '2026-06-21', venue: 'София Тех Парк', city: 'sofia', guests: 250 },
  // Ресторант „Тера“: city (a).
  { key: 'i-bday', client: 'ivelina', type: 'rozhden-den', title: 'Рожден ден', date: '2026-06-28', start: '20:00', end: '01:00',
    venue: 'Ресторант „Тера“', city: 'sofia', guests: 40 },
  // Venues, cities and guests of the events below: (a) where the prototype gives none.
  { key: 'p-wed26', client: 'petya', type: 'svatba', title: 'Сватба', date: '2026-06-07', city: 'sofia', guests: 90 },
  { key: 'p-wed25', client: 'petya', type: 'svatba', title: 'Сватба', date: '2025-05-30', city: 'sofia', guests: 100 },
  { key: 's-bday25', client: 'stefka', type: 'rozhden-den', title: 'Рожден ден', date: '2025-05-17', start: '19:00', city: 'sofia', guests: 40 },
  { key: 's-bday26', client: 'stefka', type: 'rozhden-den', title: 'Рожден ден', date: '2026-05-30', city: 'sofia', guests: 40 },
  { key: 'b-prom', client: 'botev', type: 'abiturientski-bal', title: 'Абитуриентски бал', date: '2026-06-30', venue: 'Хотел „Маринела“', city: 'sofia', guests: 70 },
  { key: 'k-wed', client: 'kolev', type: 'svatba', title: 'Сватба', date: '2026-09-05', venue: 'Механа „Извора“', city: 'sofia', guests: 90 },
  { key: 'av-wed', client: 'anaviktor', type: 'svatba', title: 'Сватба', date: '2026-07-19', venue: 'Вила Роза', city: 'sofia', guests: 140 },
  { key: 'n-corp', client: 'netera', type: 'firmeno-sabitie', title: 'Фирмено събитие', date: '2025-04-26', city: 'sofia', guests: 120 },
  { key: 'd-wed', client: 'denitsa', type: 'svatba', title: 'Сватба', date: '2025-05-09', city: 'sofia', guests: 100 },
  { key: 'r-wed', client: 'ralitsa', type: 'svatba', title: 'Сватба', date: '2025-04-26', city: 'sofia', guests: 100 },
];

// ── S7 Requests and bookings ──────────────────────────────────────────────

/** A request that never became a booking. */
export type OpenRequestSeed = {
  number?: string; client: string; partner: string; service: string; event: string; kind: 'package' | 'quote';
  title: string; summary?: string; amountCents: number | null; sentAt: string;
  status: 'pending' | 'declined'; declinedAt?: string; start?: string; end?: string; guests?: number;
};
export const OPEN_REQUESTS: OpenRequestSeed[] = [
  { number: '2026-1219-КТ', client: 'maria', partner: 'vkusna-istoriya', service: 'vi-xmas', event: 'm-xmas', kind: 'package',
    title: 'Коледно меню за 40 гости', amountCents: 198_000, sentAt: '2025-08-31 09:45' /* D89 */, status: 'pending' },
  { number: '2026-0614-КТ', client: 'maria', partner: 'vkusna-istoriya', service: 'vi-garden', event: 'm-wedding', kind: 'package',
    title: 'Меню „Градина“ за 120 гости', amountCents: 360_000, sentAt: '2025-08-31 10:02', status: 'pending' },
  { number: '2026-0614-ДК', client: 'maria', partner: 'flora-studio', service: 'fl-arch', event: 'm-wedding', kind: 'package',
    title: 'Арка, маси и букет', amountCents: 118_000, sentAt: '2025-08-30 18:00', status: 'pending' },
  { number: '2026-0614-ФТ', client: 'maria', partner: 'ana-petrova-photography', service: 'ap-full', event: 'm-wedding', kind: 'package',
    title: 'Цял ден с втори фотограф', amountCents: 190_000, sentAt: '2025-08-09 14:15', status: 'declined', declinedAt: '2025-08-10 10:00' /* time (a) */ },
  { number: '2026-1219-ФК', client: 'maria', partner: 'snap360', service: 'sn-3h', event: 'm-xmas', kind: 'package',
    title: 'Фотокабина · 3 часа с оператор и реквизит', amountCents: 42_000, sentAt: '2025-08-08 09:40', status: 'declined', declinedAt: '2025-08-09 09:00' /* time (a) */ },
  // D92: Ивелина's request to Студио Мелодия (vendor/messages.html: 20:00 – 01:00, 40 гости).
  { client: 'ivelina', partner: 'studio-melodiya', service: 'sm-evening', event: 'i-bday', kind: 'package',
    title: 'Пакет „Вечер“', summary: '5 часа музика', amountCents: 64_000, sentAt: '2025-08-31 07:00', status: 'pending' },
  // D91: Технолинк's quote to Студио Мелодия, no amount.
  { client: 'technolink', partner: 'studio-melodiya', service: 'sm-corporate', event: 't-corp', kind: 'quote',
    title: 'Фирмени събития', summary: 'тиймбилдинг вечер', amountCents: null, sentAt: '2025-08-30 14:00', status: 'pending' },
];

export type BookingSeed = {
  /** null = allocated by the seed (D2). */
  number: string | null;
  client: string; partner: string; service: string; event: string; kind?: 'package' | 'quote';
  title: string; summary?: string; amountCents: number;
  /** The amount on the request when it differs from the booking (2026-0621-ТЛ). */
  requestAmountCents?: number;
  status: BookingStatus;
  sentAt: string; approvedAt: string;
  /** First succeeded charge. */
  paidAt?: string;
  /** A second succeeded charge, flagged duplicate (2025-0426-ФТ). */
  duplicatePaidAt?: string;
  /** Quote bookings: the chosen offer. */
  offer?: { title: string; sentAt: string; chosenAt: string };
  start?: string | null; end?: string | null; guests?: number; venue?: string; locality?: string;
  spaceType?: SpaceType; note?: string; attachments?: string[];
  payoutHold?: boolean;
  reviewState?: 'not_due' | 'invited' | 'reviewed';
  cancellation?: { at: string; reason: 'event_cancelled'; daysBefore: number; retainedCents: number; refundCents: number };
  /** Last change of the booking row when the prototype dates one. */
  updatedAt?: string;
};

// Times marked (a) follow one rule: sent 09:00, approved 11:00, paid 14:00 on the paid date (2026-0614-ЕА's pattern).
export const BOOKINGS: BookingSeed[] = [
  { number: '2026-0614-ЕА', client: 'maria', partner: 'studio-melodiya', service: 'sm-full', event: 'm-wedding',
    title: 'Пакет „Цял ден“', summary: 'DJ, озвучаване и осветление', amountCents: 145_000, status: 'confirmed',
    sentAt: '2025-08-12 09:24', approvedAt: '2025-08-12 11:06', paidAt: '2025-08-12 14:05' /* time (a) */,
    spaceType: 'garden_hall',
    note: 'Здравейте! Търсим DJ за сватбата ни във Вила Екатерина. Държим на жива атмосфера — микс от български и чуждестранни парчета, без прекалено силна музика по време на вечерята. Възможно ли е да включите и микрофон за тостовете? Ще се радвам да чуя вашето предложение.',
    attachments: ['dancers', 'v1-dj-perf', 'decorator'] },
  { number: '2026-0614-МЗ', client: 'maria', partner: 'kvartet-adazhio', service: 'ad-ceremony', event: 'm-wedding',
    title: 'Церемония и коктейл, 90 минути', amountCents: 74_000, status: 'confirmed', start: '16:00' /* D87 */, end: null,
    sentAt: '2025-08-08 09:00', approvedAt: '2025-08-08 11:00', paidAt: '2025-08-08 14:00' },
  { number: '2026-0614-ФК', client: 'maria', partner: 'snap360', service: 'sn-4h', event: 'm-wedding',
    title: 'Фотокабина · 4 часа с оператор и реквизит', amountCents: 56_000, status: 'confirmed', start: '20:00', end: '24:00',
    sentAt: '2025-08-07 09:00', approvedAt: '2025-08-07 11:00', paidAt: '2025-08-07 14:00', payoutHold: true },
  // D31: a quote booking on ‹Фирмени събития›; admin/client.html shows its number.
  { number: '2026-1219-ЕА', client: 'maria', partner: 'studio-melodiya', service: 'sm-corporate', event: 'm-xmas', kind: 'quote',
    title: 'Парти програма, 5 часа', amountCents: 68_000, status: 'confirmed', start: '20:00', end: null,
    offer: { title: 'Парти програма, 5 часа', sentAt: '2025-08-04 16:00', chosenAt: '2025-08-05 09:00' },
    sentAt: '2025-08-04 10:00', approvedAt: '2025-08-05 11:00', paidAt: '2025-08-05 14:00' },
  { number: '2026-1219-ТД', client: 'maria', partner: 'sladkarnitsa-med-i-mlyako', service: 'mm-xmas', event: 'm-xmas',
    title: 'Коледна торта за 40 гости', amountCents: 42_000, status: 'confirmed', start: '21:30', end: null,
    sentAt: '2025-08-06 09:00', approvedAt: '2025-08-06 11:00', paidAt: '2025-08-06 14:00' },
  { number: '2025-0424-СЛ', client: 'maria', partner: 'sladkarnitsa-med-i-mlyako', service: 'mm-cake', event: 'm-anniv',
    title: 'Торта и десерти', amountCents: 38_000, status: 'completed', reviewState: 'invited',
    sentAt: '2025-04-10 09:00', approvedAt: '2025-04-10 11:00', paidAt: '2025-04-10 14:00' },
  { number: '2026-1219-ДК', client: 'maria', partner: 'flora-studio', service: 'fl-xmas', event: 'm-xmas',
    title: 'Коледна украса на залата и масите', amountCents: 46_000, status: 'awaiting_payment',
    sentAt: '2025-08-30 11:05', approvedAt: '2025-08-31 07:40' },
  { number: null, client: 'kolev', partner: 'studio-melodiya', service: 'sm-full', event: 'k-wed',
    title: 'Пакет „Цял ден“', summary: 'DJ, озвучаване и осветление', amountCents: 145_000, status: 'awaiting_payment',
    sentAt: '2025-08-30 20:00' /* (a) */, approvedAt: '2025-08-31 09:14' },
  { number: '2026-0630-АБ', client: 'botev', partner: 'studio-melodiya', service: 'sm-evening', event: 'b-prom',
    title: 'Пакет „Вечер“', summary: '5 часа музика', amountCents: 64_000, status: 'confirmed',
    sentAt: '2025-08-20 09:00', approvedAt: '2025-08-20 11:00', paidAt: '2025-08-20 14:00' },
  { number: null, client: 'anaviktor', partner: 'studio-melodiya', service: 'sm-full', event: 'av-wed',
    title: 'Пакет „Цял ден“', summary: 'DJ, озвучаване и осветление', amountCents: 145_000, status: 'confirmed',
    sentAt: '2025-08-25 09:00', approvedAt: '2025-08-25 11:00', paidAt: '2025-08-25 14:00' },
  { number: null, client: 'petya', partner: 'studio-melodiya', service: 'sm-full', event: 'p-wed25',
    title: 'Пакет „Цял ден“', summary: 'DJ, озвучаване и осветление', amountCents: 145_000, status: 'completed', reviewState: 'reviewed',
    sentAt: '2025-04-15 09:00', approvedAt: '2025-04-15 11:00', paidAt: '2025-04-15 14:00' },
  { number: null, client: 'stefka', partner: 'studio-melodiya', service: 'sm-evening', event: 's-bday25',
    title: 'Пакет „Вечер“', summary: '5 часа музика', amountCents: 64_000, status: 'completed', reviewState: 'reviewed',
    sentAt: '2025-04-02 09:00', approvedAt: '2025-04-02 11:00', paidAt: '2025-04-02 14:00' },
  { number: null, client: 'netera', partner: 'studio-melodiya', service: 'sm-corporate', event: 'n-corp', kind: 'quote',
    title: 'Фирмени събития' /* (a) offer title */, amountCents: 190_000, status: 'completed', reviewState: 'reviewed',
    offer: { title: 'Фирмени събития', sentAt: '2025-02-09 09:00' /* before the 24 h deadline (R4) */, chosenAt: '2025-02-10 09:00' },
    sentAt: '2025-02-08 10:00', approvedAt: '2025-02-10 11:00', paidAt: '2025-02-10 14:00' },
  // ‹Датата беше блокирана от февруари› (admin/dispute.html 0509).
  { number: '2025-0509-СВ', client: 'denitsa', partner: 'studio-melodiya', service: 'sm-full', event: 'd-wed',
    title: 'Пакет „Цял ден“', summary: 'DJ, озвучаване и осветление', amountCents: 145_000, status: 'cancelled',
    sentAt: '2025-02-20 09:00', approvedAt: '2025-02-20 11:00', paidAt: '2025-02-20 14:00',
    cancellation: { at: '2025-05-05 10:00' /* time (a) */, reason: 'event_cancelled' /* (a) */, daysBefore: 4, retainedCents: 145_000, refundCents: 0 } },
  { number: '2026-0607-СВ', client: 'petya', partner: 'flora-studio', service: 'fl-arch', event: 'p-wed26',
    title: 'Арка, маси и букет', summary: 'монтаж на място', amountCents: 118_000, status: 'confirmed', payoutHold: true,
    sentAt: '2025-08-14 09:00', approvedAt: '2025-08-14 11:00', paidAt: '2025-08-14 14:00' },
  { number: '2026-0621-ТЛ', client: 'technolink', partner: 'vkusna-istoriya', service: 'vi-garden', event: 't-corp',
    title: 'Кетъринг · меню „Градина“', summary: '100 гости', guests: 100, amountCents: 360_000, requestAmountCents: 320_000,
    status: 'awaiting_payment', payoutHold: true,
    sentAt: '2025-08-30 10:00' /* (a) */, approvedAt: '2025-08-30 18:20',
    updatedAt: '2025-08-31 08:15' /* ‹Офертата за плащане стана 3 600 €› (case timeline) */ },
  { number: '2026-0628-ФК', client: 'ivelina', partner: 'snap360', service: 'sn-4h', event: 'i-bday',
    title: 'Фотокабина · 4 часа с оператор и реквизит', amountCents: 56_000, status: 'confirmed',
    sentAt: '2025-08-18 09:00', approvedAt: '2025-08-18 11:00', paidAt: '2025-08-18 14:00' },
  { number: '2026-0628-КТ', client: 'ivelina', partner: 'vkusna-istoriya', service: 'vi-garden', event: 'i-bday',
    title: 'Кетъринг', amountCents: 128_000, status: 'confirmed',
    sentAt: '2025-08-19 09:00', approvedAt: '2025-08-19 11:00', paidAt: '2025-08-19 14:00' },
  // D93: a normal confirmed booking.
  { number: '2026-0530-РД', client: 'stefka', partner: 'snap360', service: 'sn-4h', event: 's-bday26',
    title: 'Фотокабина · 4 часа с оператор и реквизит', amountCents: 56_000, status: 'confirmed',
    sentAt: '2025-08-21 09:00', approvedAt: '2025-08-21 11:00', paidAt: '2025-08-21 14:00' },
  { number: '2025-0517-РД', client: 'stefka', partner: 'vkusna-istoriya', service: 'vi-garden', event: 's-bday25',
    title: 'Кетъринг', summary: 'сервиране от 19:00', amountCents: 128_000, status: 'completed', reviewState: 'invited',
    sentAt: '2025-04-01 09:00', approvedAt: '2025-04-01 11:00', paidAt: '2025-04-01 14:00' },
  // Two identical charges within a minute; the second is the duplicate.
  { number: '2025-0426-ФТ', client: 'ralitsa', partner: 'ana-petrova-photography', service: 'ap-full', event: 'r-wed',
    title: 'Цял ден с втори фотограф', amountCents: 190_000, status: 'completed', reviewState: 'invited',
    sentAt: '2025-03-12 09:00', approvedAt: '2025-03-12 11:00', paidAt: '2025-03-12 14:00', duplicatePaidAt: '2025-03-12 14:00:40' },
];

/** S7: Студио Мелодия's invoices in paid_at order end at 0000000412 for 2026-0614-ЕА (and 414 for Ана и Виктор). */
export const STUDIO_MELODIA_FIRST_INVOICE = 407;

// ── S9 Disputes (admin/dispute.html CASES, verbatim) ──────────────────────

export type DisputeSeed = {
  number: string; openedBy: DisputeParty; reason: DisputeReason; status: 'collecting' | 'awaiting_decision' | 'resolved';
  urgent?: boolean; holdsPayout: boolean; heldCents: number;
  title: string; summary: string; openedAt: string; positionRequestedAt: string; positionDueAt: string;
  facts: (string[])[]; agreed: (string[])[]; comparison?: [string, string, boolean][]; note?: string;
  statements: { party: DisputeParty; at: string; body: string; context: string; docs?: { label: string; mime: 'application/pdf' | 'image/png' }[]; pics?: string[] }[];
  options?: { kind: DisputeDecisionKind; label: string; description: string; refundCents?: number; newAmountCents?: number }[];
  decision?: { kind: DisputeDecisionKind; title: string; detail: string; motive: string; refundCents: number; partnerKeepsCents: number; at: string };
};

export const DISPUTES: DisputeSeed[] = [
  {
    number: '2026-0607-СВ', openedBy: 'client', reason: 'other', status: 'awaiting_decision', urgent: true, holdsPayout: true, heldCents: 118_000,
    title: 'Изпълнителят не потвърждава монтажа',
    summary: 'Петя и Николай искат писмено потвърждение, че Флора Студио ще монтира арката и масите между 13:00 и 16:00 — от 13:00 залата пуска екипите, а в 16:00 започва церемонията. Флора Студио не отказва, но казва, че монтажът отнема около три часа, и иска по-ранен достъп. Спорът е за часа на монтажа, а не за качеството на услугата.',
    openedAt: '2025-08-28 09:12', positionRequestedAt: '2025-08-28 10:40', positionDueAt: '2025-08-30 10:40',
    facts: [['Искат клиентите', 'Потвърждение за 13:00–16:00 или анулиране с пълно възстановяване'],
      ['Предлага изпълнителят', 'Достъп от 11:00 или арка, сглобена предварително'],
      ['За парите', 'Могат да анулират без такси до 31 май 2026 — гъвкава политика']],
    agreed: [['Резервация', '2026-0607-СВ', 'платена'], ['Събитие', 'Сватба · 07 юни 2026', '90 гости'],
      ['Услуга', 'Арка, маси и букет', 'монтаж на място'], ['Час за монтаж', 'Не е посочен в офертата', '', 'key'],
      ['Сума', '1 180,00 €', 'задържани до деня след събитието'], ['Анулиране', 'Гъвкава политика', 'пълно възстановяване до 31 май 2026']],
    note: 'Офертата не определя час за монтаж — затова спорът не е за нарушено условие, а за неуточнено.',
    statements: [
      { party: 'client', at: '2025-08-28 09:12', context: 'причина: „Друго“',
        body: 'Залата ни пуска екипите от 13:00, а церемонията е в 16:00. От три седмици питаме Флора Студио дали ще монтират арката и масите в този прозорец и не получаваме ясен отговор. Искаме го писмено. Ако не могат, предпочитаме да анулираме сега, докато има време да намерим друг декоратор.',
        docs: [{ label: 'Правила на залата · PDF', mime: 'application/pdf' }] },
      { party: 'partner', at: '2025-08-29 14:05', context: 'в отговор на запитване от екипа',
        body: 'Ще монтираме — не отказваме. Арката е с живи цветя и отнема около три часа, така че при достъп от 13:00 ще е готова точно за 16:00, без никакъв резерв. Предложихме залата да ни пусне от 11:00 или да донесем арката сглобена. Клиентите искат точно вида от снимките, затова още не сме потвърдили час.',
        pics: ['decorator', 'bouquet'] },
    ],
    options: [
      { kind: 'enforce_terms', label: 'Задължи Флора Студио да потвърди монтажа', description: 'Писмено потвърждение за 13:00–16:00 до 3 септември. Ако не дойде, резервацията се анулира с пълно възстановяване.' },
      { kind: 'cancel_full_refund', label: 'Анулирай с пълно възстановяване', description: '1 180 € към клиентите. Политиката на изпълнителя го позволява и без решение на екипа.', refundCents: 118_000 },
      { kind: 'no_refund', label: 'Затвори без промяна', description: 'Офертата не определя час — страните го уточняват със залата.' },
    ],
  },
  {
    number: '2026-0614-ФК', openedBy: 'client', reason: 'not_as_described', status: 'collecting', holdsPayout: true, heldCents: 56_000,
    title: 'Обхватът е по-малък от обявения',
    summary: 'Мария Димитрова е платила фотокабина за 4 часа от 20:00. Snap360 ѝ е писал, че на 14 юни може да остане само 3 часа, защото има второ събитие същата вечер. Мария иска пълните 4 часа или разликата обратно. Snap360 още не е отговорил на екипа.',
    openedAt: '2025-08-29 11:30', positionRequestedAt: '2025-08-29 12:10', positionDueAt: '2025-08-31 12:10',
    facts: [['Иска клиентът', '4 часа, както е платено, или разликата обратно'],
      ['Разликата', '140 € — пакетът за 3 часа струва 420 €'],
      ['Срок за изпълнителя', 'Изтича днес в 12:10', 'warn']],
    agreed: [['Резервация', '2026-0614-ФК', 'платена на 07.08.2025'], ['Събитие', 'Сватба · 14 юни 2026', 'Вила Екатерина'],
      ['Услуга', 'Фотокабина', '4 часа с оператор и реквизит'], ['Час', 'От 20:00', 'до 24:00 по резервацията', 'key'],
      ['Сума', '560,00 €', 'задържани до 15 юни 2026'], ['Анулиране', 'Гъвкава политика', 'пълно възстановяване до 07 юни 2026']],
    comparison: [['Платено', '4 часа · 20:00–24:00 · 560 €', false], ['Предлага Snap360', '3 часа · 20:00–23:00 · пакетът за 3 часа е 420 €', true]],
    statements: [
      { party: 'client', at: '2025-08-29 11:30', context: 'причина: „Услугата не беше по описание“',
        body: 'Платих фотокабина за 4 часа с оператор и реквизит — така пише и в резервацията. В последното съобщение Snap360 ми пише, че на 14 юни могат да останат само 3 часа, от 20:00 до 23:00, защото имат второ събитие. Искам или 4 часа, както е платено, или разликата обратно.',
        docs: [{ label: 'Съобщение от Snap360 · снимка на екрана', mime: 'image/png' }] },
    ],
    options: [
      { kind: 'enforce_terms', label: 'Задължи Snap360 да осигури 4 часа', description: '20:00–24:00, както е платено. Сумата остава задържана до събитието.' },
      { kind: 'partial_refund', label: 'Върни разликата — 140 €', description: '140 € към Мария, 420 € остават за Snap360 — цената на пакета за 3 часа.', refundCents: 14_000 },
      { kind: 'cancel_full_refund', label: 'Анулирай с пълно възстановяване', description: '560 € към Мария. Датата на Snap360 се освобождава.', refundCents: 56_000 },
    ],
  },
  {
    number: '2026-0621-ТЛ', openedBy: 'client', reason: 'payment_problem', status: 'collecting', holdsPayout: true, heldCents: 0,
    title: 'Цената е променена след потвърждение',
    summary: 'Вкусна История одобри заявката на Технолинк за 3 200 €. Преди Технолинк да плати, сумата в офертата стана 3 600 € — по нова цена на гост, която Вкусна История подаде днес и която още чака одобрение в Модерация. Технолинк иска да плати одобрената сума, а срокът им за плащане изтича след 4 часа.',
    openedAt: '2025-08-31 08:52', positionRequestedAt: '2025-08-31 09:05', positionDueAt: '2025-09-02 09:05',
    facts: [['Иска клиентът', 'Да плати одобрените 3 200 €'],
      ['Разликата', '+400 € — 32 € вместо 28 € на гост'],
      ['Срок за плащане', 'Изтича след 4 часа', 'warn']],
    agreed: [['Резервация', '2026-0621-ТЛ', 'чака плащане'], ['Събитие', 'Фирмено събитие · 21 юни 2026', 'София Тех Парк'],
      ['Услуга', 'Кетъринг · меню „Градина“', '100 гости'], ['Анулиране', 'Умерена политика', 'пълно възстановяване до 22 май 2026']],
    comparison: [['Одобрено на 30 август', '3 200 € · 100 гости × 28 € + сервиране 400 €', false], ['За плащане днес', '3 600 € · 100 гости × 32 € + сервиране 400 €', true]],
    note: 'Новата цена на гост е подадена в Модерация и още не е одобрена.',
    statements: [
      { party: 'client', at: '2025-08-31 08:52', context: 'причина: „Проблем с плащането“',
        body: 'Вкусна История одобри заявката ни вчера за 3 200 €. Днес, когато отидохме да платим, сумата е 3 600 €. Никой не ни е питал за нова цена. Искаме да платим одобрената сума — и да не изгубим датата, докато въпросът се реши.',
        docs: [{ label: 'Одобрена оферта · 30 август', mime: 'application/pdf' }] },
    ],
    options: [
      { kind: 'restore_price', label: 'Върни одобрената цена', description: 'Офертата се връща на 3 200 €, а Технолинк получава нови 24 часа за плащане.', newAmountCents: 320_000 },
      { kind: 'accept_new_price', label: 'Приеми новата цена', description: '3 600 €. Технолинк решава дали да плати.', newAmountCents: 360_000 },
      { kind: 'cancel_unpaid', label: 'Анулирай заявката без такси', description: 'Нищо не е платено — датата се освобождава и за двете страни.' },
    ],
  },
  {
    number: '2026-0630-АБ', openedBy: 'partner', reason: 'client_unresponsive', status: 'collecting', holdsPayout: false /* D13 */, heldCents: 64_000,
    title: 'Клиентът не отговаря',
    summary: 'Студио Мелодия има платена резервация за абитуриентския бал на СУ „Христо Ботев“. От юли не може да се свърже с училището, за да уточни програмата и техниката с хотел „Маринела“. Не иска пари и не иска да анулира — иска контакт с отговорното лице.',
    openedAt: '2025-08-30 16:20', positionRequestedAt: '2025-08-30 16:30', positionDueAt: '2025-09-01 16:30',
    facts: [['Иска изпълнителят', 'Контакт с отговорното лице в училището'],
      ['Пари', 'Не са предмет на сигнала'],
      ['Срок за клиента', '1 септември, 16:30']],
    agreed: [['Резервация', '2026-0630-АБ', 'платена'], ['Събитие', 'Абитуриентски бал · 30 юни 2026', 'Хотел „Маринела“'],
      ['Услуга', 'Пакет „Вечер“', 'DJ и озвучаване'], ['Сума', '640,00 €', 'задържани до деня след събитието'],
      ['Анулиране', 'Умерена политика', 'пълно възстановяване до 31 май 2026']],
    statements: [
      { party: 'partner', at: '2025-08-30 16:20', context: 'причина: „Клиентът не отговаря“',
        body: 'Резервацията е платена, но от началото на юли не получаваме отговор от училището — нито в платформата, нито на имейла им. Трябва да уточним програмата и часа за саундчек с хотел „Маринела“. Не искаме да анулираме. Молим екипа да ни свърже с някого от класа или от ръководството.',
        docs: [{ label: 'Разговор в платформата · 4 съобщения без отговор', mime: 'application/pdf' }] },
    ],
    options: [
      { kind: 'mediate', label: 'Свържи страните чрез екипа', description: 'Обаждаме се на училището и даваме на Студио Мелодия контакт на отговорното лице. Резервацията продължава.' },
      { kind: 'close', label: 'Затвори сигнала', description: 'Училището е отговорило или намесата не е нужна.' },
    ],
  },
  {
    number: '2025-0517-РД', openedBy: 'client', reason: 'other', status: 'resolved', holdsPayout: true, heldCents: 0,
    title: 'Закъснение над 2 часа',
    summary: 'Кетърингът за рождения ден на Стефка Илиева пристигна в 21:10 вместо в 19:00, без да предупреди. Вкусна История потвърди закъснението; менюто беше сервирано изцяло. Екипът върна 30% от сумата на клиента.',
    openedAt: '2025-05-18 10:05', positionRequestedAt: '2025-05-18 10:05', positionDueAt: '2025-05-20 10:05',
    facts: [['Решение', 'Частично възстановяване — 30%'], ['Върнати на клиента', '384 €'], ['Остават за изпълнителя', '896 €']],
    agreed: [['Резервация', '2025-0517-РД', 'платена'], ['Събитие', 'Рожден ден · 17 май 2025', 'начало 19:00'],
      ['Услуга', 'Кетъринг', 'сервиране от 19:00', 'key'], ['Сума', '1 280,00 €', '']],
    statements: [
      { party: 'client', at: '2025-05-18 10:05', context: 'причина: „Друго“',
        body: 'Поръчахме кетъринг за 19:00 и гостите вече бяха на масите. Екипът пристигна в 21:10, без да ни предупреди. Храната беше хубава, но половината вечер мина в чакане.' },
      { party: 'partner', at: '2025-05-19 09:40', context: 'в отговор на запитване от екипа',
        body: 'Закъсняхме заради катастрофа на околовръстното — прилагаме маршрута от навигацията. Трябваше да предупредим веднага и съжаляваме. Сервирахме цялото меню и останахме до края.',
        docs: [{ label: 'Маршрут · снимка на екрана', mime: 'image/png' }] },
    ],
    decision: { kind: 'partial_refund', title: 'Частично възстановяване — 30%', detail: '384 € на Стефка Илиева, 896 € за Вкусна История.',
      motive: 'Закъснението от 2 часа и 10 минути е потвърдено и от двете страни, а клиентът не е бил предупреден. Менюто е сервирано изцяло, затова връщаме 30%, а не цялата сума.',
      refundCents: 38_400, partnerKeepsCents: 89_600, at: '2025-05-20 11:30' },
  },
  {
    number: '2025-0509-СВ', openedBy: 'client', reason: 'other', status: 'resolved', holdsPayout: true, heldCents: 0,
    title: 'Анулиране от клиента извън срок',
    summary: 'Деница и Иван анулираха сватбата 4 дни преди датата и поискаха сумата обратно. Студио Мелодия работи с умерена политика — в последните 7 дни сумата не се връща. Екипът приложи политиката.',
    openedAt: '2025-05-06 18:30', positionRequestedAt: '2025-05-06 18:30', positionDueAt: '2025-05-08 18:30',
    facts: [['Решение', 'Без възстановяване'], ['Върнати на клиента', '0 €'], ['Остават за изпълнителя', '1 450 €']],
    agreed: [['Резервация', '2025-0509-СВ', 'платена'], ['Събитие', 'Сватба · 09 май 2025', ''],
      ['Услуга', 'Пакет „Цял ден“', 'DJ, озвучаване и осветление'], ['Сума', '1 450,00 €', ''],
      ['Анулиране', 'Умерена политика', 'в последните 7 дни сумата не се връща', 'key'], ['Анулирано', '05 май 2025', '4 дни преди събитието', 'key']],
    statements: [
      { party: 'client', at: '2025-05-06 18:30', context: 'причина: „Друго“',
        body: 'Анулирахме сватбата по семейни причини. До датата има още 4 дни и смятаме, че изпълнителят може да я предложи на други. Молим поне за частично връщане на сумата.' },
      { party: 'partner', at: '2025-05-07 10:15', context: 'в отговор на запитване от екипа',
        body: 'Съжаляваме за обстоятелствата. Датата беше блокирана от февруари и отказахме две други запитвания за нея. В последната седмица не можем да я продадем отново.' },
    ],
    decision: { kind: 'no_refund', title: 'Без възстановяване', detail: 'Политиката на изпълнителя е приложена — 1 450 € остават за Студио Мелодия.',
      motive: 'Анулирането е 4 дни преди събитието. По умерената политика в последните 7 дни сумата не се връща, а клиентите са я приели при плащането. Изпълнителят е отказал други запитвания за тази дата.',
      refundCents: 0, partnerKeepsCents: 145_000, at: '2025-05-11 10:00' },
  },
  {
    number: '2025-0426-ФТ', openedBy: 'client', reason: 'payment_problem', status: 'resolved', holdsPayout: true, heldCents: 0,
    title: 'Двойно плащане',
    summary: 'Картата на Ралица и Георги беше таксувана два пъти за една и съща резервация при Ана Петрова Photography. Второто плащане беше върнато изцяло; изпълнителят нямаше възражения.',
    openedAt: '2025-04-25 21:40', positionRequestedAt: '2025-04-25 21:40', positionDueAt: '2025-04-27 21:40',
    facts: [['Решение', 'Пълно възстановяване на второто плащане'], ['Върнати на клиента', '1 900 €'], ['Остават за изпълнителя', '1 900 € — едно плащане']],
    agreed: [['Резервация', '2025-0426-ФТ', 'платена'], ['Събитие', 'Сватба · 26 април 2025', ''],
      ['Услуга', 'Цял ден с втори фотограф', ''], ['Сума', '1 900,00 €', 'таксувана два пъти', 'key']],
    statements: [
      { party: 'client', at: '2025-04-25 21:40', context: 'причина: „Проблем с плащането“',
        body: 'Платихме фотографа веднъж, а от сметката са изтеглени две еднакви суми от по 1 900 € — прилагаме извлечението. Моля, върнете второто плащане.',
        docs: [{ label: 'Извлечение от банката · PDF', mime: 'application/pdf' }] },
      { party: 'partner', at: '2025-04-26 09:10', context: 'в отговор на запитване от екипа',
        body: 'При нас е постъпило едно плащане по резервацията. Нямаме нищо против второто да бъде върнато.' },
    ],
    decision: { kind: 'refund_duplicate', title: 'Пълно възстановяване на второто плащане', detail: '1 900 € обратно на клиентите. Резервацията остава платена веднъж.',
      motive: 'Банката потвърждава две еднакви тегления в рамките на минута. Второто е техническа грешка и се връща изцяло; изпълнителят е съгласен.',
      refundCents: 190_000, partnerKeepsCents: 190_000, at: '2025-04-27 09:30' },
  },
];

/** Refund completion times (S7/S9): 2025-0517-РД on 21 May (time a), the duplicate at the decision. */
export const REFUND_SUCCEEDED_AT: Record<string, string> = {
  '2025-0517-РД': '2025-05-21 10:00',
  '2025-0426-ФТ': '2025-04-27 09:30',
};

// ── S8 Payout batches (all paid; release and payment times (a): 10:00 on the batch date) ──

export const PAID_BATCHES = [
  { date: '2025-05-01', label: 'Партида април · втора половина' },
  { date: '2025-05-15', label: 'Партида май · първа половина' },
  { date: '2025-06-01', label: 'Партида май · втора половина' },
];
/** The next batch: created `scheduled`, no lines (S8). */
export const NEXT_BATCH = { date: '2025-09-01', label: 'Партида август · втора половина' };

// ── S10 Messages ──────────────────────────────────────────────────────────

export type ThreadSeed = {
  client: string; partner: string; event: string;
  /** The booking the thread is about; the latest request between the two for the event is linked either way. */
  bookingNumber?: string;
  clientDraft?: string;
  /** [sender, Sofia time, text, read?]; `read` defaults to true. */
  messages: [('client' | 'partner'), string, string, boolean?][];
};
export const THREADS: ThreadSeed[] = [
  { client: 'maria', partner: 'studio-melodiya', event: 'm-wedding', bookingNumber: '2026-0614-ЕА',
    clientDraft: 'Благодаря! Ще изпратя списъка с песните в петък.',
    messages: [
      ['client', '2025-08-29 18:20', 'Здравейте! Церемонията ще е в градината на Вила Екатерина, а партито — в залата. Ще можете ли да озвучите и двете места?'],
      ['partner', '2025-08-29 19:05', 'Добър вечер, г-жо Димитрова. Да — за церемонията носим отделна колона и два безжични микрофона. Всичко е включено в пакет „Цял ден“.'],
      ['client', '2025-08-31 10:12', 'Чудесно. В колко часа ще дойдете за подготовка?'],
      ['partner', '2025-08-31 10:40', 'Ще бъдем на място в 15:30 — час и половина преди гостите, за да настроим звука.'],
      ['client', '2025-08-31 11:05', 'Разбрахме се. До петък ще ви изпратя списък с 15 песни, които държим да се чуят.'],
      ['partner', '2025-08-31 11:42', 'Очакваме го. Ако има песни, които не искате да звучат, добавете ги в отделен списък — няма да ги пускаме.', false],
    ] },
  { client: 'maria', partner: 'vkusna-istoriya', event: 'm-xmas',
    messages: [
      ['client', '2025-08-31 09:50', 'Здравейте! Може ли менюто да включва и вегетариански предложения?'],
      ['partner', '2025-08-31 10:35', 'Подготвяме предложение за коледното меню за 40 гости — с две вегетариански ястия. Ще го изпратим до довечера.', false],
    ] },
  // The booking awaits payment: the thread's context link reads ‹Виж заявката› from the booking's status.
  { client: 'maria', partner: 'flora-studio', event: 'm-xmas', bookingNumber: '2026-1219-ДК',
    messages: [
      ['client', '2025-08-29 16:20', 'Здравейте! Търсим коледна украса на залата и арка за снимки за 19 декември.'],
      ['partner', '2025-08-31 07:40', 'Одобрихме заявката — датата е запазена до плащането. Имате 24 часа да платите, за да я потвърдим.', false],
    ] },
  { client: 'maria', partner: 'kvartet-adazhio', event: 'm-wedding', bookingNumber: '2026-0614-МЗ',
    messages: [
      ['client', '2025-08-29 14:10', 'Здравейте! Церемонията започва в 17:00. Кога ще дойдете на място?'],
      ['partner', '2025-08-29 14:35', 'Ще дойдем за саундчек около 15:00 — два часа преди гостите.'],
    ] },
  { client: 'maria', partner: 'snap360', event: 'm-wedding', bookingNumber: '2026-0614-ФК',
    messages: [
      ['client', '2025-08-27 11:20', 'Може ли реквизитът да включва и рамки с наш надпис?'],
      ['partner', '2025-08-27 12:05', 'Реквизитът е потвърден — носим и рамки с ваш надпис. Ще ги подготвим седмица преди събитието.'],
    ] },
  { client: 'maria', partner: 'sladkarnitsa-med-i-mlyako', event: 'm-xmas', bookingNumber: '2026-1219-ТД',
    messages: [
      ['client', '2025-08-25 16:40', 'Здравейте! Тортата за коледното парти — кога да уточним вкусовете?'],
      ['partner', '2025-08-25 17:15', 'Вкусовете за тортата ще уточним през ноември — тогава ще имаме и сезонните плодове.'],
    ] },
  // vendor/messages.html, verbatim.
  { client: 'ivelina', partner: 'studio-melodiya', event: 'i-bday',
    messages: [
      ['client', '2025-08-31 09:45', 'Здравейте, интересува ме пакет „Вечер“ за 40 гости в ресторант „Тера“.', false],
      ['client', '2025-08-31 09:47', 'Празненството е на 28 юни, от 20:00 до 01:00. Свободни ли сте?', false],
    ] },
  { client: 'technolink', partner: 'studio-melodiya', event: 't-corp',
    messages: [
      ['client', '2025-08-30 16:20', 'Добър ден! Търсим озвучаване за тиймбилдинг вечерта на 21 юни в София Тех Парк — очакваме около 250 души.'],
      ['partner', '2025-08-30 17:05', 'Добър ден! Датата е свободна. За 250 души предлагаме голямата система с два субуфера и техник на място през цялата вечер.'],
      ['client', '2025-08-30 18:40', 'Изпратихме ви програмата на вечерта за преглед — очакваме оферта.'],
    ] },
];

// ── S11 Reviews (Студио Мелодия; criteria = overall (a); published the day after the event (a)) ──

export const REVIEWS = [
  { partner: 'studio-melodiya', client: 'petya', event: 'p-wed25', author: 'Петя и Николай', serviceLabel: 'Пакет „Цял ден“', rating: 5,
    body: 'Страхотен професионалист! Музиката беше точно каквато си я представяхме, а гостите не слязоха от дансинга. Отзивчив на всяко съобщение преди събитието.',
    reply: 'Благодаря ви! Беше удоволствие — пожелавам ви много поводи за танци занапред.' },
  { partner: 'studio-melodiya', client: 'stefka', event: 's-bday25', author: 'Стефка Илиева', serviceLabel: 'Пакет „Вечер“', rating: 5,
    body: 'Всичко мина безупречно. Пристигна навреме, техниката беше на ниво, а плейлистът — точно по вкуса на гостите.' },
  { partner: 'studio-melodiya', client: 'netera', event: 'n-corp', author: 'Мартин Маринов', serviceLabel: 'По запитване', rating: 4,
    body: 'Много добра организация и звук. Единствената забележка е, че настройката отне малко повече време от очакваното, но резултатът си заслужаваше.',
    reply: 'Благодаря за обратната връзка — вече идваме час по-рано за зали с по-сложна акустика.' },
];

// ── S12 Saved searches, watches, bell ─────────────────────────────────────

export const SAVED_SEARCHES = [
  { title: 'Изпълнители за сватба · София · 14 юни 2026 · 120 гости', summary: 'Всички услуги · свободни на датата · рейтинг 4,5 и нагоре',
    params: { sabitie: 'svatba', grad: 'sofia', data: '2026-06-14', gosti: '120', reyting: '4.5' }, createdAt: '2025-08-12 12:00', notify: true },
  { title: 'Кетъринг · Коледно парти · 19 дек 2026 · 40 гости', summary: 'Коледно меню · София · до 2 500 €',
    params: { kategoriya: 'ketaring', q: 'коледно меню', grad: 'sofia', data: '2026-12-19', gosti: '40', 'cena-do': '2500' }, createdAt: '2025-08-21 12:00', notify: true },
  { title: 'Фотография · София · до 1 200 €', summary: 'Без избрана дата · рейтинг 4,5 и нагоре',
    params: { kategoriya: 'fotografiya', grad: 'sofia', 'cena-do': '1200', reyting: '4.5' }, createdAt: '2025-08-27 12:00', notify: false },
];

export const DATE_WATCHES = [
  { partner: 'ana-petrova-photography', date: '2026-06-14', event: 'm-wedding', createdAt: '2025-08-10 10:05' },
  { partner: 'snap360', date: '2026-12-19', event: 'm-xmas', createdAt: '2025-08-09 09:05' },
];

export type BellSeed = { to: 'maria' | 'studio-melodiya'; kind: string; title: string; body: string; href: string; at: string; read: boolean };
export const BELL: BellSeed[] = [
  { to: 'maria', kind: 'client-request-approved', title: 'Флора Студио одобри заявката ви', body: 'Платете до 1 септември 2025, 07:40, за да запазите датата',
    href: '/plashtane/2026-1219-ДК', at: '2025-08-31 07:40', read: false },
  // D89: a message notice, not an offer.
  { to: 'maria', kind: 'client-new-message', title: 'Вкусна История ви писа',
    body: 'Подготвяме предложение за коледното меню за 40 гости — с две вегетариански ястия. Ще го изпратим до довечера.',
    href: '/akaunt/saobshteniya', at: '2025-08-31 10:35', read: false },
  { to: 'maria', kind: 'client-booking-confirmed', title: 'Резервацията за 14 юни е потвърдена', body: 'Студио Мелодия · Пакет „Цял ден“',
    href: '/akaunt/rezervacii/2026-0614-ЕА', at: '2025-08-12 14:05', read: true },
  { to: 'studio-melodiya', kind: 'vendor-new-request', title: 'Нова заявка от Ивелина Тодорова', body: 'Рожден ден · 28 юни 2026 · отговорете до 24 часа',
    href: '/partner/zayavki/{ivelina-request}', at: '2025-08-31 07:00', read: false },
  { to: 'studio-melodiya', kind: 'vendor-booking-confirmed', title: 'Плащане получено · 1 305 €', body: 'Сватба · 14 юни · Мария и Стефан',
    href: '/partner/rezervacii/2026-0614-ЕА', at: '2025-08-12 14:05', read: true /* (a) */ },
  { to: 'studio-melodiya', kind: 'vendor-new-review', title: 'Ново ревю с 5 звезди', body: 'Стефка Илиева · „Всичко мина безупречно…“',
    href: '/partner/revyuta', at: '2025-05-18 12:00' /* (a) */, read: true /* (a) */ },
];

// ── S13 Team notes ────────────────────────────────────────────────────────

export const ADMIN_NOTES = [
  { subject: { client: 'maria' }, at: '2025-08-21 10:15',
    body: 'Помогнахме ѝ да смени датата на заявката към Флора Студио. Клиентът е коректен и отговаря бързо.' },
  { subject: { booking: '2026-0614-ЕА' }, at: '2025-08-12 15:40',
    body: 'Плащането постъпи още в деня на одобрението. Да напомним на изпълнителя седмица преди датата.' },
  { subject: { partner: 'lunna-fotografiya' }, at: '2025-08-29 12:05',
    body: 'Поисках уточнение за градовете, в които работи. Изпълнителят отговори още същия ден.' },
  { subject: { partner: 'lunna-fotografiya' }, at: '2025-08-29 16:20',
    body: 'Портфолиото е силно и последователно. Чакам само банката, за да одобря.' },
] as { subject: { client?: string; booking?: string; partner?: string }; at: string; body: string }[];
