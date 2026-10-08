// Conversations between a client and a partner (SPEC §4.16, §10, §16 Messages).
//
// One conversation per (client, partner, client event). Its context link is the latest booking
// (‹Виж резервацията›), else the latest request (‹Виж заявката›). Opening it marks the other
// side's messages read (‹· прочетено›). Each side keeps its own unsent draft. Contact details
// are masked in both directions until the conversation has a confirmed booking (§10, D19);
// `body` is what the other side sees, `body_original` is kept for the team.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, clientEvent, conversation, eventType, media, message, messageAttachment, partner, request, user,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { date as fmtDate, dateTime } from '@/lib/format';
import { isSystem, type AnyActor } from './actor';
import { audit } from './audit';
import { DomainError, ForbiddenError, NotFoundError, mail, maskContacts, partnerRecipient, withTx } from './catalogue-kit';
import { ownMedia } from './media';

export type Conversation = typeof conversation.$inferSelect;
export type Message = typeof message.$inferSelect;

export const MESSAGE_MAX = 4000;
/** Bookings in these states reveal contacts (§10). */
const REVEALING = ['confirmed', 'cancellation_requested', 'completed'] as const;

// ── Conversation lookup ──────────────────────────────────────────────────

/**
 * System: the conversation for a client, partner and event, created if missing, pointing at the
 * latest request / booking. Call from R1 (request sent, ‹conversation created›) and K1.
 */
export async function ensureConversation(a: { clientId: string; partnerId: string; clientEventId: string | null; requestId?: string | null; bookingId?: string | null }, tx?: Tx): Promise<Conversation> {
  return withTx(tx, async t => {
    const at = await now();
    await t.insert(conversation).values({ clientId: a.clientId, partnerId: a.partnerId, clientEventId: a.clientEventId, createdAt: at })
      .onConflictDoNothing();
    const evCond = a.clientEventId ? eq(conversation.clientEventId, a.clientEventId) : isNull(conversation.clientEventId);
    const [c] = await t.select().from(conversation)
      .where(and(eq(conversation.clientId, a.clientId), eq(conversation.partnerId, a.partnerId), evCond)).for('update');
    const set: Partial<Conversation> = {};
    if (a.requestId) set.requestId = a.requestId;
    if (a.bookingId) set.bookingId = a.bookingId;
    if (Object.keys(set).length) return (await t.update(conversation).set(set).where(eq(conversation.id, c.id)).returning())[0];
    return c;
  });
}

/**
 * ‹Пиши на изпълнителя› / ‹Пиши на клиента› (`messages.getOrCreate()`): the conversation of a
 * request or booking the actor is party to, or (client) with a partner directly.
 */
export async function getOrCreate(actor: AnyActor, a: { requestId?: string; bookingId?: string; number?: string; partnerId?: string; clientEventId?: string | null }, tx?: Tx): Promise<Conversation> {
  if (isSystem(actor)) throw new ForbiddenError('party');
  return withTx(tx, async t => {
    let clientId: string, partnerId: string, clientEventId: string | null = null, requestId: string | null = null, bookingId: string | null = null;
    if (a.bookingId || a.requestId || a.number) {
      const [r] = await t.select({ r: request, bookingId: booking.id }).from(request).leftJoin(booking, eq(booking.requestId, request.id))
        .where(a.number ? eq(request.number, a.number) : a.bookingId ? eq(booking.id, a.bookingId) : eq(request.id, a.requestId!)).limit(1);
      if (!r) throw new NotFoundError('request');
      ({ clientId, partnerId, clientEventId } = r.r);
      requestId = r.r.id; bookingId = r.bookingId;
    } else if (a.partnerId && actor.role === 'client') {
      const [p] = await t.select({ id: partner.id, status: partner.status, isListed: partner.isListed }).from(partner).where(eq(partner.id, a.partnerId));
      if (!p || p.status !== 'approved' || !p.isListed) throw new NotFoundError('partner');
      clientId = actor.userId; partnerId = p.id; clientEventId = a.clientEventId ?? null;
      if (clientEventId) {
        const [ev] = await t.select({ id: clientEvent.id }).from(clientEvent).where(and(eq(clientEvent.id, clientEventId), eq(clientEvent.clientId, clientId)));
        if (!ev) throw new NotFoundError('client_event');
      }
    } else throw new DomainError('validation');
    if (actor.role === 'client' && actor.userId !== clientId) throw new ForbiddenError('party');
    if (actor.role === 'partner' && actor.partnerId !== partnerId) throw new ForbiddenError('party');
    if (actor.role === 'admin') throw new ForbiddenError('party');
    return ensureConversation({ clientId, partnerId, clientEventId, requestId, bookingId }, t);
  });
}

