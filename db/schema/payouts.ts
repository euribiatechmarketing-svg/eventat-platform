// Payout accounts, batches (1st/15th), items (one provider payout per partner
// per batch) and lines (one per booking) — DATA-MODEL §2.12, SPEC §8.
import { sql } from 'drizzle-orm';
import { pgTable, text, integer, bigint, uuid, char, customType, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { holdReason, payoutAccountStatus, payoutBatchStatus, payoutItemStatus, payoutLineStatus } from './enums';
import { media } from './media';
import { partner } from './partners';
import { booking } from './bookings';
import { charge } from './money';
import { dispute } from './disputes';
import { createdAt, day, id, tz } from './columns';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const payoutAccount = pgTable('payout_account', {
  id: id(),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  /** Null when the provider holds the full IBAN (seed). */
  ibanEncrypted: bytea('iban_encrypted'),
  /** ‹5272›; display masks from this only. */
  ibanLast4: char('iban_last4', { length: 4 }).notNull(),
  /** Must equal partner.legal_name. */
  holderName: text('holder_name').notNull(),
  bankName: text('bank_name').notNull(),
  bankBranch: text('bank_branch'),
  proofMediaId: uuid('proof_media_id').references(() => media.id),
  status: payoutAccountStatus('status').notNull().default('pending_verification'),
  submittedAt: tz('submitted_at').notNull().defaultNow(),
  verifiedBy: text('verified_by').references(() => user.id),
  verifiedAt: tz('verified_at'),
  rejectedReason: text('rejected_reason'),
  providerExternalRef: text('provider_external_ref'),
}, t => [
  uniqueIndex('payout_account_confirmed_key').on(t.partnerId).where(sql`status = 'confirmed'`),
  uniqueIndex('payout_account_pending_key').on(t.partnerId).where(sql`status = 'pending_verification'`),
]);

export const payoutBatch = pgTable('payout_batch', {
  id: id(),
  batchDate: day('batch_date').notNull(),
  /** ‹Партида август · първа половина› */
  label: text('label').notNull(),
  /** ‹Обединена банка · SEPA› */
  railLabel: text('rail_label'),
  status: payoutBatchStatus('status').notNull().default('scheduled'),
  partnerCount: integer('partner_count').notNull().default(0),
  grossCents: bigint('gross_cents', { mode: 'number' }).notNull().default(0),
  commissionCents: bigint('commission_cents', { mode: 'number' }).notNull().default(0),
  netCents: bigint('net_cents', { mode: 'number' }).notNull().default(0),
  heldCents: bigint('held_cents', { mode: 'number' }).notNull().default(0),
  preparedAt: tz('prepared_at'),
  releasedBy: text('released_by').references(() => user.id),
  secondApprover: text('second_approver').references(() => user.id),
  releasedAt: tz('released_at'),
  paidAt: tz('paid_at'),
  createdAt: createdAt(),
}, t => [uniqueIndex('payout_batch_date_key').on(t.batchDate)]);

export const payoutItem = pgTable('payout_item', {
  id: id(),
  batchId: uuid('batch_id').notNull().references(() => payoutBatch.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  payoutAccountId: uuid('payout_account_id').references(() => payoutAccount.id),
  amountCents: integer('amount_cents').notNull(),
  status: payoutItemStatus('status').notNull().default('ready'),
  holdReason: holdReason('hold_reason'),
  disputeId: uuid('dispute_id').references(() => dispute.id),
  providerPayoutRef: text('provider_payout_ref'),
  /** ‹Сметката е закрита› */
  failureReason: text('failure_reason'),
  sentAt: tz('sent_at'),
  paidAt: tz('paid_at'),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('payout_item_batch_partner_key').on(t.batchId, t.partnerId),
  index('payout_item_partner_idx').on(t.partnerId, t.status),
  index('payout_item_provider_ref_idx').on(t.providerPayoutRef),
]);

/** One per booking (and per early-released charge). */
export const payoutLine = pgTable('payout_line', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  /** Set for early releases (SPEC §7.4). */
  chargeId: uuid('charge_id').references(() => charge.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  payoutItemId: uuid('payout_item_id').references(() => payoutItem.id),
  /** Target batch. */
  batchDate: day('batch_date').notNull(),
  /** Retained / gross. */
  baseCents: integer('base_cents').notNull(),
  commissionCents: integer('commission_cents').notNull(),
  /** ‹Получавате› */
  amountCents: integer('amount_cents').notNull(),
  status: payoutLineStatus('status').notNull().default('awaiting_event'),
  holdReason: holdReason('hold_reason'),
  readyAt: tz('ready_at'),
  paidAt: tz('paid_at'),
  createdAt: createdAt(),
}, t => [
  index('payout_line_partner_status_idx').on(t.partnerId, t.status),
  index('payout_line_batch_status_idx').on(t.batchDate, t.status),
  index('payout_line_booking_idx').on(t.bookingId),
]);
