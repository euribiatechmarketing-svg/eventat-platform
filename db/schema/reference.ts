// Reference data (DATA-MODEL §2.3): cities, categories, event types, planning
// tiers, public holidays and legal documents. Seeded by
// lib/domain/reference.ts ensureReferenceData(); admins can add and hide
// categories only.
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, smallint, numeric, uuid, uniqueIndex, check, index } from 'drizzle-orm/pg-core';
import { priceUnit, serviceTier } from './enums';
import { media } from './media';
import { createdAt, day, id, tz, updatedAt } from './columns';

export const city = pgTable('city', {
  id: id(),
  slug: text('slug').notNull().unique('city_slug_key'),
  name: text('name').notNull(),
  preposition: text('preposition').notNull().default('в'),
  lat: numeric('lat', { precision: 8, scale: 5, mode: 'number' }).notNull(),
  lng: numeric('lng', { precision: 8, scale: 5, mode: 'number' }).notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

export const category = pgTable('category', {
  id: id(),
  slug: text('slug').notNull().unique('category_slug_key'),
  name: text('name').notNull(),
  pluralNoun: text('plural_noun'),
  shortDescription: text('short_description'),
  intro: text('intro'),
  /** Icon key; the seed uses the category slug, mapped to the prototype's SVG by the UI. */
  icon: text('icon').notNull(),
  heroPhotoUrl: text('hero_photo_url'),
  defaultPriceUnit: priceUnit('default_price_unit').notNull().default('per_event'),
  tipsHeading: text('tips_heading'),
  tipsSubheading: text('tips_subheading'),
  isVisible: boolean('is_visible').notNull().default(true),
  inDirectory: boolean('in_directory').notNull().default(true),
  sortOrder: smallint('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const categorySubtype = pgTable('category_subtype', {
  id: id(),
  categoryId: uuid('category_id').notNull().references(() => category.id),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
}, t => [uniqueIndex('category_subtype_category_slug_key').on(t.categoryId, t.slug)]);

export const categoryTip = pgTable('category_tip', {
  id: id(),
  categoryId: uuid('category_id').notNull().references(() => category.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  icon: text('icon'),
  sortOrder: smallint('sort_order').notNull().default(0),
}, t => [index('category_tip_category_idx').on(t.categoryId, t.sortOrder)]);

export const eventType = pgTable('event_type', {
  id: id(),
  slug: text('slug').notNull().unique('event_type_slug_key'),
  name: text('name').notNull(),
  /** ‹сватби›; empty for `drugo`, which has no public pages. */
  namePluralLower: text('name_plural_lower').notNull(),
  nameDefinite: text('name_definite').notNull(),
  shortDescription: text('short_description'),
  introText: text('intro_text'),
  tierRequiredText: text('tier_required_text'),
  tierCommonText: text('tier_common_text'),
  tierExtraText: text('tier_extra_text'),
  icon: text('icon'),
  heroPhotoUrl: text('hero_photo_url'),
  isPublic: boolean('is_public').notNull().default(true),
  sortOrder: smallint('sort_order').notNull().default(0),
});

/** Planning tiers on /sabitiya/[slug]. */
export const eventTypeService = pgTable('event_type_service', {
  id: id(),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventType.id),
  categoryId: uuid('category_id').notNull().references(() => category.id),
  tier: serviceTier('tier').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  photoUrl: text('photo_url'),
  sortOrder: smallint('sort_order').notNull().default(0),
}, t => [uniqueIndex('event_type_service_type_category_key').on(t.eventTypeId, t.categoryId)]);

/** Bulgarian official holidays (and the Labour Code substitute days off), for working-day counts. */
export const publicHoliday = pgTable('public_holiday', {
  date: day('date').primaryKey(),
  name: text('name').notNull(),
});

export const legalDocument = pgTable('legal_document', {
  id: id(),
  title: text('title').notNull(),
  audience: text('audience').notNull(),
  mediaId: uuid('media_id').notNull().references(() => media.id),
  publishedAt: tz('published_at').notNull().defaultNow(),
  sortOrder: smallint('sort_order').notNull().default(0),
}, t => [check('legal_document_audience_check', sql`${t.audience} in ('partner', 'client', 'all')`)]);
