// Helpers for the catalogue module tests (partners, services, availability, search, reviews,
// saved, messaging, clients, team, payout accounts, media).
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { db } from '@/db';
import { emailOutbox, job, media, notification, partner, partnerPhoto, user, type MediaKind } from '@/db/schema';
import { sofiaInstant } from '@/lib/format';
import type { Actor } from '@/lib/domain/actor';
import { checkLedgerInvariants } from '@/lib/domain/ledger';
import { addPhoto, refreshPartner, register, saveStep } from '@/lib/domain/partners';
import { saveOnboarding } from '@/lib/domain/services';
import { categoryId, cityId, createPartner, ensureReference, eventTypeId, type PartnerOpts } from './factories';

/** The prototype's "today": Sunday 31 август 2025, 12:00 Sofia. */
export const NOW = sofiaInstant('2025-08-31', 12, 0);

/** The error code (DomainError) or message of a rejection, plus drizzle's wrapped database message. */
export async function failure(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) {
    const err = e as Error & { code?: string; cause?: Error; permission?: string };
    return [err.name, err.code, err.permission, err.message, err.cause?.message].filter(Boolean).join(' | ');
  }
  throw new Error('expected the promise to reject');
}

export async function emails(key: string, toUserId?: string) {
  return db.select().from(emailOutbox)
    .where(toUserId ? and(eq(emailOutbox.templateKey, key), eq(emailOutbox.toUserId, toUserId)) : eq(emailOutbox.templateKey, key))
    .orderBy(asc(emailOutbox.createdAt));
}

export async function bells(userId: string) {
  return db.select().from(notification).where(eq(notification.userId, userId)).orderBy(desc(notification.createdAt));
}

export async function jobsByPrefix(prefix: string) {
  const all = await db.select().from(job).orderBy(asc(job.runAt));
  return all.filter(j => j.dedupeKey?.startsWith(prefix));
}

let n = 0;
/** A media row as if uploaded (no bytes stored). */
export async function mediaRow(ownerUserId: string | null, kind: MediaKind, o: { mime?: string; width?: number; height?: number } = {}) {
  const [m] = await db.insert(media).values({
    ownerUserId, kind, storageKey: `public/test/${kind}/${n++}-${randomBytes(3).toString('hex')}.jpg`, mime: o.mime ?? 'image/jpeg',
    sizeBytes: 120_000, width: o.width ?? 1600, height: o.height ?? 1200, isPublic: true,
  }).returning();
  return m;
}

/** An approved partner (factories.createPartner) with its derived search fields and a gallery. */
export async function listedPartner(o: PartnerOpts & { photos?: number; radiusKm?: number | null; nationwide?: boolean; maxGuests?: number | null } = {}) {
  const r = await createPartner(o);
  const set: Partial<typeof partner.$inferInsert> = {};
  if (o.radiusKm !== undefined) set.serviceRadiusKm = o.radiusKm;
  if (o.nationwide) { set.servesNationwide = true; set.serviceRadiusKm = null; }
  if (o.maxGuests !== undefined) set.maxGuests = o.maxGuests;
  if (Object.keys(set).length) await db.update(partner).set(set).where(eq(partner.id, r.partner.id));
  for (let i = 0; i < (o.photos ?? 0); i++) {
    const m = await mediaRow(r.user.id, 'gallery');
    await db.insert(partnerPhoto).values({ partnerId: r.partner.id, mediaId: m.id, position: i });
  }
  await refreshPartner(db, r.partner.id);
  const [p] = await db.select().from(partner).where(eq(partner.id, r.partner.id));
  return { ...r, partner: p };
}

/** A user row as Better Auth would create it at sign-up (role client, unverified). */
export async function signUpUser(o: { name?: string; email?: string } = {}) {
  const id = `u_${randomBytes(6).toString('hex')}`;
  const [u] = await db.insert(user).values({ id, name: o.name ?? 'Мартин Стоянов', email: o.email ?? `${id}@example.invalid`, role: 'client', emailVerified: false, createdAt: NOW, updatedAt: NOW }).returning();
  return u;
}

/** P1: a partner in `draft`, owned by a fresh user. */
export async function draftPartner(o: { businessName?: string } = {}) {
  await ensureReference();
  const u = await signUpUser();
  const p = await register({ userId: u.id, businessName: o.businessName ?? 'Студио Мелодия', contactName: 'Мартин Стоянов', phone: '0881234567', consent: true });
  const actor: Actor = { userId: u.id, role: 'partner', partnerId: p.id };
  return { user: u, partner: p, actor };
}

/** Valid onboarding data for steps 1–5 (step 2 needs its media, step 3 a package). */
export async function fillOnboarding(actor: Actor, o: { eik?: string; photos?: number } = {}) {
  const userId = actor.userId;
  await saveStep(actor, { step: 1, data: {
    businessName: 'Студио Мелодия', legalForm: 'eood', eik: o.eik ?? '175074752', primaryCategoryId: await categoryId('dj-i-ozvuchavane'),
    cityId: await cityId('sofia'), radius: 150, experienceBand: 'y5_10', languages: ['Български', 'English'], contactName: 'Мартин Стоянов',
    notificationEmail: 'studio.melodia@example.invalid', phone: '+359 88 123 4567', socialHandle: '@studio.melodia',
  } });
  const avatar = await mediaRow(userId, 'partner_avatar', { width: 800, height: 800 });
  const cover = await mediaRow(userId, 'partner_cover');
  for (let i = 0; i < (o.photos ?? 4); i++) await addPhoto(actor, { mediaId: (await mediaRow(userId, 'gallery')).id });
  await saveStep(actor, { step: 2, data: {
    avatarMediaId: avatar.id, coverMediaId: cover.id, shortDescription: 'DJ за сватби и партита.', description: 'Озвучаване, осветление и DJ за цялата вечер.',
    eventTypeIds: [await eventTypeId('svatba'), await eventTypeId('rozhden-den')], tags: [{ label: 'Озвучаване' }],
  } });
  await saveOnboarding(actor, { kind: 'package_fixed', name: 'Пакет „Цял ден“', categoryId: await categoryId('dj-i-ozvuchavane'), description: 'DJ и озвучаване до 10 часа.', priceCents: 145_000 });
  await saveOnboarding(actor, { kind: 'on_request', name: 'Фирмени събития', categoryId: await categoryId('dj-i-ozvuchavane'), description: 'Програма по запитване.' });
  await saveStep(actor, { step: 3, data: { offersFixedPackages: true, offersOnRequest: true } });
  await saveStep(actor, { step: 4, data: { bookingsPerDayMode: 'one', leadTimeDays: 7, horizonMonths: 24, workingDays: [1, 2, 3, 4, 5, 6, 7] } });
  await saveStep(actor, { step: 5, data: { cancellationPolicy: 'moderate', depositPercent: 30, reschedulePolicy: 'free_if_available' } });
}

/** Money is never touched by these modules, but every scenario must leave the ledger consistent. */
export async function expectLedgerClean() {
  expect(await checkLedgerInvariants(db)).toEqual([]);
}

/** lib/format keeps numbers and units together with no-break spaces; compare with plain ones. */
export function plain<T>(x: T): T {
  if (typeof x === 'string') return x.replace(/ /g, ' ') as T;
  if (Array.isArray(x)) return x.map(plain) as T;
  if (x && typeof x === 'object' && !(x instanceof Date)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)])) as T;
  return x;
}
