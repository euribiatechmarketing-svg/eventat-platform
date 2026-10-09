// Partner account (SPEC §4.2 P1–P11, §12.1 onboarding, §12.3 public profile,
// §12.4 metrics). Every transition runs in one transaction that writes the
// audit log, queues the emails (+ bell, D54) and schedules or cancels jobs.
//
//   draft ──P4──▶ submitted ──P5──▶ approved ◀──P9── deactivated
//     ▲              │ P6 / P7          │ P8 ──────────────▲
//   returned ◀───────┘   rejected        └──P10──▶ deleted
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Queryable, type Tx } from '@/db';
import {
  accountDeletionRequest, booking, briefInvitation, category, city, consent, dispute, eventType, partner,
  partnerCheck, partnerDecision, partnerEventType, partnerInvite, partnerMember, partnerPhoto, partnerTag, payoutAccount, request,
  review, service, serviceEventType, user,
  type CancellationPolicy, type CheckState, type PartnerCheckKind, type PartnerStatus, type PriceUnit, type ServiceKind, type ServiceStatus,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { scheduleJob } from '@/lib/jobs';
import { simulatedProvider } from '@/lib/payments/simulated';
import { stripeProvider } from '@/lib/payments/stripe';
import type { PartnerAccountStatus, PaymentProvider } from '@/lib/payments/types';
import { addDays, date, dateTime, moneyShort, money, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';
import { assertCan, SYSTEM, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import { addMonths, HORIZON_OPTIONS, LEAD_TIME_OPTIONS } from './availability';
import {
  DomainError, NotFoundError, count as nCount, lockPartnerOf, mail, mailEach, newToken, normalizePhone, partnerOf, partnerRecipient,
  teamRecipients, withTx, type Partner,
} from './catalogue-kit';
import { anonymiseUser, consumeDeletionToken, supersedeDeletionRequests } from './clients';
import { ownMedia } from './media';
import { onboardingServiceErrors } from './services';
import { getSetting } from './settings';

export type { Partner };

// ── Labels (SPEC §15) ────────────────────────────────────────────────────

export const POLICY_LABEL: Record<CancellationPolicy, string> = { flexible: 'Гъвкава', moderate: 'Умерена', strict: 'Строга' };
/** Free-cancellation window per policy (§5.5): Гъвкава 7 days, Умерена 30, Строга none (deposit kept). */
export const POLICY_FREE_DAYS: Record<CancellationPolicy, number | null> = { flexible: 7, moderate: 30, strict: null };
export const BOOKINGS_PER_DAY_LABEL = { one: 'Една на ден', limit: 'Лимит на ден', unlimited: 'Без лимит' } as const;
export const RADIUS_OPTIONS = [50, 100, 150] as const;
export const CONSENT_VERSION = '2025-07-01';

/** A partner is publicly visible iff approved and listed; it can receive requests iff also accepting (§4.2). */
export const isVisible = (p: Pick<Partner, 'status' | 'isListed'>) => p.status === 'approved' && p.isListed;
export const canReceiveRequests = (p: Pick<Partner, 'status' | 'isListed' | 'acceptingRequests'>) => isVisible(p) && p.acceptingRequests;

// ── Slugs and identifiers ────────────────────────────────────────────────

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

/** 'Студио Мелодия' → 'studio-melodiya' (Bulgarian streamlined transliteration). */
export function slugify(name: string): string {
  const s = [...name.toLowerCase()].map(c => TRANSLIT[c] ?? c).join('')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'partnyor';
}

async function uniqueSlug(q: Queryable, name: string, exceptId?: string): Promise<string> {
  const base = slugify(name);
  for (let i = 1; ; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    const [hit] = await q.select({ id: partner.id }).from(partner).where(eq(partner.slug, s)).limit(1);
    if (!hit || hit.id === exceptId) return s;
  }
}

/**
 * ЕИК / Булстат (§12.1 step 1): 9 or 13 digits with a valid checksum, or 10 digits
 * for the Булстат of a свободна професия.
 */
export function isValidEik(eik: string, legalForm?: string | null): boolean {
  const d = eik.replace(/\s/g, '');
  if (/^\d{10}$/.test(d)) return legalForm === 'freelancer';
  if (!/^\d{9}$|^\d{13}$/.test(d)) return false;
  const n = [...d].map(Number);
  const check = (digits: number[], w1: number[], w2: number[]) => {
    let r = digits.reduce((s, x, i) => s + x * w1[i], 0) % 11;
    if (r === 10) r = digits.reduce((s, x, i) => s + x * w2[i], 0) % 11;
    return r === 10 ? 0 : r;
  };
  if (check(n.slice(0, 8), [1, 2, 3, 4, 5, 6, 7, 8], [3, 4, 5, 6, 7, 8, 9, 10]) !== n[8]) return false;
  if (d.length === 9) return true;
  return check(n.slice(8, 12), [2, 7, 3, 5], [4, 9, 5, 7]) === n[12];
}

const VIDEO_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\/\S+$/i;

// ── Onboarding schemas (§12.1) ───────────────────────────────────────────

const radius = z.union([z.literal(50), z.literal(100), z.literal(150), z.literal('nationwide')]);
const uuid = z.uuid();

const step1Full = z.object({
  businessName: z.string().trim().min(1).max(120),
  legalForm: z.enum(['freelancer', 'sole_trader', 'eood', 'ood', 'other']),
  legalFormOther: z.string().trim().max(120).nullish(),
  eik: z.string().trim(),
  primaryCategoryId: uuid,
  suggestedCategory: z.string().trim().max(120).nullish(),
  cityId: uuid,
  radius,
  experienceBand: z.enum(['lt_1', 'y1_3', 'y3_5', 'y5_10', 'gt_10']),
  languages: z.array(z.string().trim().min(1)).min(1),
  contactName: z.string().trim().min(1).max(120),
  notificationEmail: z.email(),
  phone: z.string().trim().min(1),
  socialHandle: z.string().trim().min(1).max(200),
  websiteUrl: z.string().trim().max(300).nullish(),
});
const step2Full = z.object({
  avatarMediaId: uuid,
  coverMediaId: uuid,
  shortDescription: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(600),
  videoUrl: z.string().trim().regex(VIDEO_RE).nullish().or(z.literal('')),
  eventTypeIds: z.array(uuid).min(1),
  tags: z.array(z.object({ label: z.string().trim().min(1).max(60), isCustom: z.boolean().default(false) })).default([]),
});
const step3Full = z.object({ offersFixedPackages: z.boolean().optional(), offersOnRequest: z.boolean().optional() });
const step4Full = z.object({
  bookingsPerDayMode: z.enum(['one', 'limit', 'unlimited']),
  maxBookingsPerDate: z.number().int().min(1).max(9).optional(),
  leadTimeDays: z.number().int().refine(v => (LEAD_TIME_OPTIONS as readonly number[]).includes(v)),
  horizonMonths: z.number().int().refine(v => (HORIZON_OPTIONS as readonly number[]).includes(v)),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1),
});
const step5Full = z.object({
  cancellationPolicy: z.enum(['flexible', 'moderate', 'strict']),
  depositPercent: z.union([z.literal(20), z.literal(30), z.literal(40), z.literal(50)]),
  reschedulePolicy: z.enum(['free_if_available', 'one_free', 'not_allowed']),
});

export const STEP_SCHEMAS = { 1: step1Full, 2: step2Full, 3: step3Full, 4: step4Full, 5: step5Full } as const;
export type StepNumber = keyof typeof STEP_SCHEMAS;
export type StepInput<N extends StepNumber> = z.input<(typeof STEP_SCHEMAS)[N]>;

/** Draft saves (‹Назад›, ‹Запази и продължи по-късно›) keep whatever is filled in, typed but not required. */
const DRAFT_SCHEMAS = {
  1: step1Full.partial().extend({ eik: z.string().trim().max(13).nullish(), notificationEmail: z.string().trim().nullish(), phone: z.string().trim().nullish() }),
  2: step2Full.partial().extend({ videoUrl: z.string().trim().max(300).nullish() }),
  3: step3Full,
  4: step4Full.partial(),
  5: step5Full.partial(),
} as const;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('validation', r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), { issues: r.error.issues });
  return r.data;
}

