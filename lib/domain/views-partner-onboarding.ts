import 'server-only';
// Read models for the partner sign-up wizard (SCREENS §6, SPEC §12.1):
// /partner/registratsiya/1…6 and /partner/registratsiya/podadeno.
// Writes go through partners.ts / services.ts / availability.ts / media.ts.
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import {
  availabilityBlock, category, city, eventType, media, partner, partnerEventType, partnerPhoto, partnerTag, service, serviceInclusion,
  type CancellationPolicy,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, date, dateShort, monthName, sofiaDate, type DateStr } from '@/lib/format';
import type { AnyActor } from './actor';
import { addMonths, isDate } from './availability';
import { displayPhone, mediaUrl, partnerOf } from './catalogue-kit';
import { POLICY_LABEL, onboardingSummary } from './partners';
import { onboardingServiceErrors } from './services';
import { getSetting, type CancellationPolicies } from './settings';

export * from './onboarding-labels';
import {
  STANDARD_TAGS, STEP_HINTS, STEP_TITLES, WEEKDAYS_SHORT, cap, experienceLabel, firstName, horizonLabel, leadTimeLabel, legalFormLabel,
  radiusLabel, radiusValue, rescheduleLabel,
} from './onboarding-labels';

/** The policy timeline numbers (onboarding/policy.html) from ⚙ cancellation.policies (§5.2). */
export function policyDays(p: CancellationPolicies) {
  const days = (t: { minDaysBefore: number }[], i: number) => t[i]?.minDaysBefore ?? 0;
  return {
    flexibleFree: days(p.flexible.tiers, 0),
    moderateFree: days(p.moderate.tiers, 0),
    moderateDeposit: days(p.moderate.tiers, 1),
    strictRemainder: days(p.strict.tiers, 0),
  };
}

/** ‹Умерена · безплатно анулиране до 30 дни преди събитието› (review step). */
export function policyLine(policy: CancellationPolicy, p: CancellationPolicies): string {
  const d = policyDays(p);
  if (policy === 'flexible') return `${POLICY_LABEL.flexible} · безплатно анулиране до ${d.flexibleFree} дни преди събитието`;
  if (policy === 'moderate') return `${POLICY_LABEL.moderate} · безплатно анулиране до ${d.moderateFree} дни преди събитието`;
  return `${POLICY_LABEL.strict} · депозитът не се връща`;
}

// ── Chrome (layout) ──────────────────────────────────────────────────────

export type WizardStep = { step: number; title: string; done: boolean; reachable: boolean; meta: string };

/**
 * The wizard frame: status, the steps rail (done / reachable / meta, §12.1) and the save status.
 * A step is reachable when it is done, or every step before it is done (the next unfinished one).
 */
export async function wizardChrome(actor: AnyActor, q: Queryable = db) {
  const s = await onboardingSummary(actor, q);
  // A step counts as done once it is valid and the partner has moved past it (‹Продължи…›);
  // a returned application has passed every step.
  const done = s.steps.map(x => x.done && (s.onboardingStep > x.step || s.status === 'returned'));
  const allDone = done.every(Boolean);
  const steps: WizardStep[] = STEP_TITLES.map((title, i) => {
    const n = i + 1;
    const isDone = n <= 5 ? done[i] : false;
    const before = done.slice(0, i).every(Boolean);
    return {
      step: n, title, done: isDone, reachable: isDone || before || (n === 6 && allDone),
      meta: (n <= 5 && isDone ? s.steps[i].meta : null) ?? STEP_HINTS[i],
    };
  });
  return {
    status: s.status, onboardingStep: s.onboardingStep, draftSavedAt: s.draftSavedAt, serverNow: await now(),
    steps, firstOpen: steps.find(x => !x.done)?.step ?? 6, lastDecisionNote: s.lastDecisionNote,
  };
}

// ── Step data ────────────────────────────────────────────────────────────

const photoUrlOf = (key: string | null | undefined) => mediaUrl(key);

async function mediaKey(q: Queryable, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [m] = await q.select({ key: media.storageKey }).from(media).where(eq(media.id, id)).limit(1);
  return m?.key ?? null;
}

export async function visibleCategories(q: Queryable = db) {
  return q.select({ id: category.id, name: category.name }).from(category)
    .where(eq(category.isVisible, true)).orderBy(asc(category.sortOrder), asc(category.name));
}

export async function stepBusiness(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const cats = await visibleCategories(q);
  const cities = await q.select({ id: city.id, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder));
  return {
    values: {
      businessName: p.businessName, legalForm: p.legalForm ?? '', legalFormOther: p.legalFormOther ?? '', eik: p.eik ?? '',
      primaryCategoryId: p.primaryCategoryId ?? '', cityId: p.cityId ?? '', radius: radiusValue(p), experienceBand: p.experienceBand ?? '',
      languages: p.languages.join(', '), contactName: p.contactName, notificationEmail: p.notificationEmail,
      phone: displayPhone(p.phone), websiteUrl: p.websiteUrl ?? '', socialHandle: p.socialHandle ?? '',
    },
    categories: cats, cities,
  };
}

export async function galleryOf(partnerId: string, q: Queryable = db) {
  const rows = await q.select({ id: partnerPhoto.id, mediaId: partnerPhoto.mediaId, key: media.storageKey }).from(partnerPhoto)
    .innerJoin(media, eq(media.id, partnerPhoto.mediaId))
    .where(eq(partnerPhoto.partnerId, partnerId)).orderBy(asc(partnerPhoto.position));
  return rows.map(r => ({ id: r.id, mediaId: r.mediaId, url: photoUrlOf(r.key)! }));
}

async function specialisations(partnerId: string, q: Queryable) {
  const types = await q.select({ id: eventType.id, plural: eventType.namePluralLower }).from(eventType)
    .where(eq(eventType.isPublic, true)).orderBy(asc(eventType.sortOrder));
  const chosenTypes = new Set((await q.select({ id: partnerEventType.eventTypeId }).from(partnerEventType)
    .where(eq(partnerEventType.partnerId, partnerId))).map(r => r.id));
  const tags = await q.select({ label: partnerTag.label, isCustom: partnerTag.isCustom }).from(partnerTag).where(eq(partnerTag.partnerId, partnerId));
  return {
    eventTypes: types.filter(t => t.plural).map(t => ({ id: t.id, label: cap(t.plural), on: chosenTypes.has(t.id) })),
    tags: [
      ...STANDARD_TAGS.map(l => ({ label: l, custom: false, on: tags.some(t => t.label === l) })),
      ...tags.filter(t => !(STANDARD_TAGS as readonly string[]).includes(t.label)).map(t => ({ label: t.label, custom: true, on: true })),
    ],
  };
}

export async function stepProfile(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const [avatarKey, coverKey] = await Promise.all([mediaKey(q, p.avatarMediaId), mediaKey(q, p.coverMediaId)]);
  return {
    avatarUrl: photoUrlOf(avatarKey), coverUrl: photoUrlOf(coverKey),
    photos: await galleryOf(p.id, q),
    galleryMin: await getSetting('partner.gallery_min', undefined, q), galleryMax: await getSetting('partner.gallery_max', undefined, q),
    values: { shortDescription: p.shortDescription ?? '', description: p.description ?? '', videoUrl: p.videoUrl ?? '' },
    ...(await specialisations(p.id, q)),
  };
}

export type OnboardingService = {
  id: string; kind: 'package_fixed' | 'on_request'; name: string; categoryId: string; description: string; priceCents: number | null;
  durationLabel: string; extraHourEnabled: boolean; extraHourPriceCents: number | null; travelFeeEnabled: boolean;
  inclusions: string[]; thumbUrl: string | null; status: string; complete: boolean;
};

/** The wizard's services (not archived, add-ons excluded), first fixed package first (‹Препоръчан›). */
export async function onboardingServices(partnerId: string, q: Queryable = db): Promise<OnboardingService[]> {
  const rows = await q.select({ s: service, key: media.storageKey }).from(service)
    .leftJoin(media, eq(media.id, service.coverMediaId))
    .where(and(eq(service.partnerId, partnerId), ne(service.status, 'archived'), inArray(service.kind, ['package_fixed', 'on_request'])))
    .orderBy(asc(service.sortOrder), asc(service.createdAt));
  const ids = rows.map(r => r.s.id);
  const inc = ids.length ? await q.select().from(serviceInclusion).where(inArray(serviceInclusion.serviceId, ids)).orderBy(asc(serviceInclusion.position)) : [];
  const [first] = await galleryOf(partnerId, q);
  return rows.map(({ s, key }) => ({
    id: s.id, kind: s.kind as 'package_fixed' | 'on_request', name: s.name, categoryId: s.categoryId, description: s.description,
    priceCents: s.priceCents, durationLabel: s.durationLabel ?? '', extraHourEnabled: s.extraHourEnabled, extraHourPriceCents: s.extraHourPriceCents,
    travelFeeEnabled: s.travelFeeEnabled, inclusions: inc.filter(i => i.serviceId === s.id).map(i => i.text),
    thumbUrl: photoUrlOf(key) ?? first?.url ?? null, status: s.status, complete: onboardingServiceErrors(s).length === 0,
  }));
}

export async function stepServices(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const [c] = p.cityId ? await q.select({ name: city.name }).from(city).where(eq(city.id, p.cityId)) : [];
  return {
    offersFixedPackages: p.offersFixedPackages, offersOnRequest: p.offersOnRequest,
    services: await onboardingServices(p.id, q), categories: await visibleCategories(q),
    defaultCategoryId: p.primaryCategoryId, cityName: c?.name ?? '', maxPackages: await getSetting('partner.max_packages', undefined, q),
    fallbackThumb: (await galleryOf(p.id, q))[0]?.url ?? null,
  };
}

/** The month grid of onboarding step 4: Monday-first weeks, manual blocks, today. `month` = 'YYYY-MM'. */
export async function stepAvailability(actor: AnyActor, month: string | undefined, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const today = sofiaDate(await now());
  const first = today.slice(0, 7);
  const last = addMonths(`${first}-01`, Math.max(p.horizonMonths, 24)).slice(0, 7);
  // Opens on the month of the first date clients can ask for (today + lead time).
  const opening = addDays(today, p.leadTimeDays).slice(0, 7);
  const m = month && /^\d{4}-\d{2}$/.test(month) && isDate(`${month}-01`) && month >= first && month <= last ? month : opening;
  const from = `${m}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const blocks = await q.select({ start: availabilityBlock.startDate, end: availabilityBlock.endDate }).from(availabilityBlock)
    .where(and(eq(availabilityBlock.partnerId, p.id), lte(availabilityBlock.startDate, to), gte(availabilityBlock.endDate, from)));
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: { date: DateStr; day: number; out: boolean; past: boolean; today: boolean; blocked: boolean }[] = [];
  const gridStart = addDays(from, -lead);
  const total = Math.ceil((lead + Number(to.slice(8))) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const d = addDays(gridStart, i);
    cells.push({
      date: d, day: Number(d.slice(8)), out: d < from || d > to, past: d < today, today: d === today,
      blocked: d >= from && d <= to && blocks.some(b => b.start <= d && d <= b.end),
    });
  }
  const prev = m > first ? addMonths(from, -1).slice(0, 7) : null;
  const next = m < last ? addMonths(from, 1).slice(0, 7) : null;
  return {
    values: {
      bookingsPerDayMode: p.bookingsPerDayMode, maxBookingsPerDate: p.maxBookingsPerDate, leadTimeDays: p.leadTimeDays,
      horizonMonths: p.horizonMonths, workingDays: p.workingDays,
    },
    calendar: { month: m, title: `${cap(monthName(Number(m.slice(5))))} ${m.slice(0, 4)}`, cells, prev, next },
  };
}

export async function stepPolicy(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  return {
    values: { cancellationPolicy: (p.cancellationPolicy ?? '') as CancellationPolicy | '', depositPercent: p.depositPercent, reschedulePolicy: p.reschedulePolicy },
    days: policyDays(await getSetting('cancellation.policies', undefined, q)),
  };
}

/** ‹17 и 18 юни 2026›, ‹3 – 10 август 2026›, ‹24 декември 2026› — the partner's manual blocks from today on. */
function blockText(start: DateStr, end: DateStr): string {
  if (start === end) return date(start);
  const [sy, sm] = [start.slice(0, 4), start.slice(5, 7)];
  const sameMonth = sy === end.slice(0, 4) && sm === end.slice(5, 7);
  if (sameMonth && addDays(start, 1) === end) return `${Number(start.slice(8))} и ${date(end)}`;
  if (sameMonth) return `${Number(start.slice(8))} – ${date(end)}`;
  if (sy === end.slice(0, 4)) return `${dateShort(start)} – ${date(end)}`;
  return `${date(start)} – ${date(end)}`;
}

/** Blocks that touch (one ends the day before the next starts) read as one period. */
function mergeAdjacent(blocks: { start: DateStr; end: DateStr }[]) {
  const out: { start: DateStr; end: DateStr }[] = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (last && addDays(last.end, 1) >= b.start) { if (b.end > last.end) last.end = b.end; } else out.push({ ...b });
  }
  return out;
}

export async function stepReview(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const [cat] = p.primaryCategoryId ? await q.select({ name: category.name }).from(category).where(eq(category.id, p.primaryCategoryId)) : [];
  const [c] = p.cityId ? await q.select({ name: city.name }).from(city).where(eq(city.id, p.cityId)) : [];
  const [avatarKey, coverKey] = await Promise.all([mediaKey(q, p.avatarMediaId), mediaKey(q, p.coverMediaId)]);
  const photos = await galleryOf(p.id, q);
  const spec = await specialisations(p.id, q);
  const services = await onboardingServices(p.id, q);
  const today = sofiaDate(await now());
  const blocks = await q.select({ start: availabilityBlock.startDate, end: availabilityBlock.endDate }).from(availabilityBlock)
    .where(and(eq(availabilityBlock.partnerId, p.id), gte(availabilityBlock.endDate, today))).orderBy(asc(availabilityBlock.startDate));
  const policies = await getSetting('cancellation.policies', undefined, q);
  const wd = [...p.workingDays].sort();
  return {
    partner: p,
    categoryName: cat?.name ?? '', cityName: c?.name ?? '',
    avatarUrl: photoUrlOf(avatarKey), coverUrl: photoUrlOf(coverKey), photoCount: photos.length,
    specialisations: [...spec.eventTypes.filter(t => t.on).map(t => t.label), ...spec.tags.filter(t => t.on).map(t => t.label)],
    services,
    packages: services.filter(s => s.kind === 'package_fixed').length,
    onRequest: services.filter(s => s.kind === 'on_request').length,
    legalForm: p.legalForm === 'other' && p.legalFormOther ? p.legalFormOther : legalFormLabel(p.legalForm),
    experience: experienceLabel(p.experienceBand), radius: radiusLabel(p), phone: displayPhone(p.phone),
    leadTime: leadTimeLabel(p.leadTimeDays), horizon: horizonLabel(p.horizonMonths),
    workingDays: wd.length === 7 ? 'Всички дни от седмицата' : wd.map(d => WEEKDAYS_SHORT[d - 1]).join(', '),
    blocks: blocks.length ? mergeAdjacent(blocks).map(b => blockText(b.start, b.end)).join(', ') : '—',
    policy: p.cancellationPolicy ? policyLine(p.cancellationPolicy, policies) : '—',
    policyName: p.cancellationPolicy ? POLICY_LABEL[p.cancellationPolicy] : '',
    reschedule: rescheduleLabel(p.reschedulePolicy),
    slaHours: await getSetting('partner.approval_sla_hours', undefined, q),
  };
}

/** /partner/registratsiya/podadeno: the application's live status (submitted → approved, or rejected, D51/D94). */
export async function pendingStatus(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  return {
    status: p.status, slug: p.slug, businessName: p.businessName, firstName: firstName(p.contactName), email: p.notificationEmail,
    eik: p.eik ?? '', submittedAt: p.submittedAt, approvedAt: p.approvedAt, rejectedAt: p.rejectedAt, note: p.lastDecisionNote,
    onboardingStep: p.onboardingStep, serverNow: await now(),
    slaHours: await getSetting('partner.approval_sla_hours', undefined, q), supportEmail: await getSetting('support.email', undefined, q),
  };
}
