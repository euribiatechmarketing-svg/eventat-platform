// Client events, the number registry, requests, briefs (open requests),
// invitations and offers (DATA-MODEL §2.8–2.9).
import { sql } from 'drizzle-orm';
import {
  pgTable, text, integer, smallint, uuid, time, primaryKey, uniqueIndex, index, check, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { briefStatus, budgetBand, declineReason, invitationStatus, offerStatus, requestKind, requestStatus, spaceType } from './enums';
import { category, city, eventType } from './reference';
import { media } from './media';
import { partner } from './partners';
import { service } from './services';
import { createdAt, day, id, tz, updatedAt } from './columns';

/** The client's event folder (‹Моите събития›). Status ‹Предстоящо› / ‹Минало събитие› is computed. */
export const clientEvent = pgTable('client_event', {
  id: id(),
  clientId: text('client_id').notNull().references(() => user.id),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
  /** Free text: ‹Сватба›, ‹Коледно парти›, ‹Годишнина›. */
  title: text('title').notNull(),
  /** ‹Мария и Стефан› (partner-side event title). */
  hosts: text('hosts'),
  date: day('date').notNull(),
  startTime: time('start_time'),
  /** May be after midnight. */
  endTime: time('end_time'),
  venueName: text('venue_name'),
  locality: text('locality'),
  cityId: uuid('city_id').references(() => city.id),
  guests: integer('guests'),
  /** Private (‹Виждат ги само вие›). */
  notes: text('notes'),
  notesUpdatedAt: tz('notes_updated_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [index('client_event_client_date_idx').on(t.clientId, t.date)]);

/** The shared YYYY-MMDD-XX registry (SPEC D2). Allocated by lib/domain/numbers.ts. */
export const bookingNumber = pgTable('booking_number', {
  number: text('number').primaryKey(),
  eventDate: day('event_date').notNull(),
  createdAt: createdAt(),
}, t => [
  check('booking_number_format_check', sql`${t.number} ~ '^[0-9]{4}-[0-9]{4}-[АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЮЯ]{2}$'`),
  check('booking_number_date_check', sql`left(${t.number}, 9) = to_char(${t.eventDate}::timestamp, 'YYYY-MMDD')`),
]);

/** A заявка to one partner. The booking created on approval shares its number (D1). */
export const request = pgTable('request', {
  id: id(),
  number: text('number').notNull().references(() => bookingNumber.number),
  kind: requestKind('kind').notNull(),
  status: requestStatus('status').notNull().default('pending'),
  clientId: text('client_id').notNull().references(() => user.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  serviceId: uuid('service_id').references(() => service.id),
  clientEventId: uuid('client_event_id').notNull().references(() => clientEvent.id),
  briefId: uuid('brief_id').references((): AnyPgColumn => brief.id),
  offerId: uuid('offer_id').references((): AnyPgColumn => offer.id),
  // Snapshots of the event at sending time.
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
  eventDate: day('event_date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  guests: integer('guests').notNull(),
  venueName: text('venue_name'),
  locality: text('locality'),
  cityId: uuid('city_id').references(() => city.id),
  spaceType: spaceType('space_type'),
  /** ‹Бележка към изпълнителя› (≤ 2 000). */
  note: text('note'),
  /** Snapshot; shown to the partner only per SPEC §10. */
  contactPhone: text('contact_phone').notNull(),
  serviceTitle: text('service_title').notNull(),
  serviceSummary: text('service_summary'),
  /** Null for an unanswered quote. */
  amountCents: integer('amount_cents'),
  sentAt: tz('sent_at').notNull().defaultNow(),
  responseDueAt: tz('response_due_at').notNull(),
  answeredAt: tz('answered_at'),
  approvedAt: tz('approved_at'),
  declinedAt: tz('declined_at'),
  expiredAt: tz('expired_at'),
  declineReason: declineReason('decline_reason'),
  declineText: text('decline_text'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('request_number_key').on(t.number),
  index('request_partner_status_idx').on(t.partnerId, t.status, t.sentAt.desc()),
  index('request_client_status_idx').on(t.clientId, t.status, t.sentAt.desc()),
  index('request_partner_date_idx').on(t.partnerId, t.eventDate),
  uniqueIndex('request_open_per_date_key').on(t.clientId, t.partnerId, t.eventDate)
    .where(sql`status in ('pending', 'offer_sent', 'awaiting_confirmation')`),
]);

/** Inspiration photos (≤ 6). */
export const requestAttachment = pgTable('request_attachment', {
  requestId: uuid('request_id').notNull().references(() => request.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id),
  position: smallint('position').notNull().default(0),
}, t => [primaryKey({ name: 'request_attachment_pk', columns: [t.requestId, t.mediaId] })]);

/** The open request (запитване to many partners). */
export const brief = pgTable('brief', {
  id: id(),
  clientId: text('client_id').notNull().references(() => user.id),
  clientEventId: uuid('client_event_id').notNull().references(() => clientEvent.id),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
  eventDate: day('event_date').notNull(),
  cityId: uuid('city_id').notNull().references(() => city.id),
  guests: integer('guests').notNull(),
  budgetBand: budgetBand('budget_band').notNull().default('unknown'),
  description: text('description'),
  contactPhone: text('contact_phone').notNull(),
  status: briefStatus('status').notNull().default('open'),
  sentAt: tz('sent_at').notNull().defaultNow(),
  offersDueAt: tz('offers_due_at').notNull(),
  closedAt: tz('closed_at'),
  createdAt: createdAt(),
}, t => [index('brief_client_idx').on(t.clientId, t.sentAt)]);

export const briefCategory = pgTable('brief_category', {
  briefId: uuid('brief_id').notNull().references(() => brief.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => category.id),
}, t => [primaryKey({ name: 'brief_category_pk', columns: [t.briefId, t.categoryId] })]);

export const briefAttachment = pgTable('brief_attachment', {
  briefId: uuid('brief_id').notNull().references(() => brief.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id),
  position: smallint('position').notNull().default(0),
}, t => [primaryKey({ name: 'brief_attachment_pk', columns: [t.briefId, t.mediaId] })]);

export const briefInvitation = pgTable('brief_invitation', {
  id: id(),
  briefId: uuid('brief_id').notNull().references(() => brief.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  status: invitationStatus('status').notNull().default('invited'),
  invitedAt: tz('invited_at').notNull().defaultNow(),
  offerDueAt: tz('offer_due_at').notNull(),
  answeredAt: tz('answered_at'),
}, t => [
  uniqueIndex('brief_invitation_brief_partner_key').on(t.briefId, t.partnerId),
  index('brief_invitation_partner_status_idx').on(t.partnerId, t.status),
]);

/** A partner's priced answer: to a quote request (request_id) or to a brief invitation (invitation_id). */
export const offer = pgTable('offer', {
  id: id(),
  /** Set for brief offers; a quote's offer uses the request number. */
  number: text('number').references(() => bookingNumber.number),
  requestId: uuid('request_id').references((): AnyPgColumn => request.id),
  invitationId: uuid('invitation_id').references(() => briefInvitation.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  title: text('title').notNull(),
  description: text('description'),
  amountCents: integer('amount_cents').notNull(),
  status: offerStatus('status').notNull().default('sent'),
  sentAt: tz('sent_at').notNull().defaultNow(),
  chosenAt: tz('chosen_at'),
  decidedAt: tz('decided_at'),
}, t => [
  uniqueIndex('offer_number_key').on(t.number),
  index('offer_invitation_idx').on(t.invitationId),
  index('offer_request_idx').on(t.requestId),
  check('offer_source_check', sql`(${t.requestId} is null) <> (${t.invitationId} is null)`),
  check('offer_amount_check', sql`${t.amountCents} > 0`),
]);
