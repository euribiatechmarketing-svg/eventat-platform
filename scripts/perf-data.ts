// npm run db:perf-data
// Launch-year volume ON TOP of the demo seed, for performance work only:
// ~1 500 approved partners (1–5 active services, gallery rows pointing at the
// existing /photos files), ~20 000 clients, ~30 000 requests, ~12 000 bookings
// (2025–2027) with charges and balanced ledger postings, ~8 000 reviews,
// ~40 000 messages, notifications and email_outbox rows.
//
// Local databases only (same guard as the seed). Run once after `npm run db:seed`;
// it refuses a database that already has perf rows. Deterministic (seeded PRNG).
// The demo users stay the busiest accounts so the measured pages can sign in:
// maria.dimitrova@gmail.com (client) and studio.melodia@gmail.com (partner).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';

const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { DEFAULT_URL, isResettableUrl, redact } = await import('./lib/schema-sync');
const url = process.env.DATABASE_URL ?? DEFAULT_URL;
if (!isResettableUrl(url)) {
  console.error(`Refusing to add perf data to a non-local database: ${redact(url)}`);
  process.exit(1);
}
const { sql } = await import('../db');
const { photo } = await import('./seed/photos');
const { SAMPLES } = await import('../lib/email/templates/samples');
const { TEMPLATES } = await import('../lib/email/templates');

const N = {
  partners: 1500, clients: 20_000, requests: 30_000, bookings: 12_000, reviews: 8_000, messages: 40_000,
  notifications: 60_000, emails: 50_000,
  busyClientBookings: 150, busyClientRequests: 400, busyPartnerPast: 200, busyPartnerFuture: 150, busyPartnerRequests: 800,
};

// ── deterministic randomness ───────────────────────────────────────────────
let seed = 0x5eed1234;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const DAY = 86_400_000, H = 3_600_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
const atNoon = (s: string) => new Date(`${s}T09:00:00Z`);

const NOW = new Date('2025-08-31T09:00:00Z'); // the demo clock: 31 Aug 2025, 12:00 Sofia
const TODAY = '2025-08-31';
const PAST_START = '2025-01-03', FUTURE_END = '2027-08-28';
const PAST_DAYS = (Date.parse(TODAY) - Date.parse(PAST_START)) / DAY - 1;
const FUTURE_DAYS = (Date.parse(FUTURE_END) - Date.parse(TODAY)) / DAY;

const FIRST = ['Иван', 'Георги', 'Димитър', 'Николай', 'Петър', 'Христо', 'Стефан', 'Мартин', 'Александър', 'Васил', 'Мария', 'Елена', 'Иванка', 'Десислава', 'Гергана', 'Петя', 'Надежда', 'Виктория', 'Радостина', 'Цветелина'];
const LAST_M = ['Иванов', 'Георгиев', 'Димитров', 'Петров', 'Николов', 'Стоянов', 'Христов', 'Тодоров', 'Колев', 'Маринов'];
const LAST_F = LAST_M.map(l => `${l}а`);
const personName = () => { const i = int(0, FIRST.length - 1); return `${FIRST[i]} ${i < 10 ? pick(LAST_M) : pick(LAST_F)}`; };
const BIZ_A = ['Студио', 'Ателие', 'Къща', 'Сцена', 'Агенция', 'Кетъринг', 'Фото', 'Бенд', 'Декор', 'Арт'];
const BIZ_B = ['Изгрев', 'Хармония', 'Ритъм', 'Светлина', 'Момент', 'Празник', 'Звезда', 'Магия', 'Усмивка', 'Балкан', 'Витоша', 'Лале', 'Елегант', 'Импулс', 'Акорд'];
const PACKAGES = ['Пакет „Стандарт“', 'Пакет „Цял ден“', 'Пакет „Премиум“', 'Пакет „Половин ден“', 'Пакет „Вечерен“'];
const INCL = ['Подготовка и консултация', 'Транспорт в рамките на града', 'Оборудване', 'До 6 часа на място', 'Обработка и предаване'];
const REVIEW_BODIES = [
  'Много професионално отношение от първия разговор до края на събитието. Всичко беше точно както се разбрахме.',
  'Гостите останаха очаровани, а организацията беше безупречна. Бихме ги поканили отново за следващия ни празник.',
  'Точни, отзивчиви и внимателни към детайлите. Съветите им ни помогнаха да изберем най-доброто за нашия ден.',
  'Добро качество и коректна комуникация. Имаше малко закъснение в началото, но иначе всичко мина чудесно.',
];
const MSG = ['Здравейте, свободни ли сте на тази дата?', 'Да, датата е свободна. Ще ви изпратим подробности.', 'Благодаря, ще потвърдим до края на седмицата.', 'Има ли възможност за допълнителен час?', 'Разбира се, по договаряне на място.'];