/** Map one step's fields onto partner columns. */
function stepColumns(step: StepNumber, d: Record<string, unknown>): Partial<Partner> {
  const set: Partial<Partner> = {};
  const has = (k: string) => k in d && d[k] !== undefined;
  if (step === 1) {
    if (has('businessName')) set.businessName = d.businessName as string;
    if (has('legalForm')) set.legalForm = d.legalForm as Partner['legalForm'];
    if (has('legalFormOther')) set.legalFormOther = (d.legalFormOther as string | null) || null;
    if (has('eik')) set.eik = ((d.eik as string | null) ?? '').replace(/\s/g, '') || null;
    if (has('primaryCategoryId')) set.primaryCategoryId = d.primaryCategoryId as string;
    if (has('suggestedCategory')) set.suggestedCategory = (d.suggestedCategory as string | null) || null;
    if (has('cityId')) set.cityId = d.cityId as string;
    if (has('radius')) {
      set.servesNationwide = d.radius === 'nationwide';
      set.serviceRadiusKm = d.radius === 'nationwide' ? null : (d.radius as number);
    }
    if (has('experienceBand')) set.experienceBand = d.experienceBand as Partner['experienceBand'];
    if (has('languages')) set.languages = d.languages as string[];
    if (has('contactName')) set.contactName = d.contactName as string;
    if (has('notificationEmail') && d.notificationEmail) set.notificationEmail = (d.notificationEmail as string).toLowerCase();
    if (has('phone') && d.phone) set.phone = normalizePhone(d.phone as string) ?? (d.phone as string);
    if (has('socialHandle')) set.socialHandle = d.socialHandle as string;
    if (has('websiteUrl')) set.websiteUrl = (d.websiteUrl as string | null) || null;
  } else if (step === 2) {
    if (has('avatarMediaId')) set.avatarMediaId = d.avatarMediaId as string;
    if (has('coverMediaId')) set.coverMediaId = d.coverMediaId as string;
    if (has('shortDescription')) set.shortDescription = d.shortDescription as string;
    if (has('description')) set.description = d.description as string;
    if (has('videoUrl')) set.videoUrl = (d.videoUrl as string | null) || null;
  } else if (step === 3) {
    if (has('offersFixedPackages')) set.offersFixedPackages = d.offersFixedPackages as boolean;
    if (has('offersOnRequest')) set.offersOnRequest = d.offersOnRequest as boolean;
  } else if (step === 4) {
    if (has('bookingsPerDayMode')) set.bookingsPerDayMode = d.bookingsPerDayMode as Partner['bookingsPerDayMode'];
    if (has('maxBookingsPerDate')) set.maxBookingsPerDate = d.maxBookingsPerDate as number;
    if (d.bookingsPerDayMode === 'one') set.maxBookingsPerDate = 1;
    if (has('leadTimeDays')) set.leadTimeDays = d.leadTimeDays as number;
    if (has('horizonMonths')) set.horizonMonths = d.horizonMonths as number;
    if (has('workingDays')) set.workingDays = [...new Set(d.workingDays as number[])].sort();
  } else if (step === 5) {
    if (has('cancellationPolicy')) set.cancellationPolicy = d.cancellationPolicy as CancellationPolicy;
    if (has('depositPercent')) set.depositPercent = d.depositPercent as number;
    if (has('reschedulePolicy')) set.reschedulePolicy = d.reschedulePolicy as Partner['reschedulePolicy'];
  }
  return set;
}

async function setEventTypes(tx: Tx, partnerId: string, ids: string[]) {
  await tx.delete(partnerEventType).where(eq(partnerEventType.partnerId, partnerId));
  const uniq = [...new Set(ids)];
  if (uniq.length) await tx.insert(partnerEventType).values(uniq.map(eventTypeId => ({ partnerId, eventTypeId })));
}

async function setTags(tx: Tx, partnerId: string, tags: { label: string; isCustom?: boolean }[]) {
  await tx.delete(partnerTag).where(eq(partnerTag.partnerId, partnerId));
  const seen = new Set<string>();
  const rows = tags.filter(t => !seen.has(t.label) && seen.add(t.label)).map(t => ({ partnerId, label: t.label, isCustom: !!t.isCustom }));
  if (rows.length) await tx.insert(partnerTag).values(rows);
}

async function applyStep(tx: Tx, actor: AnyActor, p: Partner, step: StepNumber, d: Record<string, unknown>, at: Date) {
  if (step === 2) {
    if (typeof d.avatarMediaId === 'string') await ownMedia(tx, actor, d.avatarMediaId, ['partner_avatar']);
    if (typeof d.coverMediaId === 'string') await ownMedia(tx, actor, d.coverMediaId, ['partner_cover', 'gallery']);
  }
  const set = stepColumns(step, d);
  if (step === 1 && set.businessName && set.businessName !== p.businessName && p.status !== 'approved' && p.status !== 'deactivated') {
    set.slug = await uniqueSlug(tx, set.businessName, p.id);
  }
  await tx.update(partner).set({ ...set, draftSavedAt: at, updatedAt: at }).where(eq(partner.id, p.id));
  if (step === 2 && Array.isArray(d.eventTypeIds)) await setEventTypes(tx, p.id, d.eventTypeIds as string[]);
  if (step === 2 && Array.isArray(d.tags)) await setTags(tx, p.id, d.tags as { label: string; isCustom?: boolean }[]);
}

const WIZARD_STATUSES: PartnerStatus[] = ['draft', 'returned'];

/** P3: ‹Назад› / ‹Запази и продължи по-късно› / ‹Изход› — saves the fields without validation (toast ‹Черновата е запазена›). */
export async function saveDraft(actor: AnyActor, a: { step: StepNumber; data: Record<string, unknown> }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (!WIZARD_STATUSES.includes(p.status)) throw new DomainError('wizard_read_only');
    const d = parse(DRAFT_SCHEMAS[a.step], a.data ?? {}) as Record<string, unknown>;
    await applyStep(t, actor, p, a.step, d, await now());
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'partner.draft_saved', entity: 'partner', entityId: p.id, data: { step: a.step, fields: Object.keys(d) } });
    return { savedAt: await now() };
  });
}

/**
 * P3 ‹Продължи към …›: validates step `n` (§12.1), saves it and advances `onboarding_step`
 * to the next unfinished step. Step 3 also turns the valid onboarding services `ready` (S5).
 */
export async function saveStep(actor: AnyActor, a: { step: StepNumber; data?: Record<string, unknown> }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (!WIZARD_STATUSES.includes(p.status)) throw new DomainError('wizard_read_only');
    const d = parse(STEP_SCHEMAS[a.step], a.data ?? {}) as Record<string, unknown>;
    if (a.step === 1) {
      if (!isValidEik(d.eik as string, d.legalForm as string)) throw new DomainError('invalid_eik');
      if (!normalizePhone(d.phone as string)) throw new DomainError('invalid_phone');
      if (d.legalForm === 'other' && !d.legalFormOther) throw new DomainError('validation', 'legalFormOther');
    }
    if (a.step === 4 && d.bookingsPerDayMode === 'limit' && !((d.maxBookingsPerDate as number) >= 2)) throw new DomainError('validation', 'maxBookingsPerDate ≥ 2');
    const at = await now();
    await applyStep(t, actor, p, a.step, d, at);
    const [fresh] = await t.select().from(partner).where(eq(partner.id, p.id));
    const errors = (await stepErrors(t, fresh))[a.step];
    if (errors.length) throw new DomainError('step_incomplete', errors.join('; '), { step: a.step, errors });
    if (a.step === 3) await markOnboardingServicesReady(t, p.id, at);
    const next = Math.min(6, a.step + 1);
    await t.update(partner).set({ onboardingStep: Math.max(fresh.onboardingStep, next), updatedAt: at }).where(eq(partner.id, p.id));
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'partner.step_saved', entity: 'partner', entityId: p.id, data: { step: a.step } });
    return { nextStep: next };
  });
}

/** S5: onboarding packages that pass step 3's checks become `ready` (listed with the profile on P5). */
async function markOnboardingServicesReady(tx: Tx, partnerId: string, at: Date) {
  const rows = await tx.select().from(service).where(and(eq(service.partnerId, partnerId), inArray(service.status, ['draft', 'ready'])));
  for (const s of rows) {
    const ok = onboardingServiceErrors(s).length === 0;
    if (ok && s.status === 'draft') await tx.update(service).set({ status: 'ready', updatedAt: at }).where(eq(service.id, s.id));
  }
}

