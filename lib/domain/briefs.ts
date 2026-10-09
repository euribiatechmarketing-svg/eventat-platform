// Open requests — briefs (SPEC §4.6). A запитване to every partner that fits.
//   O1 create (client ‹Изпрати запитването›, /zayavka/otvorena): matching,
//      invitations, T3 per invitation, `client-brief-sent`, `vendor-new-inquiry`.
//   T3 invitationExpireJob: an invitation nobody answered → `lapsed` (no email).
// Offers on briefs (O2, O6) and their screens wait for approved copy (D60).
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import {
  brief, briefAttachment, briefCategory, briefInvitation, category, city, eventType, media, partner, partnerMember, service, user, type BudgetBand,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, date, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';
import { scheduleJob } from '@/lib/jobs';
import { SYSTEM, type AnyActor } from './actor';
import { audit } from './audit';
import { HOUR, LifecycleError, assertClientActor, checkPartnerDate, mail, phoneDisplay, withTx } from './bookings';
import { findOrCreateClientEvent } from './events';
import { getSettings } from './settings';

export const BRIEF_JOBS = { invitationExpire: 'brief.invitation_expire' } as const;
export const DESCRIPTION_MAX = 2_000;
export const ATTACHMENTS_MAX = 6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BUDGETS: readonly BudgetBand[] = ['lt_1000', 'b1000_2000', 'gt_2000', 'unknown'];

export type CreateBriefInput = {
  categorySlugs: string[];
  eventTypeSlug: string;
  eventDate: DateStr;
  guests: number;
  citySlug: string;
  budget?: BudgetBand;
  description?: string | null;
  /** Media already uploaded by the client (kind brief_attachment), ≤ 6. */
  attachmentMediaIds?: string[];
};

/** Great-circle distance in km between two city centroids. */
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** ‹Кетъринг› → ‹кетъринг›; keeps acronyms (‹DJ и озвучаване›). */
const lowerCategory = (s: string) => (/^[A-ZА-Я]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/**
 * O1. Guards: ≥ 1 category, a known event type and city, a date from today on,
 * guests ≥ 1; the client verified, not blocked, with a phone. Matching (§4.6):
 * publicly visible and accepting requests; an active service in a chosen
 * category (or that category is primary); serves the city (D73: base city,
 * nationwide, or within the radius); free on the date with lead time and
 * horizon (§12.6); max_guests null or ≥ guests. Budget does not filter (D65).
 */
export async function create(actor: AnyActor, input: CreateBriefInput, tx?: Tx): Promise<{ briefId: string; invited: number }> {
  assertClientActor(actor);
  const slugs = [...new Set(input.categorySlugs)];
  if (!slugs.length) throw new LifecycleError('validation', 'Choose at least one category');
  if (!DATE_RE.test(input.eventDate)) throw new LifecycleError('validation', 'eventDate must be YYYY-MM-DD');
  if (!Number.isInteger(input.guests) || input.guests < 1) throw new LifecycleError('validation', 'Guests must be a positive integer');
  const budget = input.budget ?? 'unknown';
  if (!BUDGETS.includes(budget)) throw new LifecycleError('validation', 'Unknown budget');
  const description = input.description?.trim() || null;
  if (description && description.length > DESCRIPTION_MAX) throw new LifecycleError('validation', `The description is limited to ${DESCRIPTION_MAX} characters`);
  const mediaIds = [...new Set(input.attachmentMediaIds ?? [])];
  if (mediaIds.length > ATTACHMENTS_MAX) throw new LifecycleError('validation', `Up to ${ATTACHMENTS_MAX} photos`);

  return withTx(tx, async t => {
    const at = await now();
    const today = sofiaDate(at);
    if (input.eventDate < today) throw new LifecycleError('validation', 'The date has passed');
    const s = await getSettings(at, t);
    const [c] = await t.select().from(user).where(eq(user.id, actor.userId)).limit(1);
    if (!c) throw new LifecycleError('not_found', 'No such client');
    if (c.banned) throw new LifecycleError('not_allowed', 'Blocked clients cannot send requests');
    if (!c.emailVerified) throw new LifecycleError('not_allowed', 'Verify the email first');
    if (!c.phone) throw new LifecycleError('validation', 'A phone number is needed on the profile');

    const cats = await t.select().from(category).where(and(inArray(category.slug, slugs), eq(category.isVisible, true)));
    if (cats.length !== slugs.length) throw new LifecycleError('validation', 'Unknown category');
    const [et] = await t.select().from(eventType).where(eq(eventType.slug, input.eventTypeSlug)).limit(1);
    if (!et) throw new LifecycleError('validation', 'Unknown event type');
    const [ct] = await t.select().from(city).where(eq(city.slug, input.citySlug)).limit(1);
    if (!ct) throw new LifecycleError('validation', 'Unknown city');

    const ev = await findOrCreateClientEvent(t, { clientId: c.id, eventTypeId: et.id, date: input.eventDate, cityId: ct.id, guests: input.guests, at });
    // T3: the invitations lapse ⚙ brief.offer_window_hours after sending, and no later than the end of the event day.
    const due = new Date(Math.min(at.getTime() + s['brief.offer_window_hours'] * HOUR, sofiaInstant(addDays(input.eventDate, 1)).getTime()));
    const [b] = await t.insert(brief).values({
      clientId: c.id, clientEventId: ev.id, eventTypeId: et.id, eventDate: input.eventDate, cityId: ct.id, guests: input.guests,
      budgetBand: budget, description, contactPhone: c.phone, status: 'open', sentAt: at, offersDueAt: due, createdAt: at,
    }).returning();
    await t.insert(briefCategory).values(cats.map(x => ({ briefId: b.id, categoryId: x.id })));
    if (mediaIds.length) {
      const owned = await t.select({ id: media.id }).from(media)
        .where(and(inArray(media.id, mediaIds), eq(media.ownerUserId, c.id), eq(media.kind, 'brief_attachment')));
      if (owned.length !== mediaIds.length) throw new LifecycleError('validation', 'Unknown attachment');
      await t.insert(briefAttachment).values(mediaIds.map((mediaId, position) => ({ briefId: b.id, mediaId, position })));
    }

    // Matching.
    const catIds = cats.map(x => x.id);
    const candidates = await t.select().from(partner)
      .where(and(eq(partner.status, 'approved'), eq(partner.isListed, true), eq(partner.acceptingRequests, true)));
    const services = candidates.length ? await t.select({ partnerId: service.partnerId, categoryId: service.categoryId, name: service.name, kind: service.kind })
      .from(service).where(and(inArray(service.partnerId, candidates.map(p => p.id)), eq(service.status, 'active'), inArray(service.categoryId, catIds))) : [];
    const cityRows = await t.select().from(city);
    const invited: { p: typeof partner.$inferSelect; need: string; serviceName: string }[] = [];
    for (const p of candidates) {
      const mine = services.filter(x => x.partnerId === p.id);
      const primaryChosen = !!p.primaryCategoryId && catIds.includes(p.primaryCategoryId);
      if (!mine.length && !primaryChosen) continue;
      const base = p.cityId ? cityRows.find(x => x.id === p.cityId) : null;
      const serves = p.servesNationwide || p.cityId === ct.id || (!!base && p.serviceRadiusKm != null && km(base, ct) <= p.serviceRadiusKm);
      if (!serves) continue;
      if (p.maxGuests != null && p.maxGuests < input.guests) continue;
      const check = await checkPartnerDate(t, p, input.eventDate, { today });
      if (!check.requestable) continue;
      const catId = mine[0]?.categoryId ?? p.primaryCategoryId!;
      const svc = mine.find(x => x.kind === 'on_request') ?? mine[0];
      const catName = cats.find(x => x.id === catId)?.name ?? '';
      invited.push({ p, need: lowerCategory(catName), serviceName: svc?.name ?? catName });
    }

    for (const m of invited) {
      const [inv] = await t.insert(briefInvitation).values({ briefId: b.id, partnerId: m.p.id, status: 'invited', invitedAt: at, offerDueAt: due }).returning();
      await scheduleJob(BRIEF_JOBS.invitationExpire, due, { invitationId: inv.id }, `invitation:${inv.id}:expire`, t);
    }

    await mail(t, {
      key: 'client-brief-sent', to: c.email, toUserId: c.id, dedupeKey: `brief:${b.id}:sent`,
      vars: {
        services: cats.map(x => x.name).join(', '), eventType: et.name, eventDate: date(input.eventDate), city: ct.name,
        guests: input.guests, phone: phoneDisplay(c.phone),
      },
    });
    for (const m of invited) {
      const [owner] = await t.select({ userId: partnerMember.userId }).from(partnerMember)
        .where(eq(partnerMember.partnerId, m.p.id)).orderBy(asc(partnerMember.createdAt)).limit(1);
      await mail(t, {
        key: 'vendor-new-inquiry', to: m.p.notificationEmail, toUserId: owner?.userId ?? null, dedupeKey: `brief:${b.id}:invite:${m.p.id}`,
        vars: {
          // No request exists until an offer is chosen (O6); the CTA opens the partner's requests.
          requestId: '', clientName: c.name, eventType: et.name, eventDate: date(input.eventDate), guests: input.guests,
          location: ct.name, need: m.need, serviceName: m.serviceName,
        },
      });
    }
    await audit(t, {
      actor, action: 'brief.sent', entity: 'brief', entityId: b.id,
      data: { categories: slugs, eventDate: input.eventDate, city: ct.slug, guests: input.guests, invited: invited.map(m => m.p.id) },
    });
    return { briefId: b.id, invited: invited.length };
  });
}

/** T3: an invitation still `invited` at its offer deadline → `lapsed` (no email). */
export async function invitationExpireJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const [inv] = await t.select().from(briefInvitation).where(eq(briefInvitation.id, String(p.invitationId))).for('update');
    if (!inv || inv.status !== 'invited') return;
    const at = await now();
    if (at < inv.offerDueAt) return;
    await t.update(briefInvitation).set({ status: 'lapsed' }).where(eq(briefInvitation.id, inv.id));
    await audit(t, { actor: SYSTEM, action: 'brief.invitation_lapsed', entity: 'brief_invitation', entityId: inv.id, data: { briefId: inv.briefId } });
  });
}
