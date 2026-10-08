// Services and their moderated revisions (SPEC §4.4 S1–S10, §12.2 validation).
//
//   ∅ ─S1─▶ draft ─S2─▶ pending_review ─S3─▶ active ◀─S9─▶ draft (visibility, immediate)
//                         │ S4                │ S6 edit → revision pending ─S7─▶ applied
//                         ▼                   │                          └─S8─▶ returned (live unchanged)
//                       returned ─S2─▶ …      └─S10─▶ archived
//   onboarding (draft partner): draft ─S5─▶ ready ─P5─▶ active
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, category, partner, request, service, serviceEventType, serviceInclusion, serviceRevision,
  type PriceUnit, type ServiceKind, type ServiceStatus,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { money } from '@/lib/format';
import { assertCan, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import { DomainError, NotFoundError, lockPartnerOf, mail, partnerOf, partnerRecipient, withTx, type Partner } from './catalogue-kit';
import { ownMedia } from './media';
import { refreshChecks, refreshPartner } from './partners';
import { getSetting } from './settings';

export type Service = typeof service.$inferSelect;
export type Revision = typeof serviceRevision.$inferSelect;

export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  package_fixed: 'Пакет с фиксирана цена', on_request: 'По запитване', addon: 'Допълнителна услуга',
};
export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  draft: 'Чернова', pending_review: 'В преглед', returned: 'Върната с бележка', ready: 'Готов', active: 'Активна', archived: 'Архив',
};

// ── Input and validation (§12.2) ─────────────────────────────────────────

const uuid = z.uuid();
const full = z.object({
  kind: z.enum(['package_fixed', 'on_request', 'addon']),
  name: z.string().trim().min(1).max(80),
  categoryId: uuid,
  description: z.string().trim().min(1).max(600),
  priceCents: z.number().int().positive().nullish(),
  priceUnit: z.enum(['per_event', 'per_guest']).default('per_event'),
  minGuests: z.number().int().positive().nullish(),
  durationLabel: z.string().trim().max(80).nullish(),
  extraHourEnabled: z.boolean().default(false),
  extraHourPriceCents: z.number().int().positive().nullish(),
  travelFeeEnabled: z.boolean().default(false),
  coverMediaId: uuid.nullish(),
  showInProfile: z.boolean().default(true),
  acceptingRequests: z.boolean().default(true),
  inclusions: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  eventTypeIds: z.array(uuid).min(1),
});
const draft = full.partial().extend({ name: z.string().trim().min(1).max(80) });
const onboarding = full.partial().extend({ name: z.string().trim().min(1).max(80), eventTypeIds: z.array(uuid).default([]) });

export type ServiceInput = z.input<typeof full>;
type Content = z.output<typeof full>;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('validation', r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), { issues: r.error.issues });
  return r.data;
}

/** The kind-specific rules of §12.2 on a complete service. */
function kindRules(c: Pick<Content, 'kind' | 'priceCents' | 'priceUnit' | 'minGuests' | 'extraHourEnabled' | 'extraHourPriceCents'>) {
  if (c.kind === 'on_request' && c.priceCents != null) throw new DomainError('validation', 'on_request has no price');
  if (c.kind !== 'on_request' && !(c.priceCents! > 0)) throw new DomainError('validation', 'price required');
  if (c.minGuests != null && c.priceUnit !== 'per_guest') throw new DomainError('validation', 'minGuests needs per_guest');
  if (c.extraHourEnabled && !(c.extraHourPriceCents! > 0)) throw new DomainError('validation', 'extra hour price required');
}

/** What onboarding step 3 still needs on a service (name, category, short description and, for packages, the price). */
export function onboardingServiceErrors(s: Pick<Service, 'kind' | 'name' | 'categoryId' | 'description' | 'priceCents'>): string[] {
  const e: string[] = [];
  if (!s.name?.trim()) e.push('name');
  if (!s.categoryId) e.push('category');
  if (!s.description?.trim()) e.push('description');
  if (s.kind !== 'on_request' && !(s.priceCents! > 0)) e.push('price');
  return e;
}

async function assertCategory(q: Queryable, categoryId: string) {
  const [c] = await q.select({ visible: category.isVisible }).from(category).where(eq(category.id, categoryId));
  if (!c) throw new DomainError('validation', 'unknown category');
  if (!c.visible) throw new DomainError('validation', 'category hidden');
}

