// Requests (SPEC §4.5) — a заявка to one partner.
//   R1 sendRequest (client) · R2 askForInfo · R3/R6 approveRequest (→ booking K1)
//   R4 sendQuote · R5 chooseQuoteOffer · R7 declineRequest · R8 expiry (T2/T4)
//   R9 auto-decline when a date fills (from K5) · R10 offer lapse
//   client withdrawal of an unanswered request (cancelPendingRequest)
// plus the T1 partner reminder and the request view models.
//
// Quote and brief screens ship only after their copy is approved (D60); the
// rules are implemented here so the screens only have to call them.
import { and, asc, eq, inArray, lt, ne } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, brief, briefInvitation, category, conversation, dateWatch, eventType, media, message, offer, partner, request, requestAttachment, service, user,
  type DeclineReason, type SpaceType,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { date, dateTime, money, moneyShort, sofiaDate, type DateStr } from '@/lib/format';
import { cancelJobs, scheduleJob } from '@/lib/jobs';
import { SYSTEM, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import {
  HOLDING_STATUSES, HOUR, LIFECYCLE_JOBS, LifecycleError, PHONE_VISIBLE_STATUSES, assertClientActor, assertPartnerActor, checkPartnerDate,
  completionInstant, createBookingFromRequest, eventStartInstant, jobKey, loadParties, locationOf, mail, packageNameOf, paymentWindowHours,
  schedulePaymentJobs, timeRange, withTx,
  type DateProblem, type Parties, type RequestRow,
} from './bookings';
import { projectedSplit, split } from './commission';
import { ensureConversation, findOrCreateClientEvent } from './events';
import { allocateNumber } from './numbers';
import { getSettings } from './settings';

export const NOTE_MAX = 2_000;
export const MESSAGE_MAX = 4_000;
export const ATTACHMENTS_MAX = 6;
/** Request states the partner still has to answer (and the unique-per-date index covers). */
export const OPEN_REQUEST_STATUSES = ['pending', 'offer_sent', 'awaiting_confirmation'] as const;
/** ‹Датата е заета› — the one fixed decline reason (D63); `other` carries the partner's text. */
export const DECLINE_REASON_LABEL: Record<DeclineReason, string> = { date_taken: 'Датата е заета', other: 'Друга причина' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// ── Contact masking for the request conversation (SPEC §10, D19) ─────────

const PROTECT = [
  /\d{4}-\d{4}-[АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЮЯ]{2}/g,             // booking numbers
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g,                             // dates 14.06.2026
  /\d{1,3}(?:[  ]\d{3})*(?:,\d{2})?[  ]?€/g,                  // money 1 450,00 €
  /\b\d{1,2}:\d{2}\b/g,                                       // times 17:00
];

/**
 * Replace e-mail addresses and phone numbers (a run of digits with + ( ) . - /
 * or spaces holding ≥ 7 digits) with ‹•••›, keeping dates, money, times and
 * booking numbers. The original text is stored separately for the team.
 */
export function maskContacts(text: string): string {
  const kept: string[] = [];
  let s = text;
  for (const re of PROTECT) s = s.replace(re, m => `\u0000${kept.push(m) - 1}\u0000`);
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '•••');
  s = s.replace(/\+?\(?\d[\d\s\-./()]{5,}\d/g, m => (m.replace(/\D/g, '').length >= 7 ? '•••' : m));
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

// ── Shared loading ───────────────────────────────────────────────────────

type RequestContext = { request: RequestRow; parties: Parties; serviceName: string };

async function loadRequest(q: Queryable, ref: { id?: string; number?: string }, forUpdate = false): Promise<RequestContext | null> {
  const where = ref.id ? eq(request.id, ref.id) : eq(request.number, ref.number ?? '');
  const base = q.select().from(request).where(where).limit(1);
  const [r] = forUpdate ? await base.for('update') : await base;
  if (!r) return null;
  const parties = await loadParties(q, { clientId: r.clientId, partnerId: r.partnerId, eventTypeId: r.eventTypeId, cityId: r.cityId });
  return { request: r, parties, serviceName: r.serviceTitle };
}

async function requestForPartner(tx: Tx, actor: AnyActor, number: string): Promise<RequestContext> {
  assertPartnerActor(actor);
  const ctx = await loadRequest(tx, { number }, true);
  if (!ctx || ctx.request.partnerId !== actor.partnerId) throw new LifecycleError('not_found', `No request ${number}`);
  return ctx;
}

async function requestForClient(tx: Tx, actor: AnyActor, number: string): Promise<RequestContext> {
  assertClientActor(actor);
  const ctx = await loadRequest(tx, { number }, true);
  if (!ctx || ctx.request.clientId !== actor.userId) throw new LifecycleError('not_found', `No request ${number}`);
  return ctx;
}

/** ‹1 450,00 €›, or ‹По оферта› for an unanswered quote. */
const amountText = (cents: number | null) => (cents == null ? 'По оферта' : money(cents));

/** The response deadline (SPEC §3 clamp): min(from + hours, event start − 1 h). */
function responseDue(from: Date, hours: number, r: { eventDate: DateStr; startTime: string | null }): Date {
  return new Date(Math.min(from.getTime() + hours * HOUR, eventStartInstant(r.eventDate, r.startTime).getTime() - HOUR));
}

const problemText: Record<DateProblem, string> = {
  past: 'the date has passed', lead_time: 'inside the lead time', horizon: 'beyond the horizon', non_working_day: 'not a working day',
  blocked: 'blocked by the partner', not_open: 'not an open date', full: 'fully booked',
};

// ── R1: ‹Изпрати заявката› ───────────────────────────────────────────────

export type SendRequestInput = {
  partnerId?: string;
  partnerSlug?: string;
  serviceId: string;
  eventTypeId?: string;
  eventTypeSlug?: string;
  eventDate: DateStr;
  startTime?: string | null;
  endTime?: string | null;
  guests: number;
  venueName?: string | null;
  locality?: string | null;
  cityId?: string | null;
  spaceType?: SpaceType | null;
  note?: string | null;
  /** ‹sabitie-id›: attach to this client event (D15). */
  clientEventId?: string | null;
  /** Media already uploaded by the client (kind request_attachment), ≤ 6. */
  attachmentMediaIds?: string[];
};

/**
 * R1. Guards: the partner can receive requests; the service is active and
 * accepts requests; the date passes §12.6; guests ≤ max_guests; no other active
 * request (or held booking) from this client to this partner for the date; the
 * client is verified, not blocked, and has a phone. Effects: number (D2),
 * snapshots, response_due_at (§3), client event (D15), conversation,
 * attachments, T1/T2, `client-request-sent` + `vendor-new-request` /
 * `vendor-new-inquiry`; the client's watch on that date closes (§4.14).
 */
export async function sendRequest(actor: AnyActor, input: SendRequestInput, tx?: Tx): Promise<{ requestId: string; number: string }> {
  assertClientActor(actor);
  if (!DATE_RE.test(input.eventDate)) throw new LifecycleError('validation', 'eventDate must be YYYY-MM-DD');
  for (const t of [input.startTime, input.endTime]) if (t && !TIME_RE.test(t)) throw new LifecycleError('validation', 'Times are HH:MM');
  if (!Number.isInteger(input.guests) || input.guests < 1) throw new LifecycleError('validation', 'Guests must be a positive integer');
  const note = input.note?.trim() || null;
  if (note && note.length > NOTE_MAX) throw new LifecycleError('validation', `The note is limited to ${NOTE_MAX} characters`);
  const mediaIds = [...new Set(input.attachmentMediaIds ?? [])];
  if (mediaIds.length > ATTACHMENTS_MAX) throw new LifecycleError('validation', `Up to ${ATTACHMENTS_MAX} photos`);

  return withTx(tx, async t => {
    const at = await now();
    const today = sofiaDate(at);
    const s = await getSettings(at, t);
    const [c] = await t.select().from(user).where(eq(user.id, actor.userId)).limit(1);
    if (!c) throw new LifecycleError('not_found', 'No such client');
    if (c.banned) throw new LifecycleError('not_allowed', 'Blocked clients cannot send requests');
    if (!c.emailVerified) throw new LifecycleError('not_allowed', 'Verify the email first');
    if (!c.phone) throw new LifecycleError('validation', 'A phone number is needed on the profile');

    const [p] = input.partnerId
      ? await t.select().from(partner).where(eq(partner.id, input.partnerId)).limit(1)
      : await t.select().from(partner).where(eq(partner.slug, input.partnerSlug ?? '')).limit(1);
    if (!p) throw new LifecycleError('not_found', 'No such partner');
    if (p.status !== 'approved' || !p.isListed || !p.acceptingRequests) throw new LifecycleError('not_allowed', 'The partner is not accepting requests');

    const [svc] = await t.select().from(service).where(and(eq(service.id, input.serviceId), eq(service.partnerId, p.id))).limit(1);
    if (!svc || svc.status !== 'active' || !svc.acceptingRequests || svc.kind === 'addon') {
      throw new LifecycleError('not_allowed', 'The service does not accept requests');
    }
    const kind = svc.kind === 'on_request' ? 'quote' : 'package';

    const [et] = input.eventTypeId
      ? await t.select().from(eventType).where(eq(eventType.id, input.eventTypeId)).limit(1)
      : await t.select().from(eventType).where(eq(eventType.slug, input.eventTypeSlug ?? '')).limit(1);
    if (!et) throw new LifecycleError('validation', 'Unknown event type');

    const check = await checkPartnerDate(t, p, input.eventDate, { today });
    if (!check.requestable) {
      throw new LifecycleError('date_unavailable', `The date is not available: ${check.problems.map(x => problemText[x]).join(', ')}`);
    }
    if (p.maxGuests != null && input.guests > p.maxGuests) throw new LifecycleError('validation', `The partner takes up to ${p.maxGuests} guests`);

    const [open] = await t.select({ id: request.id }).from(request).where(and(
      eq(request.clientId, c.id), eq(request.partnerId, p.id), eq(request.eventDate, input.eventDate), inArray(request.status, [...OPEN_REQUEST_STATUSES]),
    )).limit(1);
    const [held] = await t.select({ id: booking.id }).from(booking).where(and(
      eq(booking.clientId, c.id), eq(booking.partnerId, p.id), eq(booking.eventDate, input.eventDate), inArray(booking.status, [...HOLDING_STATUSES]),
    )).limit(1);
    if (open || held) throw new LifecycleError('duplicate', 'You already have a request to this partner for this date');

    const amountCents = kind === 'quote' ? null
      : svc.priceUnit === 'per_guest' ? svc.priceCents! * Math.max(input.guests, svc.minGuests ?? 0) : svc.priceCents!;
    const responseDueAt = responseDue(at, s['request.response_hours'], { eventDate: input.eventDate, startTime: input.startTime ?? null });
    if (responseDueAt.getTime() <= at.getTime()) throw new LifecycleError('deadline_passed', 'The event is too close to request');

    const ev = await findOrCreateClientEvent(t, {
      clientId: c.id, eventTypeId: et.id, date: input.eventDate, explicitEventId: input.clientEventId,
      startTime: input.startTime, endTime: input.endTime, venueName: input.venueName, locality: input.locality, cityId: input.cityId,
      guests: input.guests, at,
    });
    const [cat] = await t.select({ name: category.name }).from(category).where(eq(category.id, svc.categoryId)).limit(1);
    const number = await allocateNumber(t, input.eventDate);
    const [r] = await t.insert(request).values({
      number, kind, status: 'pending', clientId: c.id, partnerId: p.id, serviceId: svc.id, clientEventId: ev.id,
      eventTypeId: et.id, eventDate: input.eventDate, startTime: input.startTime ?? null, endTime: input.endTime ?? null, guests: input.guests,
      venueName: input.venueName?.trim() || null, locality: input.locality?.trim() || null, cityId: input.cityId ?? null,
      spaceType: input.spaceType ?? null, note, contactPhone: c.phone, serviceTitle: svc.name, serviceSummary: cat?.name ?? null,
      amountCents, sentAt: at, responseDueAt, createdAt: at, updatedAt: at,
    }).returning();

    if (mediaIds.length) {
      const owned = await t.select({ id: media.id }).from(media).where(and(inArray(media.id, mediaIds), eq(media.ownerUserId, c.id)));
      if (owned.length !== mediaIds.length) throw new LifecycleError('validation', 'Unknown attachment');
      await t.insert(requestAttachment).values(mediaIds.map((mediaId, position) => ({ requestId: r.id, mediaId, position })));
    }
    await ensureConversation(t, { clientId: c.id, partnerId: p.id, clientEventId: ev.id, requestId: r.id, at });
    await t.update(dateWatch).set({ status: 'closed', closedAt: at }).where(and(
      eq(dateWatch.clientId, c.id), eq(dateWatch.partnerId, p.id), eq(dateWatch.date, input.eventDate), eq(dateWatch.status, 'watching'),
    ));

    // T1, T2
    const remindAt = new Date(responseDueAt.getTime() - s['request.partner_reminder_before_h'] * HOUR);
    if (remindAt > at) await scheduleJob(LIFECYCLE_JOBS.requestReminder, remindAt, { requestId: r.id }, jobKey.requestReminder(r.id), t);
    await scheduleJob(LIFECYCLE_JOBS.requestExpire, responseDueAt, { requestId: r.id }, jobKey.requestExpire(r.id), t);

    const parties = await loadParties(t, { clientId: c.id, partnerId: p.id, eventTypeId: et.id, cityId: r.cityId });
    const location = locationOf(r, parties.cityName);
    await mail(t, {
      key: 'client-request-sent', to: c.email, toUserId: c.id, dedupeKey: `request:${r.id}:sent`,
      vars: {
        requestId: number, requestNo: number, partnerName: p.businessName, partnerCategory: parties.partnerCategory,
        packageName: packageNameOf(svc.name), eventType: et.name, guests: input.guests, eventDate: date(input.eventDate),
        eventTime: r.startTime ? r.startTime.slice(0, 5) : '—', location, photoCount: mediaIds.length,
        amount: amountText(amountCents), replyBy: dateTime(responseDueAt),
      },
    });
    if (parties.partnerUserId) {
      if (kind === 'package') {
        const sp = await projectedSplit(t, { partnerId: p.id, clientId: c.id, amountCents: amountCents!, at });
        const attached = note && mediaIds.length ? `бележка и ${mediaIds.length} ${mediaIds.length === 1 ? 'снимка' : 'снимки'} за вдъхновение`
          : note ? 'бележка' : mediaIds.length ? `${mediaIds.length} ${mediaIds.length === 1 ? 'снимка' : 'снимки'} за вдъхновение` : undefined;
        await mail(t, {
          key: 'vendor-new-request', to: p.notificationEmail, toUserId: parties.partnerUserId, dedupeKey: `request:${r.id}:new`,
          vars: {
            requestId: number, requestNo: number, clientName: c.name, eventType: et.name, eventTypeDefinite: et.nameDefinite,
            eventDate: date(input.eventDate), eventWeekday: weekday(input.eventDate), timeRange: timeRange(r.startTime, r.endTime, true),
            guests: input.guests, location, packageName: packageNameOf(svc.name), partnerAmount: money(sp.partnerAmountCents),
            replyBy: dateTime(responseDueAt), ...(attached ? { attached } : {}),
          },
          // D54: ‹Нова заявка от {Клиент}› / ‹{Тип} · {дата} · отговорете до 24 часа›
          bell: { title: `Нова заявка от ${c.name}`, body: `${et.name} · ${date(input.eventDate)} · отговорете до ${s['request.response_hours']} часа` },
        });
      } else {
        await mail(t, {
          key: 'vendor-new-inquiry', to: p.notificationEmail, toUserId: parties.partnerUserId, dedupeKey: `request:${r.id}:new`,
          vars: {
            requestId: number, clientName: c.name, eventType: et.name, eventDate: date(input.eventDate), guests: input.guests, location,
            // ‹need› (what the client is looking for) is not a request field; the service's category is the closest record.
            need: lowerCategory(cat?.name ?? svc.name), serviceName: svc.name,
          },
        });
      }
    }
    await audit(t, { actor, action: 'request.sent', entity: 'request', entityId: r.id, data: { number, kind, partnerId: p.id, amountCents } });
    return { requestId: r.id, number };
  });
}
/** SCREENS name for R1. */
export const create = sendRequest;

const weekday = (d: DateStr) => {
  const [y, m, day] = d.split('-').map(Number);
  return ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'][new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
};
/** ‹Кетъринг› → ‹кетъринг›; keeps acronyms (‹DJ и озвучаване›). */
const lowerCategory = (s: string) => (/^[A-ZА-Я]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

// ── R2: ‹Поискай още информация› ─────────────────────────────────────────

/**
 * R2: the partner's question goes into the request's conversation (masked per
 * §10, since no booking is confirmed yet) and `client-new-message` goes out.
 * The 24 h clock keeps running (D61).
 */
export async function askForInfo(actor: AnyActor, input: { number: string; body: string }, tx?: Tx): Promise<{ messageId: string; conversationId: string }> {
  const body = input.body.trim();
  if (!body) throw new LifecycleError('validation', 'The question is empty');
  if (body.length > MESSAGE_MAX) throw new LifecycleError('validation', `Messages are limited to ${MESSAGE_MAX} characters`);
  return withTx(tx, async t => {
    const { request: r, parties } = await requestForPartner(t, actor, input.number);
    if (!(['pending', 'awaiting_confirmation'] as string[]).includes(r.status)) throw new LifecycleError('invalid_state', 'The request is already answered');
    const at = await now();
    const conv = await ensureConversation(t, { clientId: r.clientId, partnerId: r.partnerId, clientEventId: r.clientEventId, requestId: r.id, at });
    const masked = maskContacts(body);
    const [m] = await t.insert(message).values({
      conversationId: conv.id, senderRole: 'partner', senderUserId: (actor as Actor).userId, body: masked, bodyOriginal: body, createdAt: at,
    }).returning({ id: message.id });
    await t.update(conversation).set({ lastMessageAt: at, clientUnreadCount: conv.clientUnreadCount + 1, partnerDraft: null })
      .where(eq(conversation.id, conv.id));
    await mail(t, {
      key: 'client-new-message', to: parties.client.email, toUserId: r.clientId, dedupeKey: `message:${m.id}`,
      vars: {
        partnerName: parties.partner.businessName, message: masked, eventType: parties.eventType.name, eventDate: date(r.eventDate),
        packageName: packageNameOf(r.serviceTitle), location: locationOf(r, parties.cityName), receivedAt: dateTime(at),
      },
      bell: { href: `/akaunt/saobshteniya/${conv.id}` },
    });
    await audit(t, { actor, action: 'request.info_requested', entity: 'request', entityId: r.id, data: { number: r.number, messageId: m.id } });
    return { messageId: m.id, conversationId: conv.id };
  });
}

// ── R7 / R9: decline ─────────────────────────────────────────────────────

async function declineInTx(t: Tx, ctx: RequestContext, a: { actor: AnyActor; reason: DeclineReason; text: string | null; at: Date }) {
  const r = ctx.request;
  await t.update(request).set({
    status: 'declined', declinedAt: a.at, answeredAt: r.answeredAt ?? a.at, declineReason: a.reason, declineText: a.text, updatedAt: a.at,
  }).where(eq(request.id, r.id));
  await cancelJobs(`request:${r.id}:`, t);
  if (r.offerId) await t.update(offer).set({ status: 'lapsed', decidedAt: a.at }).where(and(eq(offer.id, r.offerId), inArray(offer.status, ['sent', 'chosen'])));
  const p = ctx.parties;
  await mail(t, {
    key: 'client-request-declined', to: p.client.email, toUserId: r.clientId, dedupeKey: `request:${r.id}:declined`,
    vars: {
      requestNo: r.number, partnerName: p.partner.businessName, partnerCategory: p.partnerCategory, serviceName: r.serviceTitle,
      eventType: p.eventType.name, eventDate: date(r.eventDate),
      reason: a.reason === 'date_taken' ? DECLINE_REASON_LABEL.date_taken : (a.text ?? DECLINE_REASON_LABEL.other), amount: amountText(r.amountCents),
    },
  });
  await audit(t, { actor: a.actor, action: 'request.declined', entity: 'request', entityId: r.id, data: { number: r.number, reason: a.reason, text: a.text } });
}

/** R7: ‹Откажи› with ‹Датата е заета› or ‹Друга причина› + text (D63). */
export async function declineRequest(actor: AnyActor, input: { number: string; reason: DeclineReason; text?: string | null }, tx?: Tx): Promise<void> {
  const text = input.text?.trim() || null;
  if (input.reason === 'other' && !text) throw new LifecycleError('validation', 'Write the reason');
  if (text && text.length > 500) throw new LifecycleError('validation', 'The reason is limited to 500 characters');
  return withTx(tx, async t => {
    const ctx = await requestForPartner(t, actor, input.number);
    if (!(['pending', 'awaiting_confirmation'] as string[]).includes(ctx.request.status)) throw new LifecycleError('invalid_state', 'The request is already answered');
    await declineInTx(t, ctx, { actor, reason: input.reason, text: input.reason === 'other' ? text : null, at: await now() });
  });
}
/** SCREENS name for R7. */
export const decline = declineRequest;

/**
 * R9 + O5 (D64), from K5: once the partner's date is full, every pending
 * request for it is declined with ‹Датата е заета›, and every offer still
 * `sent` for it lapses (its quote request → `expired`, R10, no email).
 */
export async function closeFullDate(t: Tx, a: { partnerId: string; date: DateStr; exceptRequestId?: string }): Promise<{ declined: number; lapsed: number }> {
  const at = await now();
  const [p] = await t.select().from(partner).where(eq(partner.id, a.partnerId)).limit(1);
  const check = await checkPartnerDate(t, p, a.date, { today: sofiaDate(at), window: false });
  if (!check.problems.includes('full')) return { declined: 0, lapsed: 0 };
  // Locked as selected: a request the partner declines (or T2 expires) meanwhile drops out of the
  // set once that transaction commits, instead of being declined a second time over its own outcome.
  const pending = await t.select({ id: request.id }).from(request).where(and(
    eq(request.partnerId, a.partnerId), eq(request.eventDate, a.date), eq(request.status, 'pending'),
    ...(a.exceptRequestId ? [ne(request.id, a.exceptRequestId)] : []),
  )).for('update');
  let declined = 0;
  for (const { id } of pending) {
    const ctx = (await loadRequest(t, { id }, true))!;
    if (ctx.request.status !== 'pending') continue;
    await declineInTx(t, ctx, { actor: SYSTEM, reason: 'date_taken', text: null, at });
    declined++;
  }
  // O5: offers on quote requests for this date… The requests are locked first, in the order the
  // client's choice (R5) takes them (request, then offer); one chosen meanwhile drops out.
  const quoteOffers = await t.select({ offerId: offer.id, requestId: request.id }).from(offer).innerJoin(request, eq(request.id, offer.requestId))
    .where(and(eq(offer.partnerId, a.partnerId), eq(offer.status, 'sent'), eq(request.status, 'offer_sent'), eq(request.eventDate, a.date)))
    .for('update', { of: request });
  // …and on briefs for this date.
  const briefOffers = await t.select({ offerId: offer.id }).from(offer)
    .innerJoin(briefInvitation, eq(briefInvitation.id, offer.invitationId)).innerJoin(brief, eq(brief.id, briefInvitation.briefId))
    .where(and(eq(offer.partnerId, a.partnerId), eq(offer.status, 'sent'), eq(brief.eventDate, a.date)));
  const candidates = [...quoteOffers.map(o => o.offerId), ...briefOffers.map(o => o.offerId)];
  const lapsed = candidates.length
    ? (await t.update(offer).set({ status: 'lapsed', decidedAt: at })
      .where(and(inArray(offer.id, candidates), eq(offer.status, 'sent'))).returning({ id: offer.id })).map(o => o.id)
    : [];
  for (const q of quoteOffers.filter(o => lapsed.includes(o.offerId))) {
    await t.update(request).set({ status: 'expired', expiredAt: at, updatedAt: at }).where(and(eq(request.id, q.requestId), eq(request.status, 'offer_sent')));
    await audit(t, { actor: SYSTEM, action: 'request.offer_lapsed', entity: 'request', entityId: q.requestId, data: { offerId: q.offerId } });
  }
  return { declined, lapsed: lapsed.length };
}

// ── R3 / R6: approval → booking (K1) ─────────────────────────────────────

/**
 * R3 (`package`, pending) and R6 (`quote`/`brief`, awaiting_confirmation):
 * before response_due_at; the date still free with holds counted (the partner
 * row is locked so two approvals cannot overbook a date); with stripe, the
 * partner's provider account can take charges (D62). Creates the booking
 * (K1), cancels T1/T2/T4, schedules T5–T8, `client-request-approved` + `vendor-request-approved`.
 */
export async function approveRequest(actor: AnyActor, input: { number: string }, tx?: Tx): Promise<{ bookingId: string; number: string; paymentDueAt: Date }> {
  assertPartnerActor(actor);
  return withTx(tx, async t => {
    // Lock order shared with K5 (charges.confirmBooking → closeFullDate): the partner row, then its
    // requests. Taking the request first deadlocks against a payment that fills the same date.
    await t.select({ id: partner.id }).from(partner).where(eq(partner.id, actor.partnerId)).for('update');
    const ctx = await requestForPartner(t, actor, input.number);
    const r = ctx.request;
    const isPackage = r.kind === 'package' && r.status === 'pending';
    const isConfirm = r.kind !== 'package' && r.status === 'awaiting_confirmation';
    if (!isPackage && !isConfirm) throw new LifecycleError('invalid_state', 'The request cannot be approved in its state');
    const at = await now();
    if (at >= r.responseDueAt) throw new LifecycleError('deadline_passed', 'The response deadline has passed');
    const s = await getSettings(at, t);
    const [p] = await t.select().from(partner).where(eq(partner.id, r.partnerId)).for('update');
    if (s['payment.provider'] === 'stripe' && !p.providerChargesEnabled) {
      throw new LifecycleError('provider_not_ready', 'The payment account is not ready to take payments'); // D62
    }
    const check = await checkPartnerDate(t, p, r.eventDate, { today: sofiaDate(at), window: false });
    if (!check.requestable) throw new LifecycleError('date_unavailable', `The date is not free: ${check.problems.map(x => problemText[x]).join(', ')}`);

    let amountCents = r.amountCents;
    if (isConfirm) {
      const [o] = r.offerId ? await t.select().from(offer).where(eq(offer.id, r.offerId)).limit(1) : [];
      if (!o || o.status !== 'chosen') throw new LifecycleError('invalid_state', 'No chosen offer');
      amountCents = o.amountCents;
      await t.update(offer).set({ decidedAt: at }).where(eq(offer.id, o.id));
    }
    if (amountCents == null || amountCents <= 0) throw new LifecycleError('invalid_state', 'The request has no amount');

    const b = await createBookingFromRequest(t, { request: r, partner: p, amountCents, at, settings: s });
    await t.update(request).set({ status: 'approved', approvedAt: at, answeredAt: r.answeredAt ?? at, amountCents, updatedAt: at }).where(eq(request.id, r.id));
    await ensureConversation(t, { clientId: r.clientId, partnerId: r.partnerId, clientEventId: r.clientEventId, requestId: r.id, bookingId: b.id, at });
    await cancelJobs(`request:${r.id}:`, t);
    await schedulePaymentJobs(t, b, s, at);

    const pt = ctx.parties;
    const sp = await projectedSplit(t, { partnerId: p.id, clientId: r.clientId, amountCents: b.amountCents, at });
    const sameDay = sofiaDate(b.paymentDueAt) === sofiaDate(at);
    await mail(t, {
      key: 'client-request-approved', to: pt.client.email, toUserId: r.clientId, dedupeKey: `booking:${b.id}:approved`,
      vars: {
        bookingId: b.number, requestNo: b.number, partnerName: p.businessName, partnerCategory: pt.partnerCategory,
        packageName: packageNameOf(r.serviceTitle), eventType: pt.eventType.name, eventDate: date(b.eventDate), eventTime: b.startTime ? b.startTime.slice(0, 5) : '—',
        amount: money(b.dueNowCents), payBy: dateTime(b.paymentDueAt), payHours: paymentWindowHours(b), // the event start may clamp it (§3)
      },
      // D54: ‹{Партньор} одобри заявката ви› / ‹Платете до {срок}, за да запазите датата›
      bell: {
        title: `${p.businessName} одобри заявката ви`,
        body: `Платете до ${sameDay ? `${dateTime(b.paymentDueAt).split(', ')[1]} ч` : dateTime(b.paymentDueAt)}, за да запазите датата`,
      },
    });
    if (pt.partnerUserId) {
      await mail(t, {
        key: 'vendor-request-approved', to: p.notificationEmail, toUserId: pt.partnerUserId, dedupeKey: `booking:${b.id}:approved:partner`,
        vars: {
          requestId: b.number, requestNo: b.number, clientName: pt.client.name, eventType: pt.eventType.name, eventDate: date(b.eventDate),
          packageName: packageNameOf(r.serviceTitle), partnerAmount: money(sp.partnerAmountCents), payBy: dateTime(b.paymentDueAt),
        },
      });
    }
    await audit(t, { actor, action: 'request.approved', entity: 'request', entityId: r.id, data: { number: r.number, bookingId: b.id, amountCents } });
    await audit(t, {
      actor, action: 'booking.created', entity: 'booking', entityId: b.id,
      data: { number: b.number, paymentDueAt: b.paymentDueAt.toISOString(), paymentMode: b.paymentMode, dueNowCents: b.dueNowCents, balanceCents: b.balanceCents },
    });
    return { bookingId: b.id, number: b.number, paymentDueAt: b.paymentDueAt };
  });
}
/** SCREENS names: ‹Одобри заявката› (R3) and ‹Потвърди офертата› (R6). */
export const approve = approveRequest;
export const confirmOffer = approveRequest;

// ── R4 / R5: quotes ──────────────────────────────────────────────────────

/** R4 ‹Изпрати оферта› (control new copy, D60): the partner prices a `quote` request. */
export async function sendQuote(
  actor: AnyActor, input: { number: string; title: string; amountCents: number; description?: string | null }, tx?: Tx,
): Promise<{ offerId: string }> {
  const title = input.title.trim();
  if (!title || title.length > 120) throw new LifecycleError('validation', 'The offer needs a title (≤ 120 characters)');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new LifecycleError('validation', 'The amount must be positive');
  const description = input.description?.trim() || null;
  if (description && description.length > NOTE_MAX) throw new LifecycleError('validation', `The description is limited to ${NOTE_MAX} characters`);
  return withTx(tx, async t => {
    const ctx = await requestForPartner(t, actor, input.number);
    const r = ctx.request;
    if (r.kind !== 'quote' || r.status !== 'pending') throw new LifecycleError('invalid_state', 'Only a pending quote request takes an offer');
    const at = await now();
    if (at >= r.responseDueAt) throw new LifecycleError('deadline_passed', 'The response deadline has passed');
    const [o] = await t.insert(offer).values({
      requestId: r.id, partnerId: r.partnerId, title, description, amountCents: input.amountCents, status: 'sent', sentAt: at,
    }).returning({ id: offer.id });
    await t.update(request).set({ status: 'offer_sent', offerId: o.id, answeredAt: at, updatedAt: at }).where(eq(request.id, r.id));
    await cancelJobs(`request:${r.id}:`, t);
    // R10 / O5: an offer nobody chose lapses once the event date has passed (D22).
    await scheduleJob(LIFECYCLE_JOBS.offerLapse, completionInstant(r.eventDate), { requestId: r.id }, jobKey.offerLapse(r.id), t);
    const pt = ctx.parties;
    await mail(t, {
      key: 'client-offer-received', to: pt.client.email, toUserId: r.clientId, dedupeKey: `offer:${o.id}:received`,
      vars: {
        requestId: r.number, requestNo: r.number, partnerName: pt.partner.businessName, partnerCategory: pt.partnerCategory,
        offerTitle: title, amount: money(input.amountCents), eventType: pt.eventType.name, eventTypeDefinite: pt.eventType.nameDefinite,
        eventDate: date(r.eventDate), location: locationOf(r, pt.cityName),
      },
      // D54: ‹{Партньор} отговори на запитването› / ‹{оферта} · {сума}›
      bell: { title: `${pt.partner.businessName} отговори на запитването`, body: `${title} · ${moneyShort(input.amountCents)}` },
    });
    await audit(t, { actor, action: 'request.offer_sent', entity: 'request', entityId: r.id, data: { number: r.number, offerId: o.id, amountCents: input.amountCents } });
    return { offerId: o.id };
  });
}

/** R5 (control new copy, D60): the client chooses the offer on a quote request; the partner has 24 h to confirm (T4, D23). */
export async function chooseQuoteOffer(actor: AnyActor, input: { number: string }, tx?: Tx): Promise<void> {
  return withTx(tx, async t => {
    const ctx = await requestForClient(t, actor, input.number);
    const r = ctx.request;
    if (r.kind !== 'quote' || r.status !== 'offer_sent' || !r.offerId) throw new LifecycleError('invalid_state', 'There is no offer to choose');
    const [o] = await t.select().from(offer).where(eq(offer.id, r.offerId)).for('update');
    const at = await now();
    if (!o || o.status !== 'sent' || r.eventDate < sofiaDate(at)) throw new LifecycleError('invalid_state', 'The offer is no longer valid');
    const s = await getSettings(at, t);
    const due = responseDue(at, s['offer.confirm_hours'], r);
    if (due.getTime() <= at.getTime()) throw new LifecycleError('deadline_passed', 'The event is too close');
    await t.update(offer).set({ status: 'chosen', chosenAt: at }).where(eq(offer.id, o.id));
    await t.update(request).set({ status: 'awaiting_confirmation', responseDueAt: due, updatedAt: at }).where(eq(request.id, r.id));
    await cancelJobs(jobKey.offerLapse(r.id), t);
    await scheduleJob(LIFECYCLE_JOBS.requestExpire, due, { requestId: r.id }, jobKey.requestExpire(r.id), t);
    const pt = ctx.parties;
    if (pt.partnerUserId) {
      const sp = await projectedSplit(t, { partnerId: r.partnerId, clientId: r.clientId, amountCents: o.amountCents, at });
      await mail(t, {
        key: 'vendor-offer-chosen', to: pt.partner.notificationEmail, toUserId: pt.partnerUserId, dedupeKey: `offer:${o.id}:chosen`,
        vars: {
          requestId: r.number, requestNo: r.number, clientName: pt.client.name, eventType: pt.eventType.name, eventTypeDefinite: pt.eventType.nameDefinite,
          eventDate: date(r.eventDate), eventTime: r.startTime ? r.startTime.slice(0, 5) : '—', location: locationOf(r, pt.cityName), guests: r.guests,
          offerTitle: o.title, partnerAmount: money(sp.partnerAmountCents),
        },
      });
    }
    await audit(t, { actor, action: 'request.offer_chosen', entity: 'request', entityId: r.id, data: { number: r.number, offerId: o.id } });
  });
}

// ── Client withdrawal ────────────────────────────────────────────────────

/**
 * The client withdraws a request nobody has approved yet (pending, offer sent,
 * or awaiting the partner's confirmation) → `withdrawn`. SPEC §4.5 has no
 * control or email for this in v1; it records the change only.
 */
export async function cancelPendingRequest(actor: AnyActor, input: { number: string }, tx?: Tx): Promise<void> {
  return withTx(tx, async t => {
    const { request: r } = await requestForClient(t, actor, input.number);
    if (!(OPEN_REQUEST_STATUSES as readonly string[]).includes(r.status)) throw new LifecycleError('invalid_state', 'The request is no longer open');
    const at = await now();
    await t.update(request).set({ status: 'withdrawn', updatedAt: at }).where(eq(request.id, r.id));
    await t.update(offer).set({ status: 'lapsed', decidedAt: at }).where(and(eq(offer.requestId, r.id), inArray(offer.status, ['sent', 'chosen'])));
    await cancelJobs(`request:${r.id}:`, t);
    await audit(t, { actor, action: 'request.withdrawn', entity: 'request', entityId: r.id, data: { number: r.number } });
  });
}
export const withdrawRequest = cancelPendingRequest;

// ── T1, T2/T4 handlers ───────────────────────────────────────────────────

/** T1: `vendor-request-reminder` 6 h before response_due_at while pending. */
export async function requestReminderJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const ctx = await loadRequest(t, { id: String(p.requestId) });
    if (!ctx || ctx.request.status !== 'pending' || !ctx.parties.partnerUserId) return;
    const r = ctx.request;
    const at = await now();
    if (at >= r.responseDueAt) return;
    const sp = r.amountCents != null ? await projectedSplit(t, { partnerId: r.partnerId, clientId: r.clientId, amountCents: r.amountCents, at }) : null;
    await mail(t, {
      key: 'vendor-request-reminder', to: ctx.parties.partner.notificationEmail, toUserId: ctx.parties.partnerUserId,
      dedupeKey: jobKey.requestReminder(r.id),
      vars: {
        requestId: r.number, requestNo: r.number, hoursLeft: Math.max(1, Math.round((r.responseDueAt.getTime() - at.getTime()) / HOUR)),
        clientName: ctx.parties.client.name, eventType: ctx.parties.eventType.name, eventTypeDefinite: ctx.parties.eventType.nameDefinite,
        eventDate: date(r.eventDate), packageName: packageNameOf(r.serviceTitle),
        partnerAmount: sp ? money(sp.partnerAmountCents) : 'По оферта', replyBy: dateTime(r.responseDueAt),
      },
    });
  });
}

/** T2 / T4 (R8, D23): a request still pending or awaiting confirmation at response_due_at → `expired`. */
export async function expireRequestJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const ctx = await loadRequest(t, { id: String(p.requestId) }, true);
    if (!ctx || !(['pending', 'awaiting_confirmation'] as string[]).includes(ctx.request.status)) return;
    const r = ctx.request;
    const at = await now();
    if (at < r.responseDueAt) return;
    await t.update(request).set({ status: 'expired', expiredAt: at, updatedAt: at }).where(eq(request.id, r.id));
    await cancelJobs(jobKey.requestReminder(r.id), t);
    if (r.offerId) await t.update(offer).set({ status: 'lapsed', decidedAt: at }).where(and(eq(offer.id, r.offerId), eq(offer.status, 'chosen')));
    const pt = ctx.parties;
    await mail(t, {
      key: 'client-request-expired', to: pt.client.email, toUserId: r.clientId, dedupeKey: `request:${r.id}:expired`,
      vars: {
        requestNo: r.number, partnerName: pt.partner.businessName, partnerCategory: pt.partnerCategory, serviceName: r.serviceTitle,
        eventType: pt.eventType.name, eventDate: date(r.eventDate), amount: amountText(r.amountCents),
      },
    });
    if (pt.partnerUserId) {
      await mail(t, {
        key: 'vendor-request-expired', to: pt.partner.notificationEmail, toUserId: pt.partnerUserId, dedupeKey: `request:${r.id}:expired:partner`,
        vars: {
          requestNo: r.number, clientName: pt.client.name, eventType: pt.eventType.name, eventTypeDefinite: pt.eventType.nameDefinite,
          eventDate: date(r.eventDate), packageName: packageNameOf(r.serviceTitle), receivedAt: dateTime(r.sentAt), replyBy: dateTime(r.responseDueAt),
        },
      });
    }
    await audit(t, { actor: SYSTEM, action: 'request.expired', entity: 'request', entityId: r.id, data: { number: r.number, from: r.status } });
  });
}

