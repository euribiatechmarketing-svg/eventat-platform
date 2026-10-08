// Partner availability (DATA-MODEL §2.7). Blocks of one partner never overlap:
// the gist exclusion constraint lives in db/sql/020_availability.sql.
import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { partner } from './partners';
import { createdAt, day, id } from './columns';

export const availabilityBlock = pgTable('availability_block', {
  id: id(),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  startDate: day('start_date').notNull(),
  endDate: day('end_date').notNull(),
  /** ‹Отпуска› */
  reason: text('reason'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: createdAt(),
}, t => [
  index('availability_block_partner_idx').on(t.partnerId, t.startDate),
  check('availability_block_range_check', sql`${t.endDate} >= ${t.startDate}`),
]);

/** Used when partner.only_selected_dates. */
export const availabilityOpenDate = pgTable('availability_open_date', {
  partnerId: uuid('partner_id').notNull().references(() => partner.id, { onDelete: 'cascade' }),
  date: day('date').notNull(),
}, t => [primaryKey({ name: 'availability_open_date_pk', columns: [t.partnerId, t.date] })]);