/** ≤ ⚙ partner.max_packages fixed packages that are not archived (§12.2). */
async function assertPackageLimit(q: Queryable, partnerId: string, exceptId?: string) {
  const conds = [eq(service.partnerId, partnerId), eq(service.kind, 'package_fixed'), ne(service.status, 'archived')];
  if (exceptId) conds.push(ne(service.id, exceptId));
  const [{ n }] = await q.select({ n: count() }).from(service).where(and(...conds));
  if (n + 1 > await getSetting('partner.max_packages', undefined, q)) throw new DomainError('max_packages');
}

// ── Row helpers ──────────────────────────────────────────────────────────

const CONTENT_FIELDS = [
  'kind', 'name', 'categoryId', 'description', 'priceCents', 'priceUnit', 'minGuests', 'durationLabel', 'extraHourEnabled',
  'extraHourPriceCents', 'travelFeeEnabled', 'coverMediaId', 'inclusions', 'eventTypeIds',
] as const;
type ContentField = (typeof CONTENT_FIELDS)[number];
type Snapshot = Record<ContentField, unknown> & { showInProfile?: boolean; acceptingRequests?: boolean };

/** The service as the revision payload stores it (`new`: the full service). */
export async function snapshot(q: Queryable, s: Service): Promise<Snapshot> {
  const inc = await q.select({ text: serviceInclusion.text }).from(serviceInclusion).where(eq(serviceInclusion.serviceId, s.id)).orderBy(asc(serviceInclusion.position));
  const ets = await q.select({ id: serviceEventType.eventTypeId }).from(serviceEventType).where(eq(serviceEventType.serviceId, s.id));
  return {
    kind: s.kind, name: s.name, categoryId: s.categoryId, description: s.description, priceCents: s.priceCents, priceUnit: s.priceUnit,
    minGuests: s.minGuests, durationLabel: s.durationLabel, extraHourEnabled: s.extraHourEnabled, extraHourPriceCents: s.extraHourPriceCents,
    travelFeeEnabled: s.travelFeeEnabled, coverMediaId: s.coverMediaId, inclusions: inc.map(i => i.text), eventTypeIds: ets.map(e => e.id).sort(),
    showInProfile: s.showInProfile, acceptingRequests: s.acceptingRequests,
  };
}

function columnsOf(c: Partial<Content>): Partial<Service> {
  const set: Partial<Service> = {};
  if (c.kind !== undefined) set.kind = c.kind;
  if (c.name !== undefined) set.name = c.name;
  if (c.categoryId !== undefined) set.categoryId = c.categoryId;
  if (c.description !== undefined) set.description = c.description;
  if (c.priceCents !== undefined) set.priceCents = c.kind === 'on_request' ? null : c.priceCents ?? null;
  if (c.kind === 'on_request') set.priceCents = null;
  if (c.priceUnit !== undefined) set.priceUnit = c.priceUnit as PriceUnit;
  if (c.minGuests !== undefined) set.minGuests = c.minGuests ?? null;
  if (c.durationLabel !== undefined) set.durationLabel = c.durationLabel || null;
  if (c.extraHourEnabled !== undefined) set.extraHourEnabled = c.extraHourEnabled;
  if (c.extraHourPriceCents !== undefined) set.extraHourPriceCents = c.extraHourPriceCents ?? null;
  if (c.travelFeeEnabled !== undefined) set.travelFeeEnabled = c.travelFeeEnabled;
  if (c.coverMediaId !== undefined) set.coverMediaId = c.coverMediaId ?? null;
  if (c.showInProfile !== undefined) set.showInProfile = c.showInProfile;
  if (c.acceptingRequests !== undefined) set.acceptingRequests = c.acceptingRequests;
  return set;
}

async function writeLists(tx: Tx, serviceId: string, c: { inclusions?: string[]; eventTypeIds?: string[] }) {
  if (c.inclusions) {
    await tx.delete(serviceInclusion).where(eq(serviceInclusion.serviceId, serviceId));
    if (c.inclusions.length) await tx.insert(serviceInclusion).values(c.inclusions.map((text, position) => ({ serviceId, text, position })));
  }
  if (c.eventTypeIds) {
    await tx.delete(serviceEventType).where(eq(serviceEventType.serviceId, serviceId));
    const uniq = [...new Set(c.eventTypeIds)];
    if (uniq.length) await tx.insert(serviceEventType).values(uniq.map(eventTypeId => ({ serviceId, eventTypeId })));
  }
}

async function nextSortOrder(q: Queryable, partnerId: string) {
  const [r] = await q.select({ m: sql<number | null>`max(${service.sortOrder})` }).from(service).where(eq(service.partnerId, partnerId));
  return (r?.m ?? -1) + 1;
}