/**
 * R10 / O5 (D22): the event date of a quote request passed while its offer was
 * still waiting for the client → offer `lapsed`, request `expired`. No email (D60).
 */
export async function offerLapseJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const ctx = await loadRequest(t, { id: String(p.requestId) }, true);
    if (!ctx || ctx.request.status !== 'offer_sent') return;
    const r = ctx.request;
    const at = await now();
    if (r.eventDate >= sofiaDate(at)) return;
    const lapsed = await t.update(offer).set({ status: 'lapsed', decidedAt: at })
      .where(and(eq(offer.requestId, r.id), eq(offer.status, 'sent'))).returning({ id: offer.id });
    await t.update(request).set({ status: 'expired', expiredAt: at, updatedAt: at }).where(eq(request.id, r.id));
    await audit(t, { actor: SYSTEM, action: 'request.offer_lapsed', entity: 'request', entityId: r.id, data: { offerId: lapsed[0]?.id ?? r.offerId, reason: 'event_date_passed' } });
  });
}

// ── View models ──────────────────────────────────────────────────────────

export type RequestView = {
  id: string; number: string; kind: RequestRow['kind']; status: RequestRow['status'];
  eventType: { slug: string; name: string }; eventDate: DateStr; startTime: string | null; endTime: string | null; guests: number;
  venueName: string | null; locality: string | null; cityName: string | null; location: string; spaceType: RequestRow['spaceType'];
  note: string | null; serviceTitle: string; serviceId: string | null; amountCents: number | null;
  sentAt: Date; responseDueAt: Date; answeredAt: Date | null; approvedAt: Date | null; declinedAt: Date | null; expiredAt: Date | null;
  decline: { reason: DeclineReason; label: string } | null;
  offer: { id: string; title: string; description: string | null; amountCents: number; status: string; sentAt: Date } | null;
  booking: { number: string; status: string; paymentDueAt: Date; dueNowCents: number; payable: boolean } | null;
  attachmentMediaIds: string[];
  conversationId: string | null;
  clientEventId: string;
};

