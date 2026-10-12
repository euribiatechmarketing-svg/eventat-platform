// Admin operations (SCREENS §8): dashboard, partners, moderation, clients,
// settings, team, invite acceptance and the admin search. Read models for those
// screens plus the few mutations the domain did not have yet (category editor,
// batched settings, demo clock, admin exports, invite acceptance with a password).
// Every money figure is gated by `view_finance` in the pages (SPEC §1.2).
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Queryable, type Tx } from '@/db';
import {
  account, adminNote, category, categorySubtype, city, metricsSnapshot, partner, partnerDecision, partnerPhoto, partnerSubtype, partnerTag,
  media, payoutAccount, reportJob, service, serviceRevision, teamInvite, user, type ReportKind,
} from '@/db/schema';
import { invalidateClock, now } from '@/lib/clock';
import { runDueJobs } from '@/lib/jobs';
import { deliverQueued } from '@/lib/email/send';
import { addDays, daysBetween, monthName, sofiaDate, sofiaInstant, sofiaParts, type DateStr } from '@/lib/format';
import { assertCan, can, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import { DomainError, NotFoundError, assertTeamMember, displayPhone, mediaUrl, withTx } from './catalogue-kit';
import { POLICY_FREE_DAYS, POLICY_LABEL, checksSummary, slugify } from './partners';
import { priceText } from './services';
import { acceptInvite, inviteByToken, ROLE_LABEL } from './team';
import { getSetting, getSettings, setSetting, SETTING_SCHEMAS, type SettingKey, type SettingValue } from './settings';

// ── Small shared helpers ─────────────────────────────────────────────────

const int = (v: unknown) => Number(v ?? 0) || 0;
/** Raw-SQL timestamptz values arrive as text ('2025-08-31 05:50:00+00') through the Drizzle driver. */
export function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  const s = String(v).trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  return new Date(s);
}
const toDateOrNull = (v: unknown) => (v == null ? null : toDate(v));
const lower = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('bg');
/** Case-insensitive Bulgarian substring match over several fields (the collation may not fold Cyrillic). */
export function matches(needle: string | null | undefined, ...fields: (string | null | undefined)[]): boolean {
  const n = lower(needle).trim();
  if (!n) return true;
  return fields.some(f => lower(f).includes(n));
}

/** Booking states as the admin sees them (SPEC §4.7). */
export const BOOKING_ADMIN: Record<string, { label: string; tone: string }> = {
  awaiting_payment: { label: 'Чака плащане', tone: 'pink' },
  confirmed: { label: 'Платена', tone: 'success' },
  cancellation_requested: { label: 'Искане за анулиране', tone: 'warning' },
  completed: { label: 'Приключила', tone: '' },
  payment_expired: { label: 'Изтекъл срок за плащане', tone: '' },
  approval_withdrawn: { label: 'Оттеглено одобрение', tone: '' },
  cancelled: { label: 'Анулирана', tone: 'danger' },
};

/** Partner states as the admin sees them (SPEC §4.2). */
export const PARTNER_ADMIN: Record<string, { label: string; tone: string }> = {
  submitted: { label: 'Чака', tone: 'warning' },
  returned: { label: 'Върнат за поправка', tone: 'warning' },
  rejected: { label: 'Отказан', tone: 'danger' },
  approved: { label: 'Активен', tone: 'success' },
  deactivated: { label: 'Деактивиран', tone: '' },
  draft: { label: 'Чернова', tone: '' },
  deleted: { label: 'Изтрит профил', tone: '' },
};

/** Request states for the admin client profile (SPEC §4.5). */
export function requestAdminLabel(r: { status: string; declineReason: string | null; bookingStatus: string | null }): { label: string; tone: string } {
  if (r.bookingStatus) return BOOKING_ADMIN[r.bookingStatus] ?? { label: '', tone: '' };
  switch (r.status) {
    case 'pending': return { label: 'Чака отговор', tone: 'primary' };
    case 'offer_sent': return { label: 'Нова оферта', tone: 'primary' };
    case 'awaiting_confirmation': return { label: 'Избрана оферта', tone: 'primary' };
    case 'declined': return r.declineReason === 'date_taken' ? { label: 'Датата е заета', tone: 'danger' } : { label: 'Отказана', tone: 'danger' };
    case 'expired': return { label: 'Изтекла', tone: '' };
    default: return { label: '', tone: '' };
  }
}

export const EXPERIENCE_LABEL: Record<string, string> = {
  lt_1: 'До 1 година', y1_3: '1 – 3 години', y3_5: '3 – 5 години', y5_10: '5 – 10 години', gt_10: 'Над 10 години',
};

/** Check labels: the queue side panel and the application page (SPEC §4.2 profile checks). */
export const CHECK_LIST_LABEL: Record<string, string> = {
  company: 'Данни за фирмата', contacts: 'Контакти', gallery: 'Галерия', services: 'Услуги и цени', cancellation_policy: 'Политика за анулиране', bank_account: 'Банкова сметка',
};
export const CHECK_DETAIL_LABEL: Record<string, string> = {
  company: 'ЕИК проверен', contacts: 'Контакти потвърдени', gallery: 'Собствени снимки', services: 'Услуги и цени', cancellation_policy: 'Политика за анулиране', bank_account: 'Банкова сметка',
};
export const TEAM_CHECKS = ['company', 'contacts', 'gallery'] as const;
export type TeamCheck = (typeof TEAM_CHECKS)[number];

/** ‹Умерена · безплатно до 30 дни› / ‹Строга · депозитът не се връща› (SPEC §5.5). */
export function policyLine(policy: keyof typeof POLICY_LABEL | null): { name: string; detail: string } | null {
  if (!policy) return null;
  const days = POLICY_FREE_DAYS[policy];
  return { name: POLICY_LABEL[policy], detail: days != null ? `безплатно до ${days} дни` : 'депозитът не се връща' };
}

// ── Periods ──────────────────────────────────────────────────────────────

export type PeriodKind = 'month' | 'quarter' | 'year';
export const PERIODS: PeriodKind[] = ['month', 'quarter', 'year'];

const ymd = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
function shiftMonths(d: DateStr, n: number): DateStr {
  const [y, m] = d.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return ymd(Math.floor(t / 12), (t % 12) + 1);
}

export type Period = { kind: PeriodKind; from: DateStr; to: DateStr; prevFrom: DateStr; prevTo: DateStr; title: string; prevLabel: string; year: number };

/** The current month / quarter / year in Sofia, its predecessor and their display names. */
export function periodOf(kind: PeriodKind, today: DateStr): Period {
  const [y, m] = today.split('-').map(Number);
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase('bg') + s.slice(1);
  if (kind === 'year') {
    return { kind, from: ymd(y, 1), to: ymd(y + 1, 1), prevFrom: ymd(y - 1, 1), prevTo: ymd(y, 1), title: String(y), prevLabel: String(y - 1), year: y };
  }
  if (kind === 'quarter') {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    const from = ymd(y, qm), to = shiftMonths(from, 3), prevFrom = shiftMonths(from, -3);
    const span = (start: DateStr) => {
      const [sy, sm] = start.split('-').map(Number);
      const end = shiftMonths(start, 2).split('-').map(Number);
      return `${monthName(sm)} – ${monthName(end[1])} ${end[0] === sy ? sy : end[0]}`;
    };
    return { kind, from, to, prevFrom, prevTo: from, title: cap(span(from)), prevLabel: span(prevFrom), year: y };
  }
  const from = ymd(y, m), to = shiftMonths(from, 1), prevFrom = shiftMonths(from, -1);
  return { kind, from, to, prevFrom, prevTo: from, title: `${cap(monthName(m))} ${y}`, prevLabel: monthName(Number(prevFrom.split('-')[1])), year: y };
}

const inst = (d: DateStr) => sofiaInstant(d, 0, 0).toISOString();

// ── Dashboard (/admin) ───────────────────────────────────────────────────

