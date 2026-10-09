CREATE TYPE "public"."acquisition_source" AS ENUM('organic', 'meta', 'referral', 'other');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('awaiting_payment', 'confirmed', 'cancellation_requested', 'completed', 'payment_expired', 'approval_withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bookings_per_day_mode" AS ENUM('one', 'limit', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."brief_status" AS ENUM('open', 'offer_chosen', 'closed');--> statement-breakpoint
CREATE TYPE "public"."budget_band" AS ENUM('lt_1000', 'b1000_2000', 'gt_2000', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."cancellation_policy" AS ENUM('flexible', 'moderate', 'strict');--> statement-breakpoint
CREATE TYPE "public"."cancellation_reason" AS ENUM('date_change', 'other_vendor', 'event_cancelled', 'other');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('client', 'partner', 'team', 'non_payment', 'dispute');--> statement-breakpoint
CREATE TYPE "public"."charge_kind" AS ENUM('full', 'deposit', 'balance');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('pending', 'awaiting_transfer', 'succeeded', 'failed', 'expired', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."check_state" AS ENUM('ok', 'waiting', 'failed');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('private', 'business');--> statement-breakpoint
CREATE TYPE "public"."consent_document" AS ENUM('general_terms', 'partner_terms', 'privacy');--> statement-breakpoint
CREATE TYPE "public"."decline_reason" AS ENUM('date_taken', 'other');--> statement-breakpoint
CREATE TYPE "public"."deletion_status" AS ENUM('requested', 'confirmed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."dispute_decision_kind" AS ENUM('enforce_terms', 'partial_refund', 'cancel_full_refund', 'cancel_unpaid', 'restore_price', 'accept_new_price', 'no_refund', 'refund_duplicate', 'mediate', 'close');--> statement-breakpoint
CREATE TYPE "public"."dispute_message_kind" AS ENUM('statement', 'question', 'reminder', 'note');--> statement-breakpoint
CREATE TYPE "public"."dispute_party" AS ENUM('client', 'partner', 'team');--> statement-breakpoint
CREATE TYPE "public"."dispute_reason" AS ENUM('no_show', 'not_as_described', 'payment_problem', 'client_unresponsive', 'terms_changed_on_site', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('collecting', 'awaiting_decision', 'resolved', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."experience_band" AS ENUM('lt_1', 'y1_3', 'y3_5', 'y5_10', 'gt_10');--> statement-breakpoint
CREATE TYPE "public"."hold_reason" AS ENUM('dispute', 'account_check', 'provider_disabled', 'returned');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('invited', 'offered', 'declined', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."invoice_issuer_type" AS ENUM('partner', 'platform');--> statement-breakpoint
CREATE TYPE "public"."invoice_recipient" AS ENUM('individual', 'company');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('invoice', 'credit_note', 'commission_invoice');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('provider_held', 'client_funds', 'partner_payable', 'partner_receivable', 'commission_revenue', 'platform_cash');--> statement-breakpoint
CREATE TYPE "public"."ledger_txn_kind" AS ENUM('charge', 'refund', 'release', 'early_release', 'payout', 'payout_reversal', 'receivable_netting', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."legal_form" AS ENUM('freelancer', 'sole_trader', 'eood', 'ood', 'other');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('bg', 'en');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('partner_avatar', 'partner_cover', 'gallery', 'service_cover', 'request_attachment', 'brief_attachment', 'dispute_evidence', 'review_photo', 'message_attachment', 'bank_proof', 'legal_document', 'invoice_pdf', 'report_file', 'user_avatar');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('sent', 'chosen', 'not_chosen', 'lapsed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."partner_check_kind" AS ENUM('company', 'contacts', 'gallery', 'services', 'cancellation_policy', 'bank_account');--> statement-breakpoint
CREATE TYPE "public"."partner_decision_kind" AS ENUM('approved', 'returned', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."partner_member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('draft', 'submitted', 'returned', 'rejected', 'approved', 'deactivated', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('full', 'deposit_balance');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('simulated', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."payout_account_status" AS ENUM('pending_verification', 'confirmed', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."payout_batch_status" AS ENUM('scheduled', 'ready', 'released', 'paid', 'partially_failed');--> statement-breakpoint
CREATE TYPE "public"."payout_item_status" AS ENUM('ready', 'held', 'sent', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payout_line_status" AS ENUM('awaiting_event', 'ready', 'held', 'released_early', 'in_batch', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."price_unit" AS ENUM('per_event', 'per_guest');--> statement-breakpoint
CREATE TYPE "public"."provider_account_status" AS ENUM('not_started', 'pending', 'enabled', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('client_cancel', 'partner_cancel', 'team_cancel', 'dispute_decision', 'duplicate_charge');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('partner_earnings', 'partner_requests', 'partner_bookings', 'admin_dashboard', 'admin_partners', 'admin_clients', 'admin_bookings', 'accounting', 'batch_report');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('requested', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."request_kind" AS ENUM('package', 'quote', 'brief');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'offer_sent', 'awaiting_confirmation', 'approved', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."reschedule_policy" AS ENUM('free_if_available', 'one_free', 'not_allowed');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('not_due', 'invited', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."revision_status" AS ENUM('pending', 'approved', 'returned');--> statement-breakpoint
CREATE TYPE "public"."revision_type" AS ENUM('new', 'edit');--> statement-breakpoint
CREATE TYPE "public"."search_sort" AS ENUM('recommended', 'rating', 'price', 'newest');--> statement-breakpoint
CREATE TYPE "public"."sender_role" AS ENUM('client', 'partner', 'team', 'system');--> statement-breakpoint
CREATE TYPE "public"."service_kind" AS ENUM('package_fixed', 'on_request', 'addon');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('draft', 'pending_review', 'returned', 'ready', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."service_tier" AS ENUM('required', 'common', 'extra');--> statement-breakpoint
CREATE TYPE "public"."space_type" AS ENUM('indoor', 'garden_hall', 'outdoor', 'undecided');--> statement-breakpoint
CREATE TYPE "public"."team_invite_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."team_member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('admin', 'moderator', 'support', 'accounting');--> statement-breakpoint
CREATE TYPE "public"."watch_status" AS ENUM('watching', 'notified', 'closed', 'expired', 'removed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('client', 'partner', 'admin');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'done', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"device_label" text,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'client' NOT NULL,
	"phone" text,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"locale" "locale" DEFAULT 'bg' NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_login_city" text,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"to_email" text NOT NULL,
	"to_user_id" text,
	"audience" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metrics_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_kind" text NOT NULL,
	"period_start" date NOT NULL,
	"city_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_snapshot_period_city_key" UNIQUE NULLS NOT DISTINCT("period_kind","period_start","city_id"),
	CONSTRAINT "metrics_snapshot_period_kind_check" CHECK ("metrics_snapshot"."period_kind" in ('month', 'quarter', 'year'))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "report_kind" NOT NULL,
	"requested_by" text NOT NULL,
	"partner_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "report_status" DEFAULT 'requested' NOT NULL,
	"media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sms_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"to_phone" text NOT NULL,
	"to_user_id" text,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text,
	"kind" "media_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_mime_check" CHECK ("media"."mime" in ('image/jpeg', 'image/png', 'application/pdf')),
	CONSTRAINT "media_size_check" CHECK ("media"."size_bytes" >= 0 and "media"."size_bytes" <= 5242880)
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plural_noun" text,
	"short_description" text,
	"intro" text,
	"icon" text NOT NULL,
	"hero_photo_url" text,
	"default_price_unit" "price_unit" DEFAULT 'per_event' NOT NULL,
	"tips_heading" text,
	"tips_subheading" text,
	"is_visible" boolean DEFAULT true NOT NULL,
	"in_directory" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "category_subtype" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_tip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"icon" text,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "city" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"preposition" text DEFAULT 'в' NOT NULL,
	"lat" numeric(8, 5) NOT NULL,
	"lng" numeric(8, 5) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "city_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_plural_lower" text NOT NULL,
	"name_definite" text NOT NULL,
	"short_description" text,
	"intro_text" text,
	"tier_required_text" text,
	"tier_common_text" text,
	"tier_extra_text" text,
	"icon" text,
	"hero_photo_url" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_type_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_type_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"tier" "service_tier" NOT NULL,
	"display_name" text,
	"description" text,
	"photo_url" text,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"audience" text NOT NULL,
	"media_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "legal_document_audience_check" CHECK ("legal_document"."audience" in ('partner', 'client', 'all'))
);
--> statement-breakpoint
CREATE TABLE "public_holiday" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_deletion_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "deletion_status" DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "account_deletion_request_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "client_invoice_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"recipient_type" "invoice_recipient" DEFAULT 'individual' NOT NULL,
	"name" text NOT NULL,
	"company_name" text,
	"eik" varchar(13),
	"mol" text,
	"address" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_invoice_profile_company_check" CHECK ("client_invoice_profile"."recipient_type" <> 'company' or ("client_invoice_profile"."company_name" is not null and "client_invoice_profile"."eik" is not null and "client_invoice_profile"."mol" is not null))
);
--> statement-breakpoint
CREATE TABLE "client_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"client_type" "client_type" DEFAULT 'private' NOT NULL,
	"city_id" uuid,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"marketing_opt_in_at" timestamp with time zone,
	"acquisition_source" "acquisition_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document" "consent_document" NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "email_change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"new_email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_note_subject_type_check" CHECK ("admin_note"."subject_type" in ('partner', 'client', 'booking', 'dispute'))
);
--> statement-breakpoint
CREATE TABLE "partner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"status" "partner_status" DEFAULT 'draft' NOT NULL,
	"onboarding_step" smallint DEFAULT 1 NOT NULL,
	"draft_saved_at" timestamp with time zone,
	"business_name" text NOT NULL,
	"business_name_changed_at" timestamp with time zone,
	"legal_name" text,
	"legal_form" "legal_form",
	"legal_form_other" text,
	"eik" varchar(13),
	"vat_registered" boolean DEFAULT false NOT NULL,
	"vat_number" text,
	"registered_address" text,
	"manager_name" text,
	"contact_name" text NOT NULL,
	"contact_role" text,
	"notification_email" text NOT NULL,
	"phone" text NOT NULL,
	"website_url" text,
	"social_handle" text,
	"primary_category_id" uuid,
	"suggested_category" text,
	"city_id" uuid,
	"service_radius_km" integer,
	"serves_nationwide" boolean DEFAULT false NOT NULL,
	"also_serves_note" text,
	"experience_band" "experience_band",
	"active_since_year" smallint,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"avatar_media_id" uuid,
	"cover_media_id" uuid,
	"short_description" varchar(140),
	"description" varchar(600),
	"video_url" text,
	"offers_fixed_packages" boolean DEFAULT true NOT NULL,
	"offers_on_request" boolean DEFAULT false NOT NULL,
	"bookings_per_day_mode" "bookings_per_day_mode" DEFAULT 'one' NOT NULL,
	"max_bookings_per_date" smallint DEFAULT 1 NOT NULL,
	"lead_time_days" smallint DEFAULT 7 NOT NULL,
	"horizon_months" smallint DEFAULT 24 NOT NULL,
	"working_days" smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
	"only_selected_dates" boolean DEFAULT false NOT NULL,
	"cancellation_policy" "cancellation_policy",
	"deposit_percent" smallint DEFAULT 30 NOT NULL,
	"reschedule_policy" "reschedule_policy" DEFAULT 'free_if_available' NOT NULL,
	"max_guests" integer,
	"is_listed" boolean DEFAULT true NOT NULL,
	"accepting_requests" boolean DEFAULT true NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"payouts_paused" boolean DEFAULT false NOT NULL,
	"provider" "payment_provider",
	"provider_account_ref" text,
	"provider_status" "provider_account_status" DEFAULT 'not_started' NOT NULL,
	"provider_charges_enabled" boolean DEFAULT false NOT NULL,
	"provider_payouts_enabled" boolean DEFAULT false NOT NULL,
	"provider_requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"info_confirmed_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"approved_by" text,
	"listed_at" timestamp with time zone,
	"last_decision_note" text,
	"rating_avg" numeric(2, 1),
	"review_count" integer DEFAULT 0 NOT NULL,
	"responsiveness_pct" smallint,
	"min_price_cents" integer,
	"min_price_unit" "price_unit",
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_max_bookings_per_date_check" CHECK ("partner"."max_bookings_per_date" between 1 and 9),
	CONSTRAINT "partner_lead_time_days_check" CHECK ("partner"."lead_time_days" in (0, 1, 3, 7, 14, 30)),
	CONSTRAINT "partner_horizon_months_check" CHECK ("partner"."horizon_months" in (3, 6, 12, 24)),
	CONSTRAINT "partner_deposit_percent_check" CHECK ("partner"."deposit_percent" in (20, 30, 40, 50)),
	CONSTRAINT "partner_onboarding_step_check" CHECK ("partner"."onboarding_step" between 1 and 6)
);
--> statement-breakpoint
CREATE TABLE "partner_check" (
	"partner_id" uuid NOT NULL,
	"kind" "partner_check_kind" NOT NULL,
	"state" "check_state" DEFAULT 'waiting' NOT NULL,
	"detail" text,
	"checked_by" text,
	"checked_at" timestamp with time zone,
	CONSTRAINT "partner_check_pk" PRIMARY KEY("partner_id","kind")
);
--> statement-breakpoint
CREATE TABLE "partner_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"decision" "partner_decision_kind" NOT NULL,
	"note" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_decision_note_check" CHECK ("partner_decision"."decision" = 'approved' or "partner_decision"."note" is not null)
);
--> statement-breakpoint
CREATE TABLE "partner_event_type" (
	"partner_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	CONSTRAINT "partner_event_type_pk" PRIMARY KEY("partner_id","event_type_id")
);
--> statement-breakpoint
CREATE TABLE "partner_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"invited_by" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_partner_id" uuid
);
--> statement-breakpoint
CREATE TABLE "partner_member" (
	"partner_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "partner_member_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_member_pk" PRIMARY KEY("partner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "partner_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_subtype" (
	"partner_id" uuid NOT NULL,
	"subtype_id" uuid NOT NULL,
	CONSTRAINT "partner_subtype_pk" PRIMARY KEY("partner_id","subtype_id")
);
--> statement-breakpoint
CREATE TABLE "partner_tag" (
	"partner_id" uuid NOT NULL,
	"label" text NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	CONSTRAINT "partner_tag_pk" PRIMARY KEY("partner_id","label")
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" "service_kind" DEFAULT 'package_fixed' NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"description" varchar(600) NOT NULL,
	"price_cents" integer,
	"price_unit" "price_unit" DEFAULT 'per_event' NOT NULL,
	"min_guests" integer,
	"duration_label" text,
	"extra_hour_enabled" boolean DEFAULT false NOT NULL,
	"extra_hour_price_cents" integer,
	"travel_fee_enabled" boolean DEFAULT false NOT NULL,
	"cover_media_id" uuid,
	"status" "service_status" DEFAULT 'draft' NOT NULL,
	"show_in_profile" boolean DEFAULT true NOT NULL,
	"accepting_requests" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_price_by_kind_check" CHECK (("service"."kind" = 'on_request' and "service"."price_cents" is null) or ("service"."kind" <> 'on_request' and (("service"."price_cents" is not null and "service"."price_cents" > 0) or ("service"."status" = 'draft' and "service"."price_cents" is null)))),
	CONSTRAINT "service_min_guests_check" CHECK ("service"."min_guests" is null or "service"."price_unit" = 'per_guest')
);
--> statement-breakpoint
CREATE TABLE "service_event_type" (
	"service_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	CONSTRAINT "service_event_type_pk" PRIMARY KEY("service_id","event_type_id")
);
--> statement-breakpoint
CREATE TABLE "service_inclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"text" varchar(120) NOT NULL,
	"position" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"type" "revision_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "revision_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "availability_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_block_range_check" CHECK ("availability_block"."end_date" >= "availability_block"."start_date")
);
--> statement-breakpoint
CREATE TABLE "availability_open_date" (
	"partner_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "availability_open_date_pk" PRIMARY KEY("partner_id","date")
);
--> statement-breakpoint
CREATE TABLE "booking_number" (
	"number" text PRIMARY KEY NOT NULL,
	"event_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_number_format_check" CHECK ("booking_number"."number" ~ '^[0-9]{4}-[0-9]{4}-[АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЮЯ]{2}$'),
	CONSTRAINT "booking_number_date_check" CHECK (left("booking_number"."number", 9) = to_char("booking_number"."event_date"::timestamp, 'YYYY-MMDD'))
);
--> statement-breakpoint
CREATE TABLE "brief" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"client_event_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"city_id" uuid NOT NULL,
	"guests" integer NOT NULL,
	"budget_band" "budget_band" DEFAULT 'unknown' NOT NULL,
	"description" text,
	"contact_phone" text NOT NULL,
	"status" "brief_status" DEFAULT 'open' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offers_due_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brief_attachment" (
	"brief_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "brief_attachment_pk" PRIMARY KEY("brief_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "brief_category" (
	"brief_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "brief_category_pk" PRIMARY KEY("brief_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "brief_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" "invitation_status" DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offer_due_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"event_type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"hosts" text,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"venue_name" text,
	"locality" text,
	"city_id" uuid,
	"guests" integer,
	"notes" text,
	"notes_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"request_id" uuid,
	"invitation_id" uuid,
	"partner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount_cents" integer NOT NULL,
	"status" "offer_status" DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chosen_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	CONSTRAINT "offer_source_check" CHECK (("offer"."request_id" is null) <> ("offer"."invitation_id" is null)),
	CONSTRAINT "offer_amount_check" CHECK ("offer"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" "request_kind" NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"client_id" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"service_id" uuid,
	"client_event_id" uuid NOT NULL,
	"brief_id" uuid,
	"offer_id" uuid,
	"event_type_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"guests" integer NOT NULL,
	"venue_name" text,
	"locality" text,
	"city_id" uuid,
	"space_type" "space_type",
	"note" text,
	"contact_phone" text NOT NULL,
	"service_title" text NOT NULL,
	"service_summary" text,
	"amount_cents" integer,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_due_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"decline_reason" "decline_reason",
	"decline_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_attachment" (
	"request_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "request_attachment_pk" PRIMARY KEY("request_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"request_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"service_id" uuid,
	"client_event_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"guests" integer NOT NULL,
	"venue_name" text,
	"locality" text,
	"city_id" uuid,
	"service_title" text NOT NULL,
	"service_summary" text,
	"inclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "booking_status" DEFAULT 'awaiting_payment' NOT NULL,
	"amount_cents" integer NOT NULL,
	"booking_fee_cents" integer DEFAULT 0 NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"due_now_cents" integer NOT NULL,
	"deposit_pay_cents" integer,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"balance_due_date" date,
	"approved_at" timestamp with time zone NOT NULL,
	"payment_due_at" timestamp with time zone NOT NULL,
	"payment_extensions" smallint DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"cancellation_policy" "cancellation_policy" NOT NULL,
	"deposit_percent" smallint NOT NULL,
	"free_cancel_until" date,
	"commission_bp" integer,
	"contact_phone" text NOT NULL,
	"hold_until" date NOT NULL,
	"batch_date" date NOT NULL,
	"payout_hold" boolean DEFAULT false NOT NULL,
	"review_state" "review_state" DEFAULT 'not_due' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" "cancelled_by",
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_amounts_check" CHECK ("booking"."amount_cents" >= 0 and "booking"."due_now_cents" >= 0 and "booking"."balance_cents" >= 0 and "booking"."booking_fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cancellation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"initiated_by" "cancelled_by" NOT NULL,
	"reason" "cancellation_reason",
	"reason_text" text,
	"days_before" integer NOT NULL,
	"policy" "cancellation_policy" NOT NULL,
	"deposit_percent" smallint NOT NULL,
	"total_cents" integer NOT NULL,
	"paid_cents" integer NOT NULL,
	"refund_cents" integer NOT NULL,
	"retained_cents" integer NOT NULL,
	"commission_bp" integer,
	"partner_amount_cents" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_cancellation_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "partner_cancellation_request_status_check" CHECK ("partner_cancellation_request"."status" in ('pending', 'completed', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "payment_extension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"previous_due_at" timestamp with time zone NOT NULL,
	"new_due_at" timestamp with time zone NOT NULL,
	"hours" smallint DEFAULT 24 NOT NULL,
	"dispute_id" uuid,
	"extended_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" charge_kind DEFAULT 'full' NOT NULL,
	"method" "payment_method" NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_ref" text,
	"checkout_url" text,
	"amount_cents" integer NOT NULL,
	"application_fee_cents" integer DEFAULT 0 NOT NULL,
	"commission_bp" integer,
	"status" charge_status DEFAULT 'pending' NOT NULL,
	"card_brand" text,
	"card_last4" char(4),
	"customer_ref" text,
	"payment_method_ref" text,
	"transfer_iban" text,
	"transfer_reference" text,
	"due_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_amounts_check" CHECK ("charge"."amount_cents" > 0 and "charge"."application_fee_cents" >= 0 and "charge"."refunded_cents" >= 0 and "charge"."refunded_cents" <= "charge"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"partner_id" uuid,
	"booking_id" uuid,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ledger_entry_one_side_check" CHECK ("ledger_entry"."debit_cents" >= 0 and "ledger_entry"."credit_cents" >= 0 and (("ledger_entry"."debit_cents" > 0) <> ("ledger_entry"."credit_cents" > 0)))
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger_txn_kind" NOT NULL,
	"booking_id" uuid,
	"charge_id" uuid,
	"refund_id" uuid,
	"payout_item_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"reason" "refund_reason" NOT NULL,
	"amount_cents" integer NOT NULL,
	"application_fee_refund_cents" integer DEFAULT 0 NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"cancellation_id" uuid,
	"dispute_id" uuid,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "refund_amounts_check" CHECK ("refund"."amount_cents" > 0 and "refund"."application_fee_refund_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payout_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"iban_encrypted" "bytea",
	"iban_last4" char(4) NOT NULL,
	"holder_name" text NOT NULL,
	"bank_name" text NOT NULL,
	"bank_branch" text,
	"proof_media_id" uuid,
	"status" "payout_account_status" DEFAULT 'pending_verification' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"rejected_reason" text,
	"provider_external_ref" text
);
--> statement-breakpoint
CREATE TABLE "payout_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_date" date NOT NULL,
	"label" text NOT NULL,
	"rail_label" text,
	"status" "payout_batch_status" DEFAULT 'scheduled' NOT NULL,
	"partner_count" integer DEFAULT 0 NOT NULL,
	"gross_cents" bigint DEFAULT 0 NOT NULL,
	"commission_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint DEFAULT 0 NOT NULL,
	"held_cents" bigint DEFAULT 0 NOT NULL,
	"prepared_at" timestamp with time zone,
	"released_by" text,
	"second_approver" text,
	"released_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"payout_account_id" uuid,
	"amount_cents" integer NOT NULL,
	"status" "payout_item_status" DEFAULT 'ready' NOT NULL,
	"hold_reason" "hold_reason",
	"dispute_id" uuid,
	"provider_payout_ref" text,
	"failure_reason" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"charge_id" uuid,
	"partner_id" uuid NOT NULL,
	"payout_item_id" uuid,
	"batch_date" date NOT NULL,
	"base_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payout_line_status" DEFAULT 'awaiting_event' NOT NULL,
	"hold_reason" "hold_reason",
	"ready_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"booking_id" uuid NOT NULL,
	"opened_by" "dispute_party" NOT NULL,
	"opened_by_user" text,
	"reason" "dispute_reason" NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'collecting' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"holds_payout" boolean DEFAULT true NOT NULL,
	"held_cents" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"team_reply_due_at" timestamp with time zone NOT NULL,
	"position_from" "dispute_party" NOT NULL,
	"position_requested_at" timestamp with time zone NOT NULL,
	"position_due_at" timestamp with time zone NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agreed_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comparison" jsonb,
	"note" text,
	"decision_kind" "dispute_decision_kind",
	"decision_title" text,
	"decision_detail" text,
	"motive" text,
	"refund_cents" integer,
	"partner_keeps_cents" integer,
	"new_amount_cents" integer,
	"compliance_due_at" timestamp with time zone,
	"fallback" "dispute_decision_kind",
	"complied_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"message_id" uuid,
	"media_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"party" "dispute_party" NOT NULL,
	"author_id" text,
	"kind" "dispute_message_kind" NOT NULL,
	"body" text NOT NULL,
	"context" text,
	"recipients" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_message_recipients_check" CHECK ("dispute_message"."recipients" is null or "dispute_message"."recipients" in ('client', 'partner', 'both'))
);
--> statement-breakpoint
CREATE TABLE "dispute_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"kind" "dispute_decision_kind" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"refund_cents" integer,
	"new_amount_cents" integer,
	"position" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"client_event_id" uuid,
	"request_id" uuid,
	"booking_id" uuid,
	"last_message_at" timestamp with time zone,
	"client_last_read_at" timestamp with time zone,
	"partner_last_read_at" timestamp with time zone,
	"client_unread_count" integer DEFAULT 0 NOT NULL,
	"partner_unread_count" integer DEFAULT 0 NOT NULL,
	"client_draft" text,
	"partner_draft" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_client_partner_event_key" UNIQUE NULLS NOT DISTINCT("client_id","partner_id","client_event_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_role" "sender_role" NOT NULL,
	"sender_user_id" text,
	"body" text NOT NULL,
	"body_original" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_attachment" (
	"message_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "message_attachment_pk" PRIMARY KEY("message_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"author_display_name" text NOT NULL,
	"event_type_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"service_label" text NOT NULL,
	"rating_overall" smallint NOT NULL,
	"rating_communication" smallint NOT NULL,
	"rating_accuracy" smallint NOT NULL,
	"rating_quality" smallint NOT NULL,
	"rating_value" smallint NOT NULL,
	"body" text NOT NULL,
	"body_original" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reply_text" text,
	"reply_original" text,
	"reply_published_at" timestamp with time zone,
	CONSTRAINT "review_ratings_check" CHECK ("review"."rating_overall" between 1 and 5 and "review"."rating_communication" between 1 and 5
    and "review"."rating_accuracy" between 1 and 5 and "review"."rating_quality" between 1 and 5 and "review"."rating_value" between 1 and 5),
	CONSTRAINT "review_body_length_check" CHECK (char_length("review"."body_original") >= 40)
);
--> statement-breakpoint
CREATE TABLE "review_photo" (
	"review_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "review_photo_pk" PRIMARY KEY("review_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "date_watch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"date" date NOT NULL,
	"client_event_id" uuid,
	"status" "watch_status" DEFAULT 'watching' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_search" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"filters_summary" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"seen_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_alerted_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"query" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "team_role" NOT NULL,
	"invited_by" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "team_invite_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" "team_role" NOT NULL,
	"title" text,
	"is_owner" boolean DEFAULT false NOT NULL,
	"status" "team_member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by" text,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"last_active_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "invoice_type" DEFAULT 'invoice' NOT NULL,
	"issuer_type" "invoice_issuer_type" DEFAULT 'partner' NOT NULL,
	"issuer_key" text NOT NULL,
	"number" char(10) NOT NULL,
	"partner_id" uuid,
	"booking_id" uuid,
	"charge_id" uuid,
	"refund_id" uuid,
	"payout_item_id" uuid,
	"credited_invoice_id" uuid,
	"issuer_legal_name" text,
	"issuer_eik" text,
	"issuer_vat_number" text,
	"issuer_address" text,
	"issuer_manager" text,
	"issuer_email" text,
	"issuer_city" text,
	"recipient_type" "invoice_recipient" NOT NULL,
	"recipient_name" text,
	"recipient_company" text,
	"recipient_eik" text,
	"recipient_mol" text,
	"recipient_address" text,
	"recipient_email" text,
	"recipient_phone" text,
	"issued_on" date NOT NULL,
	"paid_on" date,
	"place" text NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"payment_note" text,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"pdf_media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"description" text NOT NULL,
	"detail" text,
	"quantity" numeric(10, 2) DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequence" (
	"issuer_key" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chargeback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ledger_transaction_id" uuid,
	"line_adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chargeback_status_check" CHECK ("chargeback"."status" in ('open', 'won', 'lost')),
	CONSTRAINT "chargeback_amount_check" CHECK ("chargeback"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_snapshot" ADD CONSTRAINT "metrics_snapshot_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_outbox" ADD CONSTRAINT "sms_outbox_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_subtype" ADD CONSTRAINT "category_subtype_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_tip" ADD CONSTRAINT "category_tip_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_service" ADD CONSTRAINT "event_type_service_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_service" ADD CONSTRAINT "event_type_service_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document" ADD CONSTRAINT "legal_document_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_request" ADD CONSTRAINT "account_deletion_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice_profile" ADD CONSTRAINT "client_invoice_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_change_request" ADD CONSTRAINT "email_change_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_note" ADD CONSTRAINT "admin_note_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_primary_category_id_category_id_fk" FOREIGN KEY ("primary_category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_check" ADD CONSTRAINT "partner_check_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_check" ADD CONSTRAINT "partner_check_checked_by_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_decision" ADD CONSTRAINT "partner_decision_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_decision" ADD CONSTRAINT "partner_decision_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_event_type" ADD CONSTRAINT "partner_event_type_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_event_type" ADD CONSTRAINT "partner_event_type_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invite" ADD CONSTRAINT "partner_invite_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invite" ADD CONSTRAINT "partner_invite_registered_partner_id_partner_id_fk" FOREIGN KEY ("registered_partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_member" ADD CONSTRAINT "partner_member_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_member" ADD CONSTRAINT "partner_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_photo" ADD CONSTRAINT "partner_photo_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_photo" ADD CONSTRAINT "partner_photo_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_subtype" ADD CONSTRAINT "partner_subtype_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_subtype" ADD CONSTRAINT "partner_subtype_subtype_id_category_subtype_id_fk" FOREIGN KEY ("subtype_id") REFERENCES "public"."category_subtype"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_tag" ADD CONSTRAINT "partner_tag_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event_type" ADD CONSTRAINT "service_event_type_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event_type" ADD CONSTRAINT "service_event_type_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_inclusion" ADD CONSTRAINT "service_inclusion_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_revision" ADD CONSTRAINT "service_revision_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_revision" ADD CONSTRAINT "service_revision_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_revision" ADD CONSTRAINT "service_revision_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_block" ADD CONSTRAINT "availability_block_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_block" ADD CONSTRAINT "availability_block_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_open_date" ADD CONSTRAINT "availability_open_date_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_client_event_id_client_event_id_fk" FOREIGN KEY ("client_event_id") REFERENCES "public"."client_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_attachment" ADD CONSTRAINT "brief_attachment_brief_id_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."brief"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_attachment" ADD CONSTRAINT "brief_attachment_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_category" ADD CONSTRAINT "brief_category_brief_id_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."brief"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_category" ADD CONSTRAINT "brief_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_invitation" ADD CONSTRAINT "brief_invitation_brief_id_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."brief"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_invitation" ADD CONSTRAINT "brief_invitation_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_event" ADD CONSTRAINT "client_event_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_event" ADD CONSTRAINT "client_event_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_event" ADD CONSTRAINT "client_event_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_number_booking_number_number_fk" FOREIGN KEY ("number") REFERENCES "public"."booking_number"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_invitation_id_brief_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."brief_invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_number_booking_number_number_fk" FOREIGN KEY ("number") REFERENCES "public"."booking_number"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_client_event_id_client_event_id_fk" FOREIGN KEY ("client_event_id") REFERENCES "public"."client_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_brief_id_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."brief"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_number_booking_number_number_fk" FOREIGN KEY ("number") REFERENCES "public"."booking_number"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_client_event_id_client_event_id_fk" FOREIGN KEY ("client_event_id") REFERENCES "public"."client_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation" ADD CONSTRAINT "cancellation_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation" ADD CONSTRAINT "cancellation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_cancellation_request" ADD CONSTRAINT "partner_cancellation_request_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_cancellation_request" ADD CONSTRAINT "partner_cancellation_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_cancellation_request" ADD CONSTRAINT "partner_cancellation_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_extension" ADD CONSTRAINT "payment_extension_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_extension" ADD CONSTRAINT "payment_extension_dispute_id_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."dispute"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_extension" ADD CONSTRAINT "payment_extension_extended_by_user_id_fk" FOREIGN KEY ("extended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_payout_item_id_payout_item_id_fk" FOREIGN KEY ("payout_item_id") REFERENCES "public"."payout_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_cancellation_id_cancellation_id_fk" FOREIGN KEY ("cancellation_id") REFERENCES "public"."cancellation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_dispute_id_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."dispute"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_account" ADD CONSTRAINT "payout_account_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_account" ADD CONSTRAINT "payout_account_proof_media_id_media_id_fk" FOREIGN KEY ("proof_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_account" ADD CONSTRAINT "payout_account_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch" ADD CONSTRAINT "payout_batch_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batch" ADD CONSTRAINT "payout_batch_second_approver_user_id_fk" FOREIGN KEY ("second_approver") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_item" ADD CONSTRAINT "payout_item_batch_id_payout_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_item" ADD CONSTRAINT "payout_item_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_item" ADD CONSTRAINT "payout_item_payout_account_id_payout_account_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."payout_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_item" ADD CONSTRAINT "payout_item_dispute_id_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."dispute"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_line" ADD CONSTRAINT "payout_line_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_line" ADD CONSTRAINT "payout_line_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_line" ADD CONSTRAINT "payout_line_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_line" ADD CONSTRAINT "payout_line_payout_item_id_payout_item_id_fk" FOREIGN KEY ("payout_item_id") REFERENCES "public"."payout_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_opened_by_user_user_id_fk" FOREIGN KEY ("opened_by_user") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_attachment" ADD CONSTRAINT "dispute_attachment_dispute_id_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."dispute"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_attachment" ADD CONSTRAINT "dispute_attachment_message_id_dispute_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."dispute_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_attachment" ADD CONSTRAINT "dispute_attachment_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_message" ADD CONSTRAINT "dispute_message_dispute_id_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."dispute"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_message" ADD CONSTRAINT "dispute_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_option" ADD CONSTRAINT "dispute_option_dispute_id_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."dispute"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_client_event_id_client_event_id_fk" FOREIGN KEY ("client_event_id") REFERENCES "public"."client_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachment" ADD CONSTRAINT "message_attachment_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachment" ADD CONSTRAINT "message_attachment_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_photo" ADD CONSTRAINT "review_photo_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_photo" ADD CONSTRAINT "review_photo_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_watch" ADD CONSTRAINT "date_watch_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_watch" ADD CONSTRAINT "date_watch_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_watch" ADD CONSTRAINT "date_watch_client_event_id_client_event_id_fk" FOREIGN KEY ("client_event_id") REFERENCES "public"."client_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_client_id_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invite" ADD CONSTRAINT "team_invite_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_payout_item_id_payout_item_id_fk" FOREIGN KEY ("payout_item_id") REFERENCES "public"."payout_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_credited_invoice_id_invoice_id_fk" FOREIGN KEY ("credited_invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_pdf_media_id_media_id_fk" FOREIGN KEY ("pdf_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargeback" ADD CONSTRAINT "chargeback_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargeback" ADD CONSTRAINT "chargeback_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargeback" ADD CONSTRAINT "chargeback_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargeback" ADD CONSTRAINT "chargeback_ledger_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargeback" ADD CONSTRAINT "chargeback_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_throttle_window_idx" ON "auth_throttle" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "user_role_created_idx" ON "user" USING btree ("role","created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_user_idx" ON "email_outbox" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "email_outbox_created_idx" ON "email_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_idx" ON "email_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "job_due_idx" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedupe_idx" ON "job" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_pk" ON "notification_preference" USING btree ("user_id","key","channel");--> statement-breakpoint
CREATE INDEX "platform_settings_key_idx" ON "platform_settings" USING btree ("key","effective_from");--> statement-breakpoint
CREATE INDEX "report_job_requester_idx" ON "report_job" USING btree ("requested_by","created_at");--> statement-breakpoint
CREATE INDEX "sms_outbox_status_idx" ON "sms_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_outbox_dedupe_idx" ON "sms_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_subtype_category_slug_key" ON "category_subtype" USING btree ("category_id","slug");--> statement-breakpoint
CREATE INDEX "category_tip_category_idx" ON "category_tip" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "event_type_service_type_category_key" ON "event_type_service" USING btree ("event_type_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_request_open_key" ON "account_deletion_request" USING btree ("user_id") WHERE status = 'requested';--> statement-breakpoint
CREATE INDEX "consent_user_document_idx" ON "consent" USING btree ("user_id","document");--> statement-breakpoint
CREATE INDEX "email_change_request_user_idx" ON "email_change_request" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_note_subject_idx" ON "admin_note" USING btree ("subject_type","subject_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "partner_slug_key" ON "partner" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_provider_account_ref_key" ON "partner" USING btree ("provider_account_ref");--> statement-breakpoint
CREATE INDEX "partner_listing_idx" ON "partner" USING btree ("status","is_listed","accepting_requests");--> statement-breakpoint
CREATE INDEX "partner_city_idx" ON "partner" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "partner_primary_category_idx" ON "partner" USING btree ("primary_category_id");--> statement-breakpoint
CREATE INDEX "partner_search_text_trgm_idx" ON "partner" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "partner_approved_at_idx" ON "partner" USING btree ("approved_at");--> statement-breakpoint
CREATE INDEX "partner_decision_partner_idx" ON "partner_decision" USING btree ("partner_id","decided_at");--> statement-breakpoint
CREATE INDEX "partner_invite_email_idx" ON "partner_invite" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_member_user_key" ON "partner_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_photo_partner_position_key" ON "partner_photo" USING btree ("partner_id","position");--> statement-breakpoint
CREATE INDEX "service_partner_status_idx" ON "service" USING btree ("partner_id","status","sort_order");--> statement-breakpoint
CREATE INDEX "service_category_status_idx" ON "service" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "service_inclusion_service_idx" ON "service_inclusion" USING btree ("service_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "service_revision_pending_key" ON "service_revision" USING btree ("service_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "service_revision_queue_idx" ON "service_revision" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "availability_block_partner_idx" ON "availability_block" USING btree ("partner_id","start_date");--> statement-breakpoint
CREATE INDEX "brief_client_idx" ON "brief" USING btree ("client_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brief_invitation_brief_partner_key" ON "brief_invitation" USING btree ("brief_id","partner_id");--> statement-breakpoint
CREATE INDEX "brief_invitation_partner_status_idx" ON "brief_invitation" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "client_event_client_date_idx" ON "client_event" USING btree ("client_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_number_key" ON "offer" USING btree ("number");--> statement-breakpoint
CREATE INDEX "offer_invitation_idx" ON "offer" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "offer_request_idx" ON "offer" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_key" ON "request" USING btree ("number");--> statement-breakpoint
CREATE INDEX "request_partner_status_idx" ON "request" USING btree ("partner_id","status","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "request_client_status_idx" ON "request" USING btree ("client_id","status","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "request_partner_date_idx" ON "request" USING btree ("partner_id","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "request_open_per_date_key" ON "request" USING btree ("client_id","partner_id","event_date") WHERE status in ('pending', 'offer_sent', 'awaiting_confirmation');--> statement-breakpoint
CREATE UNIQUE INDEX "booking_number_key" ON "booking" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_request_key" ON "booking" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "booking_partner_date_status_idx" ON "booking" USING btree ("partner_id","event_date","status");--> statement-breakpoint
CREATE INDEX "booking_client_date_idx" ON "booking" USING btree ("client_id","event_date");--> statement-breakpoint
CREATE INDEX "booking_status_due_idx" ON "booking" USING btree ("status","payment_due_at");--> statement-breakpoint
CREATE INDEX "booking_batch_date_idx" ON "booking" USING btree ("batch_date") WHERE status in ('confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE INDEX "booking_event_date_idx" ON "booking" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "booking_status_event_date_idx" ON "booking" USING btree ("status","event_date");--> statement-breakpoint
CREATE INDEX "booking_approved_at_idx" ON "booking" USING btree ("approved_at","created_at");--> statement-breakpoint
CREATE INDEX "booking_paid_at_idx" ON "booking" USING btree ("paid_at") WHERE paid_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_booking_key" ON "cancellation" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_cancellation_request_pending_key" ON "partner_cancellation_request" USING btree ("booking_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "payment_extension_booking_idx" ON "payment_extension" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "charge_booking_idx" ON "charge" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_provider_ref_key" ON "charge" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "ledger_entry_account_partner_idx" ON "ledger_entry" USING btree ("account","partner_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_booking_idx" ON "ledger_entry" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_transaction_idx" ON "ledger_entry" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_transaction_booking_idx" ON "ledger_transaction" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "ledger_transaction_charge_idx" ON "ledger_transaction" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "ledger_transaction_payout_item_idx" ON "ledger_transaction" USING btree ("payout_item_id");--> statement-breakpoint
CREATE INDEX "refund_booking_idx" ON "refund" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "refund_provider_ref_idx" ON "refund" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_account_confirmed_key" ON "payout_account" USING btree ("partner_id") WHERE status = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "payout_account_pending_key" ON "payout_account" USING btree ("partner_id") WHERE status = 'pending_verification';--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batch_date_key" ON "payout_batch" USING btree ("batch_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_item_batch_partner_key" ON "payout_item" USING btree ("batch_id","partner_id");--> statement-breakpoint
CREATE INDEX "payout_item_partner_idx" ON "payout_item" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "payout_item_provider_ref_idx" ON "payout_item" USING btree ("provider_payout_ref");--> statement-breakpoint
CREATE INDEX "payout_line_partner_status_idx" ON "payout_line" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "payout_line_batch_status_idx" ON "payout_line" USING btree ("batch_date","status");--> statement-breakpoint
CREATE INDEX "payout_line_booking_idx" ON "payout_line" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_booking_key" ON "dispute" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "dispute_queue_idx" ON "dispute" USING btree ("status","urgent" DESC NULLS LAST,"opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dispute_number_idx" ON "dispute" USING btree ("number");--> statement-breakpoint
CREATE INDEX "dispute_attachment_dispute_idx" ON "dispute_attachment" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "dispute_message_dispute_idx" ON "dispute_message" USING btree ("dispute_id","created_at");--> statement-breakpoint
CREATE INDEX "dispute_option_dispute_idx" ON "dispute_option" USING btree ("dispute_id","position");--> statement-breakpoint
CREATE INDEX "conversation_client_idx" ON "conversation" USING btree ("client_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_partner_idx" ON "conversation" USING btree ("partner_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_booking_key" ON "review" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "review_partner_published_idx" ON "review" USING btree ("partner_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_partner_unanswered_idx" ON "review" USING btree ("partner_id") WHERE reply_text is null;--> statement-breakpoint
CREATE UNIQUE INDEX "date_watch_active_key" ON "date_watch" USING btree ("client_id","partner_id","date") WHERE status = 'watching';--> statement-breakpoint
CREATE INDEX "date_watch_partner_date_idx" ON "date_watch" USING btree ("partner_id","date","status");--> statement-breakpoint
CREATE INDEX "saved_search_client_idx" ON "saved_search" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "search_history_client_idx" ON "search_history" USING btree ("client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "team_invite_token_hash_key" ON "team_invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "team_invite_status_idx" ON "team_invite" USING btree ("status");--> statement-breakpoint
CREATE INDEX "team_member_role_status_idx" ON "team_member" USING btree ("role","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_issuer_number_key" ON "invoice" USING btree ("issuer_key","number");--> statement-breakpoint
CREATE INDEX "invoice_booking_idx" ON "invoice" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "chargeback_charge_key" ON "chargeback" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "chargeback_partner_status_idx" ON "chargeback" USING btree ("partner_id","status");