import 'server-only';
// Read models (and the few writes the domain modules lacked) for the partner's
// catalogue and money screens: /partner/uslugi*, /partner/profil, /partner/revyuta,
// /partner/prihodi, /partner/smetka, /partner/nastroyki (SCREENS §7).
// Every function resolves the partner from the actor (own records only).
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  account, accountDeletionRequest, booking, category, city, clientEvent, eventType, media, partner, partnerEventType, partnerPhoto, partnerTag,
  payoutLine, reportJob, request, service, serviceRevision, user,
  type PayoutLineStatus, type ServiceStatus,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { date, dateNumeric, money, monthName, sofiaDate, type DateStr } from '@/lib/format';
import { isSystem, type AnyActor } from './actor';
import { audit } from './audit';
import { DomainError, NotFoundError, displayPhone, hashToken, mail, mediaUrl, partnerOf, partnerRecipient, withTx } from './catalogue-kit';
import { getPreferences } from './clients';
import { deletionBlockers, fromPrice, nameChangeWindow, POLICY_FREE_DAYS } from './partners';
import { overview as payoutOverview } from './payout-accounts';
import { partnerEarnings } from './payouts';
import { partnerReviews, ratingSummary } from './reviews';
import { SERVICE_KIND_LABEL, SERVICE_STATUS_LABEL, listForPartner, snapshot } from './services';
import { getSetting } from './settings';

// ── Small display helpers ────────────────────────────────────────────────

