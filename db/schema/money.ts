// Charges, refunds and the double-entry ledger (DATA-MODEL §2.11, SPEC §7.5).
// The ledger's balance (Σ debit = Σ credit per transaction) is enforced by a
// deferred constraint trigger in db/sql/010_ledger.sql and by
// lib/domain/ledger.ts postTransaction().
import { sql } from 'drizzle-orm';
import { pgTable, text, integer, bigint, uuid, boolean, char, uniqueIndex, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { chargeKind, chargeStatus, ledgerAccount, ledgerTxnKind, paymentMethod, paymentProvider, refundReason, refundStatus } from './enums';
import { partner } from './partners';
import { booking, cancellation } from './bookings';
import { dispute } from './disputes';
import { payoutItem } from './payouts';
import { createdAt, id, tz, updatedAt } from './columns';

/** One payment attempt for a booking. The id is also the provider idempotency key. */
export const charge = pgTable('charge', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  kind: chargeKind('kind').notNull().default('full'),
  method: paymentMethod('method').notNull(),
  provider: paymentProvider('provider').notNull(),
  /** Checkout session / payment intent. */
  providerRef: text('provider_ref'),
  /** Reused while pending. */
  checkoutUrl: text('checkout_url'),
  amountCents: integer('amount_cents').notNull(),
  /** Commission on this charge. */
  applicationFeeCents: integer('application_fee_cents').notNull().default(0),
  /**
   * The commission rate (basis points) the application fee was computed with when the charge was
   * created. The provider splits the money at that rate, so K5 snapshots this rate on the booking.
   */
  commissionBp: integer('commission_bp'),
  status: chargeStatus('status').notNull().default('pending'),
  cardBrand: text('card_brand'),
  cardLast4: char('card_last4', { length: 4 }),
  customerRef: text('customer_ref'),
  paymentMethodRef: text('payment_method_ref'),
  /** Provider-issued (bank transfer). */
  transferIban: text('transfer_iban'),
  /** = booking number */
  transferReference: text('transfer_reference'),
  dueAt: tz('due_at'),
  succeededAt: tz('succeeded_at'),
  failedAt: tz('failed_at'),
  failureReason: text('failure_reason'),
  refundedCents: integer('refunded_cents').notNull().default(0),
  isDuplicate: boolean('is_duplicate').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index('charge_booking_idx').on(t.bookingId, t.createdAt),
  uniqueIndex('charge_provider_ref_key').on(t.provider, t.providerRef),
  check('charge_amounts_check', sql`${t.amountCents} > 0 and ${t.applicationFeeCents} >= 0 and ${t.refundedCents} >= 0 and ${t.refundedCents} <= ${t.amountCents}`),
]);

export const refund = pgTable('refund', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  chargeId: uuid('charge_id').notNull().references(() => charge.id),
  reason: refundReason('reason').notNull(),
  amountCents: integer('amount_cents').notNull(),
  applicationFeeRefundCents: integer('application_fee_refund_cents').notNull().default(0),
  status: refundStatus('status').notNull().default('pending'),
  providerRef: text('provider_ref'),
  cancellationId: uuid('cancellation_id').references(() => cancellation.id),
  disputeId: uuid('dispute_id').references(() => dispute.id),
  requestedBy: text('requested_by').references(() => user.id),
  createdAt: createdAt(),
  succeededAt: tz('succeeded_at'),
  failureReason: text('failure_reason'),
}, t => [
  index('refund_booking_idx').on(t.bookingId),
  index('refund_provider_ref_idx').on(t.providerRef),
  check('refund_amounts_check', sql`${t.amountCents} > 0 and ${t.applicationFeeRefundCents} >= 0`),
]);

/** One money movement. Its entries balance. Append-only (db/sql/010_ledger.sql). */
export const ledgerTransaction = pgTable('ledger_transaction', {
  id: id(),
  kind: ledgerTxnKind('kind').notNull(),
  bookingId: uuid('booking_id').references(() => booking.id),
  chargeId: uuid('charge_id').references(() => charge.id),
  refundId: uuid('refund_id').references(() => refund.id),
  payoutItemId: uuid('payout_item_id').references((): AnyPgColumn => payoutItem.id),
  /** Business time of the movement (lib/clock now()). */
  occurredAt: tz('occurred_at').notNull(),
  description: text('description').notNull(),
  createdBy: text('created_by').references(() => user.id),
  createdAt: createdAt(),
}, t => [
  index('ledger_transaction_booking_idx').on(t.bookingId),
  index('ledger_transaction_charge_idx').on(t.chargeId),
  index('ledger_transaction_payout_item_idx').on(t.payoutItemId),
]);

export const ledgerEntry = pgTable('ledger_entry', {
  id: id(),
  transactionId: uuid('transaction_id').notNull().references(() => ledgerTransaction.id, { onDelete: 'cascade' }),
  account: ledgerAccount('account').notNull(),
  /** Dimension. */
  partnerId: uuid('partner_id').references(() => partner.id),
  /** Dimension. */
  bookingId: uuid('booking_id').references(() => booking.id),
  debitCents: bigint('debit_cents', { mode: 'number' }).notNull().default(0),
  creditCents: bigint('credit_cents', { mode: 'number' }).notNull().default(0),
}, t => [
  index('ledger_entry_account_partner_idx').on(t.account, t.partnerId),
  index('ledger_entry_booking_idx').on(t.bookingId),
  index('ledger_entry_transaction_idx').on(t.transactionId),
  check('ledger_entry_one_side_check',
    sql`${t.debitCents} >= 0 and ${t.creditCents} >= 0 and ((${t.debitCents} > 0) <> (${t.creditCents} > 0))`),
]);
