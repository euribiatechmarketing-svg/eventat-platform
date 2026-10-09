import 'server-only';
// Read models for the messaging and support screens (SCREENS §4 /akaunt/saobshteniya, /akaunt/poddrazhka;
// §7 /partner/saobshteniya, /partner/poddrazhka). Writes go through lib/domain/messaging.ts,
// lib/domain/disputes.ts and lib/domain/media.ts; this module only reads and formats.
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  booking, category, clientEvent, clientProfile, conversation, dispute, disputeAttachment, eventType, media, message, messageAttachment, partner, request, user,
  type DisputeReason,
} from '@/db/schema';
import { now } from '@/lib/clock';
import {
  addDays, date as fmtDate, daysBetween, money, moneyShort, monthName, plural, sofiaDate, sofiaParts, time, weekdayName,
} from '@/lib/format';
import { initials as initialsOf } from '@/lib/initials';
import type { Actor } from './actor';
import { getSetting } from './settings';
import { listConversations, thread } from './messaging';
import { getDispute } from './disputes';
import { mediaUrl } from './catalogue-kit';
import { DISPUTE_REASON_LABEL } from './aftercare-shared';

const NBSP = '\u00A0';
/** ‹ · › that stays at the end of a line when the text wraps (never starts one). */
const SEP = `${NBSP}· `;
const MON_SHORT = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
/** Bookings that reveal contacts and count as ‹Потвърдена резервация› (SPEC §10). */
const REVEALING = ['confirmed', 'cancellation_requested', 'completed'];
/** Bookings a case can be opened on (SPEC §4.11 X1/X2). */
const DISPUTABLE = ['awaiting_payment', 'confirmed', 'cancellation_requested', 'completed'] as const;
const OPEN = ['collecting', 'awaiting_decision'] as const;
/** D70: a client may open a case up to 30 days after the event. */
const DISPUTE_WINDOW_DAYS = 30;

// ── Formatting ───────────────────────────────────────────────────────────

/** Conversation list time: ‹11:42› today, ‹вчера›, else ‹29 авг› (with the year when it differs). */
export function listTime(at: Date, today: Date): string {
  const d = sofiaDate(at), t = sofiaDate(today);
  if (d === t) return time(at);
  if (d === addDays(t, -1)) return 'вчера';
  const p = sofiaParts(at);
  const s = `${p.d}${NBSP}${MON_SHORT[p.m - 1]}`;
  return p.y === sofiaParts(today).y ? s : `${s} ${p.y}`;
}

