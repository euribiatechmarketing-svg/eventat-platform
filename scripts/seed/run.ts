// The demo seed (DATA-MODEL §3): the prototype's records, written in one
// transaction. Reference data comes from lib/domain/reference.ts; every money
// movement is a balanced posting through lib/domain/ledger.ts (SPEC §7.5);
// pending timers are scheduled with lib/jobs (SPEC §3).
//
// Domain functions for state transitions are not used: the seed writes the
// states the prototype shows directly, with the side records those
// transitions would have produced (snapshots, charges, invoices, payout lines,
// ledger postings, jobs). Emails and audit rows of that history are not
// recreated.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { generateRandomString, hashPassword } from 'better-auth/crypto';
import { db } from '@/db';
import * as s from '@/db/schema';
import { invalidateClock } from '@/lib/clock';
import { addDays, date as fmtDate, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';
import { bookingBalances, postTransaction, type LedgerLine } from '@/lib/domain/ledger';
import { allocateNumber, reserveNumber } from '@/lib/domain/numbers';
import { CATEGORIES, EVENT_TYPES, ensureReferenceData } from '@/lib/domain/reference';
import { getSettings } from '@/lib/domain/settings';
import { scheduleJob } from '@/lib/jobs';
import { DEFAULT_URL, isLocalUrl, redact } from '../lib/schema-sync';
import * as D from './data';
import { planJobs, type PlannedJob } from './jobs';
import { photo } from './photos';

export class SeedRefusedError extends Error {
  constructor(message: string) { super(message); this.name = 'SeedRefusedError'; }
}

export type SeedOptions = {
  /** Truncate every table first (otherwise the seed refuses a database that has users). */
  force?: boolean;
  log?: (line: string) => void;
};

export type SeedResult = {
  users: { email: string; role: s.UserRole; name: string }[];
  clockOffsetMs: number;
  jobs: PlannedJob[];
  numbers: Record<string, string>;
};

// ── helpers ──────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD HH:MM[:SS]' Sofia wall-clock → instant. */
export function at(v: string): Date {
  const [d, t = '00:00'] = v.split(' ');
  const [hh, mm, ss = '0'] = t.split(':');
  return new Date(sofiaInstant(d, Number(hh), Number(mm)).getTime() + Number(ss) * 1000);
}
const H = 3600_000;
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const userId = () => generateRandomString(32, 'a-z', 'A-Z', '0-9');
/** The simulated provider's reference format (lib/payments/simulated.ts). */
const simRef = (p: string, id: string) => `sim_${p}_${id.replace(/-/g, '').slice(0, 20)}`;
/** SPEC §6: round half up once per amount. */
const commissionOf = (base: number, bp: number) => Math.floor((base * bp + 5_000) / 10_000);

/** Deterministic PRNG for generated booking numbers, so the demo's URLs are stable across seeds. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return (max: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

/** SPEC §8: the first payout day ≥ d. */
function batchDateFor(holdUntil: DateStr, days: number[]): DateStr {
  for (let d = holdUntil; ; d = addDays(d, 1)) if (days.includes(Number(d.slice(8, 10)))) return d;
}

/** SPEC §5.5: the free-cancellation date shown on the booking. */
function freeCancelUntil(policy: s.CancellationPolicy, eventDate: DateStr): DateStr | null {
  if (policy === 'flexible') return addDays(eventDate, -7);
  if (policy === 'moderate') return addDays(eventDate, -30);
  return null;
}

/** '2025-08-01' → '2025-09-01' */
const nextMonth = (first: DateStr) => `${addDays(`${first.slice(0, 8)}28`, 4).slice(0, 8)}01`;

const categoryName = (slug: string) => {
  const c = CATEGORIES.find(x => x.slug === slug);
  if (!c) throw new Error(`Unknown category ${slug}`);
  return c.name;
};

/**
 * Remove every row from every table (TRUNCATE skips the ledger's row-level
 * append-only triggers). It runs on its own, before the seed's transaction:
 * inside it, TRUNCATE's exclusive lock on platform_settings would block the
 * clock (lib/clock.ts reads clock_offset_ms on another connection) and the
 * seed would wait on itself.
 */
async function truncateAll() {
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (!rows.length) return;
  await db.execute(sql.raw(`truncate table ${rows.map(r => `"${r.tablename}"`).join(', ')} restart identity cascade`));
}

// ── the seed ─────────────────────────────────────────────────────────────

export async function seedDemo(opts: SeedOptions = {}): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;
  if (!isLocalUrl(url)) throw new SeedRefusedError(`Refusing to seed a non-local database: ${redact(url)}`);

  const [{ n: userCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.user);
  if (userCount > 0) {
    if (!opts.force) throw new SeedRefusedError(`The database already has ${userCount} users; run with --force to truncate every table and seed again`);
    await truncateAll();
    log('truncated every table');
  }

  const passwordHash = await hashPassword(D.DEMO_PASSWORD);
  const NOW = at(D.DEMO_NOW);
  // S1: the offset that makes now() = 31 Aug 2025, 12:00 at the moment of seeding (real time on purpose).
  const clockOffsetMs = NOW.getTime() - Date.now();

  const result = await db.transaction(async tx => {
    // ── S1–S2 reference data and settings ────────────────────────────────
    await ensureReferenceData(tx);
    const setJson = (key: string, value: unknown) =>
      tx.update(s.platformSettings).set({ value: value === null ? sql`'null'::jsonb` : value }).where(eq(s.platformSettings.key, key));
    await setJson('clock_offset_ms', clockOffsetMs);
    await setJson('payment.provider', 'simulated');
    await setJson('payment.provider_max_hold_days', null);
    await setJson('payment.schedule', { mode: 'full', deposit_percent: null, balance_due_days: 30 });
    const settings = await getSettings(NOW, tx);
    const payoutDays = settings['payout.days'];
    const holdDays = settings['payout.hold_days_after_event'];

    const ref = {
      city: new Map((await tx.select({ id: s.city.id, slug: s.city.slug, name: s.city.name }).from(s.city)).map(r => [r.slug, r])),
      category: new Map((await tx.select({ id: s.category.id, slug: s.category.slug }).from(s.category)).map(r => [r.slug, r.id])),
      eventType: new Map((await tx.select({ id: s.eventType.id, slug: s.eventType.slug, name: s.eventType.name }).from(s.eventType)).map(r => [r.slug, r])),
    };
    const cityId = (slug: string) => ref.city.get(slug)!.id;
    const catId = (slug: string) => { const v = ref.category.get(slug); if (!v) throw new Error(`category ${slug}`); return v; };
    const etId = (slug: string) => { const v = ref.eventType.get(slug); if (!v) throw new Error(`event type ${slug}`); return v.id; };

    // ── users ────────────────────────────────────────────────────────────
    const users: SeedResult['users'] = [];
    async function addUser(u: { name: string; email: string; role: s.UserRole; phone?: string | null; createdAt: Date; extra?: Partial<typeof s.user.$inferInsert> }) {
      const id = userId();
      await tx.insert(s.user).values({
        id, name: u.name, email: u.email.toLowerCase(), emailVerified: true, role: u.role, phone: u.phone ?? null,
        createdAt: u.createdAt, updatedAt: u.createdAt, ...u.extra,
      });
      // Better Auth's email-and-password account (sign-up.mjs: providerId 'credential', accountId = user id).
      await tx.insert(s.account).values({
        id: userId(), accountId: id, providerId: 'credential', userId: id, password: passwordHash, createdAt: u.createdAt, updatedAt: u.createdAt,
      });
      users.push({ email: u.email.toLowerCase(), role: u.role, name: u.name });
      return id;
    }

    async function addMedia(owner: string, kind: s.MediaKind, name: string, isPublic: boolean, createdAt: Date) {
      const p = photo(name);
      const [m] = await tx.insert(s.media).values({
        ownerUserId: owner, kind, storageKey: p.storageKey, originalName: `${name}.jpg`, mime: 'image/jpeg',
        sizeBytes: p.sizeBytes, width: p.width, height: p.height, isPublic, createdAt,
      }).returning({ id: s.media.id });
      return m.id;
    }

    // ── S3 team ──────────────────────────────────────────────────────────
    const team: Record<string, string> = {};
    for (const m of D.TEAM) {
      team[m.key] = await addUser({ name: m.name, email: m.email, role: 'admin', createdAt: at(m.joinedAt) });
    }
    const monika = team.monika;
    for (const m of D.TEAM) {
      await tx.insert(s.teamMember).values({
        userId: team[m.key], role: m.role, title: m.title ?? null, isOwner: !!m.isOwner, status: 'active',
        joinedAt: at(m.joinedAt), invitedBy: m.isOwner ? null : monika, lastActiveAt: m.lastActiveAt ? at(m.lastActiveAt) : null,
      });
    }
    const invites: { id: string; expiresAt: Date }[] = [];
    for (const inv of D.TEAM_INVITES) {
      const sentAt = at(inv.sentAt);
      const expiresAt = addMs(sentAt, 7 * 24 * H); // D50
      const [r] = await tx.insert(s.teamInvite).values({
        email: inv.email, role: inv.role, invitedBy: monika, status: 'pending', sentAt, expiresAt,
        // The token itself is never stored (and is discarded here: the demo invite cannot be accepted by link).
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      }).returning({ id: s.teamInvite.id });
      invites.push({ id: r.id, expiresAt });
    }

    // ── S7 dates the users depend on ─────────────────────────────────────
    // (a) A client registered two days before their first request.
    const firstSent = new Map<string, Date>();
    for (const r of [...D.OPEN_REQUESTS, ...D.BOOKINGS]) {
      const t = at(r.sentAt);
      const cur = firstSent.get(r.client);
      if (!cur || t < cur) firstSent.set(r.client, t);
    }

    // ── S4 clients ───────────────────────────────────────────────────────
    const clients: Record<string, { id: string; phone: string; seed: D.ClientSeed }> = {};
    for (const c of D.CLIENTS) {
      const createdAt = c.registeredAt ? at(c.registeredAt) : sofiaInstant(addDays(sofiaDate(firstSent.get(c.key)!), -2), 10, 0);
      const extra: Partial<typeof s.user.$inferInsert> = c.key === 'maria' ? {
        passwordChangedAt: at(D.MARIA.passwordChangedAt), lastLoginAt: at(D.MARIA.lastLoginAt), lastLoginCity: D.MARIA.lastLoginCity,
      } : {};
      const id = await addUser({ name: c.name, email: c.email, role: 'client', phone: c.phone, createdAt, extra });
      clients[c.key] = { id, phone: c.phone, seed: c };
      await tx.insert(s.clientProfile).values({ userId: id, clientType: c.type, cityId: cityId(c.city), createdAt, updatedAt: createdAt });
    }
    const maria = clients.maria.id;
    await tx.insert(s.clientInvoiceProfile).values({ userId: maria, ...D.MARIA.invoiceProfile, updatedAt: at(D.MARIA.passwordChangedAt) });
    for (const h of D.MARIA.searchHistory) await tx.insert(s.searchHistory).values({ clientId: maria, query: h.query, createdAt: at(h.at) });
    for (const ss of D.MARIA.sessions) {
      await tx.insert(s.session).values({
        id: userId(), userId: maria, token: generateRandomString(32, 'a-z', 'A-Z', '0-9'),
        // Better Auth compares expiry with real time; a seeded session stays listable for 30 days of real time.
        expiresAt: new Date(Date.now() + 30 * 24 * H),
        userAgent: ss.userAgent, deviceLabel: ss.deviceLabel, city: ss.city, createdAt: at(ss.lastActiveAt), updatedAt: at(ss.lastActiveAt),
      });
    }

    // ── S5 partners ──────────────────────────────────────────────────────
    type PartnerRec = { id: string; userId: string; seed: D.PartnerSeed; approvedAt: Date | null; submittedAt: Date; payoutAccountId: string | null };
    const partners: Record<string, PartnerRec> = {};
    for (const p of D.PARTNERS) {
      const approvedAt = p.approvedAt ? at(p.approvedAt) : null;
      // (a) An approved partner submitted two days before approval, and registered two days before submitting.
      const submittedAt = p.submittedAt ? at(p.submittedAt) : addMs(approvedAt!, -2 * 24 * H);
      const registeredAt = addMs(submittedAt, -2 * 24 * H);
      const uid = await addUser({ name: p.contactName, email: p.email, role: 'partner', phone: p.phone, createdAt: registeredAt });
      const id = randomUUID();
      const galleryIds: string[] = [];
      for (const name of p.gallery) galleryIds.push(await addMedia(uid, 'gallery', name, true, submittedAt));
      const avatarId = await addMedia(uid, 'partner_avatar', p.avatar ?? p.gallery[0], true, submittedAt);
      const coverId = await addMedia(uid, 'partner_cover', p.cover ?? p.gallery[0], true, submittedAt);
      const x = p.extra ?? {};
      await tx.insert(s.partner).values({
        id, slug: p.slug, status: p.status, onboardingStep: 6, draftSavedAt: submittedAt,
        businessName: p.businessName, businessNameChangedAt: x.businessNameChangedAt ? at(x.businessNameChangedAt) : null,
        // (a) legal names and forms of partners other than Студио Мелодия and Лунна Фотография.
        legalName: x.legalName ?? `${p.businessName} ЕООД`, legalForm: x.legalForm ?? 'eood', eik: x.eik ?? null,
        registeredAddress: x.registeredAddress ?? null, managerName: x.managerName ?? null,
        contactName: p.contactName, contactRole: p.contactRole ?? null, notificationEmail: p.email.toLowerCase(), phone: p.phone,
        socialHandle: x.socialHandle ?? null, primaryCategoryId: catId(p.category), cityId: cityId(p.city),
        serviceRadiusKm: p.radiusKm, servesNationwide: !!p.nationwide, alsoServesNote: x.alsoServesNote ?? null,
        experienceBand: x.experienceBand ?? null, activeSinceYear: x.activeSinceYear ?? null, languages: x.languages ?? [],
        avatarMediaId: avatarId, coverMediaId: coverId, shortDescription: x.shortDescription ?? null, description: x.description ?? null,
        offersFixedPackages: true, offersOnRequest: !!x.offersOnRequest,
        cancellationPolicy: p.policy, depositPercent: p.depositPercent ?? 30, maxGuests: p.maxGuests ?? null,
        isListed: true, acceptingRequests: true, isVerified: p.verified,
        // B1: an account waiting for verification pauses payouts.
        payoutsPaused: p.payout?.status === 'pending_verification',
        // P4 creates the provider account; the simulated provider is always enabled (D62).
        provider: 'simulated', providerAccountRef: simRef('acct', id), providerStatus: 'enabled',
        providerChargesEnabled: true, providerPayoutsEnabled: true,
        infoConfirmedAt: submittedAt, termsAcceptedAt: submittedAt, submittedAt,
        approvedAt, approvedBy: approvedAt ? monika : null,
        createdAt: registeredAt, updatedAt: x.updatedAt ? at(x.updatedAt) : (approvedAt ?? submittedAt),
      });
      await tx.insert(s.partnerMember).values({ partnerId: id, userId: uid, role: 'owner', createdAt: registeredAt });
      await tx.insert(s.partnerEventType).values(p.eventTypes.map(e => ({ partnerId: id, eventTypeId: etId(e) })));
      if (p.tags?.length) await tx.insert(s.partnerTag).values(p.tags.map(label => ({ partnerId: id, label })));
      await tx.insert(s.partnerPhoto).values(galleryIds.map((mediaId, position) => ({ partnerId: id, mediaId, position, createdAt: submittedAt })));

      // Payout account (§4.3).
      let payoutAccountId: string | null = null;
      if (p.payout) {
        const confirmed = p.payout.status === 'confirmed';
        const [a] = await tx.insert(s.payoutAccount).values({
          partnerId: id, ibanLast4: p.payout.last4, holderName: x.legalName ?? `${p.businessName} ЕООД`, bankName: p.payout.bank,
          bankBranch: p.payout.branch ?? null, status: p.payout.status, submittedAt,
          verifiedBy: confirmed ? monika : null, verifiedAt: confirmed ? (approvedAt ?? addMs(submittedAt, H)) : null,
        }).returning({ id: s.payoutAccount.id });
        payoutAccountId = confirmed ? a.id : null;
      }

      // Profile checks (§4.2): team-set kinds ok unless listed as waiting; computed kinds from the data.
      const waiting = new Set<string>(p.waitingChecks ?? []);
      const checkedAt = approvedAt ?? addMs(submittedAt, H);
      const kinds: s.PartnerCheckKind[] = ['company', 'contacts', 'gallery', 'services', 'cancellation_policy', 'bank_account'];
      await tx.insert(s.partnerCheck).values(kinds.map(kind => {
        const state: s.CheckState = kind === 'bank_account'
          ? (p.payout?.status === 'confirmed' ? 'ok' : 'waiting')
          : (waiting.has(kind) ? 'waiting' : 'ok');
        const teamSet = kind === 'company' || kind === 'contacts' || kind === 'gallery';
        return {
          partnerId: id, kind, state, detail: p.checkDetails?.[kind] ?? null,
          checkedBy: teamSet && state === 'ok' ? monika : null, checkedAt: teamSet && state === 'ok' ? checkedAt : null,
        };
      }));
      if (approvedAt) await tx.insert(s.partnerDecision).values({ partnerId: id, decision: 'approved', decidedBy: monika, decidedAt: approvedAt });
      for (const b of p.blocks ?? []) {
        await tx.insert(s.availabilityBlock).values({
          partnerId: id, startDate: b.start, endDate: b.end ?? b.start, reason: b.reason ?? null, createdBy: uid,
          createdAt: approvedAt ?? submittedAt,
        });
      }
      partners[p.slug] = { id, userId: uid, seed: p, approvedAt, submittedAt, payoutAccountId };
    }

    // ── S6 services ──────────────────────────────────────────────────────
    type ServiceRec = { id: string; seed: D.ServiceSeed; inclusions: string[] };
    const services: Record<string, ServiceRec> = {};
    for (const sv of D.SERVICES) {
      const p = partners[sv.partner];
      const createdAt = sv.submittedAt ? at(sv.submittedAt) : (p.approvedAt ?? p.submittedAt);
      const coverId = sv.cover ? await addMedia(p.userId, 'service_cover', sv.cover, true, createdAt) : null;
      const eventTypes = sv.eventTypes ?? p.seed.eventTypes;
      const [row] = await tx.insert(s.service).values({
        partnerId: p.id, kind: sv.kind, name: sv.name, categoryId: catId(sv.category), description: sv.description,
        priceCents: sv.priceCents, priceUnit: sv.unit ?? 'per_event', minGuests: sv.minGuests ?? null, durationLabel: sv.duration ?? null,
        extraHourEnabled: sv.extraHourCents != null, extraHourPriceCents: sv.extraHourCents ?? null, travelFeeEnabled: !!sv.travelFee,
        coverMediaId: coverId, status: sv.status, sortOrder: sv.sort,
        // DATA-MODEL S6: published_at = approved_at for the active services.
        publishedAt: sv.status === 'active' ? p.approvedAt : null,
        createdAt, updatedAt: sv.updatedAt ? at(sv.updatedAt) : createdAt,
      }).returning({ id: s.service.id });
      if (sv.inclusions?.length) await tx.insert(s.serviceInclusion).values(sv.inclusions.map((text, position) => ({ serviceId: row.id, text, position })));
      await tx.insert(s.serviceEventType).values(eventTypes.map(e => ({ serviceId: row.id, eventTypeId: etId(e) })));
      if (sv.status === 'pending_review') {
        // S2: a new service waits in moderation as a `new` revision carrying the full service.
        await tx.insert(s.serviceRevision).values({
          serviceId: row.id, type: 'new', status: 'pending', submittedBy: p.userId, submittedAt: createdAt,
          payload: {
            kind: sv.kind, name: sv.name, categoryId: catId(sv.category), description: sv.description, priceCents: sv.priceCents,
            priceUnit: sv.unit ?? 'per_event', minGuests: sv.minGuests ?? null, durationLabel: sv.duration ?? null, coverMediaId: coverId,
            eventTypeIds: eventTypes.map(etId),
          },
        });
      }
      services[sv.key] = { id: row.id, seed: sv, inclusions: sv.inclusions ?? [] };
    }
    for (const e of D.SERVICE_EDITS) {
      const sv = services[e.service];
      // S6: an edit of an active service; the live version stays bookable.
      await tx.insert(s.serviceRevision).values({
        serviceId: sv.id, type: 'edit', status: 'pending', submittedBy: partners[sv.seed.partner].userId, submittedAt: at(e.submittedAt), payload: e.payload,
      });
    }

    // ── S4 client events ─────────────────────────────────────────────────
    const events: Record<string, { id: string; seed: D.EventSeed }> = {};
    for (const e of D.EVENTS) {
      // D15: the folder is created with its first request.
      const createdAt = new Date(Math.min(...[...D.OPEN_REQUESTS, ...D.BOOKINGS].filter(r => r.event === e.key).map(r => at(r.sentAt).getTime())));
      const [row] = await tx.insert(s.clientEvent).values({
        clientId: clients[e.client].id, eventTypeId: etId(e.type), title: e.title, hosts: e.hosts ?? null, date: e.date,
        startTime: e.start ?? null, endTime: e.end ?? null, venueName: e.venue ?? null, locality: e.locality ?? null,
        cityId: cityId(e.city), guests: e.guests, notes: e.notes ?? null, notesUpdatedAt: e.notesUpdatedAt ? at(e.notesUpdatedAt) : null,
        createdAt, updatedAt: e.notesUpdatedAt ? at(e.notesUpdatedAt) : createdAt,
      }).returning({ id: s.clientEvent.id });
      events[e.key] = { id: row.id, seed: e };
    }

    // ── numbers (D2): the prototype's literal numbers first, then generated ones ──
    for (const r of [...D.OPEN_REQUESTS, ...D.BOOKINGS]) if (r.number) await reserveNumber(tx, r.number);
    const rand = mulberry32(20250831);
    const numberOf = async (r: { number?: string | null; event: string }) => r.number ?? (await allocateNumber(tx, events[r.event].seed.date, { rand }));

    // ── S7 requests and bookings ─────────────────────────────────────────
    const eventStart = (date: DateStr, start: string | null | undefined) =>
      sofiaInstant(date, start ? Number(start.slice(0, 2)) : 0, start ? Number(start.slice(3, 5)) : 0);
    const requestIds = new Map<string, string>(); // `${partner}|${event}` → latest request id
    const numbers: Record<string, string> = {};
    const pendingRequests: { id: string; responseDueAt: Date }[] = [];

    type RequestInput = {
      number: string; kind: s.RequestKind; status: s.RequestStatus; client: string; partner: string; service: string; event: string;
      title: string; summary?: string; amountCents: number | null; sentAt: Date; responseDueAt: Date;
      answeredAt?: Date | null; approvedAt?: Date | null; declinedAt?: Date | null;
      start?: string | null; end?: string | null; guests?: number; spaceType?: s.SpaceType; note?: string;
    };
    async function addRequest(r: RequestInput) {
      const ev = events[r.event].seed;
      const [row] = await tx.insert(s.request).values({
        number: r.number, kind: r.kind, status: r.status, clientId: clients[r.client].id, partnerId: partners[r.partner].id,
        serviceId: services[r.service].id, clientEventId: events[r.event].id, eventTypeId: etId(ev.type), eventDate: ev.date,
        startTime: r.start === undefined ? (ev.start ?? null) : r.start, endTime: r.end === undefined ? (ev.end ?? null) : r.end,
        guests: r.guests ?? ev.guests, venueName: ev.venue ?? null, locality: ev.locality ?? null, cityId: cityId(ev.city),
        spaceType: r.spaceType ?? null, note: r.note ?? null, contactPhone: clients[r.client].phone,
        serviceTitle: r.title, serviceSummary: r.summary ?? null, amountCents: r.amountCents,
        sentAt: r.sentAt, responseDueAt: r.responseDueAt, answeredAt: r.answeredAt ?? null, approvedAt: r.approvedAt ?? null,
        declinedAt: r.declinedAt ?? null, declineReason: r.declinedAt ? 'date_taken' : null,
        createdAt: r.sentAt, updatedAt: r.approvedAt ?? r.declinedAt ?? r.sentAt,
      }).returning({ id: s.request.id });
      requestIds.set(`${r.partner}|${r.event}`, row.id);
      return row.id;
    }
    // §3 clamp: min(sent + 24 h, event start − 1 h).
    const responseDue = (sent: Date, ev: D.EventSeed, start?: string | null) =>
      minDate(addMs(sent, settings['request.response_hours'] * H), addMs(eventStart(ev.date, start === undefined ? ev.start : start), -H));

    for (const r of D.OPEN_REQUESTS) {
      const number = await numberOf(r);
      const sentAt = at(r.sentAt);
      const due = responseDue(sentAt, events[r.event].seed, r.start);
      const declinedAt = r.declinedAt ? at(r.declinedAt) : null;
      const id = await addRequest({
        number, kind: r.kind, status: r.status, client: r.client, partner: r.partner, service: r.service, event: r.event,
        title: r.title, summary: r.summary, amountCents: r.amountCents, sentAt, responseDueAt: due,
        answeredAt: declinedAt, declinedAt, start: r.start, end: r.end, guests: r.guests,
      });
      numbers[`request:${r.client}:${r.partner}:${r.event}`] = number;
      if (r.status === 'pending') pendingRequests.push({ id, responseDueAt: due });
    }

    type BookingRec = {
      id: string; number: string; seed: D.BookingSeed; partner: PartnerRec; eventDate: DateStr; amountCents: number;
      paidAt: Date | null; paymentDueAt: Date; holdUntil: DateStr; batchDate: DateStr; categorySlug: string; clientEventId: string;
      charges: { id: string; amountCents: number; paidAt: Date; duplicate: boolean }[];
    };
    const bookings: Record<string, BookingRec> = {};
    const bookingByNumber = (n: string) => { const b = bookings[n]; if (!b) throw new Error(`booking ${n}`); return b; };

    for (const b of D.BOOKINGS) {
      const number = await numberOf(b);
      const ev = events[b.event].seed;
      const p = partners[b.partner];
      const sv = services[b.service];
      const sentAt = at(b.sentAt), approvedAt = at(b.approvedAt), paidAt = b.paidAt ? at(b.paidAt) : null;
      const start = b.start === undefined ? (ev.start ?? null) : b.start;
      const end = b.end === undefined ? (ev.end ?? null) : b.end;
      const kind = b.kind ?? 'package';
      // R1 snapshot: a quote carries the service name; R6 sets the amount to the chosen offer.
      const chosenAt = b.offer ? at(b.offer.chosenAt) : null;
      const requestDue = chosenAt ? addMs(chosenAt, settings['offer.confirm_hours'] * H) : responseDue(sentAt, ev, start);
      const requestId = await addRequest({
        number, kind, status: 'approved', client: b.client, partner: b.partner, service: b.service, event: b.event,
        title: b.offer ? sv.seed.name : b.title, summary: b.summary, amountCents: b.requestAmountCents ?? b.amountCents,
        // R4 answers a quote with the offer; R3/R6 keep the first answer time.
        sentAt, responseDueAt: requestDue, answeredAt: b.offer ? at(b.offer.sentAt) : approvedAt, approvedAt, start, end, guests: b.guests,
        spaceType: b.spaceType, note: b.note,
      });
      if (b.offer) {
        const [o] = await tx.insert(s.offer).values({
          requestId, partnerId: p.id, title: b.offer.title, amountCents: b.amountCents, status: 'chosen',
          sentAt: at(b.offer.sentAt), chosenAt, decidedAt: approvedAt,
        }).returning({ id: s.offer.id });
        await tx.update(s.request).set({ offerId: o.id }).where(eq(s.request.id, requestId));
      }
      for (const [i, name] of (b.attachments ?? []).entries()) {
        const mediaId = await addMedia(clients[b.client].id, 'request_attachment', name, false, sentAt);
        await tx.insert(s.requestAttachment).values({ requestId, mediaId, position: i });
      }

      // K1: payment window clamp, snapshots, payout dates (§3, §5, §8).
      const paymentDueAt = minDate(addMs(approvedAt, settings['payment.window_hours'] * H), eventStart(ev.date, start));
      const holdUntil = addDays(ev.date, holdDays);
      const batchDate = batchDateFor(holdUntil, payoutDays);
      const policy = p.seed.policy;
      const completedAt = b.status === 'completed' ? sofiaInstant(addDays(ev.date, 1), 0, 0) : null;
      const cancelledAt = b.cancellation ? at(b.cancellation.at) : null;
      const id = randomUUID();
      await tx.insert(s.booking).values({
        id, number, requestId, clientId: clients[b.client].id, partnerId: p.id, serviceId: sv.id, clientEventId: events[b.event].id,
        eventTypeId: etId(ev.type), eventDate: ev.date, startTime: start, endTime: end, guests: b.guests ?? ev.guests,
        venueName: b.venue ?? ev.venue ?? null, locality: b.locality ?? ev.locality ?? null, cityId: cityId(ev.city),
        serviceTitle: b.title, serviceSummary: b.summary ?? null, inclusions: sv.inclusions,
        status: b.status, amountCents: b.amountCents, bookingFeeCents: 0, paymentMode: 'full', dueNowCents: b.amountCents,
        balanceCents: 0, approvedAt, paymentDueAt, paidAt,
        cancellationPolicy: policy, depositPercent: p.seed.depositPercent ?? 30, freeCancelUntil: freeCancelUntil(policy, ev.date),
        // S7 seed rule: 10% for every seeded booking (each partner already had > 3 bookings, D7); snapshotted at payment (K5).
        commissionBp: paidAt ? settings['commission.standard_bp'] : null,
        contactPhone: clients[b.client].phone, holdUntil, batchDate, payoutHold: !!b.payoutHold,
        reviewState: b.reviewState ?? 'not_due',
        cancelledAt, cancelledBy: b.cancellation ? 'client' : null, completedAt,
        createdAt: approvedAt, updatedAt: b.updatedAt ? at(b.updatedAt) : (cancelledAt ?? completedAt ?? paidAt ?? approvedAt),
      });
      numbers[`booking:${b.client}:${b.partner}:${b.event}`] = number;
      bookings[number] = {
        id, number, seed: b, partner: p, eventDate: ev.date, amountCents: b.amountCents, paidAt, paymentDueAt, holdUntil, batchDate,
        categorySlug: sv.seed.category, clientEventId: events[b.event].id, charges: [],
      };
    }

    // ── charges, invoices, L1 (C3/K5) ────────────────────────────────────
    const bp = settings['commission.standard_bp'];
    const invoiceEvents: { partner: string; at: Date; build: (number: string) => Promise<void> }[] = [];
    const chargeInvoice = new Map<string, string>(); // charge id → invoice id
    const clientEmail = (k: string) => clients[k].seed.email.toLowerCase();

    function invoiceLine(b: BookingRec) {
      const ev = events[b.seed.event].seed;
      // Venue, locality — or the city when the venue is not known (as lib/domain/invoices.ts issues them).
      const place = [b.seed.venue ?? ev.venue, b.seed.locality ?? ev.locality].filter(Boolean).join(', ') || ref.city.get(ev.city)!.name;
      const category = categoryName(b.categorySlug);
      return {
        description: b.seed.title === category ? category : `${b.seed.title} · ${category}`,
        detail: `${fmtDate(ev.date)} · ${place} · ${b.seed.guests ?? ev.guests} гости`,
      };
    }
    function issuer(p: PartnerRec) {
      const x = p.seed.extra ?? {};
      return {
        issuerLegalName: x.legalName ?? `${p.seed.businessName} ЕООД`, issuerEik: x.eik ?? null, issuerVatNumber: null,
        issuerAddress: x.registeredAddress ?? null, issuerManager: x.managerName ?? null, issuerEmail: p.seed.email.toLowerCase(),
        issuerCity: ref.city.get(p.seed.city)!.name,
      };
    }
    function recipient(clientKey: string) {
      const c = clients[clientKey];
      const profile = clientKey === 'maria' ? D.MARIA.invoiceProfile : null;
      return {
        recipientType: 'individual' as const, recipientName: profile?.name ?? c.seed.name, recipientAddress: profile?.address ?? null,
        recipientEmail: clientEmail(clientKey), recipientPhone: c.phone,
      };
    }

    for (const b of Object.values(bookings)) {
      if (!b.paidAt) continue;
      const paid = [{ at: b.paidAt, duplicate: false }];
      if (b.seed.duplicatePaidAt) paid.push({ at: at(b.seed.duplicatePaidAt), duplicate: true });
      for (const c of paid) {
        const chargeId = randomUUID();
        const isMaria = b.seed.client === 'maria';
        const fee = commissionOf(b.amountCents, bp); // §6: the application fee is the commission on the charge
        await tx.insert(s.charge).values({
          id: chargeId, bookingId: b.id, kind: 'full', method: 'card', provider: 'simulated', providerRef: simRef('pi', chargeId),
          amountCents: b.amountCents, applicationFeeCents: fee, status: 'succeeded',
          cardBrand: isMaria ? D.MARIA.card.brand : null, cardLast4: isMaria ? D.MARIA.card.last4 : null,
          dueAt: b.paymentDueAt, succeededAt: c.at, isDuplicate: c.duplicate, createdAt: addMs(c.at, -60_000), updatedAt: c.at,
        });
        b.charges.push({ id: chargeId, amountCents: b.amountCents, paidAt: c.at, duplicate: c.duplicate });
        // L1 charge: Dr provider_held · Cr client_funds.
        await postTransaction(tx, {
          kind: 'charge', bookingId: b.id, partnerId: b.partner.id, chargeId, occurredAt: c.at,
          description: `Плащане по резервация ${b.number}`,
          lines: [{ account: 'provider_held', debit: b.amountCents }, { account: 'client_funds', credit: b.amountCents }],
        });
        // §9: an invoice per succeeded charge, numbered per issuer in payment order.
        invoiceEvents.push({
          partner: b.seed.partner, at: c.at, build: async number => {
            const line = invoiceLine(b);
            const [inv] = await tx.insert(s.invoice).values({
              type: 'invoice', issuerType: 'partner', issuerKey: b.partner.id, number, partnerId: b.partner.id, bookingId: b.id, chargeId,
              ...issuer(b.partner), ...recipient(b.seed.client),
              issuedOn: sofiaDate(c.at), paidOn: sofiaDate(c.at), place: ref.city.get(b.partner.seed.city)!.name,
              subtotalCents: b.amountCents, vatCents: 0, totalCents: b.amountCents,
              paymentNote: isMaria ? `Карта ${D.MARIA.card.brand} •••• ${D.MARIA.card.last4}` : 'Карта',
              status: 'issued', createdAt: c.at,
            }).returning({ id: s.invoice.id });
            await tx.insert(s.invoiceLine).values({
              invoiceId: inv.id, position: 1, description: line.description, detail: line.detail, quantity: 1,
              unitPriceCents: b.amountCents, totalCents: b.amountCents,
            });
            chargeInvoice.set(chargeId, inv.id);
          },
        });
      }
    }

    // ── K7 cancellation (2025-0509-СВ) ───────────────────────────────────
    for (const b of Object.values(bookings)) {
      const c = b.seed.cancellation;
      if (!c) continue;
      await tx.insert(s.cancellation).values({
        bookingId: b.id, initiatedBy: 'client', reason: c.reason, daysBefore: c.daysBefore, policy: b.partner.seed.policy,
        depositPercent: b.partner.seed.depositPercent ?? 30, totalCents: b.amountCents, paidCents: b.amountCents,
        refundCents: c.refundCents, retainedCents: c.retainedCents, commissionBp: bp,
        partnerAmountCents: c.retainedCents - commissionOf(c.retainedCents, bp),
        createdBy: clients[b.seed.client].id, createdAt: at(c.at),
      });
    }

    // ── S9 disputes ──────────────────────────────────────────────────────
    const disputes: Record<string, { id: string; seed: D.DisputeSeed }> = {};
    const partyUser = (b: BookingRec, party: s.DisputeParty) => party === 'client' ? clients[b.seed.client].id : b.partner.userId;
    for (const d of D.DISPUTES) {
      const b = bookingByNumber(d.number);
      const openedAt = at(d.openedAt);
      const filer = d.statements.find(x => x.party === d.openedBy)!;
      const id = randomUUID();
      await tx.insert(s.dispute).values({
        id, number: d.number, bookingId: b.id, openedBy: d.openedBy, openedByUser: partyUser(b, d.openedBy), reason: d.reason,
        title: d.title, summary: d.summary, description: filer.body, status: d.status, urgent: !!d.urgent,
        holdsPayout: d.holdsPayout, heldCents: d.heldCents, openedAt,
        teamReplyDueAt: addMs(openedAt, settings['dispute.team_reply_hours'] * H),
        positionFrom: d.openedBy === 'client' ? 'partner' : 'client',
        positionRequestedAt: at(d.positionRequestedAt), positionDueAt: at(d.positionDueAt),
        facts: d.facts, agreedTerms: d.agreed, comparison: d.comparison ?? null, note: d.note ?? null,
        decisionKind: d.decision?.kind ?? null, decisionTitle: d.decision?.title ?? null, decisionDetail: d.decision?.detail ?? null,
        motive: d.decision?.motive ?? null, refundCents: d.decision?.refundCents ?? null, partnerKeepsCents: d.decision?.partnerKeepsCents ?? null,
        decidedBy: d.decision ? monika : null, decidedAt: d.decision ? at(d.decision.at) : null,
        createdAt: openedAt, updatedAt: d.decision ? at(d.decision.at) : openedAt,
      });
      for (const [i, o] of (d.options ?? []).entries()) {
        await tx.insert(s.disputeOption).values({
          disputeId: id, kind: o.kind, label: o.label, description: o.description,
          refundCents: o.refundCents ?? null, newAmountCents: o.newAmountCents ?? null, position: i,
        });
      }
      for (const st of d.statements) {
        const author = partyUser(b, st.party);
        const [m] = await tx.insert(s.disputeMessage).values({
          disputeId: id, party: st.party, authorId: author, kind: 'statement', body: st.body, context: st.context, createdAt: at(st.at),
        }).returning({ id: s.disputeMessage.id });
        for (const pic of st.pics ?? []) {
          const mediaId = await addMedia(author, 'dispute_evidence', pic, false, at(st.at));
          await tx.insert(s.disputeAttachment).values({ disputeId: id, messageId: m.id, mediaId, label: null, createdAt: at(st.at) });
        }
        for (const [i, doc] of (st.docs ?? []).entries()) {
          // The prototype names these documents but has no files: the row records the label; the file is to be supplied.
          const ext = doc.mime === 'application/pdf' ? 'pdf' : 'png';
          const [media] = await tx.insert(s.media).values({
            ownerUserId: author, kind: 'dispute_evidence', storageKey: `seed/disputes/${d.number}/${st.party}-${i + 1}.${ext}`,
            originalName: doc.label, mime: doc.mime, sizeBytes: 0, isPublic: false, createdAt: at(st.at),
          }).returning({ id: s.media.id });
          await tx.insert(s.disputeAttachment).values({ disputeId: id, messageId: m.id, mediaId: media.id, label: doc.label, createdAt: at(st.at) });
        }
      }
      disputes[d.number] = { id, seed: d };
    }

    // ── releases (L3), refunds (L2) in time order ─────────────────────────
    type LineRec = { booking: BookingRec; base: number; commission: number; amount: number; readyAt: Date };
    const paidLines: LineRec[] = [];
    const refundEvents: { partner: string; at: Date; chargeId: string; refundId: string; amountCents: number; booking: BookingRec }[] = [];

    async function release(b: BookingRec, base: number, when: Date, why: string) {
      const c = commissionOf(base, bp);
      // L3: Dr client_funds B · Cr partner_payable (B − C) · Cr commission_revenue C; Dr platform_cash C · Cr provider_held C.
      const lines: LedgerLine[] = [
        { account: 'client_funds', debit: base }, { account: 'partner_payable', credit: base - c }, { account: 'commission_revenue', credit: c },
        { account: 'platform_cash', debit: c }, { account: 'provider_held', credit: c },
      ];
      await postTransaction(tx, { kind: 'release', bookingId: b.id, partnerId: b.partner.id, occurredAt: when, description: why, lines });
    }

    for (const b of Object.values(bookings)) {
      if (!b.paidAt || (b.seed.status !== 'completed' && b.seed.status !== 'cancelled')) continue;
      const d = disputes[b.number]?.seed;
      const eventEnd = sofiaInstant(addDays(b.eventDate, 1), 0, 0);
      // K13 / §5.4: released at event_date + 1, unless a dispute holding the payout was open then (it waits for the decision).
      const heldByDispute = d?.holdsPayout && d.decision && at(d.openedAt) < eventEnd;
      const releaseAt = heldByDispute ? at(d!.decision!.at) : eventEnd;
      const retained = b.seed.cancellation ? b.seed.cancellation.retainedCents : b.amountCents;
      await release(b, retained, releaseAt, b.seed.cancellation
        ? `Задържана сума по анулирана резервация ${b.number}` : `Освобождаване след събитието ${b.number}`);
      // The partner keeps what the decision leaves; the line is ready once both the release and the decision happened.
      const base = d?.decision ? d.decision.partnerKeepsCents : retained;
      const readyAt = d?.decision && at(d.decision.at) > releaseAt ? at(d.decision.at) : releaseAt;

      // F2 refunds decided in disputes.
      if (d?.decision && d.decision.refundCents > 0) {
        const succeededAt = at(D.REFUND_SUCCEEDED_AT[b.number]);
        const decidedAt = at(d.decision.at);
        const charge = d.decision.kind === 'refund_duplicate' ? b.charges.find(c => c.duplicate)! : b.charges[0];
        const amount = d.decision.refundCents;
        const reason: s.RefundReason = d.decision.kind === 'refund_duplicate' ? 'duplicate_charge' : 'dispute_decision';
        const feeRefund = commissionOf(amount, bp);
        const refundId = randomUUID();
        await tx.insert(s.refund).values({
          id: refundId, bookingId: b.id, chargeId: charge.id, reason, amountCents: amount, applicationFeeRefundCents: feeRefund,
          status: 'succeeded', providerRef: simRef('re', refundId), disputeId: disputes[b.number].id, requestedBy: monika,
          createdAt: decidedAt, succeededAt,
        });
        await tx.update(s.charge).set({
          refundedCents: amount, status: amount >= charge.amountCents ? 'refunded' : 'partially_refunded', updatedAt: succeededAt,
        }).where(eq(s.charge.id, charge.id));
        // L2: Dr client_funds · Cr provider_held for what is still held; after a release the rest comes back
        // from the partner's unpaid share (Dr partner_payable · Cr provider_held) and the commission part
        // from EventAT's balance (Dr commission_revenue · Cr platform_cash).
        const held = (await bookingBalances(tx, b.id)).client_funds;
        const fromHeld = Math.min(amount, held);
        const rest = amount - fromHeld;
        const commissionPart = commissionOf(rest, bp);
        const lines: LedgerLine[] = [];
        if (fromHeld > 0) lines.push({ account: 'client_funds', debit: fromHeld }, { account: 'provider_held', credit: fromHeld });
        if (rest - commissionPart > 0) lines.push({ account: 'partner_payable', debit: rest - commissionPart }, { account: 'provider_held', credit: rest - commissionPart });
        if (commissionPart > 0) lines.push({ account: 'commission_revenue', debit: commissionPart }, { account: 'platform_cash', credit: commissionPart });
        await postTransaction(tx, {
          kind: 'refund', bookingId: b.id, partnerId: b.partner.id, chargeId: charge.id, refundId, occurredAt: succeededAt,
          description: `Възстановяване по решение ${b.number}`, lines,
        });
        refundEvents.push({ partner: b.seed.partner, at: succeededAt, chargeId: charge.id, refundId, amountCents: amount, booking: b });
      }
      const commission = commissionOf(base, bp);
      paidLines.push({ booking: b, base, commission, amount: base - commission, readyAt });
    }

    // §9: credit notes for refunds, in the issuer's sequence.
    for (const r of refundEvents) {
      invoiceEvents.push({
        partner: r.partner, at: r.at, build: async number => {
          const b = r.booking;
          const line = invoiceLine(b);
          const [inv] = await tx.insert(s.invoice).values({
            type: 'credit_note', issuerType: 'partner', issuerKey: b.partner.id, number, partnerId: b.partner.id, bookingId: b.id,
            chargeId: r.chargeId, refundId: r.refundId, creditedInvoiceId: chargeInvoice.get(r.chargeId) ?? null,
            ...issuer(b.partner), ...recipient(b.seed.client),
            issuedOn: sofiaDate(r.at), paidOn: null, place: ref.city.get(b.partner.seed.city)!.name,
            subtotalCents: r.amountCents, vatCents: 0, totalCents: r.amountCents, paymentNote: null, status: 'issued', createdAt: r.at,
          }).returning({ id: s.invoice.id });
          await tx.insert(s.invoiceLine).values({
            invoiceId: inv.id, position: 1, description: line.description, detail: line.detail, quantity: 1,
            unitPriceCents: r.amountCents, totalCents: r.amountCents,
          });
        },
      });
    }

    // Number every issuer's documents in time order (S7: Студио Мелодия ends at 0000000412 for 2026-0614-ЕА).
    const byIssuer = new Map<string, typeof invoiceEvents>();
    for (const e of invoiceEvents) byIssuer.set(e.partner, [...(byIssuer.get(e.partner) ?? []), e]);
    for (const [slug, list] of byIssuer) {
      list.sort((a, b) => a.at.getTime() - b.at.getTime());
      // Charges are built before the credit notes that reference them.
      const start = slug === 'studio-melodiya' ? D.STUDIO_MELODIA_FIRST_INVOICE : 1;
      const numbered = list.map((e, i) => ({ e, number: String(start + i).padStart(10, '0') }));
      for (const { e, number } of numbered) await e.build(number);
      await tx.insert(s.invoiceSequence).values({ issuerKey: partners[slug].id, lastNumber: start + list.length - 1 });
    }

    // ── S8 payouts ───────────────────────────────────────────────────────
    for (const batch of D.PAID_BATCHES) {
      const lines = paidLines.filter(l => l.booking.batchDate === batch.date);
      const preparedAt = sofiaInstant(addDays(batch.date, -1), 9, 0);
      const releasedAt = sofiaInstant(batch.date, 10, 0); // (a)
      const [row] = await tx.insert(s.payoutBatch).values({
        batchDate: batch.date, label: batch.label, railLabel: D.PAYOUT_RAIL, status: 'paid',
        partnerCount: new Set(lines.map(l => l.booking.partner.id)).size,
        grossCents: lines.reduce((a, l) => a + l.base, 0), commissionCents: lines.reduce((a, l) => a + l.commission, 0),
        netCents: lines.reduce((a, l) => a + l.amount, 0), heldCents: 0,
        preparedAt, releasedBy: monika, releasedAt, paidAt: releasedAt, createdAt: preparedAt,
      }).returning({ id: s.payoutBatch.id });
      const byPartner = new Map<string, LineRec[]>();
      for (const l of lines) byPartner.set(l.booking.partner.id, [...(byPartner.get(l.booking.partner.id) ?? []), l]);
      for (const [partnerId, pl] of byPartner) {
        const p = pl[0].booking.partner;
        const itemId = randomUUID();
        const total = pl.reduce((a, l) => a + l.amount, 0);
        await tx.insert(s.payoutItem).values({
          id: itemId, batchId: row.id, partnerId, payoutAccountId: p.payoutAccountId, amountCents: total, status: 'paid',
          providerPayoutRef: simRef('po', itemId), sentAt: releasedAt, paidAt: releasedAt, createdAt: preparedAt,
        });
        for (const l of pl) {
          await tx.insert(s.payoutLine).values({
            bookingId: l.booking.id, partnerId, payoutItemId: itemId, batchDate: batch.date, baseCents: l.base,
            commissionCents: l.commission, amountCents: l.amount, status: 'paid', readyAt: l.readyAt, paidAt: releasedAt,
            createdAt: l.booking.paidAt!,
          });
        }
        // L4 payout (Y6): Dr partner_payable · Cr provider_held, one pair per booking.
        await postTransaction(tx, {
          kind: 'payout', partnerId, payoutItemId: itemId, occurredAt: releasedAt, description: `${batch.label} · ${p.seed.businessName}`,
          lines: pl.flatMap(l => [
            { account: 'partner_payable' as const, debit: l.amount, bookingId: l.booking.id },
            { account: 'provider_held' as const, credit: l.amount, bookingId: l.booking.id },
          ]),
        });
      }
    }
    // The next batch: `scheduled`, no lines (S8).
    await tx.insert(s.payoutBatch).values({
      batchDate: D.NEXT_BATCH.date, label: D.NEXT_BATCH.label, status: 'scheduled', createdAt: sofiaInstant('2025-08-15', 10, 0),
    });
    // Y1: lines of paid bookings whose event is still ahead; an open dispute holding the payout keeps them held.
    for (const b of Object.values(bookings)) {
      if (!b.paidAt || b.seed.status !== 'confirmed') continue;
      const d = disputes[b.number]?.seed;
      const held = !!(d && d.holdsPayout && d.status !== 'resolved');
      const commission = commissionOf(b.amountCents, bp);
      await tx.insert(s.payoutLine).values({
        bookingId: b.id, partnerId: b.partner.id, batchDate: b.batchDate, baseCents: b.amountCents, commissionCents: commission,
        amountCents: b.amountCents - commission, status: held ? 'held' : 'awaiting_event', holdReason: held ? 'dispute' : null,
        createdAt: b.paidAt,
      });
    }

    // ── S11 reviews ──────────────────────────────────────────────────────
    for (const r of D.REVIEWS) {
      const b = Object.values(bookings).find(x => x.seed.partner === r.partner && x.seed.client === r.client && x.seed.event === r.event)!;
      const publishedAt = sofiaInstant(addDays(b.eventDate, 1), 12, 0); // (a)
      await tx.insert(s.review).values({
        bookingId: b.id, partnerId: b.partner.id, clientId: clients[r.client].id, authorDisplayName: r.author,
        eventTypeId: etId(events[r.event].seed.type), eventDate: b.eventDate, serviceLabel: r.serviceLabel,
        ratingOverall: r.rating, ratingCommunication: r.rating, ratingAccuracy: r.rating, ratingQuality: r.rating, ratingValue: r.rating,
        body: r.body, bodyOriginal: r.body, publishedAt,
        replyText: r.reply ?? null, replyOriginal: r.reply ?? null, replyPublishedAt: r.reply ? addMs(publishedAt, 24 * H) : null,
      });
    }

    // ── S10 conversations ────────────────────────────────────────────────
    for (const t of D.THREADS) {
      const clientUser = clients[t.client].id, partnerUser = partners[t.partner].userId;
      const msgs = t.messages.map(([side, when, text, read]) => ({ side, at: at(when), text, read: read !== false }));
      const readAt = (i: number) => {
        if (!msgs[i].read) return null;
        const reply = msgs.slice(i + 1).find(m => m.side !== msgs[i].side);
        return reply ? reply.at : addMs(msgs[i].at, 5 * 60_000); // (a) read five minutes later when no reply follows
      };
      const reads = msgs.map((_, i) => readAt(i));
      const lastRead = (side: 'client' | 'partner') => {
        // A side's read time = when it last read the other side's messages, or its own last message.
        const times = msgs.flatMap((m, i) => m.side !== side && reads[i] ? [reads[i]!] : m.side === side ? [m.at] : []);
        return times.length ? new Date(Math.max(...times.map(x => x.getTime()))) : null;
      };
      const bookingId = t.bookingNumber ? bookingByNumber(t.bookingNumber).id : null;
      const requestId = requestIds.get(`${t.partner}|${t.event}`) ?? null;
      const [c] = await tx.insert(s.conversation).values({
        clientId: clientUser, partnerId: partners[t.partner].id, clientEventId: events[t.event].id, requestId, bookingId,
        lastMessageAt: msgs.at(-1)!.at, clientLastReadAt: lastRead('client'), partnerLastReadAt: lastRead('partner'),
        clientUnreadCount: msgs.filter(m => m.side === 'partner' && !m.read).length,
        partnerUnreadCount: msgs.filter(m => m.side === 'client' && !m.read).length,
        clientDraft: t.clientDraft ?? null, createdAt: msgs[0].at,
      }).returning({ id: s.conversation.id });
      for (const [i, m] of msgs.entries()) {
        // Nothing to mask in these texts (§10): body = body_original.
        await tx.insert(s.message).values({
          conversationId: c.id, senderRole: m.side, senderUserId: m.side === 'client' ? clientUser : partnerUser,
          body: m.text, bodyOriginal: m.text, createdAt: m.at, readAt: reads[i],
        });
      }
    }

    // ── S12 saved searches, watches, bell ─────────────────────────────────
    for (const q of D.SAVED_SEARCHES) {
      await tx.insert(s.savedSearch).values({
        clientId: maria, title: q.title, filtersSummary: q.summary, params: q.params, notify: q.notify, createdAt: at(q.createdAt),
      });
    }
    const watches: { id: string; date: DateStr }[] = [];
    for (const w of D.DATE_WATCHES) {
      const [row] = await tx.insert(s.dateWatch).values({
        clientId: maria, partnerId: partners[w.partner].id, date: w.date, clientEventId: events[w.event].id, status: 'watching', createdAt: at(w.createdAt),
      }).returning({ id: s.dateWatch.id });
      watches.push({ id: row.id, date: w.date });
    }
    const ivelinaRequest = numbers['request:ivelina:studio-melodiya:i-bday'];
    for (const n of D.BELL) {
      const to = n.to === 'maria' ? maria : partners[n.to].userId;
      await tx.insert(s.notification).values({
        userId: to, kind: n.kind, title: n.title, body: n.body, href: n.href.replace('{ivelina-request}', ivelinaRequest),
        readAt: n.read ? at(n.at) : null, createdAt: at(n.at),
      });
    }

    // ── S13 team notes ───────────────────────────────────────────────────
    for (const note of D.ADMIN_NOTES) {
      const [type, subjectId] = note.subject.client ? ['client', clients[note.subject.client].id]
        : note.subject.booking ? ['booking', bookingByNumber(note.subject.booking).id]
        : ['partner', partners[note.subject.partner!].id];
      await tx.insert(s.adminNote).values({ subjectType: type, subjectId, authorId: monika, body: note.body, createdAt: at(note.at) });
    }

    // ── cached partner figures (§12.4, §13.3), computed as the catalogue's refreshPartner() does ──
    const responsivenessFrom = addMs(NOW, -180 * 24 * H);
    for (const p of Object.values(partners)) {
      const reviews = D.REVIEWS.filter(r => r.partner === p.seed.slug);
      const ratingAvg = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : null;
      const active = D.SERVICES.filter(x => x.partner === p.seed.slug && x.status === 'active');
      const fixed = active.filter(x => x.kind === 'package_fixed' && x.priceCents != null);
      const perEvent = fixed.filter(x => (x.unit ?? 'per_event') === 'per_event').map(x => x.priceCents!);
      const perGuest = fixed.filter(x => x.unit === 'per_guest').map(x => x.priceCents!);
      const [minPrice, minUnit] = perEvent.length ? [Math.min(...perEvent), 'per_event' as const]
        : perGuest.length ? [Math.min(...perGuest), 'per_guest' as const] : [null, null];
      const haystack = [
        p.seed.businessName, categoryName(p.seed.category), ...active.map(x => categoryName(x.category)),
        ref.city.get(p.seed.city)!.name, ...p.seed.eventTypes.map(e => EVENT_TYPES.find(t => t.slug === e)!.name),
      ];
      const searchText = [...new Set(haystack.map(h => h.toLowerCase()))].join(' ');
      // §12.4 responsiveness: requests sent in the last 180 days answered (approved, declined or offered)
      // before their deadline, out of all of them; hidden (null) when there are none.
      const [resp] = await tx.select({
        total: sql<number>`count(*)::int`,
        answered: sql<number>`(count(*) filter (where ${s.request.answeredAt} <= ${s.request.responseDueAt} and ${s.request.status} <> 'expired'))::int`,
      }).from(s.request).where(sql`${s.request.partnerId} = ${p.id} and ${s.request.sentAt} >= ${responsivenessFrom.toISOString()}::timestamptz
        and ${s.request.kind} in ('package', 'quote')`);
      const responsiveness = resp.total ? Math.round((resp.answered / resp.total) * 100) : null;
      await tx.update(s.partner).set({
        ratingAvg, reviewCount: reviews.length, responsivenessPct: responsiveness,
        minPriceCents: minPrice, minPriceUnit: minUnit, searchText,
      }).where(eq(s.partner.id, p.id));
    }

    // ── S1 KPI snapshot, computed from the records ───────────────────────
    for (const month of ['2025-07-01', '2025-08-01']) {
      const from = sofiaInstant(month, 0, 0).toISOString();
      const to = sofiaInstant(nextMonth(month), 0, 0).toISOString();
      const [k] = await tx.execute<Record<string, string>>(sql`
        select
          (select coalesce(sum(amount_cents), 0) from booking where paid_at >= ${from}::timestamptz and paid_at < ${to}::timestamptz) as gmv_cents,
          (select coalesce(sum(floor((amount_cents * commission_bp + 5000) / 10000)), 0) from booking where paid_at >= ${from}::timestamptz and paid_at < ${to}::timestamptz) as commission_cents,
          (select count(*) from booking where paid_at >= ${from}::timestamptz and paid_at < ${to}::timestamptz) as bookings_paid,
          (select coalesce(sum(amount_cents), 0) from refund where status = 'succeeded' and succeeded_at >= ${from}::timestamptz and succeeded_at < ${to}::timestamptz) as refunded_cents,
          (select count(distinct dispute_id) from refund where status = 'succeeded' and succeeded_at >= ${from}::timestamptz and succeeded_at < ${to}::timestamptz) as refund_cases,
          (select count(*) from request where sent_at >= ${from}::timestamptz and sent_at < ${to}::timestamptz) as requests_sent,
          (select count(*) from "user" where role = 'client' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz) as clients_registered,
          (select count(*) from partner where approved_at >= ${from}::timestamptz and approved_at < ${to}::timestamptz) as partners_approved`);
      await tx.insert(s.metricsSnapshot).values({
        periodKind: 'month', periodStart: month, cityId: null, refreshedAt: at(D.METRICS_REFRESHED_AT),
        data: Object.fromEntries(Object.entries(k).map(([key, v]) => [key, Number(v)])),
      });
    }

    // ── SPEC §3 timers the seeded states imply ───────────────────────────
    const confirmed = Object.values(bookings).filter(b => b.seed.status === 'confirmed');
    const awaiting = Object.values(bookings).filter(b => b.seed.status === 'awaiting_payment');
    const jobs = planJobs({
      now: NOW,
      settings: {
        partnerReminderBeforeH: settings['request.partner_reminder_before_h'],
        clientPayRemindersBeforeH: settings['payment.client_reminders_before_h'],
        partnerPayReminderBeforeH: settings['payment.partner_reminder_before_h'],
        teamAlertBeforeH: settings['payment.team_alert_before_h'],
        clientEventDays: settings['reminders.client_event_days'],
        partnerEventDays: settings['reminders.partner_event_days'],
        sendTime: settings['reminders.send_time'],
        reviewInviteDaysAfter: settings['reviews.invite_days_after'],
        reviewInviteTime: settings['reviews.invite_time'],
        payoutPrepareTime: settings['payout.prepare_time'],
        savedSearchScanTime: settings['saved_search.scan_time'],
      },
      pendingRequests,
      awaitingPayment: awaiting.map(b => ({ id: b.id, paymentDueAt: b.paymentDueAt })),
      confirmed: confirmed.map(b => ({ id: b.id, eventDate: b.eventDate })),
      clientEvents: [...new Map(confirmed.map(b => [b.clientEventId, { id: b.clientEventId, date: b.eventDate }])).values()],
      collectingDisputes: Object.values(disputes).filter(d => d.seed.status === 'collecting').map(d => ({ id: d.id, positionDueAt: at(d.seed.positionDueAt) })),
      nextBatchDate: D.NEXT_BATCH.date,
      watches,
      invites,
    });
    for (const j of jobs) await scheduleJob(j.kind, j.runAt, j.payload, j.dedupeKey, tx);

    for (const b of Object.values(bookings)) numbers[b.number] = b.number;
    return { users, clockOffsetMs, jobs, numbers };
  });

  invalidateClock();
  log(`seeded ${result.users.length} users; clock offset ${result.clockOffsetMs} ms (now = ${D.DEMO_NOW} Sofia)`);
  return result;
}
