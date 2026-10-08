// The EventAT team (DATA-MODEL §2.19). Permissions per role: lib/domain/actor.ts (SPEC §1.2).
import { pgTable, text, boolean, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { teamInviteStatus, teamMemberStatus, teamRole } from './enums';
import { tz } from './columns';

export const teamMember = pgTable('team_member', {
  userId: text('user_id').primaryKey().references(() => user.id),
  role: teamRole('role').notNull(),
  /** ‹Външен счетоводител› */
  title: text('title'),
  /** ‹Собственик на профила›; cannot be removed. */
  isOwner: boolean('is_owner').notNull().default(false),
  status: teamMemberStatus('status').notNull().default('active'),
  joinedAt: tz('joined_at').notNull().defaultNow(),
  invitedBy: text('invited_by').references(() => user.id),
  removedAt: tz('removed_at'),
  removedBy: text('removed_by').references(() => user.id),
  lastActiveAt: tz('last_active_at'),
}, t => [index('team_member_role_status_idx').on(t.role, t.status)]);

export const teamInvite = pgTable('team_invite', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  role: teamRole('role').notNull(),
  invitedBy: text('invited_by').notNull().references(() => user.id),
  tokenHash: text('token_hash').notNull(),
  status: teamInviteStatus('status').notNull().default('pending'),
  sentAt: tz('sent_at').notNull().defaultNow(),
  /** sent_at + 7 days (D50). */
  expiresAt: tz('expires_at').notNull(),
  acceptedAt: tz('accepted_at'),
  revokedAt: tz('revoked_at'),
}, t => [
  uniqueIndex('team_invite_token_hash_key').on(t.tokenHash),
  index('team_invite_status_idx').on(t.status),
]);
