// Invoices, credit notes and commission invoices (DATA-MODEL §2.20, SPEC §9).
// Numbers come from invoice_sequence per issuer, incremented with
// UPDATE … RETURNING inside the charge-success transaction (no gaps).
import { pgTable, text, integer, smallint, uuid, char, numeric, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { invoiceIssuerType, invoiceRecipient, invoiceStatus, invoiceType } from './enums';
import { media } from './media';
import { partner } from './partners';
import { booking } from './bookings';
import { charge, refund } from './money';
import { payoutItem } from './payouts';
import { createdAt, day, id } from './columns';

export const invoice = pgTable('invoice', {
  id: id(),
  type: invoiceType('type').notNull().default('invoice'),
  issuerType: invoiceIssuerType('issuer_type').notNull().default('partner'),
  /** The partner id, or `platform`. */
  issuerKey: text('issuer_key').notNull(),
  /** ‹0000000412› */
  number: char('number', { length: 10 }).notNull(),
  partnerId: uuid('partner_id').references(() => partner.id),
  bookingId: uuid('booking_id').references(() => booking.id),
  chargeId: uuid('charge_id').references(() => charge.id),
  refundId: uuid('refund_id').references(() => refund.id),
  payoutItemId: uuid('payout_item_id').references(() => payoutItem.id),
  /** Credit notes: the invoice they correct. */
  creditedInvoiceId: uuid('credited_invoice_id').references((): AnyPgColumn => invoice.id),
  // Issuer snapshot.
  issuerLegalName: text('issuer_legal_name'),
  issuerEik: text('issuer_eik'),
  issuerVatNumber: text('issuer_vat_number'),
  issuerAddress: text('issuer_address'),
  issuerManager: text('issuer_manager'),
  issuerEmail: text('issuer_email'),
  issuerCity: text('issuer_city'),
  // Recipient snapshot.
  recipientType: invoiceRecipient('recipient_type').notNull(),
  recipientName: text('recipient_name'),
  recipientCompany: text('recipient_company'),
  recipientEik: text('recipient_eik'),
  recipientMol: text('recipient_mol'),
  recipientAddress: text('recipient_address'),
  recipientEmail: text('recipient_email'),
  recipientPhone: text('recipient_phone'),
  /** ‹Дата на издаване› */
  issuedOn: day('issued_on').notNull(),
  /** ‹Дата на плащане› */
  paidOn: day('paid_on'),
  /** ‹София› */
  place: text('place').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('EUR'),
  subtotalCents: integer('subtotal_cents').notNull(),
  vatCents: integer('vat_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  /** ‹Карта Visa •••• 4242› */
  paymentNote: text('payment_note'),
  status: invoiceStatus('status').notNull().default('issued'),
  pdfMediaId: uuid('pdf_media_id').references(() => media.id),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('invoice_issuer_number_key').on(t.issuerKey, t.number),
  index('invoice_booking_idx').on(t.bookingId),
]);

export const invoiceLine = pgTable('invoice_line', {
  id: id(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  position: smallint('position').notNull(),
  /** ‹Пакет „Цял ден“ · DJ и озвучаване› */
  description: text('description').notNull(),
  /** ‹14 юни 2026 · Вила Екатерина, с. Панчарево · 120 гости› */
  detail: text('detail'),
  quantity: numeric('quantity', { precision: 10, scale: 2, mode: 'number' }).notNull().default(1),
  unitPriceCents: integer('unit_price_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  vatRateBp: integer('vat_rate_bp').notNull().default(0),
}, t => [index('invoice_line_invoice_idx').on(t.invoiceId, t.position)]);

export const invoiceSequence = pgTable('invoice_sequence', {
  issuerKey: text('issuer_key').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});
