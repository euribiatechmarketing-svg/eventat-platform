// Platform plumbing shared by every feature: settings, the email outbox,
// in-app notifications, the audit log and the job queue that the per-minute
// cron sweeper drains.
import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, text, timestamp, jsonb, uuid, integer, index, boolean, uniqueIndex, date, unique, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { messageStatus, notificationChannel, reportKind, reportStatus } from './enums';
import { city } from './reference';
import { media } from './media';
import { partner } from './partners';

/**
 * Key/value settings versioned by effective_from (SPEC §2): the value at t is the row
 * with the greatest effective_from ≤ t. Read and write through lib/domain/settings.ts.
 */
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

/**
 * Per-user switches for optional emails and SMS (client/settings.html, vendor/settings.html).
 * A missing row means the SPEC §11 default. sendEmail() reads channel = 'email'.
 */
export const notificationPreference = pgTable('notification_preference', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  channel: notificationChannel('channel').notNull().default('email'),
  enabled: boolean('enabled').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('notification_preference_pk').on(t.userId, t.key, t.channel)]);

/** Every SMS (SPEC §11.4). With ⚙ sms.transport = outbox they are recorded only. */
export const smsOutbox = pgTable('sms_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateKey: text('template_key').notNull(),
  toPhone: text('to_phone').notNull(),
  toUserId: text('to_user_id').references(() => user.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  status: messageStatus('status').notNull().default('queued'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  dedupeKey: text('dedupe_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, t => [
  index('sms_outbox_status_idx').on(t.status, t.createdAt),
  uniqueIndex('sms_outbox_dedupe_idx').on(t.dedupeKey),
]);

/** Report exports (SPEC §4.17). */
export const reportJob = pgTable('report_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: reportKind('kind').notNull(),
  requestedBy: text('requested_by').notNull().references(() => user.id),
  partnerId: uuid('partner_id').references(() => partner.id),
  params: jsonb('params').notNull().default({}),
  status: reportStatus('status').notNull().default('requested'),
  mediaId: uuid('media_id').references(() => media.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readyAt: timestamp('ready_at', { withTimezone: true }),
}, t => [index('report_job_requester_idx').on(t.requestedBy, t.createdAt)]);

/** Admin KPI snapshots (GMV, commission, counts, ratios), refreshed every 15 min. */
export const metricsSnapshot = pgTable('metrics_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  periodKind: text('period_kind').notNull(),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  cityId: uuid('city_id').references(() => city.id),
  data: jsonb('data').notNull().default({}),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('metrics_snapshot_period_city_key').on(t.periodKind, t.periodStart, t.cityId).nullsNotDistinct(),
  check('metrics_snapshot_period_kind_check', sql`${t.periodKind} in ('month', 'quarter', 'year')`),
]);
