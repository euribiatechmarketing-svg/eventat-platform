// Reviews from paid bookings (DATA-MODEL §2.15). Text is masked; originals kept.
import { sql } from 'drizzle-orm';
import { pgTable, text, smallint, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { eventType } from './reference';
import { media } from './media';
import { partner } from './partners';
import { booking } from './bookings';
import { day, id, tz } from './columns';

export const review = pgTable('review', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => booking.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  clientId: text('client_id').notNull().references(() => user.id),
  /** ‹Петя и Николай› */
  authorDisplayName: text('author_display_name').notNull(),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
  eventDate: day('event_date').notNull(),
  /** ‹Пакет „Цял ден“› / ‹По запитване› */
  serviceLabel: text('service_label').notNull(),
  ratingOverall: smallint('rating_overall').notNull(),
  ratingCommunication: smallint('rating_communication').notNull(),
  ratingAccuracy: smallint('rating_accuracy').notNull(),
  ratingQuality: smallint('rating_quality').notNull(),
  ratingValue: smallint('rating_value').notNull(),
  body: text('body').notNull(),
  bodyOriginal: text('body_original').notNull(),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  publishedAt: tz('published_at').notNull().defaultNow(),
  replyText: text('reply_text'),
  replyOriginal: text('reply_original'),
  replyPublishedAt: tz('reply_published_at'),
}, t => [
  uniqueIndex('review_booking_key').on(t.bookingId),
  index('review_partner_published_idx').on(t.partnerId, t.publishedAt.desc()),
  index('review_partner_unanswered_idx').on(t.partnerId).where(sql`reply_text is null`),
  check('review_ratings_check', sql`${t.ratingOverall} between 1 and 5 and ${t.ratingCommunication} between 1 and 5
    and ${t.ratingAccuracy} between 1 and 5 and ${t.ratingQuality} between 1 and 5 and ${t.ratingValue} between 1 and 5`),
  check('review_body_length_check', sql`char_length(${t.bodyOriginal}) >= 40`),
]);

/** ≤ 6 per review. */
export const reviewPhoto = pgTable('review_photo', {
  reviewId: uuid('review_id').notNull().references(() => review.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id),
  position: smallint('position').notNull().default(0),
}, t => [primaryKey({ name: 'review_photo_pk', columns: [t.reviewId, t.mediaId] })]);