// ── reference data and the demo accounts ───────────────────────────────────
const cities = await sql<{ id: string; name: string }[]>`select id, name from city order by sort_order nulls last, name`;
const cats = await sql<{ id: string; name: string }[]>`select id, name from category where is_visible and in_directory order by sort_order`;
const ets = await sql<{ id: string; name: string }[]>`select id, name from event_type order by sort_order`;
const [maria] = await sql<{ id: string; name: string; phone: string | null }[]>`select id, name, phone from "user" where email = 'maria.dimitrova@gmail.com'`;
const [busy] = await sql<{ id: string; userId: string; categoryId: string; cityId: string; businessName: string }[]>`
  select p.id, m.user_id as "userId", p.primary_category_id as "categoryId", p.city_id as "cityId", p.business_name as "businessName"
  from partner p join partner_member m on m.partner_id = p.id where p.slug = 'studio-melodiya'`;
const [admin] = await sql<{ id: string }[]>`select id from "user" where email = 'monika.kovacheva@eventat.bg'`;
if (!maria || !busy || !admin) { console.error('Run npm run db:seed first (demo users missing).'); process.exit(1); }
const [{ n: already }] = await sql<{ n: number }[]>`select count(*)::int as n from partner where slug like 'perf-%'`;
if (already) { console.error(`Perf data already present (${already} perf partners); run db:reset + db:seed first.`); process.exit(1); }
const busyServices = await sql<{ id: string; name: string; priceCents: number | null }[]>`
  select id, name, price_cents as "priceCents" from service where partner_id = ${busy.id} and status = 'active' and price_cents is not null`;
const usedNumbers = new Set((await sql<{ number: string }[]>`select number from booking_number`).map(r => r.number));

const cityWeights = cities.map((c, i) => ({ c, w: i === 0 ? 8 : i < 3 ? 4 : 1 })); // Sofia first
const totalW = cityWeights.reduce((a, b) => a + b.w, 0);
const pickCity = () => { let x = rnd() * totalW; for (const cw of cityWeights) { x -= cw.w; if (x <= 0) return cw.c; } return cities[0]; };

// ── batched insert ─────────────────────────────────────────────────────────
async function insert(tx: TransactionSql, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const size = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += size) {
    // drizzle's postgres-js driver turns off the Date serializer, so instants go as ISO strings.
    const chunk = rows.slice(i, i + size).map(r => Object.fromEntries(cols.map(k => [k, r[k] instanceof Date ? (r[k] as Date).toISOString() : r[k] ?? null])));
    await tx`insert into ${tx(table)} ${tx(chunk as never, cols)}`;
  }
}
const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const PHOTOS = ['booth', 'bouquet', 'cake-celebration', 'catering', 'dancers', 'decorator', 'dj-working', 'photographer', 'violinist',
  'v1-caterer', 'v1-caterer-warm', 'v1-dj', 'v1-dj-party', 'v1-dj-setup', 'v1-photographer', 'v1-photographer-kids', 'owner-caterer', 'owner-photographer']
  .map(name => ({ name, ...photo(name) }));