/** What is still missing in each step (§12.1), from the stored profile. Empty arrays = valid. */
export async function stepErrors(q: Queryable, p: Partner): Promise<Record<1 | 2 | 3 | 4 | 5, string[]>> {
  const e: Record<1 | 2 | 3 | 4 | 5, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  if (!p.businessName) e[1].push('businessName');
  if (!p.legalForm) e[1].push('legalForm');
  if (p.legalForm === 'other' && !p.legalFormOther) e[1].push('legalFormOther');
  if (!p.eik || !isValidEik(p.eik, p.legalForm)) e[1].push('eik');
  if (!p.primaryCategoryId) e[1].push('primaryCategoryId');
  if (!p.cityId) e[1].push('cityId');
  if (!p.servesNationwide && !p.serviceRadiusKm) e[1].push('radius');
  if (!p.experienceBand) e[1].push('experienceBand');
  if (!p.languages.length) e[1].push('languages');
  if (!p.contactName) e[1].push('contactName');
  if (!p.notificationEmail) e[1].push('notificationEmail');
  if (!p.phone || !normalizePhone(p.phone)) e[1].push('phone');
  if (!p.socialHandle) e[1].push('socialHandle');

  if (!p.avatarMediaId) e[2].push('avatar');
  if (!p.coverMediaId) e[2].push('cover');
  if (!p.shortDescription) e[2].push('shortDescription');
  if (!p.description) e[2].push('description');
  if (p.videoUrl && !VIDEO_RE.test(p.videoUrl)) e[2].push('videoUrl');
  const [{ n: photos }] = await q.select({ n: count() }).from(partnerPhoto).where(eq(partnerPhoto.partnerId, p.id));
  const gMin = await getSetting('partner.gallery_min', undefined, q), gMax = await getSetting('partner.gallery_max', undefined, q);
  if (photos < gMin || photos > gMax) e[2].push('gallery');
  const [{ n: types }] = await q.select({ n: count() }).from(partnerEventType).where(eq(partnerEventType.partnerId, p.id));
  if (!types) e[2].push('eventTypes');

  const svcs = await q.select().from(service).where(and(eq(service.partnerId, p.id), ne(service.status, 'archived')));
  const fixed = svcs.filter(s => s.kind === 'package_fixed');
  if (!fixed.some(s => onboardingServiceErrors(s).length === 0)) e[3].push('package');
  if (fixed.length > await getSetting('partner.max_packages', undefined, q)) e[3].push('max_packages');

  if (p.bookingsPerDayMode === 'limit' && p.maxBookingsPerDate < 2) e[4].push('maxBookingsPerDate');
  if (!p.workingDays.length) e[4].push('workingDays');

  if (!p.cancellationPolicy) e[5].push('cancellationPolicy');
  return e;
}

/** The wizard sidebar (§12.1): per step done or not, and its meta line once done. */
export async function onboardingSummary(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const errors = await stepErrors(q, p);
  const [c] = p.cityId ? await q.select({ name: city.name }).from(city).where(eq(city.id, p.cityId)) : [];
  const [{ n: photos }] = await q.select({ n: count() }).from(partnerPhoto).where(eq(partnerPhoto.partnerId, p.id));
  const svcs = await q.select({ kind: service.kind }).from(service).where(and(eq(service.partnerId, p.id), ne(service.status, 'archived')));
  const packages = svcs.filter(s => s.kind === 'package_fixed').length, onRequest = svcs.filter(s => s.kind === 'on_request').length;
  const meta: Record<number, string | null> = {
    1: `${p.businessName}${c ? ` · ${c.name}` : ''}`,
    2: `Представяне и ${photos} снимки`,
    3: `${nCount(packages, 'пакет', 'пакета')}${onRequest ? ` · ${onRequest} по запитване` : ''}`,
    4: availabilityLabel(p),
    5: p.cancellationPolicy ? POLICY_LABEL[p.cancellationPolicy] : null,
  };
  const steps = ([1, 2, 3, 4, 5] as const).map(n => ({ step: n, done: errors[n].length === 0, missing: errors[n], meta: errors[n].length === 0 ? meta[n] : null }));
  return {
    status: p.status, onboardingStep: p.onboardingStep, draftSavedAt: p.draftSavedAt, readOnly: p.status === 'submitted',
    lastDecisionNote: p.status === 'returned' ? p.lastDecisionNote : null, steps,
  };
}

/** ‹Една резервация на ден› (onboarding meta); the other modes use their §15 labels. */
export function availabilityLabel(p: Pick<Partner, 'bookingsPerDayMode' | 'maxBookingsPerDate'>): string {
  if (p.bookingsPerDayMode === 'one') return 'Една резервация на ден';
  if (p.bookingsPerDayMode === 'limit') return `${BOOKINGS_PER_DAY_LABEL.limit} · ${p.maxBookingsPerDate}`;
  return BOOKINGS_PER_DAY_LABEL.unlimited;
}

// ── Gallery, avatar, cover ───────────────────────────────────────────────

const PROFILE_STATUSES: PartnerStatus[] = ['draft', 'returned', 'approved', 'deactivated'];

async function profilePartner(actor: AnyActor, tx: Tx): Promise<Partner> {
  const p = await lockPartnerOf(actor, tx);
  if (!PROFILE_STATUSES.includes(p.status)) throw new DomainError('partner_status');
  return p;
}

/** ‹Смени снимката› (toast ‹Снимката е обновена›). */
export async function setAvatar(actor: AnyActor, a: { mediaId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await profilePartner(actor, t);
    await ownMedia(t, actor, a.mediaId, ['partner_avatar']);
    await t.update(partner).set({ avatarMediaId: a.mediaId, updatedAt: await now() }).where(eq(partner.id, p.id));
    await audit(t, { actor, action: 'partner.avatar_changed', entity: 'partner', entityId: p.id });
  });
}

export async function setCover(actor: AnyActor, a: { mediaId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await profilePartner(actor, t);
    await ownMedia(t, actor, a.mediaId, ['partner_cover', 'gallery']);
    await t.update(partner).set({ coverMediaId: a.mediaId, updatedAt: await now() }).where(eq(partner.id, p.id));
    await audit(t, { actor, action: 'partner.cover_changed', entity: 'partner', entityId: p.id });
  });
}

/** ‹Добави снимка› (toast ‹Снимката е добавена›); at most ⚙ partner.gallery_max. */
export async function addPhoto(actor: AnyActor, a: { mediaId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await profilePartner(actor, t);
    await ownMedia(t, actor, a.mediaId, ['gallery']);
    const photos = await t.select().from(partnerPhoto).where(eq(partnerPhoto.partnerId, p.id)).orderBy(asc(partnerPhoto.position));
    if (photos.length >= await getSetting('partner.gallery_max', undefined, t)) throw new DomainError('gallery_full');
    if (photos.some(x => x.mediaId === a.mediaId)) throw new DomainError('photo_duplicate');
    const [row] = await t.insert(partnerPhoto).values({ partnerId: p.id, mediaId: a.mediaId, position: (photos.at(-1)?.position ?? -1) + 1, createdAt: await now() }).returning();
    await audit(t, { actor, action: 'partner.photo_added', entity: 'partner', entityId: p.id, data: { mediaId: a.mediaId } });
    return row;
  });
}

async function writePositions(tx: Tx, partnerId: string, ids: string[]) {
  await tx.update(partnerPhoto).set({ position: sql`${partnerPhoto.position} + 1000` }).where(eq(partnerPhoto.partnerId, partnerId));
  for (const [i, id] of ids.entries()) await tx.update(partnerPhoto).set({ position: i }).where(and(eq(partnerPhoto.id, id), eq(partnerPhoto.partnerId, partnerId)));
}

/** ‹Премахни› (toast ‹Снимката е премахната›). A listed profile keeps at least ⚙ partner.gallery_min photos. */
export async function removePhoto(actor: AnyActor, a: { photoId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await profilePartner(actor, t);
    const photos = await t.select().from(partnerPhoto).where(eq(partnerPhoto.partnerId, p.id)).orderBy(asc(partnerPhoto.position));
    if (!photos.some(x => x.id === a.photoId)) throw new NotFoundError('photo');
    if ((p.status === 'approved' || p.status === 'deactivated') && photos.length <= await getSetting('partner.gallery_min', undefined, t)) {
      throw new DomainError('gallery_min');
    }
    await t.delete(partnerPhoto).where(eq(partnerPhoto.id, a.photoId));
    await writePositions(t, p.id, photos.filter(x => x.id !== a.photoId).map(x => x.id));
    await audit(t, { actor, action: 'partner.photo_removed', entity: 'partner', entityId: p.id, data: { photoId: a.photoId } });
  });
}

/** Gallery order; the first photo is ‹Главна› (the catalogue photo). */
export async function reorderPhotos(actor: AnyActor, a: { photoIds: string[] }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await profilePartner(actor, t);
    const photos = await t.select({ id: partnerPhoto.id }).from(partnerPhoto).where(eq(partnerPhoto.partnerId, p.id));
    const have = new Set(photos.map(x => x.id));
    if (a.photoIds.length !== have.size || !a.photoIds.every(id => have.has(id))) throw new DomainError('invalid_order');
    await writePositions(t, p.id, a.photoIds);
  });
}

// ── P1 sign-up ───────────────────────────────────────────────────────────

/**
 * P1 ‹Създай профил› with ‹?as=partner›: Better Auth has created the user (and sends
 * `vendor-verify-code`); this makes it a partner: role, `partner` (draft) with the sign-up
 * fields, the owner `partner_member` and the consent rows.
 */
export async function register(a: {
  userId: string; businessName: string; contactName: string; phone: string; email?: string; ip?: string | null; consent: boolean;
}, tx?: Tx) {
  if (!a.consent) throw new DomainError('consent_required');
  const phone = normalizePhone(a.phone);
  if (!phone) throw new DomainError('invalid_phone');
  if (!a.businessName.trim() || !a.contactName.trim()) throw new DomainError('validation');
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, a.userId)).for('update');
    if (!u) throw new NotFoundError('user');
    const [member] = await t.select().from(partnerMember).where(eq(partnerMember.userId, u.id));
    if (member) throw new DomainError('already_partner');
    if (u.role === 'admin') throw new DomainError('wrong_role');
    const at = await now();
    await t.update(user).set({ role: 'partner', phone, updatedAt: at }).where(eq(user.id, u.id));
    const [p] = await t.insert(partner).values({
      slug: await uniqueSlug(t, a.businessName), status: 'draft', onboardingStep: 1, businessName: a.businessName.trim(),
      contactName: a.contactName.trim(), notificationEmail: (a.email ?? u.email).toLowerCase(), phone, createdAt: at, updatedAt: at,
    }).returning();
    await t.insert(partnerMember).values({ partnerId: p.id, userId: u.id, role: 'owner', createdAt: at });
    await t.insert(consent).values([
      { userId: u.id, document: 'general_terms', version: CONSENT_VERSION, acceptedAt: at, ip: a.ip ?? null },
      { userId: u.id, document: 'privacy', version: CONSENT_VERSION, acceptedAt: at, ip: a.ip ?? null },
    ]);
    await t.update(partnerInvite).set({ registeredPartnerId: p.id })
      .where(and(sql`lower(${partnerInvite.email}) = ${u.email.toLowerCase()}`, isNull(partnerInvite.registeredPartnerId)));
    await audit(t, { actor: { userId: u.id, role: 'partner', partnerId: p.id }, action: 'partner.registered', entity: 'partner', entityId: p.id });
    return p;
  });
}

// ── P4 submit ────────────────────────────────────────────────────────────

const PROVIDERS: Record<'simulated' | 'stripe', PaymentProvider> = { simulated: simulatedProvider, stripe: stripeProvider };

/** The provider implementation for a provider id (settings ⚙ payment.provider picks it for new accounts). */
export const providerById = (id: 'simulated' | 'stripe') => PROVIDERS[id];

export function providerStatusFrom(s: PartnerAccountStatus, previous?: Partner['providerStatus']): Partner['providerStatus'] {
  if (s.chargesEnabled && s.payoutsEnabled) return 'enabled';
  return previous === 'enabled' || previous === 'restricted' ? 'restricted' : 'pending';
}

const CHECK_KINDS: PartnerCheckKind[] = ['company', 'contacts', 'gallery', 'services', 'cancellation_policy', 'bank_account'];

/**
 * P4 ‹Подай за одобрение›: all six steps valid and both checkboxes ticked. Writes the consents,
 * turns valid services `ready`, creates the six `partner_check` rows, opens the provider account
 * (`createPartnerAccount`) and sends `vendor-application-received` + `team-vendor-application`.
 */
export async function submitApplication(actor: AnyActor, a: { acceptTerms: boolean; confirmInfo: boolean; ip?: string | null }, tx?: Tx) {
  if (!a.acceptTerms || !a.confirmInfo) throw new DomainError('consent_required');
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (!WIZARD_STATUSES.includes(p.status)) throw new DomainError('partner_status');
    const errors = await stepErrors(t, p);
    const incomplete = ([1, 2, 3, 4, 5] as const).filter(n => errors[n].length);
    if (incomplete.length) throw new DomainError('steps_incomplete', `steps ${incomplete.join(', ')}`, { errors });
    const at = await now();
    const userId = (actor as Actor).userId;
    await t.insert(consent).values([
      { userId, document: 'partner_terms', version: CONSENT_VERSION, acceptedAt: at, ip: a.ip ?? null },
      { userId, document: 'privacy', version: CONSENT_VERSION, acceptedAt: at, ip: a.ip ?? null },
    ]);
    await markOnboardingServicesReady(t, p.id, at);
    // Onboarding packages have no event types of their own: they take the partner's (§12.2 needs ≥ 1).
    const types = (await t.select({ id: partnerEventType.eventTypeId }).from(partnerEventType).where(eq(partnerEventType.partnerId, p.id))).map(r => r.id);
    const ready = await t.select({ id: service.id }).from(service).where(and(eq(service.partnerId, p.id), eq(service.status, 'ready')));
    for (const s of ready) {
      const [{ n }] = await t.select({ n: count() }).from(serviceEventType).where(eq(serviceEventType.serviceId, s.id));
      if (!n && types.length) await t.insert(serviceEventType).values(types.map(eventTypeId => ({ serviceId: s.id, eventTypeId })));
    }
    await t.insert(partnerCheck).values(CHECK_KINDS.map(kind => ({ partnerId: p.id, kind, state: 'waiting' as CheckState }))).onConflictDoNothing();

    let provider = p.provider, ref = p.providerAccountRef, pStatus = p.providerStatus, charges = p.providerChargesEnabled, payouts = p.providerPayoutsEnabled, req = p.providerRequirements;
    if (!ref) {
      provider = await getSetting('payment.provider', at, t);
      const impl = PROVIDERS[provider];
      ref = (await impl.createPartnerAccount({ partnerId: p.id, email: p.notificationEmail, businessName: p.businessName })).accountRef;
      const st = await impl.partnerAccountStatus(ref);
      pStatus = providerStatusFrom(st); charges = st.chargesEnabled; payouts = st.payoutsEnabled; req = st.requirementsDue;
    }
    await t.update(partner).set({
      status: 'submitted', submittedAt: at, termsAcceptedAt: at, infoConfirmedAt: at, onboardingStep: 6, draftSavedAt: at, updatedAt: at,
      provider, providerAccountRef: ref, providerStatus: pStatus, providerChargesEnabled: charges, providerPayoutsEnabled: payouts, providerRequirements: req,
    }).where(eq(partner.id, p.id));
    await refreshChecks(t, p.id);
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'partner.submitted', entity: 'partner', entityId: p.id, data: { resubmission: p.status === 'returned' } });

    const info = await partnerFacts(t, p.id);
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-application-received', to: r.email, toUserId: r.userId, dedupeKey: `partner:${p.id}:received:${at.toISOString()}`,
      vars: {
        partnerSlug: `${info.partner.slug}?preview=1`, partnerName: info.partner.businessName, partnerCategory: info.categoryName, city: info.cityName,
        contactName: info.partner.contactName, email: info.partner.notificationEmail, packages: info.packages, onRequest: info.onRequest,
        availability: availabilityLabel(info.partner), policy: `${POLICY_LABEL[info.partner.cancellationPolicy!]} · депозит ${info.partner.depositPercent}%`,
        submittedAt: dateTime(at),
      },
    });
    const checks = await checksSummary(t, p.id);
    const [pending] = await t.select({ id: payoutAccount.id }).from(payoutAccount)
      .where(and(eq(payoutAccount.partnerId, p.id), eq(payoutAccount.status, 'pending_verification'))).limit(1);
    await mailEach(t, await teamRecipients(t, ['approve_partners']), {
      key: 'team-vendor-application', dedupeKey: `partner:${p.id}:application:${at.toISOString()}`,
      vars: {
        partnerId: p.id, partnerName: info.partner.businessName, partnerLegalName: info.partner.legalName ?? info.partner.businessName,
        category: info.categoryName, city: info.cityName, contactName: info.partner.contactName, submittedOn: date(at),
        stepsDone: checks.ok, stepsTotal: checks.total, bankPending: !!pending, packages: info.packages,
        priceFrom: info.priceFrom != null ? money(info.priceFrom) : '—', priceTo: info.priceTo != null ? money(info.priceTo) : '—',
      },
    });
    return { submittedAt: at };
  });
}

/** Names and counts the partner emails need. */
async function partnerFacts(q: Queryable, partnerId: string) {
  const [row] = await q.select({ p: partner, categoryName: category.name, cityName: city.name }).from(partner)
    .leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .leftJoin(city, eq(city.id, partner.cityId))
    .where(eq(partner.id, partnerId));
  if (!row) throw new NotFoundError('partner');
  const svcs = await q.select({ kind: service.kind, price: service.priceCents, status: service.status }).from(service)
    .where(and(eq(service.partnerId, partnerId), inArray(service.status, ['ready', 'active', 'pending_review'])));
  const fixed = svcs.filter(s => s.kind === 'package_fixed' && s.status !== 'pending_review');
  const prices = fixed.map(s => s.price!).filter(x => x != null);
  return {
    partner: row.p, categoryName: row.categoryName ?? '', cityName: row.cityName ?? '',
    packages: fixed.length, onRequest: svcs.filter(s => s.kind === 'on_request' && s.status !== 'pending_review').length,
    priceFrom: prices.length ? Math.min(...prices) : null, priceTo: prices.length ? Math.max(...prices) : null,
  };
}

// ── Checks (admin/vendor.html) ───────────────────────────────────────────

/** The computed checks (§4.2): services, cancellation_policy, bank_account. company/contacts/gallery are set by the team. */
export async function refreshChecks(tx: Tx, partnerId: string) {
  const existing = await tx.select().from(partnerCheck).where(eq(partnerCheck.partnerId, partnerId));
  if (!existing.length) return;
  const at = await now();
  const [p] = await tx.select().from(partner).where(eq(partner.id, partnerId));
  const fixed = await tx.select({ price: service.priceCents }).from(service)
    .where(and(eq(service.partnerId, partnerId), eq(service.kind, 'package_fixed'), inArray(service.status, ['ready', 'active'])));
  const prices = fixed.map(f => f.price ?? 0);
  const svc = fixed.length
    ? { state: 'ok' as CheckState, detail: `${nCount(fixed.length, 'пакет', 'пакета')} · от ${moneyShort(Math.min(...prices))} до ${moneyShort(Math.max(...prices))}` }
    : { state: 'waiting' as CheckState, detail: null };
  const pol = p.cancellationPolicy
    ? { state: 'ok' as CheckState, detail: POLICY_FREE_DAYS[p.cancellationPolicy] != null
        ? `${POLICY_LABEL[p.cancellationPolicy]} · безплатно до ${POLICY_FREE_DAYS[p.cancellationPolicy]} дни`
        : `${POLICY_LABEL[p.cancellationPolicy]} · депозитът не се връща` }
    : { state: 'waiting' as CheckState, detail: null };
  const accounts = await tx.select({ status: payoutAccount.status }).from(payoutAccount)
    .where(and(eq(payoutAccount.partnerId, partnerId), inArray(payoutAccount.status, ['confirmed', 'pending_verification'])));
  const bank = accounts.some(x => x.status === 'confirmed') ? { state: 'ok' as CheckState, detail: null }
    : accounts.length ? { state: 'waiting' as CheckState, detail: 'IBAN подаден, чака потвърждение от банката' }
    : { state: 'waiting' as CheckState, detail: null };
  const computed: [PartnerCheckKind, { state: CheckState; detail: string | null }][] = [['services', svc], ['cancellation_policy', pol], ['bank_account', bank]];
  for (const [kind, v] of computed) {
    const cur = existing.find(c => c.kind === kind);
    if (!cur || (cur.state === v.state && cur.detail === v.detail)) continue;
    await tx.update(partnerCheck).set({ state: v.state, detail: v.detail, checkedAt: at, checkedBy: null })
      .where(and(eq(partnerCheck.partnerId, partnerId), eq(partnerCheck.kind, kind)));
  }
}

/** ‹профил N от 6› = the number of `ok` checks. */
export async function checksSummary(q: Queryable, partnerId: string) {
  const rows = await q.select().from(partnerCheck).where(eq(partnerCheck.partnerId, partnerId));
  const order = new Map(CHECK_KINDS.map((k, i) => [k, i]));
  return { ok: rows.filter(r => r.state === 'ok').length, total: CHECK_KINDS.length, checks: rows.sort((a, b) => order.get(a.kind)! - order.get(b.kind)!) };
}

/** A team check (company, contacts, gallery) — ‹Провери› on the application [control new copy]. */
export async function setCheck(actor: AnyActor, a: { partnerId: string; kind: 'company' | 'contacts' | 'gallery'; state: CheckState; detail?: string | null }, tx?: Tx) {
  assertCan(actor, 'approve_partners');
  if (!['company', 'contacts', 'gallery'].includes(a.kind)) throw new DomainError('computed_check');
  return withTx(tx, async t => {
    const [p] = await t.select().from(partner).where(eq(partner.id, a.partnerId)).for('update');
    if (!p) throw new NotFoundError('partner');
    const at = await now();
    await t.insert(partnerCheck).values({ partnerId: p.id, kind: a.kind, state: a.state, detail: a.detail ?? null, checkedBy: actor.userId, checkedAt: at })
      .onConflictDoUpdate({ target: [partnerCheck.partnerId, partnerCheck.kind], set: { state: a.state, detail: a.detail ?? null, checkedBy: actor.userId, checkedAt: at } });
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'partner.check_set', entity: 'partner', entityId: p.id, data: { kind: a.kind, state: a.state } });
  });
}

// ── P5–P7 team decisions ─────────────────────────────────────────────────

async function lockForDecision(tx: Tx, partnerId: string): Promise<Partner> {
  const [p] = await tx.select().from(partner).where(eq(partner.id, partnerId)).for('update');
  if (!p) throw new NotFoundError('partner');
  if (p.status !== 'submitted') throw new DomainError('partner_status', `partner is ${p.status}`);
  return p;
}

/**
 * P5 ‹Одобри›: approved_at/by; `ready` services → `active` (published); `partner_decision`;
 * `vendor-application-approved`. The bank account may still be waiting (payouts wait, §8.3).
 */
export async function approve(actor: AnyActor, a: { partnerId: string; note?: string | null }, tx?: Tx) {
  assertCan(actor, 'approve_partners');
  return withTx(tx, async t => {
    const p = await lockForDecision(t, a.partnerId);
    const at = await now();
    await t.update(service).set({ status: 'active', publishedAt: at, updatedAt: at })
      .where(and(eq(service.partnerId, p.id), eq(service.status, 'ready')));
    await t.update(partner).set({
      status: 'approved', approvedAt: at, approvedBy: actor.userId, lastDecisionNote: a.note?.trim() || null, updatedAt: at,
      listedAt: p.isListed && p.acceptingRequests ? at : p.listedAt,
    }).where(eq(partner.id, p.id));
    await t.insert(partnerDecision).values({ partnerId: p.id, decision: 'approved', note: a.note?.trim() || null, decidedBy: actor.userId, decidedAt: at });
    await refreshChecks(t, p.id);
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'partner.approved', entity: 'partner', entityId: p.id, data: { note: a.note ?? null } });
    const info = await partnerFacts(t, p.id);
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-application-approved', to: r.email, toUserId: r.userId, dedupeKey: `partner:${p.id}:approved`,
      vars: {
        partnerName: info.partner.businessName, partnerCategory: info.categoryName, city: info.cityName,
        radiusKm: info.partner.serviceRadiusKm ?? 0, packages: info.packages, onRequest: info.onRequest,
        policyName: info.partner.cancellationPolicy ? POLICY_LABEL[info.partner.cancellationPolicy] : '',
      },
    });
    return { approvedAt: at };
  });
}

/** P6 ‹Върни за поправка› (note required) → `vendor-application-returned`. */
export async function returnApplication(actor: AnyActor, a: { partnerId: string; note: string }, tx?: Tx) {
  assertCan(actor, 'approve_partners');
  const note = a.note?.trim();
  if (!note) throw new DomainError('note_required');
  return withTx(tx, async t => {
    const p = await lockForDecision(t, a.partnerId);
    const at = await now();
    await t.update(partner).set({ status: 'returned', returnedAt: at, lastDecisionNote: note, onboardingStep: 6, updatedAt: at }).where(eq(partner.id, p.id));
    await t.insert(partnerDecision).values({ partnerId: p.id, decision: 'returned', note, decidedBy: actor.userId, decidedAt: at });
    await audit(t, { actor, action: 'partner.returned', entity: 'partner', entityId: p.id, data: { note } });
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-application-returned', to: r.email, toUserId: r.userId, dedupeKey: `partner:${p.id}:returned:${at.toISOString()}`,
      vars: { partnerName: p.businessName, note, submittedAt: dateTime(p.submittedAt!) },
    });
  });
}

