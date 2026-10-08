// Services and their moderated revisions (DATA-MODEL §2.6).
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, smallint, integer, uuid, varchar, jsonb, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { priceUnit, revisionStatus, revisionType, serviceKind, serviceStatus } from './enums';
import { category, eventType } from './reference';
import { media } from './media';
import { partner } from './partners';
import { createdAt, id, tz, updatedAt } from './columns';

export const service = pgTable('service', {
  id: id(),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  kind: serviceKind('kind').notNull().default('package_fixed'),
  name: text('name').notNull(),
  categoryId: uuid('category_id').notNull().references(() => category.id),
  description: varchar('description', { length: 600 }).notNull(),
  priceCents: integer('price_cents'),
  priceUnit: priceUnit('price_unit').notNull().default('per_event'),
  minGuests: integer('min_guests'),
  durationLabel: text('duration_label'),
  extraHourEnabled: boolean('extra_hour_enabled').notNull().default(false),
  extraHourPriceCents: integer('extra_hour_price_cents'),
  travelFeeEnabled: boolean('travel_fee_enabled').notNull().default(false),
  coverMediaId: uuid('cover_media_id').references(() => media.id),
  status: serviceStatus('status').notNull().default('draft'),
  showInProfile: boolean('show_in_profile').notNull().default(true),
  acceptingRequests: boolean('accepting_requests').notNull().default(true),
  /** The first fixed package = ‹Препоръчан›. */
  sortOrder: integer('sort_order').notNull().default(0),
  publishedAt: tz('published_at'),
  archivedAt: tz('archived_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index('service_partner_status_idx').on(t.partnerId, t.status, t.sortOrder),
  index('service_category_status_idx').on(t.categoryId, t.status),
  check('service_price_by_kind_check', sql`(${t.kind} = 'on_request' and ${t.priceCents} is null) or (${t.kind} <> 'on_request' and ${t.priceCents} is not null and ${t.priceCents} > 0)`),
  check('service_min_guests_check', sql`${t.minGuests} is null or ${t.priceUnit} = 'per_guest'`),
]);

/** ‹Какво е включено›. */
export const serviceInclusion = pgTable('service_inclusion', {
  id: id(),
  serviceId: uuid('service_id').notNull().references(() => service.id, { onDelete: 'cascade' }),
  text: varchar('text', { length: 120 }).notNull(),
  position: smallint('position').notNull(),
}, t => [index('service_inclusion_service_idx').on(t.serviceId, t.position)]);

/** ‹Подходящи събития›. */
export const serviceEventType = pgTable('service_event_type', {
  serviceId: uuid('service_id').notNull().references(() => service.id, { onDelete: 'cascade' }),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
}, t => [primaryKey({ name: 'service_event_type_pk', columns: [t.serviceId, t.eventTypeId] })]);

export const serviceRevision = pgTable('service_revision', {
  id: id(),
  serviceId: uuid('service_id').notNull().references(() => service.id),
  type: revisionType('type').notNull(),
  /** `new`: the full service; `edit`: { field: [before, after] } (admin ‹Беше› / ‹Става›). */
  payload: jsonb('payload').notNull(),
  status: revisionStatus('status').notNull().default('pending'),
  note: text('note'),
  submittedBy: text('submitted_by').notNull().references(() => user.id),
  submittedAt: tz('submitted_at').notNull().defaultNow(),
  decidedBy: text('decided_by').references(() => user.id),
  decidedAt: tz('decided_at'),
}, t => [
  uniqueIndex('service_revision_pending_key').on(t.serviceId).where(sql`status = 'pending'`),
  index('service_revision_queue_idx').on(t.status, t.submittedAt),
]);