async function lockOwnService(tx: Tx, p: Partner, serviceId: string): Promise<Service> {
  const [s] = await tx.select().from(service).where(and(eq(service.id, serviceId), eq(service.partnerId, p.id))).for('update');
  if (!s) throw new NotFoundError('service');
  return s;
}

async function checkCover(tx: Tx, actor: AnyActor, c: Partial<Content>) {
  if (c.coverMediaId) await ownMedia(tx, actor, c.coverMediaId, ['service_cover', 'gallery']);
}

/** ‹420,00 €›, ‹28,00 € на гост›, ‹По оферта› (on request). */
export function priceText(s: Pick<Service, 'kind' | 'priceCents' | 'priceUnit'>): string {
  if (s.kind === 'on_request' || s.priceCents == null) return 'По оферта';
  return `${money(s.priceCents)}${s.priceUnit === 'per_guest' ? ' на гост' : ''}`;
}

/** ‹28,00 € на гост · минимум 60 гости› — the terms shown in `vendor-service-change-returned`. */
function termsText(c: { kind: unknown; priceCents: unknown; priceUnit: unknown; minGuests: unknown; durationLabel: unknown }): string {
  const parts = [priceText({ kind: c.kind as ServiceKind, priceCents: c.priceCents as number | null, priceUnit: c.priceUnit as PriceUnit })];
  if (c.minGuests) parts.push(`минимум ${c.minGuests} гости`);
  if (c.durationLabel) parts.push(String(c.durationLabel));
  return parts.join(' · ');
}

// ── S1 / S5 drafts ───────────────────────────────────────────────────────

/** S1 ‹Запази като чернова› (name present). Creates or updates a draft / returned service. Toast ‹Черновата е запазена›. */
export async function saveDraft(actor: AnyActor, input: Partial<ServiceInput> & { id?: string }, tx?: Tx): Promise<Service> {
  const c = parse(draft, input);
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    // The panel's editor (approved / deactivated, D24); partners in the wizard use saveOnboarding().
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    if (c.categoryId) await assertCategory(t, c.categoryId);
    await checkCover(t, actor, c);
    const at = await now();
    let s: Service;
    if (input.id) {
      const cur = await lockOwnService(t, p, input.id);
      if (!['draft', 'returned'].includes(cur.status)) throw new DomainError('service_status', `service is ${cur.status}`);
      if ((c.kind ?? cur.kind) === 'package_fixed' && cur.kind !== 'package_fixed') await assertPackageLimit(t, p.id, cur.id);
      [s] = await t.update(service).set({ ...columnsOf(c), status: 'draft', updatedAt: at }).where(eq(service.id, cur.id)).returning();
    } else {
      if ((c.kind ?? 'package_fixed') === 'package_fixed') await assertPackageLimit(t, p.id);
      [s] = await t.insert(service).values({
        partnerId: p.id, kind: c.kind ?? 'package_fixed', name: c.name, categoryId: c.categoryId ?? p.primaryCategoryId ?? await anyCategory(t),
        description: c.description ?? '', ...columnsOf({ ...c, kind: c.kind ?? 'package_fixed' }), status: 'draft',
        sortOrder: await nextSortOrder(t, p.id), createdAt: at, updatedAt: at,
      }).returning();
    }
    await writeLists(t, s.id, c);
    await audit(t, { actor, action: 'service.draft_saved', entity: 'service', entityId: s.id });
    return s;
  });
}

async function anyCategory(q: Queryable): Promise<string> {
  const [c] = await q.select({ id: category.id }).from(category).where(eq(category.isVisible, true)).orderBy(asc(category.sortOrder)).limit(1);
  return c.id;
}

/**
 * Onboarding step 3 package editor (`services.saveOnboarding()`): saves a package or an
 * on-request service of a partner still in the wizard. It becomes `ready` when step 3 is
 * validated (S5) and goes live with the profile on approval (P5).
 */
