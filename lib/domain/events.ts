// Client events — the client's event folders (‹Моите събития›, DATA-MODEL
// client_event, SCREENS client/events.html + event.html, SPEC §16).
//
// A request (or brief) is attached to the client's event with the same event
// type and date, otherwise a new event is created, named after the event type
// (D15). ‹Добави услуга към събитието› passes `sabitie-id`, and requests sent
// from there attach to that event.
//
// Also here: the conversation for a request — one per (client, partner,
// client event), SPEC §4.16 — which R1 creates and R2 writes to.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { booking, charge, city, clientEvent, conversation, eventType, partner, refund, request } from '@/db/schema';
import { now } from '@/lib/clock';
import { sofiaDate, type DateStr } from '@/lib/format';
import type { AnyActor } from './actor';
import { audit } from './audit';
import { LifecycleError, assertClientActor, withTx, type ClientEventRow } from './bookings';

export const NOTES_MAX = 4_000;

/** D15: the client's event with this type and date, or a new one named after the type. `explicitEventId` (‹sabitie-id›) wins. */
export async function findOrCreateClientEvent(tx: Tx, a: {
  clientId: string; eventTypeId: string; date: DateStr; explicitEventId?: string | null;
  startTime?: string | null; endTime?: string | null; venueName?: string | null; locality?: string | null; cityId?: string | null; guests?: number | null;
  at: Date;
}): Promise<ClientEventRow> {
  if (a.explicitEventId) {
    const [ev] = await tx.select().from(clientEvent).where(and(eq(clientEvent.id, a.explicitEventId), eq(clientEvent.clientId, a.clientId))).limit(1);
    if (!ev) throw new LifecycleError('not_found', 'No such event');
    return ev;
  }
  const [match] = await tx.select().from(clientEvent)
    .where(and(eq(clientEvent.clientId, a.clientId), eq(clientEvent.eventTypeId, a.eventTypeId), eq(clientEvent.date, a.date)))
    .orderBy(asc(clientEvent.createdAt)).limit(1);
  if (match) return match;
  const [et] = await tx.select({ name: eventType.name }).from(eventType).where(eq(eventType.id, a.eventTypeId)).limit(1);
  if (!et) throw new LifecycleError('validation', 'Unknown event type');
  const [ev] = await tx.insert(clientEvent).values({
    clientId: a.clientId, eventTypeId: a.eventTypeId, title: et.name, date: a.date,
    startTime: a.startTime ?? null, endTime: a.endTime ?? null, venueName: a.venueName ?? null, locality: a.locality ?? null,
    cityId: a.cityId ?? null, guests: a.guests ?? null, createdAt: a.at, updatedAt: a.at,
  }).returning();
  return ev;
}

/**
 * The conversation of a client, a partner and a client event (SPEC §4.16),
 * created on the first request. Its context link follows the latest request
 * and booking.
 */
export async function ensureConversation(tx: Tx, a: {
  clientId: string; partnerId: string; clientEventId: string; requestId?: string; bookingId?: string; at: Date;
}): Promise<typeof conversation.$inferSelect> {
  const set: Partial<typeof conversation.$inferInsert> = {};
  if (a.requestId) set.requestId = a.requestId;
  if (a.bookingId) set.bookingId = a.bookingId;
  const [c] = await tx.insert(conversation).values({
    clientId: a.clientId, partnerId: a.partnerId, clientEventId: a.clientEventId,
    requestId: a.requestId ?? null, bookingId: a.bookingId ?? null, createdAt: a.at,
  }).onConflictDoUpdate({
    target: [conversation.clientId, conversation.partnerId, conversation.clientEventId],
    set: Object.keys(set).length ? set : { clientId: a.clientId },
  }).returning();
  return c;
}

// ── Folder summaries (SPEC §16) ──────────────────────────────────────────

export type ClientEventSummary = {
  id: string; title: string; hosts: string | null; date: DateStr; startTime: string | null;
  eventType: { slug: string; name: string }; cityName: string | null; venueName: string | null; locality: string | null; guests: number | null;
  /** ‹Предстоящо› (date ≥ today) / ‹Минало събитие›. */
  upcoming: boolean;
  /** ‹N заявки›: requests without a confirmed/completed booking (declined and expired included). */
  requestsCount: number;
  /** ‹N резервации›: bookings confirmed/completed. */
  bookingsCount: number;
  /** ‹N заявка чака плащане›. */
  awaitingPaymentCount: number;
  /** ‹Платено до момента›: Σ paid on the event's bookings, net of refunds. */
  paidCents: number;
  /** ‹още X € по чакащите заявки›: Σ pending requests + awaiting-payment bookings. */
  pendingCents: number;
};

const CONFIRMED = ['confirmed', 'cancellation_requested', 'completed'] as const;

/** Summaries of a client's events (all, or `eventIds`), newest date last. */
export async function eventSummaries(q: Queryable, clientId: string, at: Date, eventIds?: string[]): Promise<ClientEventSummary[]> {
  const conds = [eq(clientEvent.clientId, clientId)];
  if (eventIds) conds.push(inArray(clientEvent.id, eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000']));
  const events = await q.select({ e: clientEvent, et: { slug: eventType.slug, name: eventType.name }, cityName: city.name })
    .from(clientEvent).innerJoin(eventType, eq(eventType.id, clientEvent.eventTypeId)).leftJoin(city, eq(city.id, clientEvent.cityId))
    .where(and(...conds)).orderBy(asc(clientEvent.date), asc(clientEvent.createdAt));
  if (!events.length) return [];
  const ids = events.map(r => r.e.id);
  const reqs = await q.select({ eventId: request.clientEventId, status: request.status, amountCents: request.amountCents, bookingStatus: booking.status })
    .from(request).leftJoin(booking, eq(booking.requestId, request.id)).where(inArray(request.clientEventId, ids));
  const bookings = await q.select({ id: booking.id, eventId: booking.clientEventId, status: booking.status, amountCents: booking.amountCents })
    .from(booking).where(inArray(booking.clientEventId, ids));
  const bookingIds = bookings.map(b => b.id);
  const charged = bookingIds.length ? await q.select({ bookingId: charge.bookingId, s: sql<string>`sum(${charge.amountCents})` }).from(charge)
    .where(and(inArray(charge.bookingId, bookingIds), inArray(charge.status, ['succeeded', 'partially_refunded', 'refunded']), eq(charge.isDuplicate, false)))
    .groupBy(charge.bookingId) : [];
  const refunded = bookingIds.length ? await q.select({ bookingId: refund.bookingId, s: sql<string>`sum(${refund.amountCents})` }).from(refund)
    .innerJoin(charge, eq(charge.id, refund.chargeId))
    .where(and(inArray(refund.bookingId, bookingIds), eq(refund.status, 'succeeded'), eq(charge.isDuplicate, false))).groupBy(refund.bookingId) : [];
  const paidBy = new Map<string, number>();
  for (const c of charged) paidBy.set(c.bookingId, Number(c.s));
  for (const r of refunded) paidBy.set(r.bookingId, (paidBy.get(r.bookingId) ?? 0) - Number(r.s));
  const today = sofiaDate(at);
  return events.map(({ e, et, cityName }) => {
    const rs = reqs.filter(r => r.eventId === e.id);
    const bs = bookings.filter(b => b.eventId === e.id);
    return {
      id: e.id, title: e.title, hosts: e.hosts, date: e.date, startTime: e.startTime ? e.startTime.slice(0, 5) : null,
      eventType: et, cityName, venueName: e.venueName, locality: e.locality, guests: e.guests,
      upcoming: e.date >= today,
      requestsCount: rs.filter(r => !r.bookingStatus || !(CONFIRMED as readonly string[]).includes(r.bookingStatus)).length,
      bookingsCount: bs.filter(b => (CONFIRMED as readonly string[]).includes(b.status)).length,
      awaitingPaymentCount: bs.filter(b => b.status === 'awaiting_payment').length,
      paidCents: bs.reduce((s, b) => s + (paidBy.get(b.id) ?? 0), 0),
      pendingCents: rs.filter(r => r.status === 'pending' && r.amountCents != null).reduce((s, r) => s + r.amountCents!, 0)
        + bs.filter(b => b.status === 'awaiting_payment').reduce((s, b) => s + b.amountCents, 0),
    };
  });
}

/** /akaunt/sabitiya: the client's events with their summaries. */
export async function listClientEvents(actor: AnyActor, q: Queryable = db): Promise<ClientEventSummary[]> {
  assertClientActor(actor);
  return eventSummaries(q, actor.userId, await now());
}

export type ClientEventDetail = ClientEventSummary & {
  notes: string | null; notesUpdatedAt: Date | null; endTime: string | null;
  requests: { number: string; kind: string; status: string; partnerName: string; partnerSlug: string; serviceTitle: string; amountCents: number | null; bookingStatus: string | null; sentAt: Date }[];
  bookings: { number: string; status: string; partnerName: string; partnerSlug: string; serviceTitle: string; amountCents: number; startTime: string | null }[];
};

/** /akaunt/sabitiya/[id]: one of the client's events (404 otherwise). */
export async function getClientEvent(actor: AnyActor, id: string, q: Queryable = db): Promise<ClientEventDetail> {
  assertClientActor(actor);
  const at = await now();
  const [sum] = await eventSummaries(q, actor.userId, at, [id]);
  if (!sum) throw new LifecycleError('not_found', 'No such event');
  const [ev] = await q.select().from(clientEvent).where(eq(clientEvent.id, id)).limit(1);
  const reqs = await q.select({
    number: request.number, kind: request.kind, status: request.status, partnerName: partner.businessName, partnerSlug: partner.slug,
    serviceTitle: request.serviceTitle, amountCents: request.amountCents, bookingStatus: booking.status, sentAt: request.sentAt,
  }).from(request).innerJoin(partner, eq(partner.id, request.partnerId)).leftJoin(booking, eq(booking.requestId, request.id))
    .where(eq(request.clientEventId, id)).orderBy(asc(request.sentAt));
  const bks = await q.select({
    number: booking.number, status: booking.status, partnerName: partner.businessName, partnerSlug: partner.slug,
    serviceTitle: booking.serviceTitle, amountCents: booking.amountCents, startTime: booking.startTime,
  }).from(booking).innerJoin(partner, eq(partner.id, booking.partnerId))
    .where(eq(booking.clientEventId, id)).orderBy(sql`${booking.startTime} asc nulls last`, asc(booking.createdAt));
  return {
    ...sum, notes: ev.notes, notesUpdatedAt: ev.notesUpdatedAt, endTime: ev.endTime ? ev.endTime.slice(0, 5) : null,
    requests: reqs.filter(r => !r.bookingStatus || !(CONFIRMED as readonly string[]).includes(r.bookingStatus)),
    bookings: bks.filter(b => (CONFIRMED as readonly string[]).includes(b.status)).map(b => ({ ...b, startTime: b.startTime ? b.startTime.slice(0, 5) : null })),
  };
}

/** ‹Запази бележката› (toast ‹Бележката е запазена›). Notes are private to the client (‹Виждат ги само вие›). */
export async function saveNotes(actor: AnyActor, input: { eventId: string; notes: string }, tx?: Tx): Promise<{ notesUpdatedAt: Date }> {
  assertClientActor(actor);
  const notes = input.notes.trim();
  if (notes.length > NOTES_MAX) throw new LifecycleError('validation', `Notes are limited to ${NOTES_MAX} characters`);
  return withTx(tx, async t => {
    const at = await now();
    const rows = await t.update(clientEvent).set({ notes: notes || null, notesUpdatedAt: at, updatedAt: at })
      .where(and(eq(clientEvent.id, input.eventId), eq(clientEvent.clientId, actor.userId))).returning({ id: clientEvent.id });
    if (!rows.length) throw new LifecycleError('not_found', 'No such event');
    await audit(t, { actor, action: 'client_event.notes_saved', entity: 'client_event', entityId: input.eventId });
    return { notesUpdatedAt: at };
  });
}
