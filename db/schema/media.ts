// Uploaded files (DATA-MODEL §2.5). Public photos are served directly;
// private files only through /api/files/[id] after an authorisation check.
import { sql } from 'drizzle-orm';
import { pgTable, text, integer, boolean, check, index } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { mediaKind } from './enums';
import { createdAt, id } from './columns';

export const MEDIA_MAX_BYTES = 5_242_880;

export const media = pgTable('media', {
  id: id(),
  ownerUserId: text('owner_user_id').references(() => user.id),
  kind: mediaKind('kind').notNull(),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name'),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: createdAt(),
}, t => [
  check('media_mime_check', sql`${t.mime} in ('image/jpeg', 'image/png', 'application/pdf')`),
  check('media_size_check', sql`${t.sizeBytes} >= 0 and ${t.sizeBytes} <= 5242880`),
  index('media_owner_idx').on(t.ownerUserId),
]);
