// Disputes — сигнал (client/partner) = кейс / спор (admin) (SPEC §4.11, K14–K16, T15, T16).
//
//   X1 openByClient()     X2 openByPartner()    X3 openByTeam()
//   X4 requestInfo()      X5 remind()           X6 submitStatement()
//   X7 positionDeadline() (T15 `dispute.position`)
//   X8 decide()           X9 withdraw()         T16 complianceDeadline() (`dispute.compliance`)
//
// While a dispute with holds_payout is open the booking's payout is held
// (booking.payout_hold, lines `held`; K13 does not release). When it ends the
// payout returns to its schedule and anything already due is released.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, charge, dispute, disputeAttachment, disputeMessage, disputeOption, job, media, request, user,
  type DisputeDecisionKind, type DisputeParty, type DisputeReason,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, date as fmtDate, dateTime, money, moneyShort, sofiaDate, sofiaInstant } from '@/lib/format';
import { ForbiddenError, SYSTEM, assertCan, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import { getSetting } from './settings';
import { cancelBookingCore, quoteFor } from './cancellation';
import { syncBookingHold } from './payouts';
import { createRefunds, refundableCharges } from './refunds';
import {
  AftercareError, DISPUTE_REASON_LABEL, bpOf, cancelPending, ctxText, loadBookingCtx, low, mailClient, mailPartner, mailTeam, paidCents,
  percentOf, refundablePaidCents, routes, schedule, withTx, type BookingCtx,
} from './aftercare-shared';

export type DisputeRow = typeof dispute.$inferSelect;

export const CLIENT_REASONS: DisputeReason[] = ['no_show', 'not_as_described', 'payment_problem', 'other'];
export const PARTNER_REASONS: DisputeReason[] = ['client_unresponsive', 'terms_changed_on_site', 'payment_problem', 'other'];
const OPEN: ('collecting' | 'awaiting_decision')[] = ['collecting', 'awaiting_decision'];
/** Bookings a dispute can be opened on (X1/X2): awaiting payment or later, not cancelled or lapsed. */
const DISPUTABLE = ['awaiting_payment', 'confirmed', 'cancellation_requested', 'completed'] as const;
/** D70: up to 30 days after the event. */
const DISPUTE_WINDOW_DAYS = 30;

/** Example option labels of §4.11, used when the team gives none for a generic kind. */
const DEFAULT_TITLE: Partial<Record<DisputeDecisionKind, string>> = {
  cancel_full_refund: 'Анулирай с пълно възстановяване',
  cancel_unpaid: 'Анулирай заявката без такси',
  restore_price: 'Върни одобрената цена',
  accept_new_price: 'Приеми новата цена',
  no_refund: 'Без възстановяване',
  refund_duplicate: 'Пълно възстановяване на второто плащане',
  mediate: 'Свържи страните чрез екипа',
  close: 'Затвори сигнала',
};
/** vendor-ticket-decision's payout sentence (approved prototype copy). */
const PAYOUT_ON_SCHEDULE = 'Изплащането по резервацията продължава по обичайния график — на 1-во или 15-то число.';
const NO_PAYOUT = 'По тази резервация няма изплащане.';

// ── Queries ───────────────────────────────────────────────────────────────

/** The open dispute on a booking, if any (T7 team payment alert, guards). */
export async function openDisputeForBooking(bookingId: string, q: Queryable = db): Promise<DisputeRow | null> {
  const [d] = await q.select().from(dispute).where(and(eq(dispute.bookingId, bookingId), inArray(dispute.status, OPEN))).limit(1);
  return d ?? null;
}

/** A dispute with its messages, attachments and options, for whoever may see it (the parties or a team member with resolve_disputes). */
export async function getDispute(actor: Actor, disputeId: string, q: Queryable = db) {
  const [d] = await q.select().from(dispute).where(eq(dispute.id, disputeId));
  if (!d) throw new AftercareError('not_found');
  const [b] = await q.select().from(booking).where(eq(booking.id, d.bookingId));
  const party = partyOf(actor, b);
  if (!party) assertCan(actor, 'resolve_disputes');
  const messages = await q.select().from(disputeMessage).where(eq(disputeMessage.disputeId, d.id)).orderBy(asc(disputeMessage.createdAt));
  const visible = party ? messages.filter(m => m.recipients === null || m.recipients === 'both' || m.recipients === party || m.party === party) : messages;
  return {
    dispute: d,
    messages: visible,
    attachments: await q.select().from(disputeAttachment).where(eq(disputeAttachment.disputeId, d.id)),
    options: party ? [] : await q.select().from(disputeOption).where(eq(disputeOption.disputeId, d.id)).orderBy(asc(disputeOption.position)),
  };
}

function partyOf(actor: AnyActor, b: { clientId: string; partnerId: string }): 'client' | 'partner' | null {
  if (actor.role === 'client' && actor.userId === b.clientId) return 'client';
  if (actor.role === 'partner' && 'partnerId' in actor && actor.partnerId === b.partnerId) return 'partner';
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function lockDispute(tx: Tx, disputeId: string): Promise<DisputeRow> {
  const [d] = await tx.select().from(dispute).where(eq(dispute.id, disputeId)).for('update');
  if (!d) throw new AftercareError('not_found');
  return d;
}

const isOpen = (d: DisputeRow) => d.status === 'collecting' || d.status === 'awaiting_decision';

async function addEvidence(tx: Tx, actor: Actor, disputeId: string, messageId: string, mediaIds: string[] | undefined): Promise<number> {
  const ids = [...new Set(mediaIds ?? [])];
  if (!ids.length) return 0;
  const max = await getSetting('uploads.max_photos', undefined, tx);
  if (ids.length > max) throw new AftercareError('too_many_files');
  const rows = await tx.select({ id: media.id, owner: media.ownerUserId, name: media.originalName }).from(media).where(inArray(media.id, ids));
  if (rows.length !== ids.length || rows.some(r => r.owner !== actor.userId)) throw new ForbiddenError('own_media');
  await tx.insert(disputeAttachment).values(rows.map(r => ({ disputeId, messageId, mediaId: r.id, label: r.name })));
  return rows.length;
}

/** Name of a side as the emails use it. */
function sideName(ctx: BookingCtx, party: DisputeParty, teamName?: string): string {
  return party === 'client' ? ctx.client.name : party === 'partner' ? ctx.partner.businessName : teamName ?? 'EventAT';
}

// ── X1–X3: opening ────────────────────────────────────────────────────────

type OpenInput = { bookingId: string; reason: DisputeReason; description: string; evidenceMediaIds?: string[]; title?: string };

async function openCore(tx: Tx, ctx: BookingCtx, a: {
  actor: Actor; openedBy: DisputeParty; reason: DisputeReason; title: string; description: string; holdsPayout: boolean;
  positionFrom: DisputeParty; positionTimer: boolean; evidenceMediaIds?: string[];
}): Promise<DisputeRow> {
  const b = ctx.booking;
  const [existing] = await tx.select({ id: dispute.id, status: dispute.status }).from(dispute).where(eq(dispute.bookingId, b.id));
  if (existing) throw new AftercareError(isOpen(existing as DisputeRow) ? 'dispute_open' : 'dispute_exists');
  const at = await now();
  const teamHours = await getSetting('dispute.team_reply_hours', undefined, tx);
  const posHours = await getSetting('dispute.position_hours', undefined, tx);
  const held = a.holdsPayout ? await paidCents(tx, b.id) : 0;
  const [d] = await tx.insert(dispute).values({
    number: b.number, bookingId: b.id, openedBy: a.openedBy, openedByUser: a.actor.userId, reason: a.reason, title: a.title,
    description: a.description, holdsPayout: a.holdsPayout, heldCents: held, openedAt: at,
    teamReplyDueAt: new Date(at.getTime() + teamHours * 3600_000), positionFrom: a.positionFrom,
    positionRequestedAt: at, positionDueAt: new Date(at.getTime() + posHours * 3600_000), createdAt: at, updatedAt: at,
  }).returning();
  if (a.openedBy !== 'team') {
    const [m] = await tx.insert(disputeMessage).values({
      disputeId: d.id, party: a.openedBy, authorId: a.actor.userId, kind: 'statement', body: a.description,
      context: `причина: „${DISPUTE_REASON_LABEL[a.reason]}“`, createdAt: at,
    }).returning({ id: disputeMessage.id });
    await addEvidence(tx, a.actor, d.id, m.id, a.evidenceMediaIds);
  }
  if (a.holdsPayout) await syncBookingHold(tx, b.id);
  // T15 (D14): the other side's 48 h start at filing; a team-opened case notifies nobody (D68), so it has no timer.
  if (a.positionTimer) await schedule('dispute.position', d.positionDueAt, { disputeId: d.id }, `dispute:${d.id}:position`, tx);
  await audit(tx, {
    actor: a.actor, action: 'dispute.opened', entity: 'dispute', entityId: d.id,
    data: { number: d.number, openedBy: a.openedBy, reason: a.reason, holdsPayout: a.holdsPayout, heldCents: held },
  });
  return d;
}

async function teamDisputeNew(tx: Tx, ctx: BookingCtx, d: DisputeRow) {
  const t = ctxText(ctx);
  const opener = d.openedBy === 'client' ? t.clientName : t.partnerName;
  const other = d.openedBy === 'client' ? t.partnerName : t.clientName;
  await mailTeam(tx, 'resolve_disputes', 'team-dispute-new', {
    caseId: d.number, bookingNo: d.number, openerName: opener, otherName: other, clientName: t.clientName, partnerName: t.partnerName,
    claim: low(DISPUTE_REASON_LABEL[d.reason]), summary: d.description, reason: DISPUTE_REASON_LABEL[d.reason], heldAmount: money(d.heldCents),
    eventType: t.eventType, eventDate: t.eventDate, venue: t.venue, openedAt: dateTime(d.openedAt),
  }, `dispute:${d.id}:new`);
}

function assertWindow(ctx: BookingCtx, today: string) {
  if (!(DISPUTABLE as readonly string[]).includes(ctx.booking.status)) throw new AftercareError('not_disputable');
  if (ctx.booking.eventDate < addDays(today, -DISPUTE_WINDOW_DAYS)) throw new AftercareError('dispute_window_passed');
}

/**
 * X1 ‹Изпрати сигнала› (/akaunt/poddrazhka/nov): the client's own booking,
 * awaiting payment or later, event at most 30 days ago (D70), no case on it.
 * Holds the payout; the partner's 48 h start now (T15, D14).
 * `client-dispute-opened`, `vendor-ticket-client-opened`, `team-dispute-new`.
 */
export async function openByClient(actor: Actor, input: OpenInput, tx?: Tx): Promise<DisputeRow> {
  if (actor.role !== 'client') throw new ForbiddenError('client');
  if (!CLIENT_REASONS.includes(input.reason)) throw new AftercareError('bad_reason');
  const description = input.description?.trim();
  if (!description) throw new AftercareError('description_required');
  return withTx(tx, async tx => {
    const ctx = await loadBookingCtx(tx, input.bookingId, { lock: true });
    if (ctx.booking.clientId !== actor.userId) throw new ForbiddenError('own_booking');
    assertWindow(ctx, sofiaDate(await now()));
    const d = await openCore(tx, ctx, {
      actor, openedBy: 'client', reason: input.reason, title: input.title?.trim() || DISPUTE_REASON_LABEL[input.reason], description,
      holdsPayout: true, positionFrom: 'partner', positionTimer: true, evidenceMediaIds: input.evidenceMediaIds,
    });
    const t = ctxText(ctx);
    await mailClient(tx, ctx, 'client-dispute-opened', {
      bookingNo: t.bookingNo, partnerName: t.partnerName, serviceName: t.serviceName, eventType: t.eventType, eventDate: t.eventDate,
      problem: DISPUTE_REASON_LABEL[d.reason], openedAt: dateTime(d.openedAt), heldAmount: money(d.heldCents),
    }, `dispute:${d.id}:client-opened`, routes.clientCase(d.number));
    await mailPartner(tx, ctx, 'vendor-ticket-client-opened', {
      bookingNo: t.bookingNo, clientName: t.clientName, eventType: t.eventType, eventTypeDefinite: t.eventTypeDefinite, hosts: t.hosts,
      eventDate: t.eventDate, message: description, reason: DISPUTE_REASON_LABEL[d.reason],
    }, `dispute:${d.id}:vendor-informed`, routes.partnerCase(d.number));
    await teamDisputeNew(tx, ctx, d);
    return d;
  });
}

/**
 * X2 ‹Изпрати сигнала› (/partner/poddrazhka/nov): the partner's own booking,
 * awaiting payment or later. ‹Клиентът не отговаря› does not hold the payout
 * (D13). `vendor-ticket-received`, `client-ticket-vendor-opened`, `team-dispute-new`.
 * `ask` fills client-ticket-vendor-opened's „…и {ask}“ (what the client should do).
 */
export async function openByPartner(actor: Actor, input: OpenInput & { ask?: string }, tx?: Tx): Promise<DisputeRow> {
  if (actor.role !== 'partner' || !actor.partnerId) throw new ForbiddenError('partner');
  if (!PARTNER_REASONS.includes(input.reason)) throw new AftercareError('bad_reason');
  const description = input.description?.trim();
  if (!description) throw new AftercareError('description_required');
  return withTx(tx, async tx => {
    const ctx = await loadBookingCtx(tx, input.bookingId, { lock: true });
    if (ctx.booking.partnerId !== actor.partnerId) throw new ForbiddenError('own_booking');
    if (!(DISPUTABLE as readonly string[]).includes(ctx.booking.status)) throw new AftercareError('not_disputable');
    const d = await openCore(tx, ctx, {
      actor, openedBy: 'partner', reason: input.reason, title: input.title?.trim() || DISPUTE_REASON_LABEL[input.reason], description,
      holdsPayout: input.reason !== 'client_unresponsive', positionFrom: 'client', positionTimer: true, evidenceMediaIds: input.evidenceMediaIds,
    });
    const t = ctxText(ctx);
    await mailPartner(tx, ctx, 'vendor-ticket-received', {
      bookingNo: t.bookingNo, eventType: t.eventType, hosts: t.hosts, location: t.location, reason: DISPUTE_REASON_LABEL[d.reason],
      openedAt: dateTime(d.openedAt),
    }, `dispute:${d.id}:vendor-received`, routes.partnerCase(d.number));
    await mailClient(tx, ctx, 'client-ticket-vendor-opened', {
      bookingNo: t.bookingNo, partnerName: t.partnerName, partnerCategory: t.partnerCategory, packageName: t.packageName,
      eventType: t.eventType, eventTypeDefinite: t.eventTypeDefinite, eventDate: t.eventDate, location: t.location,
      reason: DISPUTE_REASON_LABEL[d.reason], reasonDetail: description, ask: input.ask?.trim() ?? '', replyBy: dateTime(d.positionDueAt),
    }, `dispute:${d.id}:client-informed`, routes.clientCase(d.number));
    await teamDisputeNew(tx, ctx, d);
    return d;
  });
}

/**
 * X3 ‹Отвори спор› (/admin/rezervacii/[nomer], resolve_disputes): holds the
 * payout; no email exists for a team-opened case (D68), so neither side is
 * notified and no position timer runs.
 */
export async function openByTeam(actor: Actor, input: {
  bookingId: string; title: string; description: string; reason?: DisputeReason; positionFrom?: 'client' | 'partner';
}, tx?: Tx): Promise<DisputeRow> {
  assertCan(actor, 'resolve_disputes');
  const title = input.title?.trim(), description = input.description?.trim();
  if (!title || !description) throw new AftercareError('description_required');
  return withTx(tx, async tx => {
    const ctx = await loadBookingCtx(tx, input.bookingId, { lock: true });
    if (!(DISPUTABLE as readonly string[]).includes(ctx.booking.status)) throw new AftercareError('not_disputable');
    return openCore(tx, ctx, {
      actor, openedBy: 'team', reason: input.reason ?? 'other', title, description, holdsPayout: true,
      positionFrom: input.positionFrom ?? 'partner', positionTimer: false,
    });
  });
}

// ── X4–X6: collecting ─────────────────────────────────────────────────────

async function openCtx(tx: Tx, disputeId: string): Promise<{ d: DisputeRow; ctx: BookingCtx }> {
  const d = await lockDispute(tx, disputeId);
  if (!isOpen(d)) throw new AftercareError('dispute_closed');
  return { d, ctx: await loadBookingCtx(tx, d.bookingId, { lock: true }) };
}

/**
 * X6 ‹Изпрати позицията› / ‹Отговори на екипа›: a statement with evidence from
 * one side. From the side whose position was asked: collecting →
 * awaiting_decision, T15 cancelled, `team-dispute-reply`.
 */
export async function submitStatement(actor: Actor, input: { disputeId: string; body: string; evidenceMediaIds?: string[] }, tx?: Tx): Promise<{ messageId: string }> {
  const body = input.body?.trim();
  if (!body) throw new AftercareError('body_required');
  return withTx(tx, async tx => {
    const { d, ctx } = await openCtx(tx, input.disputeId);
    const party = partyOf(actor, ctx.booking);
    if (!party) throw new ForbiddenError('dispute_party');
    const at = await now();
    const [q] = await tx.select({ id: disputeMessage.id }).from(disputeMessage)
      .where(and(eq(disputeMessage.disputeId, d.id), eq(disputeMessage.kind, 'question'))).limit(1);
    const [m] = await tx.insert(disputeMessage).values({
      disputeId: d.id, party, authorId: actor.userId, kind: 'statement', body,
      context: q ? 'в отговор на запитване от екипа' : null, createdAt: at,
    }).returning({ id: disputeMessage.id });
    const files = await addEvidence(tx, actor, d.id, m.id, input.evidenceMediaIds);
    if (party === d.positionFrom) {
      if (d.status === 'collecting') {
        await tx.update(dispute).set({ status: 'awaiting_decision', updatedAt: at }).where(eq(dispute.id, d.id));
        await cancelPending(`dispute:${d.id}:position`, tx);
      }
      const t = ctxText(ctx);
      let opener = sideName(ctx, d.openedBy);
      if (d.openedBy === 'team' && d.openedByUser) {
        const [u] = await tx.select({ name: user.name }).from(user).where(eq(user.id, d.openedByUser));
        opener = u?.name ?? opener;
      }
      await mailTeam(tx, 'resolve_disputes', 'team-dispute-reply', {
        caseId: d.number, caseNo: d.number, responderName: sideName(ctx, party), openerName: opener, clientName: t.clientName, partnerName: t.partnerName,
        summary: body, topic: d.title, eventType: t.eventType, eventDate: t.eventDate, repliedAt: dateTime(at), photoCount: files, heldAmount: money(d.heldCents),
      }, `dispute-message:${m.id}:team`);
    }
    await audit(tx, { actor, action: 'dispute.statement', entity: 'dispute', entityId: d.id, data: { party, messageId: m.id, files } });
    return { messageId: m.id };
  });
}

/**
 * X4 ‹Поискай още информация›: a team question to both sides (or one);
 * `client-dispute-info-request`, `vendor-ticket-info-request`.
 */
export async function requestInfo(actor: Actor, input: { disputeId: string; question: string; recipients?: 'both' | 'client' | 'partner' }, tx?: Tx): Promise<{ messageId: string }> {
  assertCan(actor, 'resolve_disputes');
  const question = input.question?.trim();
  if (!question) throw new AftercareError('question_required');
  const to = input.recipients ?? 'both';
  return withTx(tx, async tx => {
    const { d, ctx } = await openCtx(tx, input.disputeId);
    const [m] = await tx.insert(disputeMessage).values({
      disputeId: d.id, party: 'team', authorId: actor.userId, kind: 'question', body: question, recipients: to, createdAt: await now(),
    }).returning({ id: disputeMessage.id });
    const t = ctxText(ctx);
    if (to !== 'partner') {
      await mailClient(tx, ctx, 'client-dispute-info-request', { bookingNo: t.bookingNo, partnerName: t.partnerName, topic: d.title },
        `dispute-message:${m.id}:client`, routes.clientCase(d.number));
    }
    if (to !== 'client') {
      await mailPartner(tx, ctx, 'vendor-ticket-info-request', {
        bookingNo: t.bookingNo, clientName: t.hosts, eventType: t.eventType, eventTypeDefinite: t.eventTypeDefinite, eventDate: t.eventDate,
        serviceName: t.serviceName, topic: d.title,
      }, `dispute-message:${m.id}:partner`, routes.partnerCase(d.number));
    }
    await audit(tx, { actor, action: 'dispute.info_requested', entity: 'dispute', entityId: d.id, data: { messageId: m.id, recipients: to } });
    return { messageId: m.id };
  });
}

/**
 * X5 ‹Напомни на изпълнителя› / ‹Напомни на клиента›: `vendor-ticket-reminder` /
 * `client-ticket-reminder` (the client's needs `need`: what the partner asks for, one sentence).
 */
export async function remind(actor: Actor, input: { disputeId: string; side: 'client' | 'partner'; need?: string }, tx?: Tx): Promise<{ messageId: string }> {
  assertCan(actor, 'resolve_disputes');
  const need = input.need?.trim() ?? '';
  if (input.side === 'client' && !need) throw new AftercareError('need_required');
  return withTx(tx, async tx => {
    const { d, ctx } = await openCtx(tx, input.disputeId);
    const [m] = await tx.insert(disputeMessage).values({
      disputeId: d.id, party: 'team', authorId: actor.userId, kind: 'reminder', body: need, recipients: input.side, createdAt: await now(),
    }).returning({ id: disputeMessage.id });
    const t = ctxText(ctx);
    if (input.side === 'partner') {
      await mailPartner(tx, ctx, 'vendor-ticket-reminder', {
        bookingNo: t.bookingNo, clientName: t.clientName, eventType: t.eventType, hosts: t.hosts, eventDate: t.eventDate,
      }, `dispute-message:${m.id}:partner`, routes.partnerCase(d.number));
    } else {
      await mailClient(tx, ctx, 'client-ticket-reminder', {
        bookingNo: t.bookingNo, partnerName: t.partnerName, eventTypeDefinite: t.eventTypeDefinite, eventDate: t.eventDate,
        reason: DISPUTE_REASON_LABEL[d.reason], need, replyBy: dateTime(d.positionDueAt),
      }, `dispute-message:${m.id}:client`, routes.clientCase(d.number));
    }
    await audit(tx, { actor, action: 'dispute.reminded', entity: 'dispute', entityId: d.id, data: { side: input.side, messageId: m.id } });
    return { messageId: m.id };
  });
}

/** D13: the team turns the payout hold on or off for an open case (control is new copy). */
export async function setHoldsPayout(actor: Actor, input: { disputeId: string; holdsPayout: boolean }, tx?: Tx): Promise<void> {
  assertCan(actor, 'resolve_disputes');
  return withTx(tx, async tx => {
    const { d } = await openCtx(tx, input.disputeId);
    await tx.update(dispute).set({
      holdsPayout: input.holdsPayout, heldCents: input.holdsPayout ? await paidCents(tx, d.bookingId) : 0, updatedAt: await now(),
    }).where(eq(dispute.id, d.id));
    await syncBookingHold(tx, d.bookingId);
    await audit(tx, { actor, action: 'dispute.hold_changed', entity: 'dispute', entityId: d.id, data: { holdsPayout: input.holdsPayout } });
  });
}

export type OptionInput = { kind: DisputeDecisionKind; label: string; description?: string | null; refundCents?: number | null; newAmountCents?: number | null };

/** The decision options shown on the case page, composed by the team from the §4.11 kinds (replaces the list). */
export async function setOptions(actor: Actor, input: { disputeId: string; options: OptionInput[] }, tx?: Tx): Promise<void> {
  assertCan(actor, 'resolve_disputes');
  return withTx(tx, async tx => {
    const { d } = await openCtx(tx, input.disputeId);
    await tx.delete(disputeOption).where(eq(disputeOption.disputeId, d.id));
    if (input.options.length) {
      await tx.insert(disputeOption).values(input.options.map((o, i) => {
        if (!o.label?.trim()) throw new AftercareError('label_required');
        return { disputeId: d.id, kind: o.kind, label: o.label.trim(), description: o.description ?? null, refundCents: o.refundCents ?? null, newAmountCents: o.newAmountCents ?? null, position: i };
      }));
    }
    await audit(tx, { actor, action: 'dispute.options_set', entity: 'dispute', entityId: d.id, data: { count: input.options.length } });
  });
}

/**
 * The team's case notes: title, summary, facts, agreed terms, comparison,
 * urgency — and the position deadline, which the team may change while the
 * case is collecting (X2): T15 moves with it.
 */
export async function updateCase(actor: Actor, input: {
  disputeId: string; title?: string; summary?: string | null; facts?: unknown[]; agreedTerms?: unknown[]; comparison?: unknown[] | null;
  note?: string | null; urgent?: boolean; positionDueAt?: Date;
}, tx?: Tx): Promise<void> {
  assertCan(actor, 'resolve_disputes');
  return withTx(tx, async tx => {
    const d = await lockDispute(tx, input.disputeId);
    const { disputeId: _id, title, summary, facts, agreedTerms, comparison, note, urgent, positionDueAt } = input;
    void _id;
    const patch = { title, summary, facts, agreedTerms, comparison, note, urgent, positionDueAt };
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete patch[k];
    if (title !== undefined && !title.trim()) throw new AftercareError('title_required');
    const at = await now();
    if (positionDueAt !== undefined) {
      if (d.status !== 'collecting' || !(positionDueAt instanceof Date) || Number.isNaN(positionDueAt.getTime()) || positionDueAt <= at) {
        throw new AftercareError('bad_position_date');
      }
    }
    await tx.update(dispute).set({ ...patch, updatedAt: at }).where(eq(dispute.id, d.id));
    // A team-opened case notified nobody (D68) and has no T15; the others' timer follows the new deadline.
    if (positionDueAt !== undefined && d.openedBy !== 'team') {
      await schedule('dispute.position', positionDueAt, { disputeId: d.id }, `dispute:${d.id}:position`, tx);
    }
    await audit(tx, {
      actor, action: 'dispute.updated', entity: 'dispute', entityId: d.id,
      data: { fields: Object.keys(patch), ...(positionDueAt ? { positionDueAt: positionDueAt.toISOString() } : {}) },
    });
  });
}

// ── X7 / T15 ──────────────────────────────────────────────────────────────

/** T15 `dispute.position`: no position from the other side in 48 h → awaiting_decision, `team-dispute-deadline`. Idempotent. */
export async function positionDeadline(input: { disputeId: string }, tx?: Tx): Promise<boolean> {
  return withTx(tx, async tx => {
    const d = await lockDispute(tx, input.disputeId);
    if (d.status !== 'collecting') return false;
    const [answered] = await tx.select({ id: disputeMessage.id }).from(disputeMessage)
      .where(and(eq(disputeMessage.disputeId, d.id), eq(disputeMessage.party, d.positionFrom), eq(disputeMessage.kind, 'statement'))).limit(1);
    if (answered) return false;
    await tx.update(dispute).set({ status: 'awaiting_decision', updatedAt: await now() }).where(eq(dispute.id, d.id));
    const ctx = await loadBookingCtx(tx, d.bookingId);
    const t = ctxText(ctx);
    const options = await tx.select({ label: disputeOption.label }).from(disputeOption).where(eq(disputeOption.disputeId, d.id)).orderBy(asc(disputeOption.position));
    await mailTeam(tx, 'resolve_disputes', 'team-dispute-deadline', {
      caseId: d.number, caseNo: d.number, silentName: sideName(ctx, d.positionFrom), clientName: t.clientName, partnerName: t.partnerName,
      requestedAt: dateTime(d.positionRequestedAt), deadline: dateTime(d.positionDueAt),
      options: options.length ? `Възможностите са: ${options.map(o => low(o.label)).join(', ')}.` : '', heldAmount: money(d.heldCents),
    }, `dispute:${d.id}:deadline`);
    await audit(tx, { actor: SYSTEM, action: 'dispute.position_lapsed', entity: 'dispute', entityId: d.id, data: { positionFrom: d.positionFrom } });
    return true;
  });
}

// ── X8: the decision ──────────────────────────────────────────────────────

export type DecideInput = {
  disputeId: string;
  /** Ignored when `optionId` is given (the option's kind wins). */
  kind?: DisputeDecisionKind;
  /** One of the case's composed options: fills kind, title, description, amounts. */
  optionId?: string;
  /** ‹Мотив към двете страни› — required. */
  motive: string;
  /** decision_title: the option label (‹Върни разликата — 140 €›). */
  title?: string;
  /** decision_detail: the full decision sentence (client email „Решение: …“). */
  detail?: string;
  /** partial_refund: an amount, or a % of what was paid (‹Частично възстановяване — 30%›). */
  refundCents?: number;
  refundPercent?: number;
  /** accept_new_price (restore_price defaults to the request's approved amount). */
  newAmountCents?: number;
  /** refund_duplicate: which charge (default: the one flagged duplicate). */
  chargeId?: string;
  /** enforce_terms: compliance deadline; the fallback is always cancel_full_refund (T16). */
  complianceDueAt?: Date;
  /** Email texts the team writes; sensible defaults come from title/detail. */
  summary?: string;
  decisionShort?: string;
  partnerSummary?: string;
  partnerAccount?: string;
  payoutLine?: string;
};

/**
 * X8 ‹Приложи решението› (resolve_disputes): an option + mandatory motive;
 * deciding while `collecting` is allowed (the page warns). Money effects per
 * §4.11; the payout hold ends (anything due is released, commission on what
 * the partner keeps); `client-dispute-decision`, `vendor-ticket-decision`,
 * and `client-refund-sent` when a refund succeeds.
 */
export async function decide(actor: Actor, input: DecideInput, tx?: Tx): Promise<DisputeRow> {
  assertCan(actor, 'resolve_disputes');
  const motive = input.motive?.trim();
  if (!motive) throw new AftercareError('motive_required');
  return withTx(tx, async tx => {
    const { d, ctx } = await openCtx(tx, input.disputeId);
    const b = ctx.booking;
    const [opt] = input.optionId
      ? await tx.select().from(disputeOption).where(and(eq(disputeOption.id, input.optionId), eq(disputeOption.disputeId, d.id)))
      : [];
    if (input.optionId && !opt) throw new AftercareError('bad_option');
    const kind = opt?.kind ?? input.kind;
    if (!kind) throw new AftercareError('kind_required');
    const at = await now();
    // What can still be given back: refunds already on their way and chargebacks are not refunded twice.
    const paid = await refundablePaidCents(tx, b.id);
    let refundCents = 0, cancelled = false, newAmount: number | null = null;
    let complianceDueAt: Date | null = null;
    let title = input.title?.trim() || opt?.label || DEFAULT_TITLE[kind] || null;
    const detail = input.detail?.trim() || opt?.description || null;

    switch (kind) {
      case 'partial_refund': {
        const r = input.refundCents ?? opt?.refundCents ?? (input.refundPercent !== undefined ? percentOf(paid, input.refundPercent) : undefined);
        if (r === undefined || !Number.isSafeInteger(r) || r <= 0 || r > paid) throw new AftercareError('bad_refund_amount');
        await createRefunds(tx, { bookingId: b.id, amountCents: r, reason: 'dispute_decision', actor, disputeId: d.id });
        refundCents = r;
        title ??= `Върни разликата — ${moneyShort(r)}`;
        break;
      }
      case 'refund_duplicate': {
        const dups = (await refundableCharges(tx, b.id, input.chargeId)).filter(c => c.refundable > 0 && (input.chargeId || c.charge.isDuplicate));
        if (!dups.length) throw new AftercareError('no_duplicate_charge');
        refundCents = dups[0].refundable;
        await createRefunds(tx, { bookingId: b.id, amountCents: refundCents, reason: 'duplicate_charge', actor, disputeId: d.id, chargeId: dups[0].charge.id });
        break;
      }
      case 'cancel_full_refund':
      case 'cancel_unpaid': {
        if (kind === 'cancel_unpaid' && b.status !== 'awaiting_payment') throw new AftercareError('not_awaiting_payment');
        if (!(DISPUTABLE as readonly string[]).includes(b.status)) throw new AftercareError('not_cancellable');
        const q = await quoteFor(tx, ctx, 'dispute');
        await cancelBookingCore(tx, ctx, { actor, initiatedBy: 'dispute', quote: q, refundReason: 'dispute_decision', disputeId: d.id });
        refundCents = q.refundCents;
        cancelled = true;
        break;
      }
      case 'restore_price':
      case 'accept_new_price': {
        if (b.status !== 'awaiting_payment') throw new AftercareError('not_awaiting_payment');
        let amount = input.newAmountCents ?? opt?.newAmountCents ?? null;
        if (amount === null && kind === 'restore_price') {
          const [r] = await tx.select({ amount: request.amountCents }).from(request).where(eq(request.id, b.requestId));
          amount = r?.amount ?? null;
        }
        if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) throw new AftercareError('bad_amount');
        newAmount = amount;
        // K16: restore_price also opens a new 24 h payment window, clamped like K1's (§3): never past the event start.
        let newDueAt: Date | null = null;
        if (kind === 'restore_price') {
          const window = new Date(at.getTime() + (await getSetting('payment.window_hours', undefined, tx)) * 3600_000);
          const [hh, mm] = (b.startTime ?? '00:00').split(':').map(Number);
          const eventStart = sofiaInstant(b.eventDate, hh, mm);
          newDueAt = window < eventStart ? window : eventStart;
        }
        await repriceBooking(tx, b, amount, newDueAt);
        break;
      }
      case 'enforce_terms': {
        if (!title) throw new AftercareError('title_required');
        if (input.complianceDueAt) {
          if (input.complianceDueAt <= at) throw new AftercareError('bad_compliance_date');
          complianceDueAt = input.complianceDueAt;
        }
        break;
      }
      case 'no_refund': case 'mediate': case 'close':
        break;
    }

    const keeps = cancelled ? 0 : Math.max(0, paid - refundCents);
    const [updated] = await tx.update(dispute).set({
      status: 'resolved', decisionKind: kind, decisionTitle: title, decisionDetail: detail, motive,
      refundCents, partnerKeepsCents: keeps, newAmountCents: newAmount, complianceDueAt,
      fallback: complianceDueAt ? 'cancel_full_refund' : null, decidedBy: actor.userId, decidedAt: at, heldCents: keeps, updatedAt: at,
    }).where(eq(dispute.id, d.id)).returning();
    await cancelPending(`dispute:${d.id}:position`, tx);
    if (complianceDueAt) await schedule('dispute.compliance', complianceDueAt, { disputeId: d.id }, `dispute:${d.id}:compliance`, tx);
    // The hold ends with the decision; anything already due is released (with commission on what the partner keeps).
    await syncBookingHold(tx, b.id);

    const t = ctxText(ctx);
    const [admin] = await tx.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
    const decisionText = detail ?? title ?? '';
    const [after] = await tx.select().from(booking).where(eq(booking.id, b.id));
    await mailClient(tx, ctx, 'client-dispute-decision', {
      bookingId: b.number, bookingNo: b.number, partnerName: t.partnerName, serviceName: t.serviceName, eventType: t.eventType,
      eventDate: t.eventDate, venue: t.venue, summary: input.summary?.trim() || decisionText, decision: decisionText, motive,
      decisionShort: input.decisionShort?.trim() || title || '', heldAmount: money(keeps), heldUntil: fmtDate(after.holdUntil),
    }, `dispute:${d.id}:decision:client`, routes.clientBooking(b.number));
    await mailPartner(tx, ctx, 'vendor-ticket-decision', {
      caseNo: d.number, eventType: t.eventType, eventTypeDefinite: t.eventTypeDefinite, eventDate: t.eventDate, packageName: t.packageName,
      decision: input.decisionShort?.trim() || title || '', summary: input.partnerSummary?.trim() || input.summary?.trim() || decisionText,
      account: input.partnerAccount?.trim() || d.summary || d.description, motive,
      payoutLine: input.payoutLine?.trim() || (cancelled ? NO_PAYOUT : PAYOUT_ON_SCHEDULE),
      refunded: money(refundCents), partnerAmount: money(keeps - bpOf(keeps, b.commissionBp ?? 0)),
      decidedBy: admin?.name ?? '', decidedAt: dateTime(at),
    }, `dispute:${d.id}:decision:partner`, routes.partnerEarnings());
    await audit(tx, {
      actor, action: 'dispute.decided', entity: 'dispute', entityId: d.id,
      data: { number: d.number, kind, refundCents, partnerKeepsCents: keeps, newAmountCents: newAmount, complianceDueAt: complianceDueAt?.toISOString() ?? null, wasStatus: d.status },
    });
    return updated;
  });
}

/**
 * K16: a new price while awaiting payment. The payment plan follows the
 * booking's mode; an open checkout or transfer for the old amount is expired;
 * with a new deadline the pending payment timers (T5–T8, all relative to the
 * deadline) move by the same shift.
 */
async function repriceBooking(tx: Tx, b: typeof booking.$inferSelect, amount: number, newDueAt: Date | null): Promise<void> {
  const at = await now();
  let dueNow = amount, depositPay: number | null = null, balance = 0;
  if (b.paymentMode === 'deposit_balance' && b.depositPayCents !== null) {
    const pct = (await getSetting('payment.schedule', b.approvedAt, tx)).deposit_percent ?? b.depositPercent;
    depositPay = percentOf(amount, pct);
    dueNow = depositPay;
    balance = amount - depositPay;
  }
  await tx.update(booking).set({
    amountCents: amount, dueNowCents: dueNow, depositPayCents: depositPay, balanceCents: balance,
    ...(newDueAt ? { paymentDueAt: newDueAt } : {}), updatedAt: at,
  }).where(eq(booking.id, b.id));
  await tx.update(charge).set({ status: 'expired', updatedAt: at })
    .where(and(eq(charge.bookingId, b.id), inArray(charge.status, ['pending', 'awaiting_transfer'])));
  if (newDueAt) {
    const shiftMs = newDueAt.getTime() - b.paymentDueAt.getTime();
    await tx.execute(sql`update job set run_at = run_at + (${shiftMs} * interval '1 millisecond') where id in (
      select id from ${job} where status = 'pending' and dedupe_key like ${`booking:${b.id}:%`} for update skip locked)`);
  }
}

// ── T16: compliance ───────────────────────────────────────────────────────

/** The team marks an enforce_terms decision complied with; T16 then does nothing. */
export async function markComplied(actor: Actor, input: { disputeId: string }, tx?: Tx): Promise<void> {
  assertCan(actor, 'resolve_disputes');
  return withTx(tx, async tx => {
    const d = await lockDispute(tx, input.disputeId);
    if (d.status !== 'resolved' || d.decisionKind !== 'enforce_terms' || !d.complianceDueAt) throw new AftercareError('no_compliance');
    if (d.compliedAt) return;
    await tx.update(dispute).set({ compliedAt: await now(), updatedAt: await now() }).where(eq(dispute.id, d.id));
    await cancelPending(`dispute:${d.id}:compliance`, tx);
    await audit(tx, { actor, action: 'dispute.complied', entity: 'dispute', entityId: d.id });
  });
}

/**
 * T16 `dispute.compliance`: an enforce_terms decision not marked complied by
 * its deadline → the fallback runs: cancel + full refund (K15). No email
 * template exists for it; `client-refund-sent` follows the refund. Idempotent.
 */
export async function complianceDeadline(input: { disputeId: string }, tx?: Tx): Promise<boolean> {
  return withTx(tx, async tx => {
    const d = await lockDispute(tx, input.disputeId);
    if (d.status !== 'resolved' || d.decisionKind !== 'enforce_terms' || d.fallback !== 'cancel_full_refund' || d.compliedAt) return false;
    const ctx = await loadBookingCtx(tx, d.bookingId, { lock: true });
    const b = ctx.booking;
    if (!(DISPUTABLE as readonly string[]).includes(b.status)) return false;
    const q = await quoteFor(tx, ctx, 'dispute');
    await cancelBookingCore(tx, ctx, { actor: SYSTEM, initiatedBy: 'dispute', quote: q, refundReason: 'dispute_decision', disputeId: d.id });
    await tx.update(dispute).set({ refundCents: q.refundCents, partnerKeepsCents: 0, heldCents: 0, updatedAt: await now() }).where(eq(dispute.id, d.id));
    await audit(tx, { actor: SYSTEM, action: 'dispute.fallback_applied', entity: 'dispute', entityId: d.id, data: { refundCents: q.refundCents } });
    return true;
  });
}

// ── X9: withdrawal ────────────────────────────────────────────────────────

/** X9: the filer withdraws while collecting; the payout returns to its schedule. No email exists (D68). */
export async function withdraw(actor: Actor, input: { disputeId: string }, tx?: Tx): Promise<void> {
  return withTx(tx, async tx => {
    const d = await lockDispute(tx, input.disputeId);
    if (!d.openedByUser || d.openedByUser !== actor.userId || d.openedBy === 'team') throw new ForbiddenError('dispute_filer');
    if (d.status !== 'collecting') throw new AftercareError('not_withdrawable');
    const at = await now();
    await tx.update(dispute).set({ status: 'withdrawn', withdrawnAt: at, updatedAt: at }).where(eq(dispute.id, d.id));
    await cancelPending(`dispute:${d.id}:`, tx);
    await syncBookingHold(tx, d.bookingId);
    await audit(tx, { actor, action: 'dispute.withdrawn', entity: 'dispute', entityId: d.id });
  });
}

/** Admin list (/admin/sporove): open cases urgent first, then the rest newest first. */
export async function listDisputes(actor: Actor, opts: { filter?: 'open' | 'resolved' | 'all' } = {}, q: Queryable = db): Promise<DisputeRow[]> {
  assertCan(actor, 'resolve_disputes');
  const f = opts.filter ?? 'open';
  const where = f === 'open' ? inArray(dispute.status, OPEN) : f === 'resolved' ? inArray(dispute.status, ['resolved', 'withdrawn']) : undefined;
  return q.select().from(dispute).where(where).orderBy(desc(dispute.urgent), desc(dispute.openedAt));
}
