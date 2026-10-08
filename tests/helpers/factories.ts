// Small record factories for domain tests. Each inserts the minimum a module
// needs and returns the rows plus a ready-made Actor. Reference data (cities,
// categories, event types, settings) is ensured once per test database.
//
//   const { user, actor } = await createClient();
//   const { partner, service, actor: pActor } = await createPartner({ priceCents: 64_000 });
//   const { actor: admin } = await createAdmin('moderator');
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import {
  booking, category, city, clientEvent, clientProfile, eventType, partner, partnerEventType, partnerMember, request, service, serviceEventType,
  serviceInclusion, teamMember, user,
  type BookingStatus, type CancellationPolicy, type ClientType, type PriceUnit, type TeamRole,
} from '@/db/schema';
import type { Actor } from '@/lib/domain/actor';
import { allocateNumber } from '@/lib/domain/numbers';
import { ensureReferenceData } from '@/lib/domain/reference';
import { addDays, type DateStr } from '@/lib/format';

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${randomBytes(3).toString('hex')}`;

const ensured = new Set<string>();
/** ensureReferenceData() once per database (cheap no-op afterwards anyway). */
export async function ensureReference(q: Queryable = db) {
  const key = process.env.DATABASE_URL ?? '';
  if (q === db && ensured.has(key)) return;
  await ensureReferenceData(q);
  if (q === db) ensured.add(key); // inside a caller's transaction it may still roll back
}

async function idBySlug(q: Queryable, table: typeof city | typeof category | typeof eventType, slug: string): Promise<string> {
  const [r] = await q.select({ id: table.id }).from(table).where(eq(table.slug, slug)).limit(1);
  if (!r) throw new Error(`No ${slug} in reference data`);
  return r.id;
}
export const cityId = (slug = 'sofia', q: Queryable = db) => idBySlug(q, city, slug);
export const categoryId = (slug = 'dj-i-ozvuchavane', q: Queryable = db) => idBySlug(q, category, slug);
export const eventTypeId = (slug = 'svatba', q: Queryable = db) => idBySlug(q, eventType, slug);

type UserOpts = { name?: string; email?: string; phone?: string | null };

async function insertUser(q: Queryable, role: 'client' | 'partner' | 'admin', o: UserOpts) {
  const id = `u_${uid()}`;
  const [u] = await q.insert(user).values({
    id, role, name: o.name ?? `Test ${role} ${id.slice(-6)}`, email: o.email ?? `${id}@example.invalid`,
    emailVerified: true, phone: o.phone === undefined ? '+359888000000' : o.phone,
  }).returning();
  return u;
}

/** A verified client with a client_profile (private, София). */
export async function createClient(o: UserOpts & { clientType?: ClientType; city?: string } = {}, q: Queryable = db) {
  await ensureReference(q);
  const u = await insertUser(q, 'client', o);
  const [profile] = await q.insert(clientProfile).values({
    userId: u.id, clientType: o.clientType ?? 'private', cityId: await cityId(o.city ?? 'sofia', q),
  }).returning();
  const actor: Actor = { userId: u.id, role: 'client' };
  return { user: u, profile, actor };
}

export type PartnerOpts = UserOpts & {
  businessName?: string;
  slug?: string;
  category?: string;
  city?: string;
  policy?: CancellationPolicy;
  depositPercent?: 20 | 30 | 40 | 50;
  /** The one active package_fixed service. */
  serviceName?: string;
  priceCents?: number;
  priceUnit?: PriceUnit;
  eventTypes?: string[];
};

/**
 * An approved, listed partner that accepts requests, owned by a partner user,
 * with one active fixed-price service (default ‹Пакет „Цял ден“›, 1 450,00 € per event,
 * Сватба) and the simulated provider enabled.
 */
export async function createPartner(o: PartnerOpts = {}, q: Queryable = db) {
  await ensureReference(q);
  const u = await insertUser(q, 'partner', o);
  const catId = await categoryId(o.category ?? 'dj-i-ozvuchavane', q);
  const businessName = o.businessName ?? `Test Partner ${u.id.slice(-6)}`;
  const [p] = await q.insert(partner).values({
    slug: o.slug ?? `test-partner-${uid()}`,
    status: 'approved',
    onboardingStep: 6,
    businessName,
    legalName: `${businessName} ЕООД`,
    legalForm: 'eood',
    contactName: u.name,
    notificationEmail: u.email,
    phone: u.phone ?? '+359888000000',
    socialHandle: '@test',
    primaryCategoryId: catId,
    cityId: await cityId(o.city ?? 'sofia', q),
    serviceRadiusKm: 150,
    cancellationPolicy: o.policy ?? 'moderate',
    depositPercent: o.depositPercent ?? 30,
    isListed: true,
    acceptingRequests: true,
    isVerified: true,
    provider: 'simulated',
    providerStatus: 'enabled',
    providerChargesEnabled: true,
    providerPayoutsEnabled: true,
    submittedAt: new Date('2025-01-30T10:00:00Z'),
    approvedAt: new Date('2025-02-01T10:00:00Z'),
  }).returning();
  await q.insert(partnerMember).values({ partnerId: p.id, userId: u.id, role: 'owner' });
  const etIds = await Promise.all((o.eventTypes ?? ['svatba']).map(s => eventTypeId(s, q)));
  await q.insert(partnerEventType).values(etIds.map(eventTypeId => ({ partnerId: p.id, eventTypeId })));
  const [s] = await q.insert(service).values({
    partnerId: p.id,
    kind: 'package_fixed',
    name: o.serviceName ?? 'Пакет „Цял ден“',
    categoryId: catId,
    description: 'DJ, озвучаване за церемония и парти, диско осветление, безжичен микрофон. До 10 часа.',
    priceCents: o.priceCents ?? 145_000,
    priceUnit: o.priceUnit ?? 'per_event',
    durationLabel: 'До 10 часа',
    status: 'active',
    sortOrder: 0,
    publishedAt: p.approvedAt,
  }).returning();
  await q.insert(serviceEventType).values(etIds.map(eventTypeId => ({ serviceId: s.id, eventTypeId })));
  await q.insert(serviceInclusion).values([
    { serviceId: s.id, text: 'DJ за цялото събитие', position: 0 },
    { serviceId: s.id, text: 'Безжичен микрофон', position: 1 },
  ]);
  const actor: Actor = { userId: u.id, role: 'partner', partnerId: p.id };
  return { user: u, partner: p, service: s, actor };
}

/** An admin user with an active team_member row in the given team role. */
export async function createAdmin(teamRole: TeamRole = 'admin', o: UserOpts & { isOwner?: boolean } = {}, q: Queryable = db) {
  const u = await insertUser(q, 'admin', o);
  const [m] = await q.insert(teamMember).values({ userId: u.id, role: teamRole, isOwner: o.isOwner ?? false }).returning();
  const actor: Actor = { userId: u.id, role: 'admin', teamRole };
  return { user: u, teamMember: m, actor };
}

/** First 1st/15th on or after `d` (SPEC §8 with the default payout days). */
function firstPayoutDayFrom(d: DateStr): DateStr {
  const day = Number(d.slice(8, 10));
  if (day === 1 || day === 15) return d;
  if (day < 15) return `${d.slice(0, 8)}15`;
  return `${addDays(`${d.slice(0, 8)}01`, 32).slice(0, 8)}01`;
}

type ClientRow = Awaited<ReturnType<typeof createClient>>['user'];
type PartnerResult = Awaited<ReturnType<typeof createPartner>>;

/**
 * A raw approved request + booking row for tests that need a booking to hang
 * money, payouts, disputes or reviews on. Inserts rows only — no emails, jobs,
 * ledger postings or audit — so it is not a substitute for the booking
 * lifecycle functions. Default: Сватба on 2026-06-14, 1 450,00 €, `confirmed`.
 */
export async function createBookingRow(
  a: { client: ClientRow; partner: PartnerResult; eventDate?: DateStr; status?: BookingStatus; amountCents?: number; approvedAt?: Date },
  q: Queryable = db,
) {
  const eventDate = a.eventDate ?? '2026-06-14';
  const amount = a.amountCents ?? a.partner.service.priceCents ?? 145_000;
  const approvedAt = a.approvedAt ?? new Date('2025-08-12T08:06:00Z');
  const etId = await eventTypeId('svatba', q);
  const [ev] = await q.insert(clientEvent).values({
    clientId: a.client.id, eventTypeId: etId, title: 'Сватба', date: eventDate, guests: 120, cityId: a.partner.partner.cityId,
  }).returning();
  const number = await allocateNumber(q, eventDate);
  const [r] = await q.insert(request).values({
    number, kind: 'package', status: 'approved', clientId: a.client.id, partnerId: a.partner.partner.id, serviceId: a.partner.service.id,
    clientEventId: ev.id, eventTypeId: etId, eventDate, guests: 120, cityId: a.partner.partner.cityId,
    contactPhone: a.client.phone ?? '+359888000000', serviceTitle: a.partner.service.name, amountCents: amount,
    sentAt: new Date(approvedAt.getTime() - 2 * 3600_000), responseDueAt: new Date(approvedAt.getTime() + 22 * 3600_000),
    answeredAt: approvedAt, approvedAt,
  }).returning();
  const holdUntil = addDays(eventDate, 1);
  const batchDate = firstPayoutDayFrom(holdUntil);
  const status = a.status ?? 'confirmed';
  const paid = status !== 'awaiting_payment' && status !== 'payment_expired' && status !== 'approval_withdrawn';
  const [b] = await q.insert(booking).values({
    number, requestId: r.id, clientId: a.client.id, partnerId: a.partner.partner.id, serviceId: a.partner.service.id, clientEventId: ev.id,
    eventTypeId: etId, eventDate, guests: 120, cityId: a.partner.partner.cityId, serviceTitle: a.partner.service.name,
    status, amountCents: amount, paymentMode: 'full', dueNowCents: amount, approvedAt,
    paymentDueAt: new Date(approvedAt.getTime() + 24 * 3600_000), paidAt: paid ? new Date(approvedAt.getTime() + 3 * 3600_000) : null,
    cancellationPolicy: a.partner.partner.cancellationPolicy ?? 'moderate', depositPercent: a.partner.partner.depositPercent,
    commissionBp: paid ? 1000 : null, contactPhone: a.client.phone ?? '+359888000000',
    holdUntil, batchDate,
  }).returning();
  return { clientEvent: ev, request: r, booking: b, number };
}