export type DashboardMetrics = {
  v: 2;
  gmv: number; commission: number; bookings: number; prevGmv: number; prevBookings: number;
  activePartners: number; registeredPartners: number;
  months: { start: DateStr; gmv: number }[];
  requests: number; converted: number; answeredOnTime: number; answerable: number; cancelled: number;
  avgReview: number | null; seasonShare: number | null;
};

async function computeMetrics(p: Period, at: Date, q: Queryable): Promise<DashboardMetrics> {
  const [k] = await q.execute<Record<string, string | null>>(sql`
    select
      (select coalesce(sum(amount_cents), 0) from booking where paid_at >= ${inst(p.from)}::timestamptz and paid_at < ${inst(p.to)}::timestamptz) as gmv,
      (select coalesce(sum(floor((amount_cents::bigint * commission_bp + 5000) / 10000)), 0) from booking where paid_at >= ${inst(p.from)}::timestamptz and paid_at < ${inst(p.to)}::timestamptz) as commission,
      (select count(*) from booking where paid_at >= ${inst(p.from)}::timestamptz and paid_at < ${inst(p.to)}::timestamptz) as bookings,
      (select count(*) from booking where paid_at >= ${inst(p.from)}::timestamptz and paid_at < ${inst(p.to)}::timestamptz and status = 'cancelled') as cancelled,
      (select coalesce(sum(amount_cents), 0) from booking where paid_at >= ${inst(p.prevFrom)}::timestamptz and paid_at < ${inst(p.prevTo)}::timestamptz) as prev_gmv,
      (select count(*) from booking where paid_at >= ${inst(p.prevFrom)}::timestamptz and paid_at < ${inst(p.prevTo)}::timestamptz) as prev_bookings,
      (select count(*) from partner where status = 'approved') as active_partners,
      (select count(*) from partner where status <> 'deleted' and deleted_at is null) as registered_partners,
      (select count(*) from request where sent_at >= ${inst(p.from)}::timestamptz and sent_at < ${inst(p.to)}::timestamptz) as requests,
      (select count(*) from request r where r.sent_at >= ${inst(p.from)}::timestamptz and r.sent_at < ${inst(p.to)}::timestamptz
         and exists (select 1 from booking b where b.request_id = r.id and b.paid_at is not null)) as converted,
      (select count(*) from request r where r.sent_at >= ${inst(p.from)}::timestamptz and r.sent_at < ${inst(p.to)}::timestamptz
         and r.kind in ('package', 'quote') and (r.answered_at is not null or r.response_due_at <= ${at.toISOString()}::timestamptz)) as answerable,
      (select count(*) from request r where r.sent_at >= ${inst(p.from)}::timestamptz and r.sent_at < ${inst(p.to)}::timestamptz
         and r.kind in ('package', 'quote') and r.answered_at is not null and r.answered_at <= r.response_due_at and r.status <> 'expired') as answered_on_time,
      (select avg(rating_overall)::float from review where published_at < ${inst(p.to)}::timestamptz) as avg_review,
      (select case when coalesce(sum(amount_cents), 0) = 0 then null
         else round(100.0 * coalesce(sum(amount_cents) filter (where extract(month from event_date) between 5 and 9), 0) / sum(amount_cents)) end
       from booking where paid_at is not null and status <> 'cancelled') as season_share`);
  const months: { start: DateStr; gmv: number }[] = [];
  const end = `${sofiaDate(at).slice(0, 7)}-01`;
  for (let i = 5; i >= 0; i--) {
    const start = shiftMonths(end, -i);
    const [r] = await q.execute<{ gmv: string }>(sql`
      select coalesce(sum(amount_cents), 0) as gmv from booking where paid_at >= ${inst(start)}::timestamptz and paid_at < ${inst(shiftMonths(start, 1))}::timestamptz`);
    months.push({ start, gmv: int(r.gmv) });
  }
  return {
    v: 2,
    gmv: int(k.gmv), commission: int(k.commission), bookings: int(k.bookings), prevGmv: int(k.prev_gmv), prevBookings: int(k.prev_bookings),
    activePartners: int(k.active_partners), registeredPartners: int(k.registered_partners),
    months, requests: int(k.requests), converted: int(k.converted), answeredOnTime: int(k.answered_on_time), answerable: int(k.answerable),
    cancelled: int(k.cancelled), avgReview: k.avg_review == null ? null : Number(k.avg_review), seasonShare: k.season_share == null ? null : Number(k.season_share),
  };
}

/** metrics_snapshot is refreshed when older than 15 minutes (DATA-MODEL §2.18); ‹обновено преди N минути› reads refreshed_at. */
export const METRICS_TTL_MS = 15 * 60_000;

/** The money figures of the dashboard: turnover (GMV), commission, turnover by month, the season's share of turnover. */
export type DashboardMoney = Pick<DashboardMetrics, 'gmv' | 'prevGmv' | 'commission' | 'months' | 'seasonShare'>;
/** The figures every team member sees. */
export type DashboardCounts = Omit<DashboardMetrics, 'v' | keyof DashboardMoney>;

/**
 * /admin KPIs for a team member. `money` (DashboardMoney) is null without `view_finance`: the
 * function leaves those figures out itself rather than trusting the page to hide them (SPEC §1.2).
 */
export async function dashboardMetrics(actor: AnyActor, kind: PeriodKind, q: Queryable = db): Promise<{ period: Period; data: DashboardCounts; money: DashboardMoney | null; refreshedAt: Date }> {
  assertTeamMember(actor);
  const { period, data, refreshedAt } = await metricsSnapshotFor(kind, q);
  const { v: _v, gmv, prevGmv, commission, months, seasonShare, ...counts } = data;
  return { period, data: counts, money: can(actor, 'view_finance') ? { gmv, prevGmv, commission, months, seasonShare } : null, refreshedAt };
}

async function metricsSnapshotFor(kind: PeriodKind, q: Queryable): Promise<{ period: Period; data: DashboardMetrics; refreshedAt: Date }> {
  const at = await now();
  const period = periodOf(kind, sofiaDate(at));
  const [snap] = await q.select().from(metricsSnapshot)
    .where(and(eq(metricsSnapshot.periodKind, kind), eq(metricsSnapshot.periodStart, period.from), sql`${metricsSnapshot.cityId} is null`)).limit(1);
  const fresh = snap && (snap.data as { v?: number }).v === 2 && at.getTime() - snap.refreshedAt.getTime() < METRICS_TTL_MS && snap.refreshedAt <= at;
  if (fresh) return { period, data: snap.data as DashboardMetrics, refreshedAt: snap.refreshedAt };
  const data = await computeMetrics(period, at, q);
  await withTx(undefined, async t => {
    await t.delete(metricsSnapshot).where(and(eq(metricsSnapshot.periodKind, kind), eq(metricsSnapshot.periodStart, period.from), sql`${metricsSnapshot.cityId} is null`));
    await t.insert(metricsSnapshot).values({ periodKind: kind, periodStart: period.from, cityId: null, data, refreshedAt: at });
  });
  return { period, data, refreshedAt: at };
}

/** ‹Топ категории› for the period, optionally in one city (booking city, else the partner's). Team; `gmv` only with view_finance. */
export async function topCategories(actor: AnyActor, p: Period, citySlug: string | null, limit = 4, q: Queryable = db) {
  assertTeamMember(actor);
  const finance = can(actor, 'view_finance');
  const rows = await q.execute<{ slug: string; name: string; n: number; gmv: string }>(sql`
    select c.slug, c.name, count(*)::int as n, coalesce(sum(b.amount_cents), 0) as gmv
    from booking b
    join partner p on p.id = b.partner_id
    left join service s on s.id = b.service_id
    join category c on c.id = coalesce(s.category_id, p.primary_category_id)
    left join city ci on ci.id = coalesce(b.city_id, p.city_id)
    where b.paid_at >= ${inst(p.from)}::timestamptz and b.paid_at < ${inst(p.to)}::timestamptz
      ${citySlug ? sql`and ci.slug = ${citySlug}` : sql``}
    group by c.slug, c.name
    order by sum(b.amount_cents) desc, count(*) desc, c.name
    limit ${limit}`);
  return rows.map(r => ({ slug: r.slug, name: r.name, bookings: r.n, gmv: finance ? int(r.gmv) : null }));
}