/** ‹преди 4 дни› / ‹преди 4 месеца› / ‹току-що› for a past instant. */
export function ago(at: Date, nowAt: Date): string {
  const mins = Math.max(0, Math.floor((nowAt.getTime() - at.getTime()) / 60_000));
  if (mins < 1) return 'току-що';
  if (mins < 60) return `преди ${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? 'преди 1 час' : `преди ${hours} часа`;
  const days = Math.floor(hours / 24);
  if (days < 31) return days === 1 ? 'преди 1 ден' : `преди ${days} дни`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return months === 1 ? 'преди 1 месец' : `преди ${months} месеца`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'преди 1 година' : `преди ${years} години`;
}

/** Whole euros with grouped thousands: 385200 → ‹3 852› (hero figures; the € sign is set apart in the markup). */
export function euros(cents: number): string {
  return String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** ‹BG•• •••• •••• 5272› — only the last four digits are ever known to the screens. */
export const ibanMask = (last4: string) => `BG•• •••• •••• ${last4}`;

/** ‹1 450 €›, ‹28 € на гост› on the service cards (the cards drop the cents like the prototype). */
export function cardPrice(s: { kind: string; priceCents: number | null; priceUnit: string }): string | null {
  if (s.kind === 'on_request' || s.priceCents == null) return null;
  return `${euros(s.priceCents)} €${s.priceUnit === 'per_guest' ? ' на гост' : ''}`;
}

/** Event-type chip label: the capitalised plural (‹Сватби›), or the name when there is none (‹Друго›). */
export const eventTypeChip = (t: { name: string; namePluralLower: string }) =>
  t.namePluralLower ? t.namePluralLower.charAt(0).toLocaleUpperCase('bg') + t.namePluralLower.slice(1) : t.name;

/** Bulgarian banks offered in ‹Изберете банка›. */
export const BANKS = [
  'Алианц Банк България', 'Банка ДСК', 'Българо-американска кредитна банка', 'Българска банка за развитие', 'Инвестбанк',
  'Интернешънъл Асет Банк', 'Обединена българска банка', 'Общинска банка', 'Първа инвестиционна банка', 'Postbank',
  'ПроКредит Банк', 'Тексим Банк', 'ТИ БИ АЙ Банк', 'Токуда Банк', 'Търговска банка Д', 'УниКредит Булбанк',
  'Централна кооперативна банка',
] as const;

// ── /partner/uslugi ──────────────────────────────────────────────────────

export type ServicesTab = 'active' | 'draft' | 'archived' | 'review';
export const SERVICES_TAB_PARAM: Record<string, ServicesTab> = { aktivni: 'active', chernovi: 'draft', arhiv: 'archived', 'v-pregled': 'review' };

export async function servicesPage(actor: AnyActor, a: { tab: ServicesTab; categorySlug?: string | null }, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const all = await listForPartner(actor, {}, q);
  const covers = await coverUrls(q, all.items.map(i => i.service.coverMediaId));
  const catIds = [...new Set([p.primaryCategoryId, ...all.items.map(i => i.service.categoryId)].filter(Boolean) as string[])];
  const cats = catIds.length ? await q.select({ id: category.id, slug: category.slug, name: category.name, sortOrder: category.sortOrder })
    .from(category).where(inArray(category.id, catIds)).orderBy(asc(category.sortOrder)) : [];
  const chosen = a.categorySlug ? cats.find(c => c.slug === a.categorySlug) ?? null : null;
  const at = await now();
  const items = all.items
    .filter(i => i.tab === a.tab && (!chosen || i.service.categoryId === chosen.id))
    .map(i => ({
      id: i.service.id, name: i.service.name, description: i.service.description, kind: i.service.kind, kindLabel: i.kindLabel,
      status: i.service.status, statusLabel: i.statusLabel, price: cardPrice(i.service),
      bookings: i.bookingsCount, inquiries: i.inquiriesCount, coverUrl: covers.get(i.service.coverMediaId ?? '') ?? null,
      pendingRevision: !!i.pendingRevision,
    }));
  return {
    slug: p.slug, items, counts: all.counts, categories: cats, category: chosen,
    order: all.items.map(i => i.service.id),
    lastChange: all.lastChange ? ago(all.lastChange, at) : null,
  };
}

async function coverUrls(q: Queryable, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter(Boolean) as string[])];
  if (!want.length) return new Map();
  const rows = await q.select({ id: media.id, key: media.storageKey }).from(media).where(inArray(media.id, want));
  return new Map(rows.map(r => [r.id, mediaUrl(r.key)!]));
}

// ── /partner/uslugi/nova and /partner/uslugi/[id] ─────────────────────────

/** What every service editor needs: categories, event types, the gallery to pick a cover from, the base city. */
export async function editorOptions(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const cats = await q.select({ id: category.id, name: category.name }).from(category).where(eq(category.isVisible, true)).orderBy(asc(category.sortOrder));
  const types = await q.select({ id: eventType.id, name: eventType.name, namePluralLower: eventType.namePluralLower })
    .from(eventType).orderBy(asc(eventType.sortOrder));
  const gallery = await galleryOf(q, p.id);
  const [c] = p.cityId ? await q.select({ name: city.name }).from(city).where(eq(city.id, p.cityId)) : [];
  return {
    partnerId: p.id, slug: p.slug, primaryCategoryId: p.primaryCategoryId,
    categories: cats, eventTypes: types.map(t => ({ id: t.id, label: eventTypeChip(t) })),
    gallery: gallery.map(g => ({ mediaId: g.mediaId, url: g.url })), cityName: c?.name ?? null,
    canPublish: p.status === 'approved',
  };
}

async function galleryOf(q: Queryable, partnerId: string) {
  const rows = await q.select({ id: partnerPhoto.id, mediaId: partnerPhoto.mediaId, position: partnerPhoto.position, key: media.storageKey })
    .from(partnerPhoto).innerJoin(media, eq(media.id, partnerPhoto.mediaId))
    .where(eq(partnerPhoto.partnerId, partnerId)).orderBy(asc(partnerPhoto.position));
  return rows.map(r => ({ id: r.id, mediaId: r.mediaId, position: r.position, url: mediaUrl(r.key)! }));
}

export type EditorValues = {
  kind: 'package_fixed' | 'on_request' | 'addon';
  name: string;
  categoryId: string;
  description: string;
  eventTypeIds: string[];
  inclusions: string[];
  priceCents: number | null;
  priceUnit: 'per_event' | 'per_guest';
  minGuests: number | null;
  durationLabel: string;
  extraHourEnabled: boolean;
  extraHourPriceCents: number | null;
  travelFeeEnabled: boolean;
  coverMediaId: string | null;
  showInProfile: boolean;
  acceptingRequests: boolean;
};

/**
 * `/partner/uslugi/[id]`: the service (own only, else null → 404), the editor values — the live
 * version, overlaid with the latest edit revision while it is pending or was returned, so the
 * partner keeps working on what they sent — the counts, the revision note and the status.
 */
export async function serviceEditor(actor: AnyActor, serviceId: string, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  if (!/^[0-9a-f-]{36}$/i.test(serviceId)) return null;
  const [s] = await q.select().from(service).where(and(eq(service.id, serviceId), eq(service.partnerId, p.id)));
  if (!s) return null;
  const live = await snapshot(q, s);
  const [latest] = await q.select().from(serviceRevision).where(eq(serviceRevision.serviceId, s.id)).orderBy(desc(serviceRevision.submittedAt)).limit(1);
  const overlay: Record<string, unknown> = {};
  if (latest && latest.type === 'edit' && (latest.status === 'pending' || latest.status === 'returned')) {
    for (const [k, v] of Object.entries(latest.payload as Record<string, [unknown, unknown]>)) overlay[k] = v[1];
  }
  const v = { ...live, ...overlay } as Record<string, unknown>;
  const values: EditorValues = {
    kind: v.kind as EditorValues['kind'], name: String(v.name ?? ''), categoryId: String(v.categoryId ?? ''), description: String(v.description ?? ''),
    eventTypeIds: (v.eventTypeIds as string[] | undefined) ?? [], inclusions: (v.inclusions as string[] | undefined) ?? [],
    priceCents: (v.priceCents as number | null) ?? null, priceUnit: (v.priceUnit as EditorValues['priceUnit']) ?? 'per_event',
    minGuests: (v.minGuests as number | null) ?? null, durationLabel: String(v.durationLabel ?? ''),
    extraHourEnabled: !!v.extraHourEnabled, extraHourPriceCents: (v.extraHourPriceCents as number | null) ?? null,
    travelFeeEnabled: !!v.travelFeeEnabled, coverMediaId: (v.coverMediaId as string | null) ?? null,
    showInProfile: s.showInProfile, acceptingRequests: s.acceptingRequests,
  };
  const [[{ n: bookings }], [{ n: inquiries }]] = await Promise.all([
    q.select({ n: count() }).from(booking).where(and(eq(booking.serviceId, s.id), inArray(booking.status, ['confirmed', 'completed']))),
    q.select({ n: count() }).from(request).where(eq(request.serviceId, s.id)),
  ]);
  const covers = await coverUrls(q, [s.coverMediaId, values.coverMediaId]);
  const [cat] = await q.select({ name: category.name }).from(category).where(eq(category.id, s.categoryId));
  const published = !!s.publishedAt;
  const mode: 'edit' | 'draft' | 'review' | 'archived' =
    s.status === 'archived' ? 'archived' : s.status === 'active' || (s.status === 'draft' && published) ? 'edit' : s.status === 'pending_review' ? 'review' : 'draft';
  return {
    id: s.id, status: s.status as ServiceStatus, mode, published,
    statusLabel: s.status === 'active' && latest?.status === 'pending' ? 'Активна · промените чакат преглед' : SERVICE_STATUS_LABEL[s.status],
    liveName: s.name, liveKindLabel: SERVICE_KIND_LABEL[s.kind], liveCategory: cat?.name ?? '', livePrice: s.kind === 'on_request' ? null : cardPrice(s),
    liveCoverUrl: covers.get(s.coverMediaId ?? '') ?? null, coverUrl: covers.get(values.coverMediaId ?? '') ?? null,
    activeSince: s.publishedAt ? `${monthName(Number(sofiaDate(s.publishedAt).slice(5, 7)))} ${sofiaDate(s.publishedAt).slice(0, 4)}` : null,
    bookings, inquiries, values,
    revision: latest && (latest.status === 'pending' || latest.status === 'returned') ? { status: latest.status, type: latest.type, note: latest.note } : null,
  };
}

/** ‹Умения и специализации› suggestions besides the event types (SPEC §15); anything else is ‹Друго› (free text). */
export const TAG_SUGGESTIONS = ['Озвучаване', 'Диско осветление', 'Годежи', 'Моминско парти', 'Ергенско парти', 'Парти изненада', 'Кръщенета', 'Тематични партита'] as const;

// ── /partner/profil ──────────────────────────────────────────────────────

export async function profilePage(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const at = await now();
  const [cat] = p.primaryCategoryId ? await q.select({ name: category.name }).from(category).where(eq(category.id, p.primaryCategoryId)) : [];
  const cities = await q.select({ id: city.id, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder));
  const types = await q.select({ id: eventType.id, name: eventType.name, namePluralLower: eventType.namePluralLower }).from(eventType).orderBy(asc(eventType.sortOrder));
  const own = await q.select({ id: partnerEventType.eventTypeId }).from(partnerEventType).where(eq(partnerEventType.partnerId, p.id));
  const tags = await q.select({ label: partnerTag.label, isCustom: partnerTag.isCustom }).from(partnerTag).where(eq(partnerTag.partnerId, p.id)).orderBy(asc(partnerTag.label));
  const gallery = await galleryOf(q, p.id);
  const win = await nameChangeWindow(p, q);
  const reviews = await ratingSummary(p.id, q);
  const fp = fromPrice(p);
  return {
    slug: p.slug, businessName: p.businessName, categoryName: cat?.name ?? '', updatedAgo: ago(p.updatedAt, at),
    nameWindow: { lastChangedOn: win.lastChangedOn ? date(win.lastChangedOn).replace(/ \d{4}$/, '') : null, nextFrom: win.nextFrom ? date(win.nextFrom).replace(/ \d{4}$/, '') : null },
    description: p.description ?? '', socialHandle: p.socialHandle ?? '',
    cityId: p.cityId, cities, radius: p.servesNationwide ? 'nationwide' as const : (p.serviceRadiusKm ?? 150) as 50 | 100 | 150,
    eventTypes: types.map(t => ({ id: t.id, label: eventTypeChip(t) })), eventTypeIds: own.map(o => o.id),
    tags: tags.map(t => ({ label: t.label, isCustom: t.isCustom })),
    gallery, galleryMin: await getSetting('partner.gallery_min', undefined, q), galleryMax: await getSetting('partner.gallery_max', undefined, q),
    policy: p.cancellationPolicy, policyFreeDays: POLICY_FREE_DAYS,
    isListed: p.isListed, acceptingRequests: p.acceptingRequests,
    rating: reviews ? { text: reviews.avgText, rounded: Math.round(reviews.avg), countLabel: reviews.countLabel } : null,
    fromPrice: fp ? { amount: euros(fp.cents), unitLabel: fp.unitLabel } : null,
  };
}

// ── /partner/revyuta ─────────────────────────────────────────────────────

export type ReviewsTab = 'all' | 'unanswered' | 'five';
export const REVIEWS_TAB_PARAM: Record<string, ReviewsTab> = { 'bez-otgovor': 'unanswered', '5-zvezdi': 'five' };

export async function reviewsPage(actor: AnyActor, a: { tab: ReviewsTab; page: number }, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const summary = await ratingSummary(p.id, q);
  const list = await partnerReviews(p.id, { tab: a.tab, page: 1, perPage: 10 * Math.max(1, a.page) }, q);
  return {
    slug: p.slug, responsiveness: p.responsivenessPct, summary,
    counts: { all: summary?.count ?? 0, unanswered: list.unanswered, five: summary?.distribution.find(d => d.stars === 5)?.count ?? 0 },
    items: list.items.map(r => ({
      id: r.id, author: r.author, rating: r.rating, body: r.body, reply: r.reply,
      meta: [r.eventType, date(r.eventDate), r.serviceLabel].filter(Boolean).join(' · '),
    })),
    hasMore: list.hasMore,
  };
}

// ── /partner/prihodi ─────────────────────────────────────────────────────

const LINE_LABEL: Record<PayoutLineStatus, { label: string; tone: 'pink' | 'success' } | null> = {
  awaiting_event: { label: 'Очаква събитие', tone: 'pink' }, ready: { label: 'Очаква събитие', tone: 'pink' },
  held: { label: 'Очаква събитие', tone: 'pink' }, released_early: { label: 'Очаква събитие', tone: 'pink' },
  in_batch: { label: 'Очаква събитие', tone: 'pink' }, paid: { label: 'Изплатено', tone: 'success' }, cancelled: null,
};

/** ‹Ивелина Т.› */
const shortName = (name: string) => {
  const words = name.trim().split(/\s+/);
  // ‹Ивелина Тодорова› → ‹Ивелина Т.›; anything else (‹Петя и Николай›, a company) stays whole.
  return words.length === 2 && words.every(w => /^\p{Lu}/u.test(w)) ? `${words[0]} ${words[1].charAt(0)}.` : name.trim();
};

const SHORT_MONTHS = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];

export const EARNINGS_PER_PAGE = 10;

export async function earningsPage(actor: AnyActor, a: { page: number }, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const e = await partnerEarnings(p.id, {}, q);
  const conds = and(eq(payoutLine.partnerId, p.id), ne(payoutLine.status, 'cancelled'));
  const [{ n: total }] = await q.select({ n: count() }).from(payoutLine).where(conds);
  const pages = Math.max(1, Math.ceil(total / EARNINGS_PER_PAGE));
  const page = Math.min(Math.max(1, a.page), pages);
  const rows = await q.select({
    id: payoutLine.id, status: payoutLine.status, amount: payoutLine.amountCents, number: booking.number, eventDate: booking.eventDate,
    serviceTitle: booking.serviceTitle, typeName: eventType.name, hosts: clientEvent.hosts, clientName: user.name,
  }).from(payoutLine)
    .innerJoin(booking, eq(booking.id, payoutLine.bookingId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .where(conds).orderBy(desc(booking.eventDate), desc(payoutLine.id))
    .limit(EARNINGS_PER_PAGE).offset((page - 1) * EARNINGS_PER_PAGE);
  const acc = await payoutOverview(actor, q);
  const [y, m] = e.month.month.split('-').map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const max = Math.max(...e.month.bars.map(b => b.cents), 0);
  return {
    month: { label: `${monthName(m)} ${y}`, monthName: monthName(m), cents: e.month.cents, deltaPct: e.month.deltaPct, prevMonthName: monthName(prevM) },
    bars: e.month.bars.map((b, i, arr) => ({
      label: SHORT_MONTHS[Number(b.month.slice(5, 7)) - 1], pct: max > 0 ? Math.max(4, Math.round((b.cents / max) * 100)) : 4, isNow: i === arr.length - 1,
    })),
    toBePaidCents: e.toBePaidCents, paidYear: e.paidYear,
    lines: rows.map(r => ({
      id: r.id, number: r.number, date: dateNumeric(r.eventDate), event: `${r.typeName} · ${r.hosts?.trim() || shortName(r.clientName)}`,
      sub: r.serviceTitle, amount: money(r.amount), badge: LINE_LABEL[r.status]!,
    })),
    page, pages,
    account: acc.confirmed ? { holder: acc.confirmed.holderName, masked: ibanMask(acc.confirmed.ibanLast4), bank: acc.confirmed.bankName } : null,
    pendingAccount: acc.pending ? { masked: ibanMask(acc.pending.ibanLast4), bank: acc.pending.bankName } : null,
    latestReport: await latestEarningsReport(actor, q),
  };
}

/** The partner's most recent ready earnings report (the email's ‹Изтегли справката› lands on /partner/prihodi). */
async function latestEarningsReport(actor: AnyActor, q: Queryable) {
  if (isSystem(actor)) return null;
  const p = await partnerOf(actor, q);
  const [r] = await q.select({ id: reportJob.id }).from(reportJob)
    .where(and(eq(reportJob.partnerId, p.id), eq(reportJob.kind, 'partner_earnings'), eq(reportJob.status, 'ready'))).orderBy(desc(reportJob.createdAt)).limit(1);
  return r?.id ?? null;
}

/**
 * ‹Изтегли справка› (`reports.request('partner_earnings')`): a report job for the current month
 * (ready at once — the CSV is produced on download) and `vendor-report-ready`.
 * Toast ‹Справката се подготвя — ще я получите по имейл›.
 */
export async function requestEarningsReport(actor: AnyActor, tx?: Tx): Promise<{ reportId: string }> {
  return withTx(tx, async t => {
    if (isSystem(actor)) throw new DomainError('forbidden');
    const p = await partnerOf(actor, t);
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    const at = await now();
    const e = await partnerEarnings(p.id, { at }, t);
    const [y, m] = e.month.month.split('-').map(Number);
    const [r] = await t.insert(reportJob).values({
      kind: 'partner_earnings', requestedBy: actor.userId, partnerId: p.id, params: { month: e.month.month }, status: 'ready', createdAt: at, readyAt: at,
    }).returning();
    const rec = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-report-ready', to: rec.email, toUserId: rec.userId, dedupeKey: `report:${r.id}`,
      vars: {
        partnerName: p.businessName, period: `${monthName(m)} ${y}`, revenue: money(e.month.cents), toPay: money(e.toBePaidCents),
        paidYear: e.paidYear.year, paidInYear: money(e.paidYear.cents),
      },
    });
    await audit(t, { actor, action: 'report.requested', entity: 'report_job', entityId: r.id, data: { kind: 'partner_earnings', month: e.month.month } });
    return { reportId: r.id };
  });
}

/** CSV of a ready earnings report (own reports only): one row per payout line. */
export async function earningsReportCsv(actor: AnyActor, reportId: string, q: Queryable = db): Promise<{ filename: string; csv: string } | null> {
  if (isSystem(actor) || !/^[0-9a-f-]{36}$/i.test(reportId)) return null;
  const p = await partnerOf(actor, q);
  const [r] = await q.select().from(reportJob).where(and(eq(reportJob.id, reportId), eq(reportJob.partnerId, p.id), eq(reportJob.kind, 'partner_earnings')));
  if (!r || r.status !== 'ready') return null;
  const e = await partnerEarnings(p.id, {}, q);
  const rows = await q.select({
    status: payoutLine.status, amount: payoutLine.amountCents, paidAt: payoutLine.paidAt, number: booking.number, eventDate: booking.eventDate,
    serviceTitle: booking.serviceTitle, typeName: eventType.name, hosts: clientEvent.hosts, clientName: user.name,
  }).from(payoutLine)
    .innerJoin(booking, eq(booking.id, payoutLine.bookingId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .where(and(eq(payoutLine.partnerId, p.id), ne(payoutLine.status, 'cancelled'))).orderBy(desc(booking.eventDate));
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvMoney = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  const out = [
    ['Приходи', money(e.month.cents)].map(cell).join(';'),
    ['За изплащане', money(e.toBePaidCents)].map(cell).join(';'),
    [`Изплатени за ${e.paidYear.year}`, money(e.paidYear.cents)].map(cell).join(';'),
    '',
    ['Дата', 'Резервация', 'Събитие', 'Услуга', 'Получавате', 'Статус', 'Изплатено на'].map(cell).join(';'),
    ...rows.map(x => [
      dateNumeric(x.eventDate), x.number, `${x.typeName} · ${x.hosts?.trim() || shortName(x.clientName)}`, x.serviceTitle,
      csvMoney(x.amount), LINE_LABEL[x.status]?.label ?? '', x.paidAt ? dateNumeric(x.paidAt) : '',
    ].map(cell).join(';')),
  ];
  return { filename: `prihodi-${String(r.params && (r.params as { month?: string }).month || sofiaDate(r.createdAt).slice(0, 7))}.csv`, csv: `﻿${out.join('\r\n')}\r\n` };
}

// ── /partner/smetka ──────────────────────────────────────────────────────

export async function payoutAccountPage(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const o = await payoutOverview(actor, q);
  return {
    legalName: p.legalName, eik: p.eik, heldCents: o.heldCents, provider: o.provider, providerStatus: o.providerStatus,
    confirmed: o.confirmed ? { ...o.confirmed, masked: ibanMask(o.confirmed.ibanLast4) } : null,
    pending: o.pending ? { ...o.pending, masked: ibanMask(o.pending.ibanLast4) } : null,
  };
}

// ── /partner/nastroyki ───────────────────────────────────────────────────

export async function settingsPage(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  if (isSystem(actor)) throw new DomainError('forbidden');
  const at = await now();
  const [u] = await q.select({ email: user.email, locale: user.locale, passwordChangedAt: user.passwordChangedAt }).from(user).where(eq(user.id, actor.userId));
  const [cred] = await q.select({ updatedAt: account.updatedAt }).from(account)
    .where(and(eq(account.userId, actor.userId), eq(account.providerId, 'credential'))).limit(1);
  const pw = u?.passwordChangedAt ?? cred?.updatedAt ?? null;
  const win = await nameChangeWindow(p, q);
  const prefs = await getPreferences(actor, q);
  const blockers = await deletionBlockers(q, p.id);
  const o = await payoutOverview(actor, q);
  const short = (d: DateStr | null) => (d ? date(d).replace(/ \d{4}$/, '') : null);
  return {
    status: p.status, businessName: p.businessName, contactName: p.contactName, notificationEmail: p.notificationEmail,
    phone: displayPhone(p.phone), eik: p.eik ?? '', socialHandle: p.socialHandle ?? '', locale: u?.locale ?? 'bg',
    nameWindow: { allowed: win.allowed, lastChangedOn: short(win.lastChangedOn), nextFrom: short(win.nextFrom) },
    passwordAgo: pw ? ago(pw, at) : null, hasPassword: !!cred,
    prefs: Object.fromEntries(prefs.map(x => [x.key, x.email])) as Record<string, boolean>,
    canDelete: blockers.upcomingBookings === 0 && blockers.openDisputes === 0,
    account: o.confirmed ? { holder: o.confirmed.holderName, masked: ibanMask(o.confirmed.ibanLast4), bank: o.confirmed.bankName } : null,
  };
}

/** ‹BG› on the language control: the user's interface language (‹EN› waits for ⚙ locale.en_enabled). */
export async function setLocale(actor: AnyActor, a: { locale: 'bg' | 'en' }, tx?: Tx) {
  if (isSystem(actor)) throw new DomainError('forbidden');
  return withTx(tx, async t => {
    if (a.locale === 'en' && !(await getSetting('locale.en_enabled', undefined, t))) throw new DomainError('locale_unavailable');
    await t.update(user).set({ locale: a.locale, updatedAt: await now() }).where(eq(user.id, actor.userId));
    await audit(t, { actor, action: 'user.locale_changed', entity: 'user', entityId: actor.userId, data: { locale: a.locale } });
  });
}

/**
 * ‹Потвърди изтриването›: whether the email link's token belongs to the signed-in user — a partner
 * signed in on a shared device must not confirm someone else's deletion with a forwarded link.
 */
export async function deletionTokenIsOwn(actor: AnyActor, token: string, q: Queryable = db): Promise<boolean> {
  if (isSystem(actor) || !token) return false;
  const [r] = await q.select({ userId: accountDeletionRequest.userId }).from(accountDeletionRequest)
    .where(eq(accountDeletionRequest.tokenHash, hashToken(token)));
  return !!r && r.userId === actor.userId;
}

// ── shared bits for the actions ──────────────────────────────────────────

/** The partner's own gallery photo (for the cover picker): returns its media id or throws. */
export async function ownGalleryMedia(actor: AnyActor, mediaId: string, q: Queryable = db): Promise<string> {
  const p = await partnerOf(actor, q);
  const [row] = await q.select({ id: partnerPhoto.mediaId }).from(partnerPhoto).where(and(eq(partnerPhoto.partnerId, p.id), eq(partnerPhoto.mediaId, mediaId)));
  if (!row) throw new NotFoundError('photo');
  return row.id;
}