async function requestView(q: Queryable, ctx: RequestContext, at: Date): Promise<RequestView> {
  const r = ctx.request;
  const [o] = r.offerId ? await q.select().from(offer).where(eq(offer.id, r.offerId)).limit(1) : [];
  const [b] = await q.select().from(booking).where(eq(booking.requestId, r.id)).limit(1);
  const atts = await q.select({ id: requestAttachment.mediaId }).from(requestAttachment).where(eq(requestAttachment.requestId, r.id)).orderBy(asc(requestAttachment.position));
  const [conv] = await q.select({ id: conversation.id }).from(conversation)
    .where(and(eq(conversation.clientId, r.clientId), eq(conversation.partnerId, r.partnerId), eq(conversation.clientEventId, r.clientEventId))).limit(1);
  return {
    id: r.id, number: r.number, kind: r.kind, status: r.status,
    eventType: { slug: ctx.parties.eventType.slug, name: ctx.parties.eventType.name }, eventDate: r.eventDate,
    startTime: r.startTime ? r.startTime.slice(0, 5) : null, endTime: r.endTime ? r.endTime.slice(0, 5) : null, guests: r.guests,
    venueName: r.venueName, locality: r.locality, cityName: ctx.parties.cityName, location: locationOf(r, ctx.parties.cityName), spaceType: r.spaceType,
    note: r.note, serviceTitle: r.serviceTitle, serviceId: r.serviceId, amountCents: r.amountCents,
    sentAt: r.sentAt, responseDueAt: r.responseDueAt, answeredAt: r.answeredAt, approvedAt: r.approvedAt, declinedAt: r.declinedAt, expiredAt: r.expiredAt,
    decline: r.declineReason ? { reason: r.declineReason, label: r.declineReason === 'other' && r.declineText ? r.declineText : DECLINE_REASON_LABEL[r.declineReason] } : null,
    offer: o ? { id: o.id, title: o.title, description: o.description, amountCents: o.amountCents, status: o.status, sentAt: o.sentAt } : null,
    booking: b ? { number: b.number, status: b.status, paymentDueAt: b.paymentDueAt, dueNowCents: b.dueNowCents, payable: b.status === 'awaiting_payment' && at < b.paymentDueAt } : null,
    attachmentMediaIds: atts.map(a => a.id),
    conversationId: conv?.id ?? null,
    clientEventId: r.clientEventId,
  };
}