type Side = 'client' | 'partner';

async function loadAsParty(q: Queryable, actor: AnyActor, conversationId: string): Promise<{ c: Conversation; side: Side | 'team' }> {
  const [c] = await q.select().from(conversation).where(eq(conversation.id, conversationId)).limit(1);
  if (!c) throw new NotFoundError('conversation');
  if (isSystem(actor)) return { c, side: 'team' };
  if (actor.role === 'client' && c.clientId === actor.userId) return { c, side: 'client' };
  if (actor.role === 'partner' && actor.partnerId === c.partnerId) return { c, side: 'partner' };
  if (actor.role === 'admin' && actor.teamRole) return { c, side: 'team' };
  throw new ForbiddenError('party');
}

/** True while the conversation has no booking in confirmed / cancellation_requested / completed (§10 masking a). */
export async function maskingApplies(q: Queryable, c: Pick<Conversation, 'clientId' | 'partnerId' | 'clientEventId'>): Promise<boolean> {
  const [hit] = await q.select({ id: booking.id }).from(booking).where(and(
    eq(booking.clientId, c.clientId), eq(booking.partnerId, c.partnerId), inArray(booking.status, [...REVEALING]),
    c.clientEventId ? eq(booking.clientEventId, c.clientEventId) : sql`true`,
  )).limit(1);
  return !hit;
}

/** What the emails say about the conversation: the event and the package of its latest booking / request. */
async function context(q: Queryable, c: Conversation) {
  const [r] = c.bookingId || c.requestId
    ? await q.select({ r: request, typeName: eventType.name }).from(request).innerJoin(eventType, eq(eventType.id, request.eventTypeId))
      .where(c.requestId ? eq(request.id, c.requestId) : eq(request.id, sql`(select request_id from booking where id = ${c.bookingId})`)).limit(1)
    : [];
  const [ev] = c.clientEventId ? await q.select({ e: clientEvent, typeName: eventType.name }).from(clientEvent).innerJoin(eventType, eq(eventType.id, clientEvent.eventTypeId))
    .where(eq(clientEvent.id, c.clientEventId)) : [];
  const title = r?.r.serviceTitle ?? '';
  // The templates print ‹Пакет „{packageName}“›: the stored title already reads ‹Пакет „Цял ден“›.
  const packageName = /^Пакет „(.+)“$/.exec(title)?.[1] ?? title;
  const date = r?.r.eventDate ?? ev?.e.date ?? null;
  const venue = [r?.r.venueName ?? ev?.e.venueName, r?.r.locality ?? ev?.e.locality].filter(Boolean).join(', ');
  return { eventType: ev?.e.title ?? r?.typeName ?? '', eventDate: date ? fmtDate(date) : '', packageName, location: venue };
}

// ── Actions ──────────────────────────────────────────────────────────────

/**
 * ‹Изпрати› (`messages.send()`): the message is stored masked per §10 (original kept); the other
 * side gets `vendor-new-message` (mandatory) or `client-new-message` (optional, client.messages)
 * and a bell item; the sender's draft is cleared. Toast ‹Съобщението е изпратено›. Also used by
 * ‹Поискай още информация› (R2; the 24 h clock keeps running, D61).
 */