/** ‹Последни резервации›: the newest approvals, any state. Team; `commissionCents` only with view_finance. */
export async function latestBookings(actor: AnyActor, limit = 4, q: Queryable = db) {
  assertTeamMember(actor);
  const finance = can(actor, 'view_finance');
  const std = await getSetting('commission.standard_bp', undefined, q);
  const rows = await q.execute<{
    number: string; status: string; amount: number; bp: number | null; event_date: string; client: string; partner: string; category: string | null;
  }>(sql`
    select b.number, b.status, b.amount_cents as amount, b.commission_bp as bp, b.event_date::text as event_date,
      u.name as client, p.business_name as partner, c.name as category
    from booking b join "user" u on u.id = b.client_id join partner p on p.id = b.partner_id
    left join category c on c.id = p.primary_category_id
    order by b.approved_at desc, b.created_at desc
    limit ${limit}`);
  return rows.map(r => ({
    number: r.number, status: r.status, amountCents: r.amount, commissionCents: finance ? Math.floor((r.amount * (r.bp ?? std) + 5000) / 10000) : null,
    eventDate: r.event_date, clientName: r.client, partnerName: r.partner, categoryName: r.category ?? '',
  }));
}

/** ‹Нови регистрации›: the newest applications waiting for approval. */
export async function newestApplications(limit = 4, q: Queryable = db) {
  return q.select({ id: partner.id, name: partner.businessName, categoryName: category.name, cityName: city.name })
    .from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
    .where(eq(partner.status, 'submitted')).orderBy(desc(partner.submittedAt)).limit(limit);
}

/** Submitted-at of the oldest pending revision (the dashboard's moderation badge). */
export async function oldestPendingRevision(q: Queryable = db): Promise<Date | null> {
  const [r] = await q.select({ at: serviceRevision.submittedAt }).from(serviceRevision)
    .where(eq(serviceRevision.status, 'pending')).orderBy(asc(serviceRevision.submittedAt)).limit(1);
  return r?.at ?? null;
}

// ── Exports (D68: report_job + toast; the ready email needs a new key) ───

const EXPORT_PERMISSION: Partial<Record<ReportKind, 'approve_partners' | 'view_finance' | null>> = {
  admin_dashboard: null, admin_partners: 'approve_partners', admin_clients: null,
};

/** ‹Експорт› on an admin list: records the request (`report_job`) and the audit entry. */
export async function requestAdminExport(actor: AnyActor, a: { kind: 'admin_dashboard' | 'admin_partners' | 'admin_clients'; params?: Record<string, unknown> }, tx?: Tx) {
  assertTeamMember(actor);
  const perm = EXPORT_PERMISSION[a.kind];
  if (perm) assertCan(actor, perm);
  return withTx(tx, async t => {
    const [r] = await t.insert(reportJob).values({ kind: a.kind, requestedBy: actor.userId, params: a.params ?? {}, status: 'requested', createdAt: await now() }).returning();
    await audit(t, { actor, action: 'report.requested', entity: 'report_job', entityId: r.id, data: { kind: a.kind, ...(a.params ?? {}) } });
    return r;
  });
}

// ── Partners (/admin/partnyori) ──────────────────────────────────────────

export type PartnerTab = 'chakat' | 'aktivni' | 'deaktivirani';
const TAB_STATUS: Record<PartnerTab, 'submitted' | 'approved' | 'deactivated'> = { chakat: 'submitted', aktivni: 'approved', deaktivirani: 'deactivated' };

/** Bookings and turnover per partner (same rule as partners.adminTotals, for many partners at once). */
async function partnerTotals(ids: string[], q: Queryable): Promise<Map<string, { bookings: number; turnoverCents: number }>> {
  if (!ids.length) return new Map();
  const rows = await q.execute<{ partner_id: string; n: number; total: string }>(sql`
    select b.partner_id, count(*)::int as n, coalesce(sum(b.amount_cents), 0) as total from booking b
    left join cancellation c on c.booking_id = b.id
    where b.partner_id in (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)})
      and (b.status in ('confirmed', 'completed', 'cancellation_requested') or (b.status = 'cancelled' and coalesce(c.retained_cents, 0) > 0))
    group by b.partner_id`);
  return new Map(rows.map(r => [r.partner_id, { bookings: r.n, turnoverCents: int(r.total) }]));
}

