// Bookings and their side records (DATA-MODEL §2.10). A booking is created
// on approval, owns all money and shares the request's number (D1).
import { sql } from 'drizzle-orm';
import { pgTable, text, integer, smallint, uuid, time, boolean, uniqueIndex, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { bookingStatus, cancellationPolicy, cancellationReason, cancelledBy, paymentMode, reviewState } from './enums';
import { city, eventType } from './reference';
import { partner } from './partners';
import { service } from './services';
import { bookingNumber, clientEvent, request } from './requests';
import { dispute } from './disputes';
import { createdAt, day, id, tz, updatedAt } from './columns';

export const booking = pgTable('booking', {
  id: id(),
  /** = request.number */
  number: text('number').notNull().references(() => bookingNumber.number),
  requestId: uuid('request_id').notNull().references(() => request.id),
  clientId: text('client_id').notNull().references(() => user.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  serviceId: uuid('service_id').references(() => service.id),
  clientEventId: uuid('client_event_id').notNull().references(() => clientEvent.id),
  // Snapshots.
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
  eventDate: day('event_date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  guests: integer('guests').notNull(),
  venueName: text('venue_name'),
  locality: text('locality'),
  cityId: uuid('city_id').references(() => city.id),
  serviceTitle: text('service_title').notNull(),
  serviceSummary: text('service_summary'),
  /** ‹Какво включва пакетът›. */
  inclusions: text('inclusions').array().notNull().default(sql`'{}'::text[]`),
  status: bookingStatus('status').notNull().default('awaiting_payment'),
  /** Total price. */
  amountCents: integer('amount_cents').notNull(),
  /** ‹Такса резервация› (always 0 in v1). */
  bookingFeeCents: integer('booking_fee_cents').notNull().default(0),
  /** Snapshot of ⚙ payment.schedule.mode. */
  paymentMode: paymentMode('payment_mode').notNull(),
  dueNowCents: integer('due_now_cents').notNull(),
  depositPayCents: integer('deposit_pay_cents'),
  balanceCents: integer('balance_cents').notNull().default(0),
  balanceDueDate: day('balance_due_date'),
  approvedAt: tz('approved_at').notNull(),
  paymentDueAt: tz('payment_due_at').notNull(),
  paymentExtensions: smallint('payment_extensions').notNull().default(0),
  /** First succeeded charge. */
  paidAt: tz('paid_at'),
  cancellationPolicy: cancellationPolicy('cancellation_policy').notNull(),
  depositPercent: smallint('deposit_percent').notNull(),
  freeCancelUntil: day('free_cancel_until'),
  /** Snapshot at payment (SPEC §6). */
  commissionBp: integer('commission_bp'),
  contactPhone: text('contact_phone').notNull(),
  /** event_date + payout.hold_days_after_event */
  holdUntil: day('hold_until').notNull(),
  /** First payout day ≥ hold_until. */
  batchDate: day('batch_date').notNull(),
  /** An open dispute holds the payout. */
  payoutHold: boolean('payout_hold').notNull().default(false),
  reviewState: reviewState('review_state').notNull().default('not_due'),
  cancelledAt: tz('cancelled_at'),
  cancelledBy: cancelledBy('cancelled_by'),
  completedAt: tz('completed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('booking_number_key').on(t.number),
  uniqueIndex('booking_request_key').on(t.requestId),
  index('booking_partner_date_status_idx').on(t.partnerId, t.eventDate, t.status),
  index('booking_client_date_idx').on(t.clientId, t.eventDate),
  index('booking_status_due_idx').on(t.status, t.paymentDueAt),
  index('booking_batch_date_idx').on(t.batchDate).where(sql`status in ('confirmed', 'completed', 'cancelled')`),
  // Admin register (/admin/rezervacii: one month by event date, the month list) and the held-funds total.
  index('booking_event_date_idx').on(t.eventDate),
  index('booking_status_event_date_idx').on(t.status, t.eventDate),
  // Admin dashboard: ‹Последни резервации› and the period's GMV / top categories by payment time.
  index('booking_approved_at_idx').on(t.approvedAt, t.createdAt), // ascending: read backwards for ‹order by … desc› (nulls first)
  index('booking_paid_at_idx').on(t.paidAt).where(sql`paid_at is not null`),
  check('booking_amounts_check', sql`${t.amountCents} >= 0 and ${t.dueNowCents} >= 0 and ${t.balanceCents} >= 0 and ${t.bookingFeeCents} >= 0`),
]);

/** ‹Удължи срока› (K3). */
export const paymentExtension = pgTable('payment_extension', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  previousDueAt: tz('previous_due_at').notNull(),
  newDueAt: tz('new_due_at').notNull(),
  hours: smallint('hours').notNull().default(24),
  disputeId: uuid('dispute_id').references((): AnyPgColumn => dispute.id),
  extendedBy: text('extended_by').notNull().references(() => user.id),
  createdAt: createdAt(),
}, t => [index('payment_extension_booking_idx').on(t.bookingId)]);

/** The stored quote of SPEC §5 at the moment of cancellation. */
export const cancellation = pgTable('cancellation', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  initiatedBy: cancelledBy('initiated_by').notNull(),
  /** Client only. */
  reason: cancellationReason('reason'),
  reasonText: text('reason_text'),
  daysBefore: integer('days_before').notNull(),
  policy: cancellationPolicy('policy').notNull(),
  depositPercent: smallint('deposit_percent').notNull(),
  totalCents: integer('total_cents').notNull(),
  paidCents: integer('paid_cents').notNull(),
  refundCents: integer('refund_cents').notNull(),
  retainedCents: integer('retained_cents').notNull(),
  commissionBp: integer('commission_bp'),
  /** retained − commission */
  partnerAmountCents: integer('partner_amount_cents').notNull(),
  createdBy: text('created_by').references(() => user.id),
  createdAt: createdAt(),
}, t => [uniqueIndex('cancellation_booking_key').on(t.bookingId)]);

/** A partner asks the team to cancel (K8/K9, D10). */
export const partnerCancellationRequest = pgTable('partner_cancellation_request', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  status: text('status').notNull().default('pending'),
  requestedBy: text('requested_by').notNull().references(() => user.id),
  requestedAt: tz('requested_at').notNull().defaultNow(),
  decidedBy: text('decided_by').references(() => user.id),
  decidedAt: tz('decided_at'),
}, t => [
  uniqueIndex('partner_cancellation_request_pending_key').on(t.bookingId).where(sql`status = 'pending'`),
  check('partner_cancellation_request_status_check', sql`${t.status} in ('pending', 'completed', 'declined')`),
]);