export async function saveOnboarding(actor: AnyActor, input: Partial<ServiceInput> & { id?: string }, tx?: Tx): Promise<Service> {
  const c = parse(onboarding, input);
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'draft' && p.status !== 'returned') throw new DomainError('wizard_read_only');
    if (c.categoryId) await assertCategory(t, c.categoryId);
    await checkCover(t, actor, c);
    const at = await now();
    let s: Service;
    if (input.id) {
      const cur = await lockOwnService(t, p, input.id);
      if (!['draft', 'ready'].includes(cur.status)) throw new DomainError('service_status');
      if ((c.kind ?? cur.kind) === 'package_fixed' && cur.kind !== 'package_fixed') await assertPackageLimit(t, p.id, cur.id);
      const merged = { ...cur, ...columnsOf(c) };
      const status: ServiceStatus = cur.status === 'ready' && onboardingServiceErrors(merged).length === 0 ? 'ready' : 'draft';
      [s] = await t.update(service).set({ ...columnsOf(c), status, updatedAt: at }).where(eq(service.id, cur.id)).returning();
    } else {
      if ((c.kind ?? 'package_fixed') === 'package_fixed') await assertPackageLimit(t, p.id);
      [s] = await t.insert(service).values({
        partnerId: p.id, kind: c.kind ?? 'package_fixed', name: c.name, categoryId: c.categoryId ?? p.primaryCategoryId ?? await anyCategory(t),
        description: c.description ?? '', ...columnsOf({ ...c, kind: c.kind ?? 'package_fixed' }), status: 'draft',
        sortOrder: await nextSortOrder(t, p.id), createdAt: at, updatedAt: at,
      }).returning();
    }
    if (c.inclusions) await writeLists(t, s.id, { inclusions: c.inclusions });
    if (c.eventTypeIds.length) await writeLists(t, s.id, { eventTypeIds: c.eventTypeIds });
    await t.update(partner).set({ draftSavedAt: at }).where(eq(partner.id, p.id));
    await audit(t, { actor, action: 'service.onboarding_saved', entity: 'service', entityId: s.id });
    return s;
  });
}

/** Onboarding ‹Премахни› (toast ‹Пакетът е премахнат›): the service is archived (records are never deleted). */
export async function remove(actor: AnyActor, a: { serviceId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    const s = await lockOwnService(t, p, a.serviceId);
    if (s.status === 'active' || s.status === 'pending_review') throw new DomainError('service_status');
    const at = await now();
    await t.update(service).set({ status: 'archived', archivedAt: at, updatedAt: at }).where(eq(service.id, s.id));
    await audit(t, { actor, action: 'service.removed', entity: 'service', entityId: s.id });
  });
}

// ── S2 submit ────────────────────────────────────────────────────────────

/**
 * S2 ‹Изпрати за преглед›: valid (§12.2), partner approved, packages ≤ 5. Writes a `new`
 * revision (payload = the full service) and sends `vendor-service-submitted`. With
 * ⚙ moderation.manual off the service goes live at once and only `vendor-service-published` is sent.
 */
export async function submit(actor: AnyActor, input: ServiceInput & { id?: string }, tx?: Tx): Promise<Service> {
  const c = parse(full, input);
  kindRules(c);
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved') throw new DomainError('partner_status');
    await assertCategory(t, c.categoryId);
    await checkCover(t, actor, c);
    const at = await now();
    const manual = await getSetting('moderation.manual', at, t);
    let s: Service;
    if (input.id) {
      const cur = await lockOwnService(t, p, input.id);
      if (cur.status === 'active') throw new DomainError('use_submit_change');
      if (cur.status === 'archived' || cur.status === 'ready') throw new DomainError('service_status');
      if (c.kind === 'package_fixed') await assertPackageLimit(t, p.id, cur.id);
      [s] = await t.update(service).set({ ...columnsOf(c), status: manual ? 'pending_review' : 'active', publishedAt: manual ? cur.publishedAt : at, updatedAt: at })
        .where(eq(service.id, cur.id)).returning();
    } else {
      if (c.kind === 'package_fixed') await assertPackageLimit(t, p.id);
      [s] = await t.insert(service).values({
        partnerId: p.id, ...columnsOf(c), kind: c.kind, name: c.name, categoryId: c.categoryId, description: c.description,
        status: manual ? 'pending_review' : 'active', publishedAt: manual ? null : at, sortOrder: await nextSortOrder(t, p.id), createdAt: at, updatedAt: at,
      }).returning();
    }
    await writeLists(t, s.id, c);
    const payload = await snapshot(t, s);
    const [pending] = await t.select().from(serviceRevision).where(and(eq(serviceRevision.serviceId, s.id), eq(serviceRevision.status, 'pending')));
    if (pending) {
      await t.update(serviceRevision).set({ type: 'new', payload, submittedAt: at, submittedBy: (actor as Actor).userId, ...(manual ? {} : { status: 'approved', decidedAt: at }) })
        .where(eq(serviceRevision.id, pending.id));
    } else {
      await t.insert(serviceRevision).values({
        serviceId: s.id, type: 'new', payload, submittedBy: (actor as Actor).userId, submittedAt: at,
        ...(manual ? {} : { status: 'approved' as const, decidedAt: at }),
      });
    }
    await audit(t, { actor, action: manual ? 'service.submitted' : 'service.published', entity: 'service', entityId: s.id });
    const r = await partnerRecipient(t, p.id);
    const [cat] = await t.select({ name: category.name }).from(category).where(eq(category.id, s.categoryId));
    if (manual) {
      await mail(t, {
        key: 'vendor-service-submitted', to: r.email, toUserId: r.userId, dedupeKey: `service:${s.id}:submitted:${at.toISOString()}`,
        vars: { serviceName: s.name, serviceKind: SERVICE_KIND_LABEL[s.kind], category: cat.name, price: priceText(s), duration: s.durationLabel ?? '—' },
      });
    } else {
      await refreshPartner(t, p.id);
      await refreshChecks(t, p.id);
      await mail(t, {
        key: 'vendor-service-published', to: r.email, toUserId: r.userId, dedupeKey: `service:${s.id}:published:${at.toISOString()}`,
        vars: { partnerSlug: p.slug, partnerName: p.businessName, serviceName: s.name, price: priceText(s), duration: s.durationLabel ?? '—' },
      });
    }
    return s;
  });
}