export async function adminPartnerList(actor: AnyActor, a: { tab: PartnerTab; category?: string | null; city?: string | null; q?: string | null }, q: Queryable = db) {
  assertCan(actor, 'approve_partners');
  const counts = await q.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from partner where deleted_at is null group by status`);
  const n = (s: string) => counts.find(c => c.status === s)?.n ?? 0;
  const registered = counts.filter(c => c.status !== 'deleted').reduce((s, c) => s + c.n, 0);
  const status = TAB_STATUS[a.tab];
  const rows = await q.select({ p: partner, categoryName: category.name, categorySlug: category.slug, cityName: city.name, citySlug: city.slug })
    .from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
    .where(eq(partner.status, status))
    .orderBy(status === 'submitted' ? asc(partner.submittedAt) : desc(sql`coalesce(${partner.approvedAt}, ${partner.createdAt})`));
  const filtered = rows.filter(r => (!a.category || r.categorySlug === a.category) && (!a.city || r.citySlug === a.city)
    && matches(a.q, r.p.businessName, r.categoryName, r.cityName, r.p.contactName));
  const checks = new Map<string, number>();
  if (status === 'submitted') for (const r of filtered) checks.set(r.p.id, (await checksSummary(q, r.p.id)).ok);
  const totals = await partnerTotals(filtered.map(r => r.p.id), q);
  const list = filtered.map(r => ({
    id: r.p.id, name: r.p.businessName, contactName: r.p.contactName, categoryName: r.categoryName ?? '', cityName: r.cityName ?? '',
    status: r.p.status, submittedAt: r.p.submittedAt, checksOk: checks.get(r.p.id) ?? 0,
    bookings: totals.get(r.p.id)?.bookings ?? 0, turnoverCents: totals.get(r.p.id)?.turnoverCents ?? 0,
  }));
  let recent: typeof list = [];
  if (a.tab === 'chakat') {
    // the same filters as the queue, so a search or a filter never shows unrelated partners under it
    const ap = (await q.select({ p: partner, categoryName: category.name, categorySlug: category.slug, cityName: city.name, citySlug: city.slug })
      .from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
      .where(eq(partner.status, 'approved')).orderBy(desc(partner.approvedAt)))
      .filter(r => (!a.category || r.categorySlug === a.category) && (!a.city || r.citySlug === a.city)
        && matches(a.q, r.p.businessName, r.categoryName, r.cityName, r.p.contactName))
      .slice(0, 3);
    const t = await partnerTotals(ap.map(r => r.p.id), q);
    recent = ap.map(r => ({
      id: r.p.id, name: r.p.businessName, contactName: r.p.contactName, categoryName: r.categoryName ?? '', cityName: r.cityName ?? '',
      status: r.p.status, submittedAt: r.p.submittedAt, checksOk: 0,
      bookings: t.get(r.p.id)?.bookings ?? 0, turnoverCents: t.get(r.p.id)?.turnoverCents ?? 0,
    }));
  }
  const [oldest] = await q.select({ at: partner.submittedAt }).from(partner).where(eq(partner.status, 'submitted')).orderBy(asc(partner.submittedAt)).limit(1);
  return {
    counts: { submitted: n('submitted'), approved: n('approved'), deactivated: n('deactivated'), registered },
    rows: list, recent, oldestSubmittedAt: oldest?.at ?? null,
    categories: await q.select({ slug: category.slug, name: category.name }).from(category).orderBy(asc(category.sortOrder)),
    cities: await q.select({ slug: city.slug, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder)),
  };
}

/** One partner as the team reviews it (`/admin/partnyori/[id]`, the queue's side panel). */
export async function adminPartnerDetail(actor: AnyActor, partnerId: string, q: Queryable = db) {
  assertCan(actor, 'approve_partners');
  if (!z.uuid().safeParse(partnerId).success) throw new NotFoundError('partner');
  const [row] = await q.select({ p: partner, categoryName: category.name, cityName: city.name, ownerVerified: user.emailVerified })
    .from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
    .leftJoin(sql`partner_member pm`, sql`pm.partner_id = ${partner.id}`).leftJoin(user, sql`${user.id} = pm.user_id`)
    .where(eq(partner.id, partnerId)).limit(1);
  if (!row || row.p.status === 'draft') throw new NotFoundError('partner');
  const p = row.p;
  const checks = await checksSummary(q, p.id);
  const subtypes = await q.select({ label: categorySubtype.label }).from(partnerSubtype)
    .innerJoin(categorySubtype, eq(categorySubtype.id, partnerSubtype.subtypeId)).where(eq(partnerSubtype.partnerId, p.id)).orderBy(asc(categorySubtype.sortOrder));
  const tags = await q.select({ label: partnerTag.label }).from(partnerTag).where(eq(partnerTag.partnerId, p.id));
  const photos = await q.select({ key: media.storageKey }).from(partnerPhoto).innerJoin(media, eq(media.id, partnerPhoto.mediaId))
    .where(eq(partnerPhoto.partnerId, p.id)).orderBy(asc(partnerPhoto.position));
  const svcs = await q.select({ s: service, cover: media.storageKey }).from(service).leftJoin(media, eq(media.id, service.coverMediaId))
    .where(and(eq(service.partnerId, p.id), inArray(service.status, ['ready', 'active', 'pending_review'])))
    .orderBy(asc(service.sortOrder), asc(service.createdAt));
  // Services with a revision waiting in /admin/moderatsiya (an onboarding package has none: it goes live with the profile).
  const inReview = new Set(svcs.length ? (await q.select({ id: serviceRevision.serviceId }).from(serviceRevision)
    .where(and(eq(serviceRevision.status, 'pending'), inArray(serviceRevision.serviceId, svcs.map(x => x.s.id))))).map(r => r.id) : []);
  const notes = await q.select({ n: adminNote, authorName: user.name }).from(adminNote).innerJoin(user, eq(user.id, adminNote.authorId))
    .where(and(eq(adminNote.subjectType, 'partner'), eq(adminNote.subjectId, p.id))).orderBy(desc(adminNote.createdAt));
  const [lastDecision] = await q.select({ d: partnerDecision, by: user.name }).from(partnerDecision).innerJoin(user, eq(user.id, partnerDecision.decidedBy))
    .where(eq(partnerDecision.partnerId, p.id)).orderBy(desc(partnerDecision.decidedAt)).limit(1);
  const queue = await q.select({ id: partner.id }).from(partner).where(eq(partner.status, 'submitted')).orderBy(asc(partner.submittedAt));
  const totals = (await partnerTotals([p.id], q)).get(p.id) ?? { bookings: 0, turnoverCents: 0 };
  const [bank] = await q.select({ name: payoutAccount.bankName }).from(payoutAccount)
    .where(and(eq(payoutAccount.partnerId, p.id), eq(payoutAccount.status, 'pending_verification'))).orderBy(desc(payoutAccount.submittedAt)).limit(1);
  return {
    partner: p, categoryName: row.categoryName ?? '', cityName: row.cityName ?? '', emailVerified: !!row.ownerVerified,
    phone: displayPhone(p.phone), checks, subtypes: [...subtypes.map(s => s.label), ...tags.map(t => t.label)],
    photos: photos.map(x => mediaUrl(x.key)!).filter(Boolean),
    services: svcs.map(x => ({
      id: x.s.id, name: x.s.name, kind: x.s.kind, status: x.s.status, description: x.s.description, durationLabel: x.s.durationLabel,
      price: x.s.kind === 'on_request' ? null : x.s.priceCents, priceUnit: x.s.priceUnit, cover: mediaUrl(x.cover),
      inReview: inReview.has(x.s.id),
    })),
    notes: notes.map(x => ({ id: x.n.id, body: x.n.body, at: x.n.createdAt, authorName: x.authorName })),
    lastDecision: lastDecision ? { ...lastDecision.d, byName: lastDecision.by } : null,
    queueSize: queue.length, queueIndex: queue.findIndex(x => x.id === p.id),
    totals, pendingBankName: bank?.name ?? null,
  };
}

/** The default `detail` a team check gets when it is marked ok (SPEC §4.2 profile checks, ok examples). */
export async function teamCheckDetail(partnerId: string, kind: TeamCheck, q: Queryable = db): Promise<string> {
  const [p] = await q.select().from(partner).where(eq(partner.id, partnerId));
  if (!p) throw new NotFoundError('partner');
  if (kind === 'company') return [p.eik ? `ЕИК ${p.eik}` : null, p.legalName, 'проверено в Търговския регистър'].filter(Boolean).join(' · ');
  if (kind === 'contacts') return 'Телефон и имейл потвърдени';
  const [{ n }] = await q.select({ n: sql<number>`count(*)::int` }).from(partnerPhoto).where(eq(partnerPhoto.partnerId, partnerId));
  return `${n} ${n === 1 ? 'снимка' : 'снимки'} · няма водни знаци от други студия`;
}

// ── Moderation (/admin/moderatsiya) ──────────────────────────────────────

/** The price line of a service as the moderation queue shows it: ‹1 180 € · фиксирана›, ‹32 € на гост · минимум 40 гости›. */
export function termsLine(c: { kind: string; priceCents: number | null; priceUnit: string; minGuests?: number | null; durationLabel?: string | null }, isNew: boolean): string {
  const short = (cents: number) => {
    const euros = cents / 100;
    const s = Number.isInteger(euros) ? String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : (euros.toFixed(2).replace('.', ','));
    return `${s} €`;
  };
  const price = c.kind === 'on_request' || c.priceCents == null ? priceText({ kind: 'on_request', priceCents: null, priceUnit: 'per_event' })
    : `${short(c.priceCents)}${c.priceUnit === 'per_guest' ? ' на гост' : ''}`;
  const parts = [price];
  if (c.minGuests) parts.push(`минимум ${c.minGuests} гости`);
  if (c.durationLabel) parts.push(c.durationLabel);
  else if (isNew && c.kind === 'package_fixed' && c.priceUnit === 'per_event') parts.push('фиксирана');
  return parts.join(' · ');
}

const TERMS_FIELDS = ['priceCents', 'priceUnit', 'minGuests', 'durationLabel', 'kind'];

/** Pending revisions with what the card shows: cover, the ‹Беше› / ‹Става› pairs (edits) or price + description (new). */
export async function moderationItems(actor: AnyActor, a: { filter: 'vsichki' | 'novi' | 'redakcii'; partnerId?: string | null; serviceId?: string | null; q?: string | null }, q: Queryable = db) {
  assertCan(actor, 'moderate_listings');
  const conds = [eq(serviceRevision.status, 'pending')];
  if (a.filter === 'novi') conds.push(eq(serviceRevision.type, 'new'));
  if (a.filter === 'redakcii') conds.push(eq(serviceRevision.type, 'edit'));
  if (a.partnerId && z.uuid().safeParse(a.partnerId).success) conds.push(eq(service.partnerId, a.partnerId));
  if (a.serviceId && z.uuid().safeParse(a.serviceId).success) conds.push(eq(service.id, a.serviceId));
  const rows = await q.select({ r: serviceRevision, s: service, partnerName: partner.businessName, categoryName: category.name, cover: media.storageKey })
    .from(serviceRevision).innerJoin(service, eq(service.id, serviceRevision.serviceId)).innerJoin(partner, eq(partner.id, service.partnerId))
    .innerJoin(category, eq(category.id, service.categoryId)).leftJoin(media, eq(media.id, service.coverMediaId))
    .where(and(...conds)).orderBy(desc(serviceRevision.submittedAt));
  return rows.filter(x => matches(a.q, x.s.name, x.partnerName, x.categoryName)).map(x => {
    const isNew = x.r.type === 'new';
    const pairs: { label: string; before: string | null; after: string }[] = [];
    if (isNew) {
      pairs.push({ label: 'Цена', before: null, after: termsLine(x.s, true) });
      pairs.push({ label: 'Описание', before: null, after: x.s.description });
    } else {
      const diff = x.r.payload as Record<string, [unknown, unknown]>;
      const changed = Object.keys(diff);
      if (changed.some(f => TERMS_FIELDS.includes(f))) {
        const pick = (i: 0 | 1) => {
          const v = (f: string) => (f in diff ? diff[f][i] : (x.s as Record<string, unknown>)[f]);
          return termsLine({ kind: v('kind') as string, priceCents: v('priceCents') as number | null, priceUnit: v('priceUnit') as string, minGuests: v('minGuests') as number | null, durationLabel: v('durationLabel') as string | null }, false);
        };
        pairs.push({ label: 'Беше', before: null, after: pick(0) }, { label: 'Става', before: null, after: pick(1) });
      }
      for (const f of ['name', 'description'] as const) {
        if (f in diff) pairs.push({ label: 'Беше', before: null, after: String(diff[f][0] ?? '') }, { label: 'Става', before: null, after: String(diff[f][1] ?? '') });
      }
      if ('inclusions' in diff) {
        const j = (v: unknown) => (Array.isArray(v) ? v.join(' · ') : '');
        pairs.push({ label: 'Беше', before: null, after: j(diff.inclusions[0]) }, { label: 'Става', before: null, after: j(diff.inclusions[1]) });
      }
    }
    const priceChanged = !isNew && ('priceCents' in (x.r.payload as object) || 'minGuests' in (x.r.payload as object) || 'priceUnit' in (x.r.payload as object));
    return {
      revisionId: x.r.id, type: x.r.type, serviceId: x.s.id, partnerId: x.s.partnerId, name: x.s.name, priceChanged,
      partnerName: x.partnerName, categoryName: x.categoryName, submittedAt: x.r.submittedAt, cover: mediaUrl(x.cover), pairs,
    };
  });
}

/** ‹Тази седмица› (Monday 00:00 Sofia until now): reviewed, published, returned with a note, average hours. */
export async function moderationWeek(q: Queryable = db) {
  const at = await now();
  const today = sofiaDate(at);
  const monday = addDays(today, -((sofiaParts(at).wd + 6) % 7));
  const [r] = await q.execute<{ reviewed: number; published: number; returned: number; avg_h: string | null }>(sql`
    select count(*)::int as reviewed,
      (count(*) filter (where status = 'approved'))::int as published,
      (count(*) filter (where status = 'returned' and note is not null))::int as returned,
      avg(extract(epoch from (decided_at - submitted_at)) / 3600) as avg_h
    from service_revision where decided_at >= ${inst(monday)}::timestamptz and decided_at <= ${at.toISOString()}::timestamptz
      and status in ('approved', 'returned')`);
  return { reviewed: r.reviewed, published: r.published, returned: r.returned, avgHours: r.avg_h == null ? null : Math.round(Number(r.avg_h)) };
}

/** Names behind the moderation filters (‹?partnyor=› / ‹?usluga=›) for the filter chips. */
export async function moderationFilterNames(a: { partnerId?: string | null; serviceId?: string | null }, q: Queryable = db) {
  const ok = (v?: string | null) => !!v && z.uuid().safeParse(v).success;
  const [p] = ok(a.partnerId) ? await q.select({ name: partner.businessName }).from(partner).where(eq(partner.id, a.partnerId!)) : [];
  const [s] = ok(a.serviceId) ? await q.select({ name: service.name }).from(service).where(eq(service.id, a.serviceId!)) : [];
  return { partnerName: p?.name ?? null, serviceName: s?.name ?? null };
}

/** Counts for the subtitle: new services, edits (all pending, regardless of the filter). */
export async function moderationCounts(q: Queryable = db) {
  const rows = await q.execute<{ type: string; n: number }>(sql`select type, count(*)::int as n from service_revision where status = 'pending' group by type`);
  return { news: rows.find(r => r.type === 'new')?.n ?? 0, edits: rows.find(r => r.type === 'edit')?.n ?? 0 };
}

// ── Clients (/admin/klienti) ─────────────────────────────────────────────

export type ClientTab = 'vsichki' | 's-rezervatsiya' | 'biznes';
export type ClientRegistered = 'vsichki' | '30-dni' | 'tazi-godina';

type ClientRow = {
  id: string; name: string; email: string; phone: string | null; created_at: Date; banned: boolean; client_type: string | null; city: string | null; city_slug: string | null;
  bookings: number; spent: string; open_disputes: number;
};

async function clientRows(q: Queryable): Promise<ClientRow[]> {
  const rows = await q.execute<ClientRow>(sql`
    with bk as (select client_id, count(*)::int as n from booking where paid_at is not null group by client_id),
      paid as (select b.client_id, sum(c.amount_cents) as s from charge c join booking b on b.id = c.booking_id where c.status = 'succeeded' group by b.client_id),
      refunded as (select b.client_id, sum(r.amount_cents) as s from refund r join booking b on b.id = r.booking_id where r.status = 'succeeded' group by b.client_id),
      disp as (select b.client_id, count(*)::int as n from dispute d join booking b on b.id = d.booking_id where d.status in ('collecting', 'awaiting_decision') group by b.client_id)
    select u.id, u.name, u.email, u.phone, u.created_at, u.banned, cp.client_type, ci.name as city, ci.slug as city_slug,
      coalesce(bk.n, 0) as bookings, coalesce(paid.s, 0) - coalesce(refunded.s, 0) as spent, coalesce(disp.n, 0) as open_disputes
    from "user" u left join client_profile cp on cp.user_id = u.id left join city ci on ci.id = cp.city_id
      left join bk on bk.client_id = u.id left join paid on paid.client_id = u.id left join refunded on refunded.client_id = u.id
      left join disp on disp.client_id = u.id
    where u.role = 'client' and u.deleted_at is null
    order by u.created_at desc`);
  return rows.map(r => ({ ...r, created_at: toDate(r.created_at) }));
}

/** D96: ‹Блокиран› > ‹Отворен спор› > ‹Активен›. */
export function clientBadge(c: { banned: boolean; openDisputes: number }): { label: string; tone: string } {
  if (c.banned) return { label: 'Блокиран', tone: 'danger' };
  if (c.openDisputes > 0) return { label: 'Отворен спор', tone: 'danger' };
  return { label: 'Активен', tone: 'success' };
}

export const CLIENT_TYPE_LABEL: Record<string, string> = { private: 'Частно лице', business: 'Бизнес клиент' };

/** Rows per ‹Покажи още› step on /admin/klienti (`?stranitsa=2` = the first 100). */
export const CLIENTS_PER_PAGE = 50;

export async function adminClientList(actor: AnyActor, a: { tab: ClientTab; city?: string | null; registered?: ClientRegistered; q?: string | null; page?: number }, q: Queryable = db) {
  assertTeamMember(actor);
  const at = await now();
  const today = sofiaDate(at);
  const all = await clientRows(q);
  const from = a.registered === '30-dni' ? sofiaInstant(addDays(today, -30)) : a.registered === 'tazi-godina' ? sofiaInstant(`${today.slice(0, 4)}-01-01`) : null;
  const monthStart = sofiaInstant(`${today.slice(0, 7)}-01`);
  const base = all.filter(c => (!a.city || c.city_slug === a.city) && (!from || c.created_at >= from)
    && matches(a.q, c.name, c.email, c.phone, displayPhone(c.phone)));
  const tabbed = base.filter(c => a.tab === 'vsichki' || (a.tab === 's-rezervatsiya' ? c.bookings > 0 : c.client_type === 'business'));
  // Demand profile: requests by event type (the three biggest + ‹Други›).
  const demand = await q.execute<{ slug: string; name: string; plural: string; n: number }>(sql`
    select et.slug, et.name, et.name_plural_lower as plural, count(*)::int as n from request r join event_type et on et.id = r.event_type_id
    group by et.slug, et.name, et.name_plural_lower, et.sort_order order by count(*) desc, et.sort_order`);
  const totalDemand = demand.reduce((s, d) => s + d.n, 0);
  const named = demand.filter(d => d.slug !== 'drugo' && d.plural).slice(0, 3);
  const pct = (x: number, of: number) => (of ? Math.round((100 * x) / of) : 0);
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase('bg') + s.slice(1);
  const demandRows = totalDemand ? [
    ...named.map(d => ({ label: cap(d.plural), pct: pct(d.n, totalDemand) })),
    { label: 'Други', pct: pct(totalDemand - named.reduce((s, d) => s + d.n, 0), totalDemand) },
  ] : [];
  const sources = await q.execute<{ src: string | null; n: number }>(sql`
    select cp.acquisition_source as src, count(*)::int as n from "user" u join client_profile cp on cp.user_id = u.id
    where u.role = 'client' and u.deleted_at is null and cp.acquisition_source is not null group by cp.acquisition_source`);
  const known = sources.reduce((s, x) => s + x.n, 0);
  const share = (k: string) => (known ? pct(sources.find(s => s.src === k)?.n ?? 0, known) : null);
  return {
    counts: { all: all.length, withBookings: all.filter(c => c.bookings > 0).length, business: all.filter(c => c.client_type === 'business').length, newThisMonth: all.filter(c => c.created_at >= monthStart).length },
    tabCounts: { vsichki: base.length, 's-rezervatsiya': base.filter(c => c.bookings > 0).length, biznes: base.filter(c => c.client_type === 'business').length },
    hasMore: tabbed.length > CLIENTS_PER_PAGE * Math.max(1, a.page ?? 1),
    rows: tabbed.slice(0, CLIENTS_PER_PAGE * Math.max(1, a.page ?? 1)).map(c => ({
      id: c.id, name: c.name, email: c.email, cityName: c.city ?? '', typeLabel: CLIENT_TYPE_LABEL[c.client_type ?? 'private'],
      bookings: c.bookings, spentCents: int(c.spent), badge: clientBadge({ banned: c.banned, openDisputes: c.open_disputes }),
    })),
    demand: demandRows,
    sources: [
      { key: 'organic', label: 'Органично търсене', sub: 'Google · директно', pct: share('organic') },
      { key: 'meta', label: 'Instagram и Facebook', sub: 'Meta реклами', pct: share('meta') },
      { key: 'referral', label: 'Препоръка', sub: 'от изпълнител или клиент', pct: share('referral') },
      { key: 'other', label: 'Друго', sub: 'партньорски сайтове', pct: share('other') },
    ],
    cities: await q.select({ slug: city.slug, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder)),
  };
}

/** `/admin/klienti/[id]`: profile, spend and commission, events, bookings, requests, state, notes. */
export async function adminClientDetail(actor: AnyActor, clientId: string, q: Queryable = db) {
  assertTeamMember(actor);
  const at = await now();
  const today = sofiaDate(at);
  const [u] = await q.execute<{
    id: string; name: string; email: string; email_verified: boolean; phone: string | null; created_at: Date; banned: boolean; ban_reason: string | null;
    last_login_at: Date | null; last_login_city: string | null; client_type: string | null; city: string | null;
  }>(sql`
    select u.id, u.name, u.email, u.email_verified, u.phone, u.created_at, u.banned, u.ban_reason, u.last_login_at, u.last_login_city,
      cp.client_type, ci.name as city
    from "user" u left join client_profile cp on cp.user_id = u.id left join city ci on ci.id = cp.city_id
    where u.id = ${clientId} and u.role = 'client' and u.deleted_at is null`);
  if (!u) throw new NotFoundError('client');
  u.created_at = toDate(u.created_at);
  u.last_login_at = toDateOrNull(u.last_login_at);
  const std = await getSetting('commission.standard_bp', undefined, q);
  const bookings = await q.execute<{
    id: string; number: string; status: string; amount: number; bp: number | null; event_date: string; paid_at: Date | null; review_state: string;
    partner: string; partner_id: string; service_title: string; event_title: string; event_id: string; cancelled_by: string | null;
  }>(sql`
    select b.id, b.number, b.status, b.amount_cents as amount, b.commission_bp as bp, b.event_date::text as event_date, b.paid_at, b.review_state,
      p.business_name as partner, p.id as partner_id, b.service_title, ce.title as event_title, ce.id as event_id, b.cancelled_by
    from booking b join partner p on p.id = b.partner_id join client_event ce on ce.id = b.client_event_id
    where b.client_id = ${clientId} order by b.event_date, b.number`);
  const requests = await q.execute<{
    number: string; status: string; kind: string; amount: number | null; sent_at: Date; decline_reason: string | null; partner: string; category: string | null;
    event_title: string; event_id: string; booking_status: string | null; booking_paid: boolean | null;
  }>(sql`
    select r.number, r.status, r.kind, coalesce(r.amount_cents, b.amount_cents) as amount, r.sent_at, r.decline_reason, p.business_name as partner,
      c.name as category, ce.title as event_title, ce.id as event_id, b.status as booking_status, (b.paid_at is not null) as booking_paid
    from request r join partner p on p.id = r.partner_id left join category c on c.id = p.primary_category_id
    join client_event ce on ce.id = r.client_event_id left join booking b on b.request_id = r.id
    where r.client_id = ${clientId} order by r.sent_at desc`);
  const events = await q.execute<{ id: string; title: string; date: string; venue_name: string | null; locality: string | null; city: string | null; guests: number | null }>(sql`
    select ce.id, ce.title, ce.date::text as date, ce.venue_name, ce.locality, ci.name as city, ce.guests
    from client_event ce left join city ci on ci.id = ce.city_id where ce.client_id = ${clientId} order by ce.date`);
  const [money] = await q.execute<{ paid: string; refunded: string }>(sql`
    select (select coalesce(sum(c.amount_cents), 0) from charge c join booking b on b.id = c.booking_id where b.client_id = ${clientId} and c.status = 'succeeded') as paid,
      (select coalesce(sum(r.amount_cents), 0) from refund r join booking b on b.id = r.booking_id where b.client_id = ${clientId} and r.status = 'succeeded') as refunded`);
  const [card] = await q.execute<{ brand: string | null; last4: string | null }>(sql`
    select c.card_brand as brand, c.card_last4 as last4 from charge c join booking b on b.id = c.booking_id
    where b.client_id = ${clientId} and c.status = 'succeeded' and c.card_last4 is not null order by c.succeeded_at desc limit 1`);
  const [disp] = await q.execute<{ open: number; total: number }>(sql`
    select (count(*) filter (where d.status in ('collecting', 'awaiting_decision')))::int as open, count(*)::int as total
    from dispute d join booking b on b.id = d.booking_id where b.client_id = ${clientId}`);
  const [rev] = await q.execute<{ n: number }>(sql`select count(*)::int as n from review where client_id = ${clientId}`);
  const notes = await q.select({ n: adminNote, authorName: user.name }).from(adminNote).innerJoin(user, eq(user.id, adminNote.authorId))
    .where(and(eq(adminNote.subjectType, 'client'), eq(adminNote.subjectId, clientId))).orderBy(desc(adminNote.createdAt));

  const paidBookings = bookings.filter(b => b.paid_at);
  const commissionCents = paidBookings.filter(b => b.status !== 'cancelled').reduce((s, b) => s + Math.floor((b.amount * (b.bp ?? std) + 5000) / 10000), 0);
  const openRequests = requests.filter(r => !r.booking_paid);
  const reqCounts = {
    waiting: openRequests.filter(r => ['pending', 'offer_sent', 'awaiting_confirmation'].includes(r.status) && !r.booking_status).length,
    awaitingPayment: openRequests.filter(r => r.booking_status === 'awaiting_payment').length,
    declined: openRequests.filter(r => r.status === 'declined').length,
  };
  const declinedAll = requests.filter(r => r.status === 'declined');
  return {
    client: {
      id: u.id, name: u.name, email: u.email, emailVerified: u.email_verified, phone: displayPhone(u.phone), createdAt: u.created_at, banned: u.banned,
      banReason: u.ban_reason, lastLoginAt: u.last_login_at, lastLoginCity: u.last_login_city, typeLabel: CLIENT_TYPE_LABEL[u.client_type ?? 'private'],
      cityName: u.city ?? '', badge: clientBadge({ banned: u.banned, openDisputes: disp.open }),
    },
    spentCents: int(money.paid) - int(money.refunded), commissionCents,
    card: card?.last4 ? { brand: card.brand, last4: card.last4 } : null,
    events: events.map(e => ({
      id: e.id, title: e.title, date: e.date, place: [e.venue_name, e.locality ?? e.city].filter(Boolean).join(', '), guests: e.guests,
      upcoming: e.date >= today, days: daysBetween(today, e.date),
    })),
    bookings: paidBookings.map(b => ({
      number: b.number, status: b.status, amountCents: b.amount, commissionCents: Math.floor((b.amount * (b.bp ?? std) + 5000) / 10000),
      eventTitle: b.event_title, eventDate: b.event_date, upcoming: b.event_date >= today, partnerName: b.partner, partnerId: b.partner_id, serviceTitle: b.service_title,
    })),
    requests: openRequests.map(r => ({
      number: r.number, sentAt: toDate(r.sent_at), partnerName: r.partner, categoryName: r.category ?? '', eventTitle: r.event_title, eventId: r.event_id, amountCents: r.amount,
      badge: requestAdminLabel({ status: r.status, declineReason: r.decline_reason, bookingStatus: r.booking_status }), hasBooking: !!r.booking_status,
    })),
    reqCounts,
    allBookings: bookings.length,
    state: {
      openDisputes: disp.open, disputesTotal: disp.total,
      cancelled: bookings.filter(b => b.status === 'cancelled').length,
      reviews: rev.n,
      reviewsDue: bookings.filter(b => b.review_state === 'invited').map(b => ({ title: b.event_title, date: b.event_date })),
      declined: declinedAll.length, declinedDateTaken: declinedAll.length > 0 && declinedAll.every(r => r.decline_reason === 'date_taken'),
    },
    notes: notes.map(x => ({ id: x.n.id, body: x.n.body, at: x.n.createdAt, authorName: x.authorName })),
    canBlock: can(actor, 'block_client', { disputeOpen: disp.open > 0 }),
  };
}

// ── Settings (/admin/nastroyki) ──────────────────────────────────────────

/** Categories with their partners, subtypes and this month's turnover (by booking category). */
export async function settingsCategories(q: Queryable = db) {
  const at = await now();
  const month = `${sofiaDate(at).slice(0, 7)}-01`;
  const rows = await q.execute<{ id: string; slug: string; name: string; icon: string; is_visible: boolean; partners: number; subtypes: number; gmv: string }>(sql`
    select c.id, c.slug, c.name, c.icon, c.is_visible,
      (select count(*)::int from partner p where p.primary_category_id = c.id and p.status = 'approved') as partners,
      (select count(*)::int from category_subtype st where st.category_id = c.id) as subtypes,
      (select coalesce(sum(b.amount_cents), 0) from booking b join partner p on p.id = b.partner_id left join service s on s.id = b.service_id
        where coalesce(s.category_id, p.primary_category_id) = c.id and b.paid_at >= ${inst(month)}::timestamptz and b.paid_at < ${inst(shiftMonths(month, 1))}::timestamptz) as gmv
    from category c
    where c.in_directory or c.slug = 'transport-za-gosti'
    order by c.sort_order, c.name`);
  return rows.map(r => ({ id: r.id, slug: r.slug, name: r.name, icon: r.icon, visible: r.is_visible, partners: r.partners, subtypes: r.subtypes, gmvCents: int(r.gmv) }));
}

/** ‹Добави категория› [dialog new copy] → a visible directory category; toast ‹Категорията е добавена›. */
export async function addCategory(actor: AnyActor, a: { name: string }, tx?: Tx) {
  assertCan(actor, 'manage_team_settings');
  const name = (a.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new DomainError('validation');
  return withTx(tx, async t => {
    // Compared in JS: lower() in the database does not fold Cyrillic under every collation.
    const names = await t.select({ name: category.name }).from(category);
    if (names.some(c => lower(c.name) === lower(name))) throw new DomainError('duplicate');
    const base = slugify(name) === 'partnyor' ? 'kategoriya' : slugify(name);
    let slug = base;
    for (let i = 2; (await t.select({ id: category.id }).from(category).where(eq(category.slug, slug)).limit(1)).length; i++) slug = `${base}-${i}`;
    const [{ m }] = await t.select({ m: sql<number>`coalesce(max(${category.sortOrder}), 0)::int` }).from(category).where(eq(category.inDirectory, true));
    const at = await now();
    const [row] = await t.insert(category).values({
      slug, name, icon: 'custom', isVisible: true, inDirectory: true, sortOrder: m + 1, createdAt: at, updatedAt: at,
    }).returning();
    await audit(t, { actor, action: 'category.added', entity: 'category', entityId: row.id, data: { name, slug } });
    return row;
  });
}

/** Category toggle: shown in / hidden from the catalogue (‹скрита от каталога›). */
export async function setCategoryVisible(actor: AnyActor, a: { categoryId: string; visible: boolean }, tx?: Tx) {
  assertCan(actor, 'manage_team_settings');
  return withTx(tx, async t => {
    const [c] = await t.select().from(category).where(eq(category.id, a.categoryId)).for('update');
    if (!c) throw new NotFoundError('category');
    if (c.isVisible === a.visible) return c;
    // Shown = in the catalogue and its directory; hiding keeps the directory flag so the row stays in the editor.
    const [row] = await t.update(category).set({ isVisible: a.visible, inDirectory: a.visible ? true : c.inDirectory, updatedAt: await now() })
      .where(eq(category.id, c.id)).returning();
    await audit(t, { actor, action: a.visible ? 'category.shown' : 'category.hidden', entity: 'category', entityId: c.id });
    return row;
  });
}

/** The keys the settings page edits. */
export const EDITABLE_SETTINGS = [
  'commission.standard_bp', 'commission.intro_bp', 'commission.business_bp', 'payment.window_hours', 'request.response_hours',
  'cancellation.policies', 'moderation.manual', 'locale.en_enabled', 'payment.bank_transfer_enabled',
] as const satisfies readonly SettingKey[];
export type EditableSetting = (typeof EDITABLE_SETTINGS)[number];

/**
 * ‹Запази промените› on `/admin/nastroyki` (`settings.update()`): every changed key gets a new
 * version effective now (records already created keep their snapshots); category toggles too.
 * Returns the keys that changed. Toast ‹Промените са запазени›.
 */
export async function updateSettings(actor: AnyActor, a: {
  values: Partial<{ [K in EditableSetting]: SettingValue<K> }>; categories?: { id: string; visible: boolean }[];
}, tx?: Tx): Promise<string[]> {
  assertCan(actor, 'manage_team_settings');
  return withTx(tx, async t => {
    const current = await getSettings(undefined, t);
    const changed: string[] = [];
    for (const key of EDITABLE_SETTINGS) {
      if (!(key in a.values)) continue;
      const v = a.values[key];
      const parsed = SETTING_SCHEMAS[key].safeParse(v);
      if (!parsed.success) throw new DomainError('validation', key);
      if (JSON.stringify(parsed.data) === JSON.stringify(current[key])) continue;
      await setSetting(key, parsed.data as never, actor, undefined, t);
      changed.push(key);
    }
    for (const c of a.categories ?? []) {
      const [row] = await t.select({ v: category.isVisible }).from(category).where(eq(category.id, c.id));
      if (row && row.v !== c.visible) { await setCategoryVisible(actor, { categoryId: c.id, visible: c.visible }, t); changed.push(`category:${c.id}`); }
    }
    return changed;
  });
}

/** When the current commission rates took effect (‹в сила от 1 юли›). */
export async function commissionEffectiveFrom(q: Queryable = db): Promise<Date | null> {
  const at = await now();
  const [r] = await q.execute<{ at: Date | null }>(sql`
    select max(f) as at from (
      select distinct on (key) key, effective_from as f from platform_settings
      where key in ('commission.standard_bp', 'commission.intro_bp', 'commission.business_bp') and effective_from <= ${at.toISOString()}::timestamptz
      order by key, effective_from desc, created_at desc) x`);
  return toDateOrNull(r?.at);
}

/** ‹Гъвкава (до 7 дни) · Умерена (до 30 дни) · Строга (депозитът не се връща)› (SPEC §5.5, D9), from the policy table. */
export function policiesSummary(p: SettingValue<'cancellation.policies'>): string {
  const free = (k: 'flexible' | 'moderate' | 'strict') => p[k].tiers.find(t => t.retained === 'none')?.minDaysBefore;
  const one = (k: 'flexible' | 'moderate' | 'strict') => {
    const d = free(k);
    return `${POLICY_LABEL[k]} (${d != null ? `до ${d} дни` : 'депозитът не се връща'})`;
  };
  return [one('flexible'), one('moderate'), one('strict')].join(' · ');
}

// ── Demo clock (ALLOW_TIME_TRAVEL only) ──────────────────────────────────

export const timeTravelAllowed = () => process.env.ALLOW_TIME_TRAVEL === 'true';

/**
 * Moves the platform clock forward by `hours` (demo and test environments only), then runs every
 * job that became due and delivers the queued emails. Never available in production.
 */
export async function advanceClock(actor: AnyActor, a: { hours: number }): Promise<{ now: Date; jobs: number; emails: number }> {
  assertCan(actor, 'manage_team_settings');
  if (!timeTravelAllowed()) throw new DomainError('time_travel_disabled');
  if (!Number.isInteger(a.hours) || a.hours < 1 || a.hours > 24 * 90) throw new DomainError('validation');
  const offset = await getSetting('clock_offset_ms');
  await db.transaction(async t => {
    await setSetting('clock_offset_ms', offset + a.hours * 3_600_000, actor, undefined, t);
    await audit(t, { actor, action: 'clock.advanced', entity: 'platform_settings', entityId: 'clock_offset_ms', data: { hours: a.hours } });
  });
  invalidateClock();
  let jobs = 0;
  for (let i = 0; i < 20; i++) {
    const r = await runDueJobs(200);
    jobs += r.ran + r.failed;
    if (r.ran + r.failed === 0) break;
  }
  const emails = await deliverQueued(500);
  return { now: await now(), jobs, emails };
}

// ── Team (/admin/nastroyki/ekip) and the invite page ─────────────────────

/** The invite behind a `/admin/pokana/[token]` link, with what the page shows. */
export async function invitePage(token: string, q: Queryable = db) {
  const found = await inviteByToken(token, q);
  if (!found) return null;
  const [inviter] = await q.select({ name: user.name, role: sql<string | null>`(select role::text from team_member where user_id = ${user.id})` })
    .from(user).where(eq(user.id, found.invite.invitedBy));
  const [existing] = await q.select({ id: user.id, role: user.role }).from(user).where(sql`lower(${user.email}) = ${found.invite.email.toLowerCase()}`).limit(1);
  return {
    invite: found.invite, valid: found.valid, roleLabel: ROLE_LABEL[found.invite.role],
    inviterName: inviter?.name ?? '', inviterRole: inviter?.role ? ROLE_LABEL[inviter.role as keyof typeof ROLE_LABEL] : '',
    existingUser: existing ? { id: existing.id, role: existing.role } : null,
  };
}

/**
 * ‹Приеми поканата› with a password (`/admin/pokana/[token]`): a new address gets a user and a
 * credential account (the invite proves the address, so no verification code is sent); then
 * team.acceptInvite() makes it an admin in the invited role. An existing account is verified by the
 * caller (sign-in) before this runs with `existingUserId`.
 */
export async function acceptInviteWithPassword(a: { token: string; name?: string; password?: string; existingUserId?: string }, tx?: Tx): Promise<{ userId: string; email: string }> {
  return withTx(tx, async t => {
    const found = await inviteByToken(a.token, t);
    if (!found || !found.valid) throw new DomainError('invalid_token');
    let userId = a.existingUserId ?? null;
    if (!userId) {
      const name = (a.name ?? '').trim();
      const password = a.password ?? '';
      if (name.length < 2 || name.length > 120) throw new DomainError('name_required');
      if (password.length < 8 || password.length > 128) throw new DomainError('password_short');
      const [taken] = await t.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${found.invite.email.toLowerCase()}`).limit(1);
      if (taken) throw new DomainError('email_taken');
      const { generateRandomString, hashPassword } = await import('better-auth/crypto');
      const id = generateRandomString(32, 'a-z', 'A-Z', '0-9');
      const at = await now();
      await t.insert(user).values({ id, name, email: found.invite.email, emailVerified: true, role: 'client', createdAt: at, updatedAt: at });
      await t.insert(account).values({
        id: generateRandomString(32, 'a-z', 'A-Z', '0-9'), accountId: id, providerId: 'credential', userId: id, password: await hashPassword(password), createdAt: at, updatedAt: at,
      });
      userId = id;
    }
    await acceptInvite({ token: a.token, userId }, t);
    return { userId, email: found.invite.email };
  });
}

