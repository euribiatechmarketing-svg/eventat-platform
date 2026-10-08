// Better Auth tables (user, session, account, verification, two_factor).
// Property names are what Better Auth's Drizzle adapter expects; column
// names are snake_case. User ids are Better Auth's text ids — every other
// table references them as text. Columns marked ✚ in DATA-MODEL §2.1 are
// ours: Better Auth never writes them, so they have defaults or are nullable.
import { pgTable, pgEnum, text, timestamp, boolean, index, integer } from 'drizzle-orm/pg-core';
import { locale } from './enums';

export const userRole = pgEnum('user_role', ['client', 'partner', 'admin']);
export type UserRole = (typeof userRole.enumValues)[number];

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: userRole('role').notNull().default('client'),
  phone: text('phone'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  locale: locale('locale').notNull().default('bg'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLoginCity: text('last_login_city'),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, t => [index('user_role_created_idx').on(t.role, t.createdAt)]);

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  deviceLabel: text('device_label'),
  city: text('city'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('session_user_idx').on(t.userId)]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('account_user_idx').on(t.userId)]);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('verification_identifier_idx').on(t.identifier)]);

export const twoFactor = pgTable('two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  verified: boolean('verified').default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
}, t => [index('two_factor_user_idx').on(t.userId), index('two_factor_secret_idx').on(t.secret)]);
