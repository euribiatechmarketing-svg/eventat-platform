// Platform plumbing shared by every feature: settings, the email outbox,
// in-app notifications, the audit log and the job queue that the per-minute
// cron sweeper drains.
import { pgTable, pgEnum, text, timestamp, jsonb, uuid, integer, index, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';

/** Key/value settings with an effective date (admin/settings.html: changes apply to new bookings only). */
export const platformSettings = pgTable('platform_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  changedBy: text('changed_by').references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('platform_settings_key_idx').on(t.key, t.effectiveFrom)]);

export const emailStatus = pgEnum('email_status', ['queued', 'sent', 'failed', 'suppressed']);

/** Every automatic email, whether or not a real transport is configured (Админ → Имейли reads this). */
export const emailOutbox = pgTable('email_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateKey: text('template_key').notNull(),
  toEmail: text('to_email').notNull(),
  toUserId: text('to_user_id').references(() => user.id, { onDelete: 'set null' }),
  audience: text('audience').notNull(), // client | partner | team
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  text: text('text').notNull(),
  vars: jsonb('vars').notNull().default({}),
  status: emailStatus('status').notNull().default('queued'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  dedupeKey: text('dedupe_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, t => [
  index('email_outbox_status_idx').on(t.status, t.createdAt),
  index('email_outbox_user_idx').on(t.toUserId),
  uniqueIndex('email_outbox_dedupe_idx').on(t.dedupeKey),
]);

/** The bell. */
export const notification = pgTable('notification', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  href: text('href'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('notification_user_idx').on(t.userId, t.createdAt)]);

/** Who did what, for the admin side and for disputes. */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  actorRole: text('actor_role'), // client | partner | admin | system
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_actor_idx').on(t.actorId)]);

/** Deferred work: deadlines and reminders. The cron sweeper runs due jobs (FOR UPDATE SKIP LOCKED). */
export const jobStatus = pgEnum('job_status', ['pending', 'done', 'cancelled', 'failed']);
export const job = pgTable('job', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  payload: jsonb('payload').notNull().default({}),
  status: jobStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  dedupeKey: text('dedupe_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  doneAt: timestamp('done_at', { withTimezone: true }),
}, t => [index('job_due_idx').on(t.status, t.runAt), uniqueIndex('job_dedupe_idx').on(t.dedupeKey)]);

/** Per-user switches for optional emails (client/settings.html, vendor/settings.html). */
export const notificationPreference = pgTable('notification_preference', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('notification_preference_pk').on(t.userId, t.key)]);
