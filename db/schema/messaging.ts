// Client ↔ partner conversations (DATA-MODEL §2.14). `body` is what the other
// side sees (masked per SPEC §10); `body_original` is kept for the team.
import { pgTable, text, integer, uuid, primaryKey, unique, index } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { senderRole } from './enums';
import { media } from './media';
import { partner } from './partners';
import { clientEvent, request } from './requests';
import { booking } from './bookings';
import { createdAt, id, tz } from './columns';

export const conversation = pgTable('conversation', {
  id: id(),
  clientId: text('client_id').notNull().references(() => user.id),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  clientEventId: uuid('client_event_id').references(() => clientEvent.id),
  /** Latest request. */
  requestId: uuid('request_id').references(() => request.id),
  /** Latest booking; drives ‹Виж резервацията›. */
  bookingId: uuid('booking_id').references(() => booking.id),
  lastMessageAt: tz('last_message_at'),
  clientLastReadAt: tz('client_last_read_at'),
  partnerLastReadAt: tz('partner_last_read_at'),
  clientUnreadCount: integer('client_unread_count').notNull().default(0),
  partnerUnreadCount: integer('partner_unread_count').notNull().default(0),
  clientDraft: text('client_draft'),
  partnerDraft: text('partner_draft'),
  createdAt: createdAt(),
}, t => [
  // One thread per client, partner and event; a thread without an event is unique too.
  unique('conversation_client_partner_event_key').on(t.clientId, t.partnerId, t.clientEventId).nullsNotDistinct(),
  index('conversation_client_idx').on(t.clientId, t.lastMessageAt.desc()),
  index('conversation_partner_idx').on(t.partnerId, t.lastMessageAt.desc()),
]);

export const message = pgTable('message', {
  id: id(),
  conversationId: uuid('conversation_id').notNull().references(() => conversation.id),
  senderRole: senderRole('sender_role').notNull(),
  senderUserId: text('sender_user_id').references(() => user.id),
  body: text('body').notNull(),
  bodyOriginal: text('body_original').notNull(),
  createdAt: createdAt(),
  readAt: tz('read_at'),
}, t => [index('message_conversation_idx').on(t.conversationId, t.createdAt)]);

export const messageAttachment = pgTable('message_attachment', {
  messageId: uuid('message_id').notNull().references(() => message.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id),
}, t => [primaryKey({ name: 'message_attachment_pk', columns: [t.messageId, t.mediaId] })]);
