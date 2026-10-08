// Saved searches, date watches and search history (DATA-MODEL §2.16, SPEC §13.9).
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, uuid, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { watchStatus } from './enums';
import { partner } from './partners';
import { clientEvent } from './requests';
import { createdAt, day, id, tz } from './columns';

export const savedSearch = pgTable('saved_search', {
  id: id(),
  clientId: text('client_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  filtersSummary: text('filters_summary').notNull(),
  /** The GET params of SPEC §13.1. */
  params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
  notify: boolean('notify').notNull().default(true),
  seenAt: tz('seen_at'),
  lastCheckedAt: tz('last_checked_at'),
  lastAlertedAt: tz('last_alerted_at'),
  lastOpenedAt: tz('last_opened_at'),
  createdAt: createdAt(),
}, t => [index('saved_search_client_idx').on(t.clientId, t.createdAt)]);

/** ‹Уведоми ме, ако се освободи›. */
export const dateWatch = pgTable('date_watch', {
  id: id(),
  clientId: text('client_id').notNull().references(() => user.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  date: day('date').notNull(),
  clientEventId: uuid('client_event_id').references(() => clientEvent.id),
  status: watchStatus('status').notNull().default('watching'),
  createdAt: createdAt(),
  notifiedAt: tz('notified_at'),
  closedAt: tz('closed_at'),
}, t => [
  uniqueIndex('date_watch_active_key').on(t.clientId, t.partnerId, t.date).where(sql`status = 'watching'`),
  index('date_watch_partner_date_idx').on(t.partnerId, t.date, t.status),
]);

export const searchHistory = pgTable('search_history', {
  id: id(),
  clientId: text('client_id').notNull().references(() => user.id),
  query: text('query').notNull(),
  createdAt: createdAt(),
}, t => [index('search_history_client_idx').on(t.clientId, t.createdAt.desc())]);