/** Members whose name, email or role label contains the query (‹Търси човек или роля›). */
export function teamMatches(qs: string | null | undefined, m: { name: string; email: string; roleLabel: string }) {
  return matches(qs, m.name, m.email, m.roleLabel);
}

/** Pending invites count for the subtitle (also used where listTeam is not loaded). */
export async function pendingInvites(q: Queryable = db) {
  const [{ n }] = await q.select({ n: sql<number>`count(*)::int` }).from(teamInvite).where(eq(teamInvite.status, 'pending'));
  return n;
}

// ── Search (/admin/tarsene) ──────────────────────────────────────────────

/** Booking number exact → that booking; else partners, clients and bookings that match. */
export async function adminSearch(actor: Actor, qs: string, q: Queryable = db) {
  assertTeamMember(actor);
  const needle = qs.trim();
  if (!needle) return { exact: null, partners: [], clients: [], bookings: [] };
  // Numbers are stored upper-case (2026-0614-ЕА); upper() in the database does not fold Cyrillic under every collation.
  const [exact] = await q.execute<{ number: string }>(sql`select number from booking where number = ${needle.toLocaleUpperCase('bg')} limit 1`);
  if (exact) return { exact: exact.number, partners: [], clients: [], bookings: [] };
  const partners = can(actor, 'approve_partners') ? (await q.select({ id: partner.id, name: partner.businessName, status: partner.status, categoryName: category.name, cityName: city.name })
    .from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
    .where(sql`${partner.status} not in ('draft', 'deleted')`).orderBy(asc(partner.businessName)))
    .filter(p => matches(needle, p.name, p.categoryName, p.cityName)) : [];
  const clients = (await clientRows(q)).filter(c => matches(needle, c.name, c.email, c.phone, displayPhone(c.phone)))
    .map(c => ({ id: c.id, name: c.name, email: c.email, cityName: c.city ?? '', typeLabel: CLIENT_TYPE_LABEL[c.client_type ?? 'private'], badge: clientBadge({ banned: c.banned, openDisputes: c.open_disputes }) }));
  const bookings = (await q.execute<{ number: string; status: string; event_date: string; client: string; partner: string; amount: number }>(sql`
    select b.number, b.status, b.event_date::text as event_date, u.name as client, p.business_name as partner, b.amount_cents as amount
    from booking b join "user" u on u.id = b.client_id join partner p on p.id = b.partner_id order by b.event_date desc`))
    .filter(b => matches(needle, b.number, b.client, b.partner));
  return { exact: null, partners, clients, bookings };
}

export { sofiaDate, monthName };
