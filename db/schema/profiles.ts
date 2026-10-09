// Client profile, invoice data, consents and account-level requests (DATA-MODEL §2.2).
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, uuid, varchar, inet, integer, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { acquisitionSource, clientType, consentDocument, deletionStatus, invoiceRecipient } from './enums';
import { city } from './reference';
import { createdAt, id, tz, updatedAt } from './columns';

export const clientProfile = pgTable('client_profile', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  clientType: clientType('client_type').notNull().default('private'),
  cityId: uuid('city_id').references(() => city.id),
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
  marketingOptInAt: tz('marketing_opt_in_at'),
  acquisitionSource: acquisitionSource('acquisition_source'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** ‹Данни за фактура›; snapshotted onto each invoice at payment. */
export const clientInvoiceProfile = pgTable('client_invoice_profile', {
  userId: text('user_id').primaryKey().references(() => user.id),
  recipientType: invoiceRecipient('recipient_type').notNull().default('individual'),
  name: text('name').notNull(),
  companyName: text('company_name'),
  eik: varchar('eik', { length: 13 }),
  mol: text('mol'),
  address: text('address'),
  updatedAt: updatedAt(),
}, t => [
  check('client_invoice_profile_company_check',
    sql`${t.recipientType} <> 'company' or (${t.companyName} is not null and ${t.eik} is not null and ${t.mol} is not null)`),
]);

export const consent = pgTable('consent', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id),
  document: consentDocument('document').notNull(),
  version: text('version').notNull(),
  acceptedAt: tz('accepted_at').notNull().defaultNow(),
  ip: inet('ip'),
}, t => [index('consent_user_document_idx').on(t.userId, t.document)]);

export const accountDeletionRequest = pgTable('account_deletion_request', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id),
  tokenHash: text('token_hash').notNull().unique('account_deletion_request_token_hash_key'),
  status: deletionStatus('status').notNull().default('requested'),
  requestedAt: tz('requested_at').notNull().defaultNow(),
  expiresAt: tz('expires_at').notNull(),
  confirmedAt: tz('confirmed_at'),
}, t => [uniqueIndex('account_deletion_request_open_key').on(t.userId).where(sql`status = 'requested'`)]);

/** D55: a code goes to the new address before the email switches. `attempts`: tries used (D49: 5 per code). */
export const emailChangeRequest = pgTable('email_change_request', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id),
  newEmail: text('new_email').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: tz('expires_at').notNull(),
  confirmedAt: tz('confirmed_at'),
  createdAt: createdAt(),
}, t => [index('email_change_request_user_idx').on(t.userId, t.createdAt)]);
