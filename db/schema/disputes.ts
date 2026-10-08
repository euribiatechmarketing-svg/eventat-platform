// Disputes — сигнал (client/partner UI) = кейс / спор (admin UI) (DATA-MODEL §2.13).
import { sql } from 'drizzle-orm';
import { pgTable, text, integer, uuid, boolean, jsonb, smallint, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { disputeDecisionKind, disputeMessageKind, disputeParty, disputeReason, disputeStatus } from './enums';
import { media } from './media';
import { booking } from './bookings';
import { createdAt, id, tz, updatedAt } from './columns';

export const dispute = pgTable('dispute', {
  id: id(),
  /** = booking number; route /admin/sporove/[nomer]. */
  number: text('number').notNull(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  openedBy: disputeParty('opened_by').notNull(),
  openedByUser: text('opened_by_user').references(() => user.id),
  reason: disputeReason('reason').notNull(),
  title: text('title').notNull(),
  /** ‹Сигналът накратко› */
  summary: text('summary'),
  /** The filer's text. */
  description: text('description').notNull(),
  status: disputeStatus('status').notNull().default('collecting'),
  urgent: boolean('urgent').notNull().default(false),
  /** D13 */
  holdsPayout: boolean('holds_payout').notNull().default(true),
  heldCents: integer('held_cents').notNull().default(0),
  openedAt: tz('opened_at').notNull().defaultNow(),
  teamReplyDueAt: tz('team_reply_due_at').notNull(),
  /** The other side. */
  positionFrom: disputeParty('position_from').notNull(),
  positionRequestedAt: tz('position_requested_at').notNull(),
  positionDueAt: tz('position_due_at').notNull(),
  /** [[label, value, "warn"?]] (‹Иска клиентът›…) */
  facts: jsonb('facts').notNull().default(sql`'[]'::jsonb`),
  /** [[label, value, sub, "key"?]] (‹Какво е договорено›) */
  agreedTerms: jsonb('agreed_terms').notNull().default(sql`'[]'::jsonb`),
  /** [[label, value, isNew]] */
  comparison: jsonb('comparison'),
  note: text('note'),
  decisionKind: disputeDecisionKind('decision_kind'),
  decisionTitle: text('decision_title'),
  decisionDetail: text('decision_detail'),
  /** ‹Мотив към двете страни› */
  motive: text('motive'),
  refundCents: integer('refund_cents'),
  partnerKeepsCents: integer('partner_keeps_cents'),
  newAmountCents: integer('new_amount_cents'),
  complianceDueAt: tz('compliance_due_at'),
  fallback: disputeDecisionKind('fallback'),
  compliedAt: tz('complied_at'),
  decidedBy: text('decided_by').references(() => user.id),
  decidedAt: tz('decided_at'),
  withdrawnAt: tz('withdrawn_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('dispute_booking_key').on(t.bookingId),
  index('dispute_queue_idx').on(t.status, t.urgent.desc(), t.openedAt.desc()),
  index('dispute_number_idx').on(t.number),
]);

/** The decision choices on the case page. */
export const disputeOption = pgTable('dispute_option', {
  id: id(),
  disputeId: uuid('dispute_id').notNull().references(() => dispute.id),
  kind: disputeDecisionKind('kind').notNull(),
  /** ‹Върни разликата — 140 €› */
  label: text('label').notNull(),
  description: text('description'),
  refundCents: integer('refund_cents'),
  newAmountCents: integer('new_amount_cents'),
  position: smallint('position').notNull().default(0),
}, t => [index('dispute_option_dispute_idx').on(t.disputeId, t.position)]);

export const disputeMessage = pgTable('dispute_message', {
  id: id(),
  disputeId: uuid('dispute_id').notNull().references(() => dispute.id),
  party: disputeParty('party').notNull(),
  authorId: text('author_id').references(() => user.id),
  kind: disputeMessageKind('kind').notNull(),
  body: text('body').notNull(),
  /** ‹причина: „Друго“› / ‹в отговор на запитване от екипа› */
  context: text('context'),
  recipients: text('recipients'),
  createdAt: createdAt(),
}, t => [
  index('dispute_message_dispute_idx').on(t.disputeId, t.createdAt),
  check('dispute_message_recipients_check', sql`${t.recipients} is null or ${t.recipients} in ('client', 'partner', 'both')`),
]);

export const disputeAttachment = pgTable('dispute_attachment', {
  id: id(),
  disputeId: uuid('dispute_id').notNull().references(() => dispute.id),
  messageId: uuid('message_id').references(() => disputeMessage.id),
  mediaId: uuid('media_id').notNull().references(() => media.id),
  /** ‹Правила на залата · PDF› */
  label: text('label'),
  createdAt: createdAt(),
}, t => [index('dispute_attachment_dispute_idx').on(t.disputeId)]);