// ── S6 edit of an active service ─────────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * S6 ‹Запази промените› on an active service: content changes become an `edit` revision
 * (payload = { field: [before, after] }); the live version stays bookable; a second save
 * replaces the pending revision; `vendor-service-change-submitted`. The profile and request
 * toggles apply at once (not moderated, D59). Returns whether a revision was written.
 */
export async function submitChange(actor: AnyActor, input: ServiceInput & { id: string }, tx?: Tx): Promise<{ revision: Revision | null }> {
  const c = parse(full, input);
  kindRules(c);
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    if (p.status !== 'approved' && p.status !== 'deactivated') throw new DomainError('partner_status');
    const s = await lockOwnService(t, p, input.id);
    if (s.status !== 'active') throw new DomainError('service_status');
    await assertCategory(t, c.categoryId);
    await checkCover(t, actor, c);
    if (c.kind === 'package_fixed' && s.kind !== 'package_fixed') await assertPackageLimit(t, p.id, s.id);
    const at = await now();
    if (c.showInProfile !== s.showInProfile || c.acceptingRequests !== s.acceptingRequests) {
      await t.update(service).set({ showInProfile: c.showInProfile, acceptingRequests: c.acceptingRequests, updatedAt: at }).where(eq(service.id, s.id));
      await refreshPartner(t, p.id);
    }
    const live = await snapshot(t, s);
    const proposed = { ...c, eventTypeIds: [...new Set(c.eventTypeIds)].sort(), priceCents: c.kind === 'on_request' ? null : c.priceCents ?? null } as Record<string, unknown>;
    const diff: Record<string, [unknown, unknown]> = {};
    for (const f of CONTENT_FIELDS) if (!same(live[f], proposed[f])) diff[f] = [live[f] ?? null, proposed[f] ?? null];
    const [pending] = await t.select().from(serviceRevision).where(and(eq(serviceRevision.serviceId, s.id), eq(serviceRevision.status, 'pending')));
    if (!Object.keys(diff).length) {
      if (pending) await t.update(serviceRevision).set({ status: 'returned', decidedAt: at }).where(eq(serviceRevision.id, pending.id));
      return { revision: null };
    }
    let revision: Revision;
    if (pending) {
      [revision] = await t.update(serviceRevision).set({ type: 'edit', payload: diff, submittedAt: at, submittedBy: (actor as Actor).userId })
        .where(eq(serviceRevision.id, pending.id)).returning();
    } else {
      [revision] = await t.insert(serviceRevision).values({ serviceId: s.id, type: 'edit', payload: diff, submittedBy: (actor as Actor).userId, submittedAt: at }).returning();
    }
    await t.update(service).set({ updatedAt: at }).where(eq(service.id, s.id));
    await audit(t, { actor, action: 'service.change_submitted', entity: 'service', entityId: s.id, data: { fields: Object.keys(diff) } });
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-service-change-submitted', to: r.email, toUserId: r.userId, dedupeKey: `revision:${revision.id}:submitted:${at.toISOString()}`,
      vars: { serviceName: s.name, serviceKind: SERVICE_KIND_LABEL[s.kind] },
    });
    return { revision };
  });
}

