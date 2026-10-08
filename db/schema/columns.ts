// Column helpers shared by the schema files (not exported from the schema index).
import { date, timestamp, uuid } from 'drizzle-orm/pg-core';

/** uuid primary key with gen_random_uuid(). */
export const id = () => uuid('id').primaryKey().defaultRandom();
/** An instant (timestamptz), as a JS Date. */
export const tz = (name: string) => timestamp(name, { withTimezone: true });
/** A Sofia calendar date, as 'YYYY-MM-DD'. */
export const day = (name: string) => date(name, { mode: 'string' });
export const createdAt = () => tz('created_at').notNull().defaultNow();
export const updatedAt = () => tz('updated_at').notNull().defaultNow();