/** P7 ‹Откажи заявката› (the reason is required) → `vendor-application-rejected`. */
export async function reject(actor: AnyActor, a: { partnerId: string; note: string }, tx?: Tx) {
  assertCan(actor, 'approve_partners');
  const note = a.note?.trim();
  if (!note) throw new DomainError('note_required');
  return withTx(tx, async t => {
    const p = await lockForDecision(t, a.partnerId);
    const at = await now();
    await t.update(partner).set({ status: 'rejected', rejectedAt: at, lastDecisionNote: note, updatedAt: at }).where(eq(partner.id, p.id));
    await t.insert(partnerDecision).values({ partnerId: p.id, decision: 'rejected', note, decidedBy: actor.userId, decidedAt: at });
    await audit(t, { actor, action: 'partner.rejected', entity: 'partner', entityId: p.id, data: { note } });
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-application-rejected', to: r.email, toUserId: r.userId, dedupeKey: `partner:${p.id}:rejected`,
      vars: { partnerName: p.businessName, eik: p.eik ?? '', reason: note, submittedAt: dateTime(p.submittedAt!) },
    });
  });
}

/** ‹Покани изпълнител› [dialog new copy] → `vendor-invite`, toast ‹Поканата е изпратена›. */
export async function invite(actor: AnyActor, a: { email: string }, tx?: Tx) {
  assertCan(actor, 'invite_partner');
  const email = a.email?.trim().toLowerCase();
  if (!z.email().safeParse(email).success) throw new DomainError('invalid_email');
  return withTx(tx, async t => {
    const at = await now();
    const [me] = await t.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
    const [row] = await t.insert(partnerInvite).values({ email, invitedBy: actor.userId, sentAt: at }).returning();
    await audit(t, { actor, action: 'partner.invited', entity: 'partner_invite', entityId: row.id, data: { email } });
    await mail(t, { key: 'vendor-invite', to: email, vars: { inviterName: me?.name ?? '' }, dedupeKey: `partnerinvite:${row.id}` });
    return row;
  });
}

// ── §12.3 profile, listing flags, settings ───────────────────────────────

const profileSchema = z.object({
  shortDescription: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().min(1).max(600).optional(),
  socialHandle: z.string().trim().min(1).max(200).optional(),
  websiteUrl: z.string().trim().max(300).nullish(),
  videoUrl: z.string().trim().regex(VIDEO_RE).nullish().or(z.literal('')),
  cityId: uuid.optional(),
  radius: radius.optional(),
  maxGuests: z.number().int().positive().nullish(),
  languages: z.array(z.string().trim().min(1)).min(1).optional(),
  eventTypeIds: z.array(uuid).min(1).optional(),
  tags: z.array(z.object({ label: z.string().trim().min(1).max(60), isCustom: z.boolean().default(false) })).optional(),
  cancellationPolicy: z.enum(['flexible', 'moderate', 'strict']).optional(),
  depositPercent: z.union([z.literal(20), z.literal(30), z.literal(40), z.literal(50)]).optional(),
  reschedulePolicy: z.enum(['free_if_available', 'one_free', 'not_allowed']).optional(),
});

/**
 * ‹Запази промените› on `/partner/profil`: saved immediately, not moderated (D59). The name is
 * read-only here (D83). A policy change applies only to bookings approved afterwards (snapshot at K1).
 */
export async function updateProfile(actor: AnyActor, input: z.input<typeof profileSchema>, tx?: Tx) {
  const d = parse(profileSchema, input);
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    const set: Partial<Partner> = { updatedAt: await now() };
    if (d.shortDescription !== undefined) set.shortDescription = d.shortDescription;
    if (d.description !== undefined) set.description = d.description;
    if (d.socialHandle !== undefined) set.socialHandle = d.socialHandle;
    if (d.websiteUrl !== undefined) set.websiteUrl = d.websiteUrl || null;
    if (d.videoUrl !== undefined) set.videoUrl = d.videoUrl || null;
    if (d.cityId !== undefined) set.cityId = d.cityId;
    if (d.radius !== undefined) { set.servesNationwide = d.radius === 'nationwide'; set.serviceRadiusKm = d.radius === 'nationwide' ? null : d.radius; }
    if (d.maxGuests !== undefined) set.maxGuests = d.maxGuests ?? null;
    if (d.languages !== undefined) set.languages = d.languages;
    if (d.cancellationPolicy !== undefined) set.cancellationPolicy = d.cancellationPolicy;
    if (d.depositPercent !== undefined) set.depositPercent = d.depositPercent;
    if (d.reschedulePolicy !== undefined) set.reschedulePolicy = d.reschedulePolicy;
    await t.update(partner).set(set).where(eq(partner.id, p.id));
    if (d.eventTypeIds) await setEventTypes(t, p.id, d.eventTypeIds);
    if (d.tags) await setTags(t, p.id, d.tags);
    await refreshChecks(t, p.id);
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'partner.profile_updated', entity: 'partner', entityId: p.id, data: { fields: Object.keys(d) } });
  });
}

/**
 * The listing flags (no email, immediate): ‹Профилът е активен› (`is_listed`) and
 * ‹Приемам нови заявки› (`accepting_requests`). Entering the search base set stamps `listed_at`.
 */
export async function setListing(actor: AnyActor, a: { isListed?: boolean; acceptingRequests?: boolean }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    const at = await now();
    const isListed = a.isListed ?? p.isListed, accepting = a.acceptingRequests ?? p.acceptingRequests;
    const entered = isListed && accepting && !(p.isListed && p.acceptingRequests);
    await t.update(partner).set({ isListed, acceptingRequests: accepting, listedAt: entered ? at : p.listedAt, updatedAt: at }).where(eq(partner.id, p.id));
    await audit(t, { actor, action: 'partner.listing_changed', entity: 'partner', entityId: p.id, data: { isListed, acceptingRequests: accepting } });
  });
}

const accountSchema = z.object({
  contactName: z.string().trim().min(1).max(120).optional(),
  notificationEmail: z.email().optional(),
  phone: z.string().trim().min(1).optional(),
  legalName: z.string().trim().min(1).max(200).optional(),
  registeredAddress: z.string().trim().max(300).nullish(),
  managerName: z.string().trim().max(120).nullish(),
  vatRegistered: z.boolean().optional(),
  vatNumber: z.string().trim().max(30).nullish(),
});

/** ‹Запази промените› on `/partner/nastroyki` (account fields; the name has its own control). */
export async function updateAccount(actor: AnyActor, input: z.input<typeof accountSchema>, tx?: Tx) {
  const d = parse(accountSchema, input);
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    const set: Partial<Partner> = { updatedAt: await now() };
    if (d.contactName !== undefined) set.contactName = d.contactName;
    if (d.notificationEmail !== undefined) set.notificationEmail = d.notificationEmail.toLowerCase();
    if (d.phone !== undefined) { const ph = normalizePhone(d.phone); if (!ph) throw new DomainError('invalid_phone'); set.phone = ph; }
    if (d.legalName !== undefined) set.legalName = d.legalName;
    if (d.registeredAddress !== undefined) set.registeredAddress = d.registeredAddress || null;
    if (d.managerName !== undefined) set.managerName = d.managerName || null;
    if (d.vatRegistered !== undefined) set.vatRegistered = d.vatRegistered;
    if (d.vatNumber !== undefined) set.vatNumber = d.vatNumber || null;
    await t.update(partner).set(set).where(eq(partner.id, p.id));
    await audit(t, { actor, action: 'partner.account_updated', entity: 'partner', entityId: p.id, data: { fields: Object.keys(d) } });
  });
}

/** ‹Последна промяна на {12 август} — следваща от {12 септември}› (D83). */
export async function nameChangeWindow(p: Pick<Partner, 'businessNameChangedAt'>, q: Queryable = db): Promise<{ lastChangedOn: DateStr | null; nextFrom: DateStr | null; allowed: boolean }> {
  if (!p.businessNameChangedAt) return { lastChangedOn: null, nextFrom: null, allowed: true };
  const months = await getSetting('partner.name_change_interval_months', undefined, q);
  const last = sofiaDate(p.businessNameChangedAt);
  const next = addMonths(last, months);
  return { lastChangedOn: last, nextFrom: next, allowed: sofiaDate(await now()) >= next };
}

/** ‹Смени името› (§12.3, D83): once per ⚙ partner.name_change_interval_months. The slug (URL) stays. */
export async function changeBusinessName(actor: AnyActor, a: { businessName: string }, tx?: Tx) {
  const name = a.businessName?.trim();
  if (!name || name.length > 120) throw new DomainError('validation');
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    const w = await nameChangeWindow(p, t);
    if (!w.allowed) throw new DomainError('name_change_too_soon', undefined, { nextFrom: w.nextFrom });
    const at = await now();
    await t.update(partner).set({ businessName: name, businessNameChangedAt: at, updatedAt: at }).where(eq(partner.id, p.id));
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'partner.name_changed', entity: 'partner', entityId: p.id, data: { from: p.businessName, to: name } });
  });
}

// ── P8 / P9 deactivation ─────────────────────────────────────────────────

async function upcomingBookings(q: Queryable, partnerId: string): Promise<number> {
  const today = sofiaDate(await now());
  const [{ n }] = await q.select({ n: count() }).from(booking).where(and(eq(booking.partnerId, partnerId),
    inArray(booking.status, ['confirmed', 'cancellation_requested']), gte(booking.eventDate, today)));
  return n;
}

/** Bookings the client can still pay (`awaiting_payment`): paying one after P10 would confirm a deleted partner. */
async function payableBookings(q: Queryable, partnerId: string): Promise<number> {
  const [{ n }] = await q.select({ n: count() }).from(booking).where(and(eq(booking.partnerId, partnerId), eq(booking.status, 'awaiting_payment')));
  return n;
}

/**
 * P8 ‹Деактивирай›: hidden from every listing; confirmed bookings stay; pending requests stay
 * answerable; `vendor-deactivated`; toast ‹Профилът е деактивиран — можете да го върнете по всяко време›.
 */
export async function deactivate(actor: AnyActor, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved') throw new DomainError('partner_status');
    const at = await now();
    await t.update(partner).set({ status: 'deactivated', deactivatedAt: at, updatedAt: at }).where(eq(partner.id, p.id));
    await audit(t, { actor, action: 'partner.deactivated', entity: 'partner', entityId: p.id });
    const info = await partnerFacts(t, p.id);
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-deactivated', to: r.email, toUserId: r.userId, dedupeKey: `partner:${p.id}:deactivated:${at.toISOString()}`,
      vars: { partnerName: p.businessName, partnerCategory: info.categoryName, upcomingCount: await upcomingBookings(t, p.id) },
    });
  });
}

/** P9 reactivate (control not drawn; new copy, D24): listed again, no email. */
export async function reactivate(actor: AnyActor, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'deactivated') throw new DomainError('partner_status');
    const at = await now();
    await t.update(partner).set({ status: 'approved', deactivatedAt: null, listedAt: p.isListed && p.acceptingRequests ? at : p.listedAt, updatedAt: at }).where(eq(partner.id, p.id));
    await audit(t, { actor, action: 'partner.reactivated', entity: 'partner', entityId: p.id });
  });
}

// ── P10 deletion ─────────────────────────────────────────────────────────

/**
 * Why ‹Изтрий› is disabled: upcoming bookings (D56) — confirmed ones and those still waiting for
 * the client's payment, which would otherwise confirm with a deleted partner — or an open dispute.
 */
export async function deletionBlockers(q: Queryable, partnerId: string): Promise<{ upcomingBookings: number; openDisputes: number }> {
  const [{ n }] = await q.select({ n: count() }).from(dispute).innerJoin(booking, eq(booking.id, dispute.bookingId))
    .where(and(eq(booking.partnerId, partnerId), inArray(dispute.status, ['collecting', 'awaiting_decision'])));
  return { upcomingBookings: await upcomingBookings(q, partnerId) + await payableBookings(q, partnerId), openDisputes: n };
}

/** P10 ‹Изтрий› → `vendor-delete-confirm` with a 24 h link (T24). Returns the token for the link. */
export async function requestDeletion(actor: AnyActor, tx?: Tx): Promise<{ token: string; expiresAt: Date }> {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    const b = await deletionBlockers(t, p.id);
    if (b.upcomingBookings || b.openDisputes) throw new DomainError('has_upcoming_bookings', undefined, b);
    const userId = (actor as Actor).userId;
    const at = await now();
    const expiresAt = new Date(at.getTime() + 24 * 3600_000);
    await supersedeDeletionRequests(t, userId);
    const { token, hash } = newToken();
    const [req] = await t.insert(accountDeletionRequest).values({ userId, tokenHash: hash, requestedAt: at, expiresAt }).returning();
    await scheduleJob('deletion.expire', expiresAt, { requestId: req.id }, `deletion:${req.id}:expire`, t);
    const [u] = await t.select({ email: user.email }).from(user).where(eq(user.id, userId));
    await audit(t, { actor, action: 'partner.deletion_requested', entity: 'partner', entityId: p.id });
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-delete-confirm', to: r.email, toUserId: userId, dedupeKey: `deletion:${req.id}`,
      vars: { partnerName: p.businessName, email: u.email, url: `/partner/nastroyki/iztrivane?token=${token}` },
    });
    return { token, expiresAt };
  });
}

/**
 * P10 ‹Потвърди изтриването› (email link): the user and partner are anonymised, services archived,
 * sessions revoked; ledger and invoices are kept. The guards are checked again.
 */
export async function confirmDeletion(a: { token: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const req = await consumeDeletionToken(t, a.token, 'partner');
    const [m] = await t.select().from(partnerMember).where(eq(partnerMember.userId, req.userId));
    if (!m) throw new NotFoundError('partner');
    const [p] = await t.select().from(partner).where(eq(partner.id, m.partnerId)).for('update');
    const b = await deletionBlockers(t, p.id);
    if (b.upcomingBookings || b.openDisputes) throw new DomainError('has_upcoming_bookings', undefined, b);
    const at = await now();
    await t.update(service).set({ status: 'archived', archivedAt: at, updatedAt: at }).where(and(eq(service.partnerId, p.id), ne(service.status, 'archived')));
    await t.update(partner).set({
      status: 'deleted', deletedAt: at, isListed: false, acceptingRequests: false, slug: `deleted-${p.id}`,
      businessName: 'Изтрит профил', contactName: 'Изтрит профил', notificationEmail: `deleted+${p.id}@eventat.invalid`, phone: '',
      socialHandle: null, websiteUrl: null, videoUrl: null, description: null, shortDescription: null, avatarMediaId: null, coverMediaId: null,
      searchText: '', updatedAt: at,
    }).where(eq(partner.id, p.id));
    await t.delete(partnerPhoto).where(eq(partnerPhoto.partnerId, p.id));
    await anonymiseUser(t, req.userId, at);
    await audit(t, { actor: SYSTEM, action: 'partner.deleted', entity: 'partner', entityId: p.id, data: { userId: req.userId } });
    return { partnerId: p.id };
  });
}

// ── P11 provider account ─────────────────────────────────────────────────

/** P11 `account.updated` (stripe webhook, via lib/payments/apply.ts): provider flags and requirements. Idempotent. */
export async function applyAccountUpdate(a: { accountRef: string; status: PartnerAccountStatus }, tx?: Tx) {
  return withTx(tx, async t => {
    const [p] = await t.select().from(partner).where(eq(partner.providerAccountRef, a.accountRef)).for('update');
    if (!p) return null;
    const st = providerStatusFrom(a.status, p.providerStatus);
    await t.update(partner).set({
      providerStatus: st, providerChargesEnabled: a.status.chargesEnabled, providerPayoutsEnabled: a.status.payoutsEnabled,
      providerRequirements: a.status.requirementsDue, updatedAt: await now(),
    }).where(eq(partner.id, p.id));
    await audit(t, { actor: SYSTEM, action: 'partner.provider_updated', entity: 'partner', entityId: p.id, data: { ...a.status, providerStatus: st } });
    return st;
  });
}

// ── Derived fields (§12.4, §13.3) ────────────────────────────────────────

/**
 * The service statuses a profile lists. Live services once the partner is approved; before that
 * (the owner's or the team's ‹Виж профила като клиент› preview) also the `ready` onboarding
 * packages, which go live with the profile on approval (S5, P5).
 */
export function profileServiceStatuses(status: PartnerStatus): ServiceStatus[] {
  return status === 'draft' || status === 'submitted' || status === 'returned' ? ['ready', 'active'] : ['active'];
}

/**
 * The from-price (§12.4) of the services a profile lists: the lowest `per_event` fixed package
 * shown in the profile, else the lowest `per_guest` one; null with on-request services only.
 */
export function lowestPrice(svcs: { kind: ServiceKind; priceCents: number | null; priceUnit: PriceUnit; showInProfile: boolean }[]):
  { cents: number; unit: PriceUnit } | null {
  const priced = svcs.filter(x => x.kind === 'package_fixed' && x.showInProfile && x.priceCents != null);
  for (const unit of ['per_event', 'per_guest'] as const) {
    const prices = priced.filter(x => x.priceUnit === unit).map(x => x.priceCents!);
    if (prices.length) return { cents: Math.min(...prices), unit };
  }
  return null;
}

/**
 * Recompute what is cached on `partner`: the stem-matcher haystack `search_text` (§13.3:
 * business name + primary category + categories of active services + base city + event types,
 * lower-case), the from-price (§12.4), `is_verified` (checks company and contacts ok) and the
 * rating cache (published reviews). Called after every change that can move them.
 */