// ── S3, S4, S7, S8 moderation ────────────────────────────────────────────

async function lockRevision(tx: Tx, revisionId: string) {
  const [rev] = await tx.select().from(serviceRevision).where(eq(serviceRevision.id, revisionId)).for('update');
  if (!rev) throw new NotFoundError('revision');
  if (rev.status !== 'pending') throw new DomainError('revision_status', `revision is ${rev.status}`);
  const [s] = await tx.select().from(service).where(eq(service.id, rev.serviceId)).for('update');
  const [p] = await tx.select().from(partner).where(eq(partner.id, s.partnerId));
  return { rev, s, p };
}

/** S3 ‹Публикувай› a new service → active; `vendor-service-published`; toast ‹Обявата е публикувана›. */
export async function publish(actor: AnyActor, a: { revisionId: string }, tx?: Tx) {
  assertCan(actor, 'moderate_listings');
  return withTx(tx, async t => {
    const { rev, s, p } = await lockRevision(t, a.revisionId);
    if (rev.type !== 'new' || s.status !== 'pending_review') throw new DomainError('revision_status');
    const at = await now();
    await t.update(service).set({ status: 'active', publishedAt: s.publishedAt ?? at, updatedAt: at }).where(eq(service.id, s.id));
    await t.update(serviceRevision).set({ status: 'approved', decidedBy: actor.userId, decidedAt: at }).where(eq(serviceRevision.id, rev.id));
    await refreshPartner(t, p.id);
    await refreshChecks(t, p.id);
    await audit(t, { actor, action: 'service.published', entity: 'service', entityId: s.id, data: { revisionId: rev.id } });
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-service-published', to: r.email, toUserId: r.userId, dedupeKey: `revision:${rev.id}:published`,
      vars: { partnerSlug: p.slug, partnerName: p.businessName, serviceName: s.name, price: priceText(s), duration: s.durationLabel ?? '—' },
    });
  });
}

/**
 * ‹Върни с бележка› (note required; ‹Чести бележки› insert text). A new service → `returned`
 * (S4, `vendor-service-returned`); an edit → the live version unchanged, the note shows in the
 * editor (S8, `vendor-service-change-returned`). Toast ‹Обявата е върната с бележка›.
 */
export async function returnRevision(actor: AnyActor, a: { revisionId: string; note: string }, tx?: Tx) {
  assertCan(actor, 'moderate_listings');
  const note = a.note?.trim();
  if (!note) throw new DomainError('note_required');
  return withTx(tx, async t => {
    const { rev, s, p } = await lockRevision(t, a.revisionId);
    const at = await now();
    await t.update(serviceRevision).set({ status: 'returned', note, decidedBy: actor.userId, decidedAt: at }).where(eq(serviceRevision.id, rev.id));
    const r = await partnerRecipient(t, p.id);
    if (rev.type === 'new') {
      await t.update(service).set({ status: 'returned', updatedAt: at }).where(eq(service.id, s.id));
      await audit(t, { actor, action: 'service.returned', entity: 'service', entityId: s.id, data: { note } });
      await mail(t, {
        key: 'vendor-service-returned', to: r.email, toUserId: r.userId, dedupeKey: `revision:${rev.id}:returned`,
        vars: { serviceId: s.id, serviceName: s.name, note },
      });
    } else {
      const live = await snapshot(t, s);
      const diff = rev.payload as Record<string, [unknown, unknown]>;
      const proposed = { ...live, ...Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v[1]])) };
      const [cat] = await t.select({ name: category.name }).from(category).where(eq(category.id, s.categoryId));
      await audit(t, { actor, action: 'service.change_returned', entity: 'service', entityId: s.id, data: { note, revisionId: rev.id } });
      await mail(t, {
        key: 'vendor-service-change-returned', to: r.email, toUserId: r.userId, dedupeKey: `revision:${rev.id}:returned`,
        vars: {
          serviceId: s.id, serviceName: s.name, category: cat.name,
          current: termsText(live as Parameters<typeof termsText>[0]), proposed: termsText(proposed as Parameters<typeof termsText>[0]),
        },
      });
    }
  });
}