await sql.begin(async tx => {
  // ── clients ──────────────────────────────────────────────────────────────
  type Client = { id: string; name: string; phone: string };
  const clients: Client[] = [];
  const users: Record<string, unknown>[] = [], profiles: Record<string, unknown>[] = [];
  for (let i = 0; i < N.clients; i++) {
    const id = randomUUID().replace(/-/g, '').slice(0, 32);
    const name = personName(), phone = `+359 88${String(1_000_000 + i).slice(1)}`;
    const createdAt = new Date(Date.parse('2024-11-01') + rnd() * (NOW.getTime() - Date.parse('2024-11-01') - 30 * DAY));
    users.push({ id, name, email: `perf.client.${i}@example.test`, email_verified: true, role: 'client', phone, created_at: createdAt, updated_at: createdAt });
    profiles.push({ user_id: id, client_type: rnd() < 0.9 ? 'private' : 'business', city_id: pickCity().id, created_at: createdAt, updated_at: createdAt });
    clients.push({ id, name, phone });
  }
  await insert(tx, 'user', users);
  await insert(tx, 'client_profile', profiles);
  log(`${clients.length} clients`);

  // ── partners, gallery, services ──────────────────────────────────────────
  type Svc = { id: string; name: string; priceCents: number };
  type Partner = { id: string; userId: string; name: string; services: Svc[]; maxBookings: number };
  const partners: Partner[] = [];
  const pUsers: Record<string, unknown>[] = [], pRows: Record<string, unknown>[] = [], members: Record<string, unknown>[] = [];
  const media: Record<string, unknown>[] = [], gallery: Record<string, unknown>[] = [], pets: Record<string, unknown>[] = [];
  const services: Record<string, unknown>[] = [], incl: Record<string, unknown>[] = [], sets: Record<string, unknown>[] = [];
  for (let i = 0; i < N.partners; i++) {
    const uid = randomUUID().replace(/-/g, '').slice(0, 32), id = randomUUID();
    const contact = personName();
    const approvedAt = new Date(Date.parse('2024-10-01') + rnd() * (Date.parse('2025-07-31') - Date.parse('2024-10-01')));
    const registeredAt = new Date(approvedAt.getTime() - 4 * DAY);
    const cat = pick(cats), cty = pickCity();
    const name = `${pick(BIZ_A)} ${pick(BIZ_B)} ${i + 1}`;
    pUsers.push({ id: uid, name: contact, email: `perf.partner.${i}@example.test`, email_verified: true, role: 'partner', phone: `+359 87${String(1_000_000 + i).slice(1)}`, created_at: registeredAt, updated_at: registeredAt });
    const mk = (kind: string, p: typeof PHOTOS[number]) => {
      const mid = randomUUID();
      media.push({ id: mid, owner_user_id: uid, kind, storage_key: p.storageKey, original_name: `${p.name}.jpg`, mime: 'image/jpeg', size_bytes: p.sizeBytes, width: p.width, height: p.height, is_public: true, created_at: registeredAt });
      return mid;
    };
    const avatar = mk('partner_avatar', pick(PHOTOS)), cover = mk('partner_cover', pick(PHOTOS));
    const nPhotos = int(3, 8);
    for (let k = 0; k < nPhotos; k++) gallery.push({ id: randomUUID(), partner_id: id, media_id: mk('gallery', pick(PHOTOS)), position: k, created_at: registeredAt });
    const myEts = [...new Set([pick(ets), pick(ets), pick(ets)])];
    for (const e of myEts) pets.push({ partner_id: id, event_type_id: e.id });
    const svcs: Svc[] = [];
    const nSvc = int(1, 5);
    for (let k = 0; k < nSvc; k++) {
      const sid = randomUUID(), price = int(15, 400) * 1000;
      services.push({
        id: sid, partner_id: id, kind: 'package_fixed', name: PACKAGES[k], category_id: cat.id,
        description: 'Пълно обслужване на вашето събитие с внимание към всеки детайл и предварителна среща за уточняване.',
        price_cents: price, price_unit: 'per_event', status: 'active', show_in_profile: true, accepting_requests: true, sort_order: k,
        published_at: approvedAt, created_at: registeredAt, updated_at: approvedAt,
      });
      for (let j = 0; j < 3; j++) incl.push({ id: randomUUID(), service_id: sid, text: INCL[(k + j) % INCL.length], position: j });
      for (const e of myEts) sets.push({ service_id: sid, event_type_id: e.id });
      svcs.push({ id: sid, name: PACKAGES[k], priceCents: price });
    }
    const maxBookings = rnd() < 0.15 ? 3 : 1;
    pRows.push({
      id, slug: `perf-${i + 1}`, status: 'approved', onboarding_step: 6, business_name: name, legal_name: `${name} ЕООД`, legal_form: 'eood',
      contact_name: contact, notification_email: `perf.partner.${i}@example.test`, phone: `+359 87${String(1_000_000 + i).slice(1)}`,
      primary_category_id: cat.id, city_id: cty.id, service_radius_km: pick([30, 50, 100, 150]), serves_nationwide: rnd() < 0.1,
      experience_band: pick(['y1_3', 'y3_5', 'y5_10', 'gt_10']), active_since_year: int(2008, 2023),
      avatar_media_id: avatar, cover_media_id: cover, short_description: `${cat.name} за сватби, рождени дни и фирмени събития.`,
      description: 'Работим с внимание към всеки детайл. Предлагаме предварителна среща и гъвкави пакети според вашето събитие.',
      bookings_per_day_mode: maxBookings > 1 ? 'limit' : 'one', max_bookings_per_date: maxBookings,
      cancellation_policy: pick(['flexible', 'moderate', 'strict']), max_guests: pick([80, 150, 250, 400, null]),
      is_listed: true, accepting_requests: true, is_verified: rnd() < 0.7, provider: 'simulated', provider_status: 'enabled',
      provider_charges_enabled: true, provider_payouts_enabled: true, provider_account_ref: `perf_acct_${i + 1}`,
      info_confirmed_at: registeredAt, terms_accepted_at: registeredAt, submitted_at: new Date(approvedAt.getTime() - 2 * DAY),
      approved_at: approvedAt, listed_at: approvedAt, approved_by: admin.id, responsiveness_pct: int(70, 100),
      created_at: registeredAt, updated_at: approvedAt,
    });
    members.push({ partner_id: id, user_id: uid, role: 'owner', created_at: registeredAt });
    partners.push({ id, userId: uid, name, services: svcs, maxBookings });
  }
  await insert(tx, 'user', pUsers);
  await insert(tx, 'media', media);
  await insert(tx, 'partner', pRows);
  await insert(tx, 'partner_member', members);
  await insert(tx, 'partner_photo', gallery);
  await insert(tx, 'partner_event_type', pets);
  await insert(tx, 'service', services);
  await insert(tx, 'service_inclusion', incl);
  await insert(tx, 'service_event_type', sets);
  log(`${partners.length} partners, ${services.length} services, ${media.length} media`);

  // The demo partner is the busy one.
  const busyP: Partner = { id: busy.id, userId: busy.userId, name: busy.businessName, maxBookings: 1,
    services: busyServices.map(s => ({ id: s.id, name: s.name, priceCents: s.priceCents! })) };
  const mariaC: Client = { id: maria.id, name: maria.name, phone: maria.phone ?? '+359 888 123 456' };

  // ── requests and bookings ────────────────────────────────────────────────
  const taken = new Map<string, Map<string, number>>(); // partner → date → bookings
  const freeDate = (p: Partner, past: boolean) => {
    const m = taken.get(p.id) ?? new Map<string, number>(); taken.set(p.id, m);
    for (let tries = 0; tries < 200; tries++) {
      const d = past ? addDays(PAST_START, int(0, PAST_DAYS)) : addDays(TODAY, int(1, FUTURE_DAYS));
      if ((m.get(d) ?? 0) < p.maxBookings) { m.set(d, (m.get(d) ?? 0) + 1); return d; }
    }
    return null;
  };
  const perDay = new Map<string, number>();
  const L = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЮЯ';
  const number = (d: string) => {
    for (;;) {
      const k = (perDay.get(d) ?? 0); perDay.set(d, k + 1);
      const n = `${d.slice(0, 4)}-${d.slice(5, 7)}${d.slice(8, 10)}-${L[Math.floor(k / 26) % 26]}${L[k % 26]}`;
      if (k >= 676) throw new Error(`numbers exhausted on ${d}`);
      if (!usedNumbers.has(n)) { usedNumbers.add(n); return n; }
    }
  };

  const numbers: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [], requests: Record<string, unknown>[] = [];
  const bookings: Record<string, unknown>[] = [], charges: Record<string, unknown>[] = [];
  const txns: Record<string, unknown>[] = [], entries: Record<string, unknown>[] = [];
  const reviews: Record<string, unknown>[] = [], convs: Record<string, unknown>[] = [], msgs: Record<string, unknown>[] = [];
  const openKey = new Set<string>();
  let completed = 0, reviewed = 0;

  function addRequest(c: Client, p: Partner, booked: boolean, past: boolean) {
    const date = booked ? freeDate(p, past) : (past ? addDays(PAST_START, int(0, PAST_DAYS)) : addDays(TODAY, int(1, FUTURE_DAYS)));
    if (!date) return false;
    const svc = pick(p.services);
    const et = pick(ets), cty = pickCity();
    const guests = int(20, 250);
    const no = number(date);
    numbers.push({ number: no, event_date: date, created_at: NOW });
    const lead = int(10, 160);
    let sentAt = new Date(atNoon(date).getTime() - lead * DAY);
    if (sentAt < new Date('2024-11-02')) sentAt = new Date(Date.parse('2024-11-02') + rnd() * 20 * DAY);
    if (sentAt > NOW) sentAt = new Date(NOW.getTime() - int(2, 60) * DAY);
    let status: string;
    if (booked) status = 'approved';
    else if (!past && rnd() < 0.09 && !openKey.has(`${c.id}|${p.id}|${date}`)) { status = 'pending'; sentAt = new Date(NOW.getTime() - int(1, 40) * H); openKey.add(`${c.id}|${p.id}|${date}`); }
    else status = pick(['declined', 'expired', 'withdrawn', 'declined']);
    const answeredAt = status === 'pending' || status === 'expired' || status === 'withdrawn' ? null : new Date(sentAt.getTime() + int(1, 40) * H);
    const ceId = randomUUID(), rid = randomUUID();
    events.push({ id: ceId, client_id: c.id, event_type_id: et.id, title: et.name, date, city_id: cty.id, guests, created_at: sentAt, updated_at: sentAt });
    requests.push({
      id: rid, number: no, kind: 'package', status, client_id: c.id, partner_id: p.id, service_id: svc.id, client_event_id: ceId,
      event_type_id: et.id, event_date: date, guests, city_id: cty.id, contact_phone: c.phone, service_title: svc.name,
      amount_cents: svc.priceCents, sent_at: sentAt, response_due_at: new Date(sentAt.getTime() + 48 * H), answered_at: answeredAt,
      approved_at: status === 'approved' ? answeredAt : null, declined_at: status === 'declined' ? answeredAt : null,
      expired_at: status === 'expired' ? new Date(sentAt.getTime() + 48 * H) : null, decline_reason: status === 'declined' ? 'date_taken' : null,
      created_at: sentAt, updated_at: answeredAt ?? sentAt,
    });
    const convId = randomUUID();
    let last = sentAt;
    const nMsg = booked ? int(2, 6) : int(0, 2);
    for (let k = 0; k < nMsg && msgs.length < N.messages; k++) {
      last = new Date(sentAt.getTime() + (k + 1) * int(1, 20) * H);
      if (last > NOW) last = NOW;
      const fromClient = k % 2 === 0;
      const body = MSG[k % MSG.length];
      msgs.push({ id: randomUUID(), conversation_id: convId, sender_role: fromClient ? 'client' : 'partner', sender_user_id: fromClient ? c.id : p.userId, body, body_original: body, created_at: last, read_at: last });
    }
    if (!booked) {
      if (nMsg) convs.push({ id: convId, client_id: c.id, partner_id: p.id, client_event_id: ceId, request_id: rid, last_message_at: last, created_at: sentAt });
      return true;
    }
    // booking
    const bid = randomUUID(), approvedAt = answeredAt!, amount = svc.priceCents;
    const unpaid = !past && rnd() < 0.06;
    const paidAt = unpaid ? null : new Date(approvedAt.getTime() + int(1, 20) * H);
    const isCompleted = past;
    const holdUntil = addDays(date, 1);
    const bStatus = isCompleted ? 'completed' : unpaid ? 'awaiting_payment' : 'confirmed';
    const wantsReview = isCompleted && reviewed < N.reviews && rnd() < 0.92;
    bookings.push({
      id: bid, number: no, request_id: rid, client_id: c.id, partner_id: p.id, service_id: svc.id, client_event_id: ceId, event_type_id: et.id,
      event_date: date, guests, city_id: cty.id, service_title: svc.name, inclusions: INCL.slice(0, 3), status: bStatus, amount_cents: amount,
      payment_mode: 'full', due_now_cents: amount, balance_cents: 0, approved_at: approvedAt,
      payment_due_at: unpaid ? new Date(NOW.getTime() + int(4, 40) * H) : new Date(approvedAt.getTime() + 48 * H), paid_at: paidAt,
      cancellation_policy: 'moderate', deposit_percent: 30, commission_bp: paidAt ? 1000 : null, contact_phone: c.phone,
      hold_until: holdUntil, batch_date: addDays(date, 3), review_state: wantsReview ? 'reviewed' : isCompleted ? 'invited' : 'not_due',
      completed_at: isCompleted ? atNoon(addDays(date, 1)) : null, created_at: approvedAt, updated_at: paidAt ?? approvedAt,
    });
    convs.push({ id: convId, client_id: c.id, partner_id: p.id, client_event_id: ceId, request_id: rid, booking_id: bid, last_message_at: nMsg ? last : null, created_at: sentAt });
    if (paidAt) {
      const chId = randomUUID(), fee = Math.round(amount / 10);
      charges.push({
        id: chId, booking_id: bid, kind: 'full', method: 'card', provider: 'simulated', provider_ref: `perf_pi_${chId}`, amount_cents: amount,
        application_fee_cents: fee, commission_bp: 1000, status: 'succeeded', card_brand: 'Visa', card_last4: String(int(1000, 9999)),
        due_at: new Date(approvedAt.getTime() + 48 * H), succeeded_at: paidAt, created_at: paidAt, updated_at: paidAt,
      });
      // L1 charge: Dr provider_held · Cr client_funds.
      const t1 = randomUUID();
      txns.push({ id: t1, kind: 'charge', booking_id: bid, charge_id: chId, occurred_at: paidAt, description: `Плащане по резервация ${no}`, created_at: paidAt });
      entries.push({ id: randomUUID(), transaction_id: t1, account: 'provider_held', partner_id: p.id, booking_id: bid, debit_cents: amount, credit_cents: 0 });
      entries.push({ id: randomUUID(), transaction_id: t1, account: 'client_funds', partner_id: p.id, booking_id: bid, debit_cents: 0, credit_cents: amount });
      if (isCompleted) {
        // L3 release: Dr client_funds B · Cr partner_payable (B − C) · Cr commission_revenue C; Dr platform_cash C · Cr provider_held C.
        const t2 = randomUUID(), rel = atNoon(addDays(date, 1));
        txns.push({ id: t2, kind: 'release', booking_id: bid, occurred_at: rel, description: `Освобождаване по резервация ${no}`, created_at: rel });
        const e = (account: string, d: number, cr: number) => entries.push({ id: randomUUID(), transaction_id: t2, account, partner_id: p.id, booking_id: bid, debit_cents: d, credit_cents: cr });
        e('client_funds', amount, 0); e('partner_payable', 0, amount - fee); e('commission_revenue', 0, fee); e('platform_cash', fee, 0); e('provider_held', 0, fee);
        completed++;
      }
    }
    if (wantsReview) {
      reviewed++;
      const r = rnd() < 0.8 ? 5 : 4, body = pick(REVIEW_BODIES), pub = atNoon(addDays(date, int(2, 6)));
      reviews.push({
        id: randomUUID(), booking_id: bid, partner_id: p.id, client_id: c.id, author_display_name: c.name, event_type_id: et.id, event_date: date,
        service_label: svc.name, rating_overall: r, rating_communication: r, rating_accuracy: int(4, 5), rating_quality: r, rating_value: int(3, 5),
        body, body_original: body, published_at: pub > NOW ? NOW : pub,
        reply_text: rnd() < 0.3 ? 'Благодарим ви за доверието. Беше удоволствие да работим с вас.' : null,
        reply_published_at: null,
      });
    }
    return true;
  }

  // busy partner and busy client first
  for (let i = 0; i < N.busyPartnerPast; i++) addRequest(pick(clients), busyP, true, true);
  for (let i = 0; i < N.busyPartnerFuture; i++) addRequest(pick(clients), busyP, true, false);
  for (let i = N.busyPartnerPast + N.busyPartnerFuture; i < N.busyPartnerRequests; i++) addRequest(pick(clients), busyP, false, rnd() < 0.5);
  for (let i = 0; i < N.busyClientBookings; i++) addRequest(mariaC, pick(partners), true, i < 100);
  for (let i = N.busyClientBookings; i < N.busyClientRequests; i++) addRequest(mariaC, pick(partners), false, rnd() < 0.5);
  // everyone else: 9 000 past bookings across Jan–Aug 2025, the rest ahead (to Aug 2027)
  let made = bookings.length;
  while (made < N.bookings) { if (addRequest(pick(clients), pick(partners), true, made < 9_000)) made++; }
  while (requests.length < N.requests) addRequest(pick(clients), pick(partners), false, rnd() < 0.45);
  // top up messages on existing booked conversations
  const booked = convs.filter(c => c.booking_id);
  const ownerOf = new Map([...partners, busyP].map(p => [p.id, p.userId]));
  while (msgs.length < N.messages) {
    const c = pick(booked), at = new Date(Math.min(NOW.getTime(), (c.created_at as Date).getTime() + int(1, 400) * H));
    const fromClient = rnd() < 0.5, body = pick(MSG);
    msgs.push({ id: randomUUID(), conversation_id: c.id, sender_role: fromClient ? 'client' : 'partner', sender_user_id: fromClient ? c.client_id : ownerOf.get(c.partner_id as string) ?? null, body, body_original: body, created_at: at, read_at: at });
    if (!c.last_message_at || (c.last_message_at as Date) < at) c.last_message_at = at;
  }

  await insert(tx, 'booking_number', numbers);
  await insert(tx, 'client_event', events);
  await insert(tx, 'request', requests);
  await insert(tx, 'booking', bookings);
  log(`${requests.length} requests, ${bookings.length} bookings (${completed} completed)`);
  await insert(tx, 'charge', charges);
  await insert(tx, 'ledger_transaction', txns);
  await insert(tx, 'ledger_entry', entries);
  log(`${charges.length} charges, ${txns.length} ledger transactions, ${entries.length} entries`);
  await insert(tx, 'review', reviews);
  await insert(tx, 'conversation', convs);
  await insert(tx, 'message', msgs);
  log(`${reviews.length} reviews, ${convs.length} conversations, ${msgs.length} messages`);

  // ── bell and email outbox ────────────────────────────────────────────────
  const notes: Record<string, unknown>[] = [];
  const recipients = [mariaC.id, busyP.userId];
  for (let i = 0; i < N.notifications; i++) {
    const uid = i < 400 ? recipients[i % 2] : rnd() < 0.7 ? pick(clients).id : pick(partners).userId;
    const at = new Date(NOW.getTime() - rnd() * 240 * DAY);
    notes.push({ id: randomUUID(), user_id: uid, kind: 'client-request-sent', title: 'Заявката е изпратена', body: 'Ще получите отговор до 48 часа.', href: null, read_at: rnd() < 0.8 ? at : null, created_at: at });
  }
  await insert(tx, 'notification', notes);
  // Emails: every template with its catalogue sample vars (what Админ → Имейли previews), sent to perf
  // clients (client templates) or perf partners, spread over the ten months before the demo day.
  const tpl = Object.entries(SAMPLES).filter(([k]) => TEMPLATES[k]).map(([k, vars]) => ({ key: k, audience: TEMPLATES[k].audience as string, vars: JSON.stringify(vars), subject: TEMPLATES[k].render(vars as never).subject }));
  const clientIds = clients.map(c => c.id), partnerUserIds = partners.map(p => p.userId);
  const [{ n: emails }] = await tx<{ n: number }[]>`
    with t as (select row_number() over () - 1 as k, key, audience, vars::jsonb as vars, subject
        from unnest(${tpl.map(t => t.key)}::text[], ${tpl.map(t => t.audience)}::text[], ${tpl.map(t => t.vars)}::text[], ${tpl.map(t => t.subject)}::text[]) as x(key, audience, vars, subject)),
      cl as (select row_number() over () - 1 as k, u.id, u.email from unnest(${clientIds}::text[]) as x(id) join "user" u on u.id = x.id),
      pa as (select row_number() over () - 1 as k, u.id, u.email from unnest(${partnerUserIds}::text[]) as x(id) join "user" u on u.id = x.id),
      ins as (
        insert into email_outbox (template_key, to_email, to_user_id, audience, subject, html, text, vars, status, provider, attempts, created_at, sent_at)
        select t.key, case when t.audience = 'partner' then pa.email when t.audience = 'team' then 'help@eventat.bg' else cl.email end,
          case when t.audience = 'partner' then pa.id when t.audience = 'team' then null else cl.id end, t.audience,
          t.subject, '<p>' || t.subject || '</p>', t.subject, t.vars, 'sent', 'outbox', 1, ts, ts
        from generate_series(0, ${N.emails - 1}) g
          join t on t.k = g % ${tpl.length}
          join cl on cl.k = g % ${clientIds.length}
          join pa on pa.k = g % ${partnerUserIds.length}
          cross join lateral (select ${NOW.toISOString()}::timestamptz - (g % 300) * interval '1 day' - (g % 23) * interval '1 hour' as ts) d
        returning 1)
    select count(*)::int as n from ins`;
  log(`${notes.length} notifications, ${emails} emails`);

  // ── caches on partner (refreshPartner, set-based) ────────────────────────
  await tx`
    update partner p set
      search_text = lower(concat_ws(' ', p.business_name, c.name, ci.name, (
        select string_agg(et.name, ' ') from partner_event_type pe join event_type et on et.id = pe.event_type_id where pe.partner_id = p.id))),
      min_price_cents = (select min(s.price_cents) from service s where s.partner_id = p.id and s.status = 'active' and s.kind <> 'on_request' and s.show_in_profile),
      min_price_unit = 'per_event'
    from category c, city ci
    where p.slug like 'perf-%' and c.id = p.primary_category_id and ci.id = p.city_id`;
  await tx`
    update partner p set rating_avg = r.avg, review_count = r.n
    from (select partner_id, round(avg(rating_overall)::numeric, 1) as avg, count(*)::int as n from review group by partner_id) r
    where r.partner_id = p.id and (p.slug like 'perf-%' or p.id = ${busy.id})`;
  log('partner caches refreshed');
});
await sql`analyze`;
log('done (analyzed)');
await sql.end({ timeout: 5 });