export async function refreshPartner(tx: Queryable, partnerId: string) {
  const [p] = await tx.select({ p: partner, cat: category.name, cityName: city.name }).from(partner)
    .leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .leftJoin(city, eq(city.id, partner.cityId))
    .where(eq(partner.id, partnerId));
  if (!p) return;
  const svcCats = await tx.selectDistinct({ name: category.name }).from(service).innerJoin(category, eq(category.id, service.categoryId))
    .where(and(eq(service.partnerId, partnerId), eq(service.status, 'active')));
  const types = await tx.select({ name: eventType.name }).from(partnerEventType).innerJoin(eventType, eq(eventType.id, partnerEventType.eventTypeId))
    .where(eq(partnerEventType.partnerId, partnerId));
  const words = [p.p.businessName, p.cat, ...svcCats.map(c => c.name), p.cityName, ...types.map(t => t.name)].filter(Boolean) as string[];
  const searchText = [...new Set(words)].join(' ').toLowerCase();

  const from = lowestPrice(await tx.select({ kind: service.kind, priceCents: service.priceCents, priceUnit: service.priceUnit, showInProfile: service.showInProfile })
    .from(service).where(and(eq(service.partnerId, partnerId), eq(service.status, 'active'))));
  const minPrice = from?.cents ?? null;
  const minUnit = from?.unit ?? null;

  const checks = await tx.select().from(partnerCheck).where(and(eq(partnerCheck.partnerId, partnerId), inArray(partnerCheck.kind, ['company', 'contacts'])));
  const verified = checks.length === 2 && checks.every(c => c.state === 'ok');

  const [r] = await tx.select({ avg: sql<string | null>`round(avg(${review.ratingOverall})::numeric, 1)`, n: count() }).from(review).where(eq(review.partnerId, partnerId));

  await tx.update(partner).set({
    searchText, minPriceCents: minPrice, minPriceUnit: minUnit,
    // Seeded / legacy partners without check rows keep their stored flag.
    isVerified: checks.length ? verified : p.p.isVerified,
    ratingAvg: r.n ? Number(r.avg) : null, reviewCount: r.n,
  }).where(eq(partner.id, partnerId));
}

/**
 * An expired request that counts against the partner (R8: T2, or T4 on a chosen offer never
 * confirmed). An offer that lapsed without ever being chosen (R10, O5: date taken or passed)
 * is not the partner's silence. Shared by §12.4 responsiveness and the D44 search filter.
 */
export const requestLapsedSql = (requestId: unknown) => sql`not exists (select 1 from offer o where o.request_id = ${requestId}
  and o.status = 'lapsed' and o.chosen_at is null)`;

/**
 * Responsiveness ‹96% отзивчивост› (§12.4): the share of requests and brief invitations sent in
 * the last 180 days that were answered (approved, declined or offered) before their deadline.
 * R8 lapses count against it (T2 and T4, for every request kind); an offer that lapsed later
 * (R10) does not undo an answer; one still inside its deadline is not judged yet.
 * Null (hidden) when there is nothing to judge.
 */
export async function responsiveness(partnerId: string, q: Queryable = db): Promise<number | null> {
  const at = await now();
  const since = new Date(at.getTime() - 180 * 86_400_000);
  const reqs = await q.select({
    answeredAt: request.answeredAt, due: request.responseDueAt, status: request.status,
    // Qualified: in a single-table select drizzle leaves `id` bare, which the subquery would read as offer.id.
    lapsed: sql<boolean>`(${request.status} = 'expired' and ${requestLapsedSql(sql.raw('"request"."id"'))})`,
  }).from(request).where(and(eq(request.partnerId, partnerId), gte(request.sentAt, since)));
  const invs = await q.select({ answeredAt: briefInvitation.answeredAt, due: briefInvitation.offerDueAt, status: briefInvitation.status }).from(briefInvitation)
    .where(and(eq(briefInvitation.partnerId, partnerId), gte(briefInvitation.invitedAt, since)));
  let judged = 0, answered = 0;
  for (const r of reqs) {
    if (r.status === 'pending' || r.status === 'awaiting_confirmation') {
      if (r.due > at) continue; // still inside its deadline
      judged++; // overdue: lapses at the next tick
      continue;
    }
    judged++;
    if (!r.lapsed && r.answeredAt && r.answeredAt <= r.due) answered++;
  }
  for (const i of invs) {
    if (i.status === 'invited' && i.due > at) continue;
    judged++;
    if (i.status !== 'lapsed' && i.status !== 'invited' && i.answeredAt && i.answeredAt <= i.due) answered++;
  }
  return judged ? Math.round((answered / judged) * 100) : null;
}

/** Nightly cache of responsiveness for listed partners (job `partners.metrics`). */
export async function refreshResponsiveness(q: Queryable = db): Promise<number> {
  const rows = await q.select({ id: partner.id }).from(partner).where(inArray(partner.status, ['approved', 'deactivated']));
  for (const r of rows) await q.update(partner).set({ responsivenessPct: await responsiveness(r.id, q) }).where(eq(partner.id, r.id));
  return rows.length;
}

/** ‹от 640 €› + ‹за събитие› / ‹на гост› (§12.4); null when only on-request services exist. */
export function fromPrice(p: Pick<Partner, 'minPriceCents' | 'minPriceUnit'>): { cents: number; unit: 'per_event' | 'per_guest'; text: string; unitLabel: string } | null {
  if (p.minPriceCents == null || !p.minPriceUnit) return null;
  return { cents: p.minPriceCents, unit: p.minPriceUnit, text: `от ${moneyShort(p.minPriceCents)}`, unitLabel: p.minPriceUnit === 'per_guest' ? 'на гост' : 'за събитие' };
}

/**
 * Admin: bookings and turnover (§12.4) — confirmed, completed and cancelled-with-retained bookings.
 * Turnover is a money column, so it needs `view_finance` (§1.2).
 */
export async function adminTotals(actor: AnyActor, partnerId: string, q: Queryable = db) {
  assertCan(actor, 'view_finance');
  const rows = await q.execute<{ n: number; total: string | null }>(sql`
    select count(*)::int as n, coalesce(sum(b.amount_cents), 0)::bigint as total from booking b
    left join cancellation c on c.booking_id = b.id
    where b.partner_id = ${partnerId}
      and (b.status in ('confirmed', 'completed') or (b.status = 'cancelled' and coalesce(c.retained_cents, 0) > 0))`);
  return { bookings: rows[0]?.n ?? 0, turnoverCents: Number(rows[0]?.total ?? 0) };
}

/** Partners waiting for approval, oldest first, with ‹профил N от 6› (`/admin/partnyori`). */
export async function approvalQueue(actor: AnyActor, q: Queryable = db) {
  assertCan(actor, 'approve_partners');
  const rows = await q.select({ p: partner, categoryName: category.name, cityName: city.name }).from(partner)
    .leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
    .where(eq(partner.status, 'submitted')).orderBy(asc(partner.submittedAt));
  const out = [];
  for (const r of rows) out.push({ ...r, checks: await checksSummary(q, r.p.id) });
  return out;
}

/** Last decisions on a partner (admin side panel). */
export async function decisions(partnerId: string, q: Queryable = db) {
  return q.select().from(partnerDecision).where(eq(partnerDecision.partnerId, partnerId)).orderBy(desc(partnerDecision.decidedAt));
}


/** Schedule the nightly responsiveness refresh (job `partners.metrics`, 03:00 Sofia). Idempotent. */
export async function schedulePartnerMetrics(tx?: Tx, after?: Date): Promise<DateStr> {
  const at = after ?? await now();
  let d = sofiaDate(at);
  if (sofiaInstant(d, 3, 0) <= at) d = addDays(d, 1);
  await scheduleJob('partners.metrics', sofiaInstant(d, 3, 0), { date: d }, `partnermetrics:${d}`, tx);
  return d;
}

/**
 * Partner panel counts (§12.5): ‹Нови заявки› / the ‹Заявки› rail counter (pending requests and
 * open brief invitations), ‹Чакат плащане›, ‹Предстоящи събития›.
 */
export async function panelCounts(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const today = sofiaDate(await now());
  const [{ n: pending }] = await q.select({ n: count() }).from(request).where(and(eq(request.partnerId, p.id), eq(request.status, 'pending')));
  const [{ n: invited }] = await q.select({ n: count() }).from(briefInvitation).where(and(eq(briefInvitation.partnerId, p.id), eq(briefInvitation.status, 'invited')));
  const [{ n: awaiting }] = await q.select({ n: count() }).from(booking).where(and(eq(booking.partnerId, p.id), eq(booking.status, 'awaiting_payment')));
  const [{ n: upcoming }] = await q.select({ n: count() }).from(booking).where(and(eq(booking.partnerId, p.id), eq(booking.status, 'confirmed'), gte(booking.eventDate, today)));
  return { newRequests: pending + invited, awaitingPayment: awaiting, upcomingEvents: upcoming };
}