/** /akaunt/zayavki/[nomer]: the client's own request (404 otherwise). */
export async function getRequestForClient(actor: AnyActor, number: string, q: Queryable = db): Promise<RequestView & { partner: { slug: string; name: string; category: string } }> {
  assertClientActor(actor);
  const ctx = await loadRequest(q, { number });
  if (!ctx || ctx.request.clientId !== actor.userId) throw new LifecycleError('not_found', `No request ${number}`);
  const v = await requestView(q, ctx, await now());
  return { ...v, partner: { slug: ctx.parties.partner.slug, name: ctx.parties.partner.businessName, category: ctx.parties.partnerCategory } };
}

/**
 * /partner/zayavki/[nomer]: the partner's own request. The client's phone shows
 * only once the booking is confirmed (SPEC §10); ‹Получавате› is projected
 * before payment (§6) and commission is never shown (rule 9).
 */
export async function getRequestForPartner(actor: AnyActor, number: string, q: Queryable = db): Promise<RequestView & {
  client: { name: string; phone: string | null }; partnerAmountCents: number | null; date: { free: boolean; problems: DateProblem[] };
}> {
  assertPartnerActor(actor);
  const ctx = await loadRequest(q, { number });
  if (!ctx || ctx.request.partnerId !== actor.partnerId) throw new LifecycleError('not_found', `No request ${number}`);
  const at = await now();
  const v = await requestView(q, ctx, at);
  const r = ctx.request;
  const amount = v.offer?.amountCents ?? r.amountCents;
  const [b] = await q.select({ status: booking.status, commissionBp: booking.commissionBp, amountCents: booking.amountCents }).from(booking).where(eq(booking.requestId, r.id)).limit(1);
  const sp = b?.commissionBp != null
    ? split(b.amountCents, b.commissionBp)
    : amount != null ? await projectedSplit(q, { partnerId: r.partnerId, clientId: r.clientId, amountCents: amount, at }) : null;
  const dateCheck = await checkPartnerDate(q, ctx.parties.partner, r.eventDate, { today: sofiaDate(at), window: false });
  return {
    ...v,
    client: { name: ctx.parties.client.name, phone: b && (PHONE_VISIBLE_STATUSES as readonly string[]).includes(b.status) ? r.contactPhone : null },
    partnerAmountCents: sp?.partnerAmountCents ?? null,
    date: { free: dateCheck.requestable, problems: dateCheck.problems },
  };
}

/** Requests of a client that are still waiting for the partner past their deadline (none in a healthy system; for admin checks). */
export async function overdueOpenRequests(q: Queryable, at: Date) {
  return q.select({ id: request.id, number: request.number }).from(request)
    .where(and(inArray(request.status, ['pending', 'awaiting_confirmation']), lt(request.responseDueAt, at)));
}

/** K4 lives with the booking it acts on; re-exported for the request page's ‹Отмени одобрението›. */
export { withdrawApproval } from './bookings';
