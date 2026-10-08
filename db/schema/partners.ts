// Partners (DATA-MODEL §2.4): the business, its members, specialisations,
// gallery, moderation checks and decisions, invites and team notes.
import { sql } from 'drizzle-orm';
import {
  pgTable, text, boolean, smallint, integer, uuid, varchar, numeric, primaryKey, uniqueIndex, index, check,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
  bookingsPerDayMode, cancellationPolicy, checkState, experienceBand, legalForm, partnerCheckKind, partnerDecisionKind,
  partnerMemberRole, partnerStatus, paymentProvider, priceUnit, providerAccountStatus, reschedulePolicy,
} from './enums';
import { category, categorySubtype, city, eventType } from './reference';
import { media } from './media';
import { createdAt, id, tz, updatedAt } from './columns';

export const partner = pgTable('partner', {
  id: id(),
  slug: text('slug').notNull(),
  status: partnerStatus('status').notNull().default('draft'),
  onboardingStep: smallint('onboarding_step').notNull().default(1),
  draftSavedAt: tz('draft_saved_at'),
  businessName: text('business_name').notNull(),
  businessNameChangedAt: tz('business_name_changed_at'),
  legalName: text('legal_name'),
  legalForm: legalForm('legal_form'),
  legalFormOther: text('legal_form_other'),
  eik: varchar('eik', { length: 13 }),
  vatRegistered: boolean('vat_registered').notNull().default(false),
  vatNumber: text('vat_number'),
  registeredAddress: text('registered_address'),
  managerName: text('manager_name'),
  contactName: text('contact_name').notNull(),
  contactRole: text('contact_role'),
  notificationEmail: text('notification_email').notNull(),
  phone: text('phone').notNull(),
  websiteUrl: text('website_url'),
  socialHandle: text('social_handle'),
  primaryCategoryId: uuid('primary_category_id').references(() => category.id),
  suggestedCategory: text('suggested_category'),
  cityId: uuid('city_id').references(() => city.id),
  serviceRadiusKm: integer('service_radius_km'),
  servesNationwide: boolean('serves_nationwide').notNull().default(false),
  alsoServesNote: text('also_serves_note'),
  experienceBand: experienceBand('experience_band'),
  activeSinceYear: smallint('active_since_year'),
  languages: text('languages').array().notNull().default(sql`'{}'::text[]`),
  avatarMediaId: uuid('avatar_media_id').references(() => media.id),
  coverMediaId: uuid('cover_media_id').references(() => media.id),
  shortDescription: varchar('short_description', { length: 140 }),
  description: varchar('description', { length: 600 }),
  videoUrl: text('video_url'),
  offersFixedPackages: boolean('offers_fixed_packages').notNull().default(true),
  offersOnRequest: boolean('offers_on_request').notNull().default(false),
  bookingsPerDayMode: bookingsPerDayMode('bookings_per_day_mode').notNull().default('one'),
  maxBookingsPerDate: smallint('max_bookings_per_date').notNull().default(1),
  leadTimeDays: smallint('lead_time_days').notNull().default(7),
  horizonMonths: smallint('horizon_months').notNull().default(24),
  /** ISO weekdays 1 (Monday) – 7 (Sunday). */
  workingDays: smallint('working_days').array().notNull().default(sql`'{1,2,3,4,5,6,7}'::smallint[]`),
  onlySelectedDates: boolean('only_selected_dates').notNull().default(false),
  cancellationPolicy: cancellationPolicy('cancellation_policy'),
  depositPercent: smallint('deposit_percent').notNull().default(30),
  reschedulePolicy: reschedulePolicy('reschedule_policy').notNull().default('free_if_available'),
  maxGuests: integer('max_guests'),
  isListed: boolean('is_listed').notNull().default(true),
  acceptingRequests: boolean('accepting_requests').notNull().default(true),
  isVerified: boolean('is_verified').notNull().default(false),
  payoutsPaused: boolean('payouts_paused').notNull().default(false),
  provider: paymentProvider('provider'),
  providerAccountRef: text('provider_account_ref'),
  providerStatus: providerAccountStatus('provider_status').notNull().default('not_started'),
  providerChargesEnabled: boolean('provider_charges_enabled').notNull().default(false),
  providerPayoutsEnabled: boolean('provider_payouts_enabled').notNull().default(false),
  providerRequirements: text('provider_requirements').array().notNull().default(sql`'{}'::text[]`),
  infoConfirmedAt: tz('info_confirmed_at'),
  termsAcceptedAt: tz('terms_accepted_at'),
  submittedAt: tz('submitted_at'),
  approvedAt: tz('approved_at'),
  returnedAt: tz('returned_at'),
  rejectedAt: tz('rejected_at'),
  deactivatedAt: tz('deactivated_at'),
  deletedAt: tz('deleted_at'),
  approvedBy: text('approved_by').references(() => user.id),
  /**
   * When the partner last entered the search base set (approved, listed and accepting requests):
   * set on approval, on re-listing and on reactivation. Saved-search alerts (T20) and ‹N нови›
   * count partners whose coalesce(listed_at, approved_at) is after the last check (catalogue addition).
   */
  listedAt: tz('listed_at'),
  lastDecisionNote: text('last_decision_note'),
  /** Cached from reviews (SPEC §12.4). */
  ratingAvg: numeric('rating_avg', { precision: 2, scale: 1, mode: 'number' }),
  reviewCount: integer('review_count').notNull().default(0),
  responsivenessPct: smallint('responsiveness_pct'),
  minPriceCents: integer('min_price_cents'),
  minPriceUnit: priceUnit('min_price_unit'),
  /** Lower-case stem-matcher text, maintained by the domain layer (SPEC §13.3). */
  searchText: text('search_text').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex('partner_slug_key').on(t.slug),
  uniqueIndex('partner_provider_account_ref_key').on(t.providerAccountRef),
  index('partner_listing_idx').on(t.status, t.isListed, t.acceptingRequests),
  index('partner_city_idx').on(t.cityId),
  index('partner_primary_category_idx').on(t.primaryCategoryId),
  index('partner_search_text_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
  index('partner_approved_at_idx').on(t.approvedAt),
  check('partner_max_bookings_per_date_check', sql`${t.maxBookingsPerDate} between 1 and 9`),
  check('partner_lead_time_days_check', sql`${t.leadTimeDays} in (0, 1, 3, 7, 14, 30)`),
  check('partner_horizon_months_check', sql`${t.horizonMonths} in (3, 6, 12, 24)`),
  check('partner_deposit_percent_check', sql`${t.depositPercent} in (20, 30, 40, 50)`),
  check('partner_onboarding_step_check', sql`${t.onboardingStep} between 1 and 6`),
]);

/** v1: exactly one owner per partner (D52). A user belongs to at most one partner. */
export const partnerMember = pgTable('partner_member', {
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  userId: text('user_id').notNull().references(() => user.id),
  role: partnerMemberRole('role').notNull().default('owner'),
  createdAt: createdAt(),
}, t => [
  primaryKey({ name: 'partner_member_pk', columns: [t.partnerId, t.userId] }),
  uniqueIndex('partner_member_user_key').on(t.userId),
]);

/** Feeds the ‹Тип събитие› filter. */
export const partnerEventType = pgTable('partner_event_type', {
  partnerId: uuid('partner_id').notNull().references(() => partner.id, { onDelete: 'cascade' }),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
}, t => [primaryKey({ name: 'partner_event_type_pk', columns: [t.partnerId, t.eventTypeId] })]);

/** Skills (‹Озвучаване›). */
export const partnerTag = pgTable('partner_tag', {
  partnerId: uuid('partner_id').notNull().references(() => partner.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  isCustom: boolean('is_custom').notNull().default(false),
}, t => [primaryKey({ name: 'partner_tag_pk', columns: [t.partnerId, t.label] })]);

export const partnerSubtype = pgTable('partner_subtype', {
  partnerId: uuid('partner_id').notNull().references(() => partner.id, { onDelete: 'cascade' }),
  subtypeId: uuid('subtype_id').notNull().references(() => categorySubtype.id),
}, t => [primaryKey({ name: 'partner_subtype_pk', columns: [t.partnerId, t.subtypeId] })]);

/** Gallery. Position 0 = ‹Главна› (the catalogue photo). */
export const partnerPhoto = pgTable('partner_photo', {
  id: id(),
  partnerId: uuid('partner_id').notNull().references(() => partner.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id),
  position: smallint('position').notNull(),
  createdAt: createdAt(),
}, t => [uniqueIndex('partner_photo_partner_position_key').on(t.partnerId, t.position)]);

export const partnerCheck = pgTable('partner_check', {
  partnerId: uuid('partner_id').notNull().references(() => partner.id, { onDelete: 'cascade' }),
  kind: partnerCheckKind('kind').notNull(),
  state: checkState('state').notNull().default('waiting'),
  detail: text('detail'),
  checkedBy: text('checked_by').references(() => user.id),
  checkedAt: tz('checked_at'),
}, t => [primaryKey({ name: 'partner_check_pk', columns: [t.partnerId, t.kind] })]);

export const partnerDecision = pgTable('partner_decision', {
  id: id(),
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  decision: partnerDecisionKind('decision').notNull(),
  note: text('note'),
  decidedBy: text('decided_by').notNull().references(() => user.id),
  decidedAt: tz('decided_at').notNull().defaultNow(),
}, t => [
  index('partner_decision_partner_idx').on(t.partnerId, t.decidedAt),
  check('partner_decision_note_check', sql`${t.decision} = 'approved' or ${t.note} is not null`),
]);

export const partnerInvite = pgTable('partner_invite', {
  id: id(),
  email: text('email').notNull(),
  invitedBy: text('invited_by').notNull().references(() => user.id),
  sentAt: tz('sent_at').notNull().defaultNow(),
  registeredPartnerId: uuid('registered_partner_id').references(() => partner.id),
}, t => [index('partner_invite_email_idx').on(t.email)]);

/** ‹Бележки от модерацията› / ‹Бележки на екипа› / ‹Вътрешна бележка›. */
export const adminNote = pgTable('admin_note', {
  id: id(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  authorId: text('author_id').notNull().references(() => user.id),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, t => [
  index('admin_note_subject_idx').on(t.subjectType, t.subjectId, t.createdAt.desc()),
  check('admin_note_subject_type_check', sql`${t.subjectType} in ('partner', 'client', 'booking', 'dispute')`),
]);