export async function send(actor: AnyActor, a: { conversationId: string; body: string; attachmentMediaId?: string | null }, tx?: Tx): Promise<Message> {
  const raw = (a.body ?? '').trim();
  if (!raw && !a.attachmentMediaId) throw new DomainError('empty_message');
  if (raw.length > MESSAGE_MAX) throw new DomainError('message_too_long');
  return withTx(tx, async t => {
    const { c, side } = await loadAsParty(t, actor, a.conversationId);
    if (side === 'team') throw new ForbiddenError('party');
    const senderId = (actor as { userId: string }).userId;
    const [me] = await t.select({ banned: user.banned, deleted: user.deletedAt }).from(user).where(eq(user.id, senderId));
    if (me?.banned || me?.deleted) throw new ForbiddenError('blocked');
    if (a.attachmentMediaId) await ownMedia(t, actor, a.attachmentMediaId, ['message_attachment']);
    const at = await now();
    const masked = (await maskingApplies(t, c)) ? maskContacts(raw) : raw;
    const [m] = await t.insert(message).values({
      conversationId: c.id, senderRole: side, senderUserId: senderId, body: masked, bodyOriginal: raw, createdAt: at,
    }).returning();
    if (a.attachmentMediaId) await t.insert(messageAttachment).values({ messageId: m.id, mediaId: a.attachmentMediaId });
    await t.update(conversation).set(side === 'client'
      ? { lastMessageAt: at, clientDraft: null, clientLastReadAt: at, partnerUnreadCount: sql`${conversation.partnerUnreadCount} + 1` }
      : { lastMessageAt: at, partnerDraft: null, partnerLastReadAt: at, clientUnreadCount: sql`${conversation.clientUnreadCount} + 1` })
      .where(eq(conversation.id, c.id));
    await audit(t, { actor, action: 'message.sent', entity: 'conversation', entityId: c.id, data: { messageId: m.id, masked: masked !== raw } });

    const ctx = await context(t, c);
    const text = masked || '—';
    if (side === 'client') {
      const [cl] = await t.select({ name: user.name }).from(user).where(eq(user.id, c.clientId));
      const r = await partnerRecipient(t, c.partnerId);
      await mail(t, {
        key: 'vendor-new-message', to: r.email, toUserId: r.userId, dedupeKey: `message:${m.id}`,
        vars: { clientName: cl.name, message: text, eventType: ctx.eventType, packageName: ctx.packageName, eventDate: ctx.eventDate, receivedAt: dateTime(at) },
        bell: { href: `/partner/saobshteniya/${c.id}` },
      });
    } else {
      const [cl] = await t.select({ email: user.email, deleted: user.deletedAt }).from(user).where(eq(user.id, c.clientId));
      const [p] = await t.select({ name: partner.businessName }).from(partner).where(eq(partner.id, c.partnerId));
      if (!cl.deleted) {
        await mail(t, {
          key: 'client-new-message', to: cl.email, toUserId: c.clientId, dedupeKey: `message:${m.id}`,
          vars: { partnerName: p.name, message: text, eventType: ctx.eventType, eventDate: ctx.eventDate, packageName: ctx.packageName, location: ctx.location, receivedAt: dateTime(at) },
          bell: { body: text.length > 120 ? `${text.slice(0, 117)}…` : text, href: `/akaunt/saobshteniya/${c.id}` },
        });
      }
    }
    return m;
  });
}

/** Opening a conversation (`messages.markRead()`): the other side's messages are read; the unread dot goes. */
export async function markRead(actor: AnyActor, a: { conversationId: string }, tx?: Tx): Promise<number> {
  return withTx(tx, async t => {
    const { c, side } = await loadAsParty(t, actor, a.conversationId);
    if (side === 'team') return 0;
    const at = await now();
    const other = side === 'client' ? 'partner' : 'client';
    const read = await t.update(message).set({ readAt: at })
      .where(and(eq(message.conversationId, c.id), eq(message.senderRole, other), isNull(message.readAt))).returning({ id: message.id });
    await t.update(conversation).set(side === 'client' ? { clientLastReadAt: at, clientUnreadCount: 0 } : { partnerLastReadAt: at, partnerUnreadCount: 0 })
      .where(eq(conversation.id, c.id));
    return read.length;
  });
}

/** Typing (`messages.saveDraft()`, debounced): each side keeps its own unsent draft. */
export async function saveDraft(actor: AnyActor, a: { conversationId: string; body: string }, tx?: Tx) {
  const body = (a.body ?? '').slice(0, MESSAGE_MAX);
  return withTx(tx, async t => {
    const { c, side } = await loadAsParty(t, actor, a.conversationId);
    if (side === 'team') throw new ForbiddenError('party');
    await t.update(conversation).set(side === 'client' ? { clientDraft: body || null } : { partnerDraft: body || null }).where(eq(conversation.id, c.id));
  });
}

// ── Read models ──────────────────────────────────────────────────────────

/**
 * The conversation list, newest first, with the other party, the last message (as this side
 * sees it), the unread count and the context link; for partners also the totals
 * ‹N разговора · N непрочетени съобщения›.
 */
