// Card chargebacks reported by the payment provider (`dispute.created`). Not the
// platform's own сигнал/спор (`dispute`, one per booking): a chargeback comes
// from the card network, takes the money back at once and freezes the
// partner's payouts until the team records the outcome. Written only by
// lib/domain/chargebacks.ts.
import { sql } from 'drizzle-orm';
import { pgTable, text, integer, uuid, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { partner } from './partners';
import { booking } from './bookings';
import { charge, ledgerTransaction } from './money';
import { createdAt, id, tz } from './columns';

export const chargeback = pgTable('chargeback', {
  id: id(),
  chargeId: uuid('charge_id').notNull().references(() => charge.id),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  amountCents: integer('amount_cents').notNull(),
  /** The provider's reason code (`fraudulent`, `product_not_received`, …). */
  reason: text('reason').notNull(),
  /** open → won | lost. */
  status: text('status').notNull().default('open'),
  /** The posting that took the money out when the chargeback opened (reversed if won). */
  ledgerTransactionId: uuid('ledger_transaction_id').references(() => ledgerTransaction.id),
  /** Payout-line changes made when it opened, undone if won: [{ lineId, base, commission, status }]. */
  lineAdjustments: jsonb('line_adjustments').notNull().default(sql`'[]'::jsonb`),
  openedAt: tz('opened_at').notNull(),
  resolvedAt: tz('resolved_at'),
  resolvedBy: text('resolved_by').references(() => user.id),
  note: text('note'),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('chargeback_charge_key').on(t.chargeId),
  index('chargeback_partner_status_idx').on(t.partnerId, t.status),
  check('chargeback_status_check', sql`${t.status} in ('open', 'won', 'lost')`),
  check('chargeback_amount_check', sql`${t.amountCents} > 0`),
]);