/** S7 ‹Одобри› an edit: the payload is applied to the service; `vendor-service-change-approved`; toast ‹Промяната е одобрена›. */
export async function approveChange(actor: AnyActor, a: { revisionId: string }, tx?: Tx) {
  assertCan(actor, 'moderate_listings');
  return withTx(tx, async t => {
    const { rev, s, p } = await lockRevision(t, a.revisionId);
    if (rev.type !== 'edit') throw new DomainError('revision_status');
    const after = Object.fromEntries(Object.entries(rev.payload as Record<string, [unknown, unknown]>).map(([k, v]) => [k, v[1]])) as Partial<Content>;
    const at = await now();
    const set = columnsOf(after);
    if (after.kind !== undefined && after.kind !== 'on_request' && after.priceCents === undefined) delete set.priceCents;
    const [updated] = await t.update(service).set({ ...set, updatedAt: at }).where(eq(service.id, s.id)).returning();
    await writeLists(t, s.id, { inclusions: after.inclusions, eventTypeIds: after.eventTypeIds });
    await t.update(serviceRevision).set({ status: 'approved', decidedBy: actor.userId, decidedAt: at }).where(eq(serviceRevision.id, rev.id));
    await refreshPartner(t, p.id);
    await refreshChecks(t, p.id);
    await audit(t, { actor, action: 'service.change_approved', entity: 'service', entityId: s.id, data: { revisionId: rev.id, fields: Object.keys(after) } });
    const r = await partnerRecipient(t, p.id);
    await mail(t, {
      key: 'vendor-service-change-approved', to: r.email, toUserId: r.userId, dedupeKey: `revision:${rev.id}:approved`,
      vars: { partnerSlug: p.slug, serviceName: updated.name },
    });
  });
}

// ── S9, S10, toggles, order ──────────────────────────────────────────────

/** S9 visibility ‹Активна› / ‹Чернова› on the edit page: immediate (D59); → active only once published. */
export async function setVisibility(actor: AnyActor, a: { serviceId: string; active: boolean }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    const s = await lockOwnService(t, p, a.serviceId);
    const at = await now();
    if (a.active) {
      if (s.status === 'active') return s;
      if (s.status !== 'draft' || !s.publishedAt) throw new DomainError('not_published');
      if (s.kind === 'package_fixed') await assertPackageLimit(t, p.id, s.id);
    } else if (s.status !== 'active') {
      if (s.status === 'draft') return s;
      throw new DomainError('service_status');
    }
    const [row] = await t.update(service).set({ status: a.active ? 'active' : 'draft', updatedAt: at }).where(eq(service.id, s.id)).returning();
    await refreshPartner(t, p.id);
    await refreshChecks(t, p.id);
    await audit(t, { actor, action: a.active ? 'service.activated' : 'service.hidden', entity: 'service', entityId: s.id });
    return row;
  });
}

/** ‹Показвай в профила ми› / ‹Приемам заявки за нея› (immediate). */
export async function setToggles(actor: AnyActor, a: { serviceId: string; showInProfile?: boolean; acceptingRequests?: boolean }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    const s = await lockOwnService(t, p, a.serviceId);
    const [row] = await t.update(service).set({
      showInProfile: a.showInProfile ?? s.showInProfile, acceptingRequests: a.acceptingRequests ?? s.acceptingRequests, updatedAt: await now(),
    }).where(eq(service.id, s.id)).returning();
    await refreshPartner(t, p.id);
    await audit(t, { actor, action: 'service.toggles_changed', entity: 'service', entityId: s.id, data: { ...a } });
    return row;
  });
}

/** S10 ‹Архивирай› (toast ‹Услугата е архивирана›): hidden from the profile; requests and bookings unaffected. */
export async function archive(actor: AnyActor, a: { serviceId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    const s = await lockOwnService(t, p, a.serviceId);
    if (s.status === 'archived') return s;
    const at = await now();
    const [row] = await t.update(service).set({ status: 'archived', archivedAt: at, updatedAt: at }).where(eq(service.id, s.id)).returning();
    // A pending change of an archived service leaves the moderation queue.
    await t.update(serviceRevision).set({ status: 'returned', decidedAt: at }).where(and(eq(serviceRevision.serviceId, s.id), eq(serviceRevision.status, 'pending')));
    await refreshPartner(t, p.id);
    await refreshChecks(t, p.id);
    await audit(t, { actor, action: 'service.archived', entity: 'service', entityId: s.id });
    return row;
  });
}

/** ‹Подреди› (toast ‹Подредбата е запазена›); the first active fixed package is ‹Препоръчан›. */
export async function reorder(actor: AnyActor, a: { serviceIds: string[] }, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await lockPartnerOf(actor, t);
    const own = await t.select({ id: service.id }).from(service).where(and(eq(service.partnerId, p.id), inArray(service.id, a.serviceIds)));
    if (own.length !== new Set(a.serviceIds).size) throw new DomainError('invalid_order');
    for (const [i, id] of a.serviceIds.entries()) await t.update(service).set({ sortOrder: i }).where(eq(service.id, id));
    await audit(t, { actor, action: 'service.reordered', entity: 'partner', entityId: p.id });
  });
}