export async function listConversations(actor: AnyActor, a: { unreadOnly?: boolean; q?: string } = {}, q: Queryable = db) {
  if (isSystem(actor) || (actor.role !== 'client' && actor.role !== 'partner')) throw new ForbiddenError('party');
  const side: Side = actor.role === 'client' ? 'client' : 'partner';
  const own = side === 'client' ? eq(conversation.clientId, actor.userId) : eq(conversation.partnerId, actor.partnerId ?? '');
  const rows = await q.select({
    c: conversation, partnerName: partner.businessName, partnerSlug: partner.slug, clientName: user.name, eventTitle: clientEvent.title, eventDate: clientEvent.date,
    bookingNumber: sql<string | null>`(select number from booking where id = ${conversation.bookingId})`,
    bookingStatus: sql<string | null>`(select status::text from booking where id = ${conversation.bookingId})`,
    requestNumber: sql<string | null>`(select number from request where id = ${conversation.requestId})`,
    requestStatus: sql<string | null>`(select status::text from request where id = ${conversation.requestId})`,
    requestKind: sql<string | null>`(select kind::text from request where id = ${conversation.requestId})`,
    last: sql<{ body: string; body_original: string; sender_role: string; created_at: string } | null>`(
      select row_to_json(m) from (select body, body_original, sender_role, created_at from message where conversation_id = ${conversation.id}
      order by created_at desc limit 1) m)`,
  }).from(conversation).innerJoin(partner, eq(partner.id, conversation.partnerId)).innerJoin(user, eq(user.id, conversation.clientId))
    .leftJoin(clientEvent, eq(clientEvent.id, conversation.clientEventId))
    .where(and(own, a.unreadOnly ? (side === 'client' ? sql`${conversation.clientUnreadCount} > 0` : sql`${conversation.partnerUnreadCount} > 0`) : sql`true`))
    .orderBy(sql`${conversation.lastMessageAt} desc nulls last`, desc(conversation.createdAt));
  // ‹Търсене по изпълнител или събитие›: matched here, case-insensitively in Bulgarian (the database collation may not fold Cyrillic).
  const needle = a.q?.trim().toLocaleLowerCase('bg');
  const hit = (r: (typeof rows)[number]) => !needle || [r.partnerName, r.clientName, r.eventTitle].some(x => x?.toLocaleLowerCase('bg').includes(needle));
  const items = rows.filter(hit).map(r => {
    const unread = side === 'client' ? r.c.clientUnreadCount : r.c.partnerUnreadCount;
    const mine = r.last?.sender_role === side;
    const contextLink = r.bookingNumber && r.bookingStatus !== 'awaiting_payment'
      ? { label: 'Виж резервацията', href: side === 'client' ? `/akaunt/rezervacii/${encodeURIComponent(r.bookingNumber)}` : `/partner/rezervacii/${encodeURIComponent(r.bookingNumber)}` }
      : r.requestNumber ? { label: 'Виж заявката', href: side === 'client' ? `/akaunt/zayavki/${encodeURIComponent(r.requestNumber)}` : `/partner/zayavki/${encodeURIComponent(r.requestNumber)}` } : null;
    const badge = side === 'partner'
      ? r.bookingStatus && ['confirmed', 'cancellation_requested', 'completed'].includes(r.bookingStatus) ? 'Потвърдена резервация'
        : r.requestStatus === 'pending' ? (r.requestKind === 'quote' ? 'Чака оферта' : 'Нова заявка') : null
      : null;
    return {
      conversation: r.c, otherName: side === 'client' ? r.partnerName : r.clientName, partnerSlug: r.partnerSlug,
      eventTitle: r.eventTitle, eventDate: r.eventDate, unread,
      lastMessage: r.last ? { body: mine ? r.last.body_original : r.last.body, mine, at: new Date(r.last.created_at) } : null,
      contextLink, badge,
    };
  });
  return {
    items,
    totals: { conversations: items.length, unreadMessages: items.reduce((s, i) => s + i.unread, 0) },
  };
}

/**
 * One thread: messages oldest first, each as this side sees it (own messages unmasked; the
 * team sees originals), with attachments, the ‹· прочетено› mark on the last own message, and the draft.
 */
export async function thread(actor: AnyActor, a: { conversationId: string }, q: Queryable = db) {
  const { c, side } = await loadAsParty(q, actor, a.conversationId);
  const msgs = await q.select().from(message).where(eq(message.conversationId, c.id)).orderBy(message.createdAt);
  const att = msgs.length ? await q.select({ messageId: messageAttachment.messageId, m: media }).from(messageAttachment)
    .innerJoin(media, eq(media.id, messageAttachment.mediaId)).where(inArray(messageAttachment.messageId, msgs.map(m => m.id))) : [];
  const lastOwn = side === 'team' ? null : [...msgs].reverse().find(m => m.senderRole === side) ?? null;
  return {
    conversation: c, side,
    draft: side === 'client' ? c.clientDraft : side === 'partner' ? c.partnerDraft : null,
    masking: await maskingApplies(q, c),
    messages: msgs.map(m => ({
      id: m.id, senderRole: m.senderRole, mine: m.senderRole === side, createdAt: m.createdAt,
      body: side === 'team' || m.senderRole === side ? m.bodyOriginal : m.body,
      read: !!m.readAt, readMark: lastOwn?.id === m.id && !!m.readAt,
      attachments: att.filter(x => x.messageId === m.id).map(x => ({ id: x.m.id, name: x.m.originalName, mime: x.m.mime })),
    })),
  };
}