/** An event date in a list row or a pick, as client/messages.html and client/dispute.html write it: ‹19 дек 2026›. */
export function eventDateShort(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${day}${NBSP}${MON_SHORT[m - 1]} ${y}`;
}

/** Day separator in a thread: ‹Днес›, ‹Вчера›, ‹Петък, 29 август›. */
export function dayLabel(at: Date, today: Date): string {
  const d = sofiaDate(at), t = sofiaDate(today);
  if (d === t) return 'Днес';
  if (d === addDays(t, -1)) return 'Вчера';
  const p = sofiaParts(at);
  const wd = weekdayName(p.wd);
  const s = `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${p.d}${NBSP}${monthName(p.m)}`;
  return p.y === sofiaParts(today).y ? s : `${s} ${p.y}`;
}

/** ‹29 август, 11:30› (with the year when it differs from today's). */
function shortDateTime(at: Date, today: Date): string {
  const p = sofiaParts(at);
  const s = `${p.d}${NBSP}${monthName(p.m)}`;
  return `${p.y === sofiaParts(today).y ? s : `${s} ${p.y}`}, ${time(at)}`;
}

/** ‹28 април› (with the year when it differs from today's). */
function shortDate(at: Date, today: Date): string {
  const p = sofiaParts(at);
  const s = `${p.d}${NBSP}${monthName(p.m)}`;
  return p.y === sofiaParts(today).y ? s : `${s} ${p.y}`;
}

/** ‹подаден преди 2 дни› / ‹подаден вчера› / ‹подаден днес›. */
function filedAgo(at: Date, today: Date): string {
  const n = daysBetween(sofiaDate(at), sofiaDate(today));
  if (n <= 0) return 'подаден днес';
  if (n === 1) return 'подаден вчера';
  return `подаден преди ${n} дни`;
}

/** A deadline as the admin case page words it: ‹Срокът изтича днес в 12:10› / ‹Срок до 2 септември, 09:05›. */
function deadlineText(due: Date, today: Date): string {
  if (sofiaDate(due) === sofiaDate(today)) return `Срокът изтича днес в ${time(due)}`;
  return `Срок до ${shortDateTime(due, today)}`;
}

/** ‹МД› for ‹Мария Димитрова›, ‹ПН› for ‹Петя и Николай› (the joining ‹и› is not a name). */
const initials = (name: string) => initialsOf(name.replace(/\s+и\s+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || name);
/** ‹Петя и Николай› take the plural verb (admin/dispute.html ‹отвориха›, ‹Подадоха сигнала›). */
const isPair = (name: string) => /\s+и\s+/.test(name);

const venueOf = (v: { venueName: string | null; locality: string | null }) => [v.venueName, v.locality].filter(Boolean).join(', ');

async function avatarUrls(partnerIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(partnerIds)];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: partner.id, key: media.storageKey }).from(partner)
    .leftJoin(media, eq(media.id, partner.avatarMediaId)).where(inArray(partner.id, ids));
  return new Map(rows.map(r => [r.id, mediaUrl(r.key)]));
}

// ── Messages ─────────────────────────────────────────────────────────────

export type ConversationItem = Awaited<ReturnType<typeof conversationList>>['items'][number];

/**
 * The conversation list of /akaunt/saobshteniya and /partner/saobshteniya: newest first, filtered by
 * ‹Търсене…› (`q`) and ‹Само непрочетени› (`unreadOnly`); the totals (‹N разговора · N непрочетени
 * съобщения›) always count every conversation.
 */
export async function conversationList(actor: Actor, a: { q?: string; unreadOnly?: boolean; keepId?: string } = {}) {
  const today = await now();
  const [all, matching] = await Promise.all([
    listConversations(actor, {}),
    a.q ? listConversations(actor, { q: a.q }) : null,
  ]);
  const base = matching ?? all;
  // ‹Само непрочетени›: the conversation open beside the list stays in it after it has been read
  // (vendor/messages.html hides only what was read when the filter was switched on).
  const list = a.unreadOnly ? { ...base, items: base.items.filter(i => i.unread > 0 || i.conversation.id === a.keepId) } : base;
  const [avatars, files] = await Promise.all([
    avatarUrls(list.items.map(i => i.conversation.partnerId)),
    lastFileNames(list.items.filter(i => i.lastMessage && !i.lastMessage.body).map(i => i.conversation.id)),
  ]);
  return {
    totals: all.totals,
    items: list.items.map(i => ({
      id: i.conversation.id,
      otherName: i.otherName,
      otherInitials: initials(i.otherName),
      avatarUrl: avatars.get(i.conversation.partnerId) ?? null,
      event: [i.eventTitle, i.eventDate ? eventDateShort(i.eventDate) : null].filter(Boolean).join(SEP),
      unread: i.unread,
      // A message that is only a file previews as the file's name.
      preview: i.lastMessage?.body || files.get(i.conversation.id) || '',
      time: i.lastMessage ? listTime(i.lastMessage.at, today) : '',
    })),
  };
}

/** The file name of each conversation's last message (for messages sent with a file and no text). */
async function lastFileNames(conversationIds: string[]): Promise<Map<string, string>> {
  if (!conversationIds.length) return new Map();
  const rows = await db.selectDistinctOn([message.conversationId], { conversationId: message.conversationId, name: media.originalName })
    .from(message)
    .innerJoin(messageAttachment, eq(messageAttachment.messageId, message.id))
    .innerJoin(media, eq(media.id, messageAttachment.mediaId))
    .where(inArray(message.conversationId, conversationIds))
    .orderBy(message.conversationId, desc(message.createdAt));
  return new Map(rows.filter(r => r.name).map(r => [r.conversationId, r.name as string]));
}

type Badge = { label: string; tone: 'success' | 'primary' | 'warning' };

/**
 * One conversation for its client or partner: the header (other party, what it is about, the
 * context link ‹Виж резервацията› / ‹Виж заявката›, the partner's status badge), the messages
 * grouped by day as this side sees them (SPEC §10 masking), the draft. Throws NotFound/Forbidden.
 */
export async function conversationView(actor: Actor, conversationId: string) {
  const t = await thread(actor, { conversationId });
  if (t.side === 'team') throw new Error('party only');
  const side = t.side;
  const c = t.conversation;
  const today = await now();
  const [[p], [cl], [b], [r], [ev]] = await Promise.all([
    db.select({ name: partner.businessName, key: media.storageKey }).from(partner).leftJoin(media, eq(media.id, partner.avatarMediaId))
      .where(eq(partner.id, c.partnerId)),
    db.select({ name: user.name }).from(user).where(eq(user.id, c.clientId)),
    c.bookingId
      ? db.select({ number: booking.number, status: booking.status, serviceTitle: booking.serviceTitle, eventDate: booking.eventDate, venueName: booking.venueName, locality: booking.locality })
        .from(booking).where(eq(booking.id, c.bookingId))
      : Promise.resolve([] as never[]),
    c.requestId
      ? db.select({ number: request.number, status: request.status, kind: request.kind, serviceTitle: request.serviceTitle, eventDate: request.eventDate, venueName: request.venueName, locality: request.locality })
        .from(request).where(eq(request.id, c.requestId))
      : Promise.resolve([] as never[]),
    c.clientEventId
      ? db.select({ title: clientEvent.title, date: clientEvent.date, venueName: clientEvent.venueName, locality: clientEvent.locality }).from(clientEvent)
        .where(eq(clientEvent.id, c.clientEventId))
      : Promise.resolve([] as never[]),
  ]);
  const base = side === 'client' ? '/akaunt' : '/partner';
  const contextLink = b && b.status !== 'awaiting_payment'
    ? { label: 'Виж резервацията', href: `${base}/rezervacii/${encodeURIComponent(b.number)}` }
    : r ? { label: 'Виж заявката', href: `${base}/zayavki/${encodeURIComponent(r.number)}` } : null;
  const badge: Badge | null = side !== 'partner' ? null
    : b && REVEALING.includes(b.status) ? { label: 'Потвърдена резервация', tone: 'success' }
      : r?.status === 'pending' ? (r.kind === 'quote' ? { label: 'Чака оферта', tone: 'warning' } : { label: 'Нова заявка', tone: 'primary' }) : null;
  const about = b ?? r;
  const eventDate = about?.eventDate ?? ev?.date ?? null;
  const venue = about ? venueOf(about) : ev ? venueOf(ev) : '';
  // ‹Пакет „Цял ден“ · 14 юни 2026 · Вила Екатерина, с. Панчарево› (client) / ‹Пакет „Цял ден“ · 14 юни 2026› (partner)
  const what = about?.serviceTitle ?? ev?.title ?? '';
  const summary = [what, eventDate ? eventDateShort(eventDate) : null].filter(Boolean).join(SEP);
  const otherName = side === 'client' ? p.name : cl.name;

  const days: { label: string; messages: (typeof t.messages[number] & { time: string })[] }[] = [];
  for (const m of t.messages) {
    const label = dayLabel(m.createdAt, today);
    const last = days[days.length - 1];
    const row = { ...m, time: time(m.createdAt) };
    if (last?.label === label) last.messages.push(row); else days.push({ label, messages: [row] });
  }
  return {
    id: c.id,
    side,
    otherName,
    otherInitials: initials(otherName),
    partnerAvatarUrl: mediaUrl(p.key),
    summary,
    detail: side === 'client' && venue ? `${summary}${SEP}${venue}` : summary,
    contextLink,
    badge,
    draft: t.draft ?? '',
    masking: t.masking,
    days,
    lastMessageId: t.messages.at(-1)?.id ?? null,
  };
}

// ── Support (disputes) ───────────────────────────────────────────────────

export const DISPUTE_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  collecting: { label: 'Събираме данни', cls: 'badge badge--warning badge--dot' },
  awaiting_decision: { label: 'Чака решение', cls: 'badge badge--warning badge--dot' },
  resolved: { label: 'Решен', cls: 'badge badge--success badge--dot' },
  withdrawn: { label: 'Оттеглен', cls: 'badge badge--dot' },
};

export const CLIENT_REASON_OPTIONS: { value: DisputeReason; label: string }[] = [
  { value: 'no_show', label: DISPUTE_REASON_LABEL.no_show },
  { value: 'not_as_described', label: DISPUTE_REASON_LABEL.not_as_described },
  { value: 'payment_problem', label: DISPUTE_REASON_LABEL.payment_problem },
  { value: 'other', label: DISPUTE_REASON_LABEL.other },
];

/** vendor/dispute.html reason cards with their descriptions. */
export const PARTNER_REASON_OPTIONS: { value: DisputeReason; label: string; desc: string }[] = [
  { value: 'client_unresponsive', label: DISPUTE_REASON_LABEL.client_unresponsive, desc: 'Няма връзка след потвърдената резервация.' },
  { value: 'terms_changed_on_site', label: DISPUTE_REASON_LABEL.terms_changed_on_site, desc: 'Час, локация или обхват, различни от уговореното.' },
  { value: 'payment_problem', label: DISPUTE_REASON_LABEL.payment_problem, desc: 'Сумата не е постъпила или не отговаря на офертата.' },
  { value: 'other', label: DISPUTE_REASON_LABEL.other, desc: 'Опишете случая със свои думи по-долу.' },
];

/** The settings the support screens quote (‹до 24 часа›, ‹До 6 снимки›). */
export async function supportSettings() {
  const [teamHours, positionHours, maxPhotos, maxMb] = await Promise.all([
    getSetting('dispute.team_reply_hours'), getSetting('dispute.position_hours'), getSetting('uploads.max_photos'), getSetting('uploads.max_mb'),
  ]);
  return { teamHours, positionHours, maxPhotos, maxMb: Math.min(maxMb, 5) };
}

/** Bookings the actor may open a case on: their own, awaiting payment or later, no case yet, event at most 30 days ago (D70). */
async function disputableBookings(owner: { clientId?: string; partnerId?: string }, preselect?: string) {
  const today = sofiaDate(await now());
  const own = owner.clientId ? eq(booking.clientId, owner.clientId) : eq(booking.partnerId, owner.partnerId ?? '');
  const window = sql`${booking.eventDate} >= ${addDays(today, -DISPUTE_WINDOW_DAYS)}`;
  const rows = await db.select({
    id: booking.id, number: booking.number, status: booking.status, eventDate: booking.eventDate, venueName: booking.venueName,
    locality: booking.locality, serviceTitle: booking.serviceTitle, amountCents: booking.amountCents, partnerId: booking.partnerId,
    partnerName: partner.businessName, categoryName: category.name, eventTitle: clientEvent.title, hosts: clientEvent.hosts,
    eventTypeName: eventType.name, clientName: user.name,
  }).from(booking)
    .innerJoin(partner, eq(partner.id, booking.partnerId))
    .leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .leftJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .where(and(
      own, inArray(booking.status, [...DISPUTABLE]),
      sql`not exists (select 1 from ${dispute} where ${dispute.bookingId} = ${booking.id})`,
      owner.clientId ? window : preselect ? or(window, eq(booking.number, preselect)) : window,
    ))
    .orderBy(asc(booking.eventDate), asc(booking.number));
  return rows;
}

/** /akaunt/poddrazhka(/nov): the booking cards (‹Студио Мелодия · DJ и озвучаване› / ‹Сватба, 14 юни 2026 · Вила Екатерина›, then ‹№ 2026-0614-ЕА› kept on one line by the page). */
export async function clientDisputeChoices(actor: Actor) {
  const rows = await disputableBookings({ clientId: actor.userId });
  const avatars = await avatarUrls(rows.map(r => r.partnerId));
  return rows.map(r => ({
    id: r.id,
    number: r.number,
    title: [r.partnerName, r.categoryName].filter(Boolean).join(' · '),
    sub: [`${r.eventTitle ?? r.eventTypeName}, ${eventDateShort(r.eventDate)}`, r.venueName ?? r.locality].filter(Boolean).join(SEP),
    imageUrl: avatars.get(r.partnerId) ?? null,
  }));
}

/** /partner/poddrazhka/nov: ‹Сватба · Мария и Стефан› / ‹14 юни 2026 · Вила Екатерина, с. Панчарево · Пакет „Цял ден“ · 1 450,00 €›. */
export async function partnerDisputeChoices(actor: Actor, preselect?: string) {
  const rows = await disputableBookings({ partnerId: actor.partnerId ?? '' }, preselect);
  return rows.map(r => ({
    id: r.id,
    number: r.number,
    title: `${r.eventTypeName} · ${r.hosts ?? r.clientName}`,
    sub: [fmtDate(r.eventDate), venueOf(r), r.serviceTitle, money(r.amountCents)].filter(Boolean).join(SEP),
  }));
}

/** The party's cases (‹Моите сигнали›): open first, then newest. */
export async function partyCases(actor: Actor) {
  const today = await now();
  const own = actor.role === 'client' ? eq(booking.clientId, actor.userId) : eq(booking.partnerId, actor.partnerId ?? '');
  const rows = await db.select({
    number: dispute.number, title: dispute.title, status: dispute.status, openedAt: dispute.openedAt, decidedAt: dispute.decidedAt,
    withdrawnAt: dispute.withdrawnAt, amountCents: booking.amountCents, eventDate: booking.eventDate,
    partnerName: partner.businessName, clientName: user.name, hosts: clientEvent.hosts, eventTitle: clientEvent.title, eventTypeName: eventType.name,
  }).from(dispute)
    .innerJoin(booking, eq(booking.id, dispute.bookingId))
    .innerJoin(partner, eq(partner.id, booking.partnerId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .leftJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .where(own)
    .orderBy(sql`case when ${dispute.status} in ('collecting', 'awaiting_decision') then 0 else 1 end`, desc(dispute.openedAt));
  const items = rows.map(r => {
    const open = (OPEN as readonly string[]).includes(r.status);
    const when = r.status === 'resolved' && r.decidedAt ? `решен на ${shortDate(r.decidedAt, today)}`
      : r.status === 'withdrawn' && r.withdrawnAt ? `оттеглен на ${shortDate(r.withdrawnAt, today)}` : filedAgo(r.openedAt, today);
    return {
      number: r.number,
      open,
      done: r.status === 'resolved',
      title: `${r.title} · ${actor.role === 'client' ? r.partnerName : r.hosts ?? r.clientName}`,
      sub: `${actor.role === 'client' ? r.eventTitle ?? r.eventTypeName : r.eventTypeName}, ${fmtDate(r.eventDate)}${SEP}${when}`,
      badge: DISPUTE_STATUS_BADGE[r.status],
      amount: moneyShort(r.amountCents),
    };
  });
  return { items, openCount: items.filter(i => i.open).length };
}

export type CaseView = NonNullable<Awaited<ReturnType<typeof caseView>>>;

/**
 * /akaunt/poddrazhka/[nomer] and /partner/poddrazhka/[nomer]: the case as one of its parties sees it —
 * both statements with their evidence (SPEC §14: visible to the other side), the team's questions to
 * this side, the position deadline (T15), the money held, the decision with its motive once made.
 * Null when the case is not on the actor's own booking.
 */
export async function caseView(actor: Actor, number: string) {
  const today = await now();
  const own = actor.role === 'client' ? eq(booking.clientId, actor.userId)
    : actor.role === 'partner' ? eq(booking.partnerId, actor.partnerId ?? '') : sql`false`;
  const [row] = await db.select({
    d: dispute, b: booking, partnerName: partner.businessName, categoryName: category.name, clientName: user.name,
    clientType: clientProfile.clientType, hosts: clientEvent.hosts, eventTitle: clientEvent.title, eventTypeName: eventType.name,
  }).from(dispute)
    .innerJoin(booking, eq(booking.id, dispute.bookingId))
    .innerJoin(partner, eq(partner.id, booking.partnerId))
    .leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .leftJoin(clientProfile, eq(clientProfile.userId, booking.clientId))
    .leftJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .where(and(eq(dispute.number, number), own))
    .limit(1);
  if (!row) return null;
  const { d, b } = row;
  const side: 'client' | 'partner' = actor.role === 'client' ? 'client' : 'partner';
  const full = await getDispute(actor, d.id);
  const files = full.attachments.length
    ? await db.select({ a: disputeAttachment, m: media }).from(disputeAttachment).innerJoin(media, eq(media.id, disputeAttachment.mediaId))
      .where(eq(disputeAttachment.disputeId, d.id)).orderBy(asc(disputeAttachment.createdAt))
    : [];
  const [decider] = d.decidedBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, d.decidedBy)) : [];

  const clientName = row.clientName;
  const names = { client: clientName, partner: row.partnerName, team: 'Екипът на EventAT' } as const;
  const fileOf = (x: (typeof files)[number]) => ({
    id: x.m.id,
    name: x.a.label ?? x.m.originalName ?? (x.m.mime === 'application/pdf' ? 'PDF' : 'Снимка'),
    isImage: x.m.mime.startsWith('image/'),
    // Seeded documents the prototype only names have no file behind them (size 0): shown, not linked.
    href: x.m.sizeBytes > 0 || x.m.storageKey.startsWith('/') ? `/api/files/${x.m.id}` : null,
  });
  const statements = full.messages.filter(m => m.kind === 'statement' && m.party !== 'team').map(m => ({
    id: m.id,
    party: m.party as 'client' | 'partner',
    body: m.body,
    at: shortDateTime(m.createdAt, today),
    meta: [shortDateTime(m.createdAt, today), m.context].filter(Boolean).join(' · '),
    files: files.filter(f => f.a.messageId === m.id).map(fileOf),
  }));
  const questions = full.messages.filter(m => m.kind === 'question').map(m => ({ id: m.id, body: m.body, at: shortDateTime(m.createdAt, today) }));
  const open = (OPEN as readonly string[]).includes(d.status);
  const other = d.positionFrom === 'client' ? 'client' : 'partner';
  const answered = statements.some(s => s.party === d.positionFrom);

  // ‹Хронология› in the admin case page's words.
  const timeline: { state: 'done' | 'current' | ''; title: string; time: string }[] = [];
  const openerName = d.openedBy === 'team' ? names.team : names[d.openedBy];
  timeline.push({ state: 'done', title: `${openerName} ${isPair(openerName) ? 'отвориха' : 'отвори'} сигнал`, time: shortDateTime(d.openedAt, today) });
  if (d.openedBy !== 'team') {
    const hours = Math.round((d.positionDueAt.getTime() - d.positionRequestedAt.getTime()) / 3600_000);
    timeline.push({ state: 'done', title: `Поискахме позиция от ${names[other]}`, time: `${shortDateTime(d.positionRequestedAt, today)} · срок ${plural(hours, 'час', 'часа')}` });
  }
  for (const s of statements.slice(1)) timeline.push({ state: 'done', title: `${names[s.party]} ${isPair(names[s.party]) ? 'отговориха' : 'отговори'}`, time: s.at });
  if (d.status === 'collecting') {
    timeline.push(answered
      ? { state: 'current', title: 'Чака решение', time: d.holdsPayout ? 'Средствата остават задържани' : '' }
      : { state: 'current', title: `Чакаме отговор от ${names[other]}`, time: deadlineText(d.positionDueAt, today) });
  } else if (d.status === 'awaiting_decision') {
    timeline.push({ state: 'current', title: 'Чака решение', time: d.holdsPayout ? 'Средствата остават задържани' : '' });
  } else if (d.status === 'resolved' && d.decidedAt) {
    timeline.push({ state: 'done', title: `Решение: ${lowFirst(d.decisionTitle ?? '')}`, time: [shortDateTime(d.decidedAt, today), decider?.name].filter(Boolean).join(' · ') });
  } else if (d.status === 'withdrawn' && d.withdrawnAt) {
    timeline.push({ state: 'done', title: 'Сигналът е оттеглен', time: shortDateTime(d.withdrawnAt, today) });
  }

  // ‹Пари по случая›
  let moneyCard: { value: string; label: string; note: string | null } | null = null;
  if (d.status === 'resolved') {
    moneyCard = {
      value: moneyShort(d.refundCents ?? 0), label: 'върнати на клиента',
      note: d.partnerKeepsCents !== null ? `${moneyShort(d.partnerKeepsCents)} остават за ${row.partnerName}.` : null,
    };
  } else if (open) {
    moneyCard = b.status === 'awaiting_payment' && d.heldCents === 0
      ? { value: moneyShort(0), label: 'задържани', note: `За плащане: ${moneyShort(b.amountCents)}.` }
      : d.holdsPayout
        ? { value: moneyShort(d.heldCents), label: 'платени и задържани от платформата', note: `Изплащането към ${row.partnerName} е спряно до решението.` }
        : { value: moneyShort(b.amountCents), label: 'платени и задържани до събитието', note: 'Сигналът не засяга сумата — изплащането следва обичайния график.' };
  }

  const partyCard = (p: 'client' | 'partner') => ({
    party: p,
    name: names[p],
    initials: initials(names[p]),
    role: p === 'client'
      ? (row.clientType === 'business' ? 'Бизнес клиент' : 'Клиент · частно лице')
      : ['Изпълнител', row.categoryName].filter(Boolean).join(' · '),
    filer: d.openedBy === p ? (isPair(names[p]) ? 'Подадоха сигнала' : 'Подаде сигнала') : null,
    statements: statements.filter(s => s.party === p),
    waitingTitle: isPair(names[p]) ? 'Още не са отговорили.' : 'Още не е отговорил.',
    waiting: open && d.positionFrom === p && !statements.some(s => s.party === p)
      ? `Поискахме позиция на ${shortDateTime(d.positionRequestedAt, today).replace(', ', ' в ')} — ${lowFirst(deadlineText(d.positionDueAt, today))}.`
      : null,
  });

  return {
    id: d.id,
    number: d.number,
    side,
    title: d.title,
    sub: `Кейс №${NBSP}${d.number} · ${lowFirst(row.eventTitle ?? row.eventTypeName)} на ${fmtDate(b.eventDate)} · отворен от ${d.openedBy === 'client' ? 'клиента' : d.openedBy === 'partner' ? 'изпълнителя' : 'екипа'} на ${shortDate(d.openedAt, today)}`,
    reason: DISPUTE_REASON_LABEL[d.reason],
    status: d.status,
    badge: DISPUTE_STATUS_BADGE[d.status],
    open,
    parties: [partyCard('client'), partyCard('partner')],
    questions,
    timeline,
    money: moneyCard,
    deadline: d.status === 'collecting' && !answered && d.openedBy !== 'team'
      ? { label: d.positionFrom === 'client' ? 'Срок за клиента' : 'Срок за изпълнителя', dueAt: d.positionDueAt.toISOString(), text: deadlineText(d.positionDueAt, today), mine: d.positionFrom === side }
      : null,
    decision: d.status === 'resolved'
      ? { title: keep(d.decisionTitle) ?? '', detail: keep(d.decisionDetail), motive: keep(d.motive), by: [decider?.name, d.decidedAt ? `${fmtDate(d.decidedAt)}, ${time(d.decidedAt)}` : null].filter(Boolean).join(' · ') }
      : null,
    /** ‹Изпрати позицията› is the partner's answer to the client's case (X6). */
    positionPending: open && d.positionFrom === side && !statements.some(s => s.party === side),
    canWithdraw: d.status === 'collecting' && d.openedBy === side && d.openedByUser === actor.userId,
    bookingNumber: b.number,
  };
}

/** Keep a number with its thousands and with the word or sign after it (admin/dispute.html does the same): ‹1 450 €›. */
const keep = (s: string | null) => (s ? s.replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`).replace(/(\d) (?=[€%\p{L}])/gu, `$1${NBSP}`) : s);

const lowFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Does this conversation belong to the actor? (cheap guard for the actions) */
export async function ownsConversation(actor: Actor, conversationId: string): Promise<boolean> {
  const own = actor.role === 'client' ? eq(conversation.clientId, actor.userId) : eq(conversation.partnerId, actor.partnerId ?? '');
  const [c] = await db.select({ id: conversation.id }).from(conversation).where(and(eq(conversation.id, conversationId), own)).limit(1);
  return !!c;
}