// ── Read models ──────────────────────────────────────────────────────────

/**
 * `/partner/uslugi`: services with status, kind, price text, counts (bookings confirmed /
 * completed, inquiries = requests), the pending or returned revision, and the tab counts.
 */
export async function listForPartner(actor: AnyActor, a: { tab?: 'active' | 'draft' | 'archived' | 'review'; categoryId?: string } = {}, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const rows = await q.select().from(service).where(eq(service.partnerId, p.id)).orderBy(asc(service.sortOrder), asc(service.createdAt));
  const ids = rows.map(r => r.id);
  const bookings = ids.length ? await q.select({ id: booking.serviceId, n: count() }).from(booking)
    .where(and(inArray(booking.serviceId, ids), inArray(booking.status, ['confirmed', 'completed']))).groupBy(booking.serviceId) : [];
  const inquiries = ids.length ? await q.select({ id: request.serviceId, n: count() }).from(request)
    .where(inArray(request.serviceId, ids)).groupBy(request.serviceId) : [];
  const revisions = ids.length ? await q.select().from(serviceRevision).where(inArray(serviceRevision.serviceId, ids)).orderBy(desc(serviceRevision.submittedAt)) : [];
  const tabOf = (s: Service) => s.status === 'active' ? 'active' : s.status === 'archived' ? 'archived' : s.status === 'pending_review' ? 'review' : 'draft';
  const firstActiveFixed = rows.find(r => r.status === 'active' && r.kind === 'package_fixed')?.id ?? null;
  const items = rows.map(s => {
    const latest = revisions.find(r => r.serviceId === s.id) ?? null;
    return {
      service: s, tab: tabOf(s), statusLabel: s.status === 'active' && latest?.status === 'pending' ? 'Активна · промените чакат преглед' : SERVICE_STATUS_LABEL[s.status],
      kindLabel: SERVICE_KIND_LABEL[s.kind], price: s.kind === 'on_request' ? '—' : priceText(s), recommended: s.id === firstActiveFixed,
      bookingsCount: bookings.find(b => b.id === s.id)?.n ?? 0, inquiriesCount: inquiries.find(b => b.id === s.id)?.n ?? 0,
      pendingRevision: latest?.status === 'pending' ? latest : null, returnedNote: latest?.status === 'returned' ? latest.note : null,
    };
  });
  const counts = { active: 0, draft: 0, archived: 0, review: 0 };
  for (const i of items) counts[i.tab as keyof typeof counts]++;
  const lastChange = rows.reduce<Date | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null);
  return {
    items: items.filter(i => (!a.tab || i.tab === a.tab) && (!a.categoryId || i.service.categoryId === a.categoryId)),
    counts, lastChange,
  };
}

/** `/admin/moderatsiya`: pending revisions, oldest first; edits carry ‹Беше› / ‹Става› pairs. */
export async function moderationQueue(actor: AnyActor, a: { filter?: 'vsichki' | 'novi' | 'redakcii'; partnerId?: string; serviceId?: string; q?: string } = {}, q: Queryable = db) {
  assertCan(actor, 'moderate_listings');
  const conds = [eq(serviceRevision.status, 'pending')];
  if (a.filter === 'novi') conds.push(eq(serviceRevision.type, 'new'));
  if (a.filter === 'redakcii') conds.push(eq(serviceRevision.type, 'edit'));
  if (a.partnerId) conds.push(eq(service.partnerId, a.partnerId));
  if (a.serviceId) conds.push(eq(service.id, a.serviceId));
  const rows = await q.select({ revision: serviceRevision, service, partnerName: partner.businessName, partnerSlug: partner.slug, categoryName: category.name })
    .from(serviceRevision).innerJoin(service, eq(service.id, serviceRevision.serviceId)).innerJoin(partner, eq(partner.id, service.partnerId))
    .innerJoin(category, eq(category.id, service.categoryId))
    .where(and(...conds)).orderBy(asc(serviceRevision.submittedAt));
  // Matched in Bulgarian here; the database collation may not fold Cyrillic case.
  const needle = a.q?.trim().toLocaleLowerCase('bg');
  return needle ? rows.filter(r => [r.service.name, r.partnerName].some(x => x.toLocaleLowerCase('bg').includes(needle))) : rows;
}
