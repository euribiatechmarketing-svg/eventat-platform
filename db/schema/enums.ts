// Every enum of DATA-MODEL §1 except user_role (auth.ts), email_status and
// job_status (system.ts), which predate this file. Values are snake_case
// English; the Bulgarian labels belong in lib/labels.ts, never here.
import { pgEnum } from 'drizzle-orm/pg-core';

type V<E extends { enumValues: readonly string[] }> = E['enumValues'][number];

// ── Accounts and profiles ────────────────────────────────────────────────
export const locale = pgEnum('locale', ['bg', 'en']);
export const clientType = pgEnum('client_type', ['private', 'business']);
export const invoiceRecipient = pgEnum('invoice_recipient', ['individual', 'company']);
export const acquisitionSource = pgEnum('acquisition_source', ['organic', 'meta', 'referral', 'other']);
export const consentDocument = pgEnum('consent_document', ['general_terms', 'partner_terms', 'privacy']);
export const deletionStatus = pgEnum('deletion_status', ['requested', 'confirmed', 'expired']);

// ── Partners ─────────────────────────────────────────────────────────────
export const partnerStatus = pgEnum('partner_status', ['draft', 'submitted', 'returned', 'rejected', 'approved', 'deactivated', 'deleted']);
export const partnerMemberRole = pgEnum('partner_member_role', ['owner', 'staff']);
export const legalForm = pgEnum('legal_form', ['freelancer', 'sole_trader', 'eood', 'ood', 'other']);
export const experienceBand = pgEnum('experience_band', ['lt_1', 'y1_3', 'y3_5', 'y5_10', 'gt_10']);
export const bookingsPerDayMode = pgEnum('bookings_per_day_mode', ['one', 'limit', 'unlimited']);
export const cancellationPolicy = pgEnum('cancellation_policy', ['flexible', 'moderate', 'strict']);
export const reschedulePolicy = pgEnum('reschedule_policy', ['free_if_available', 'one_free', 'not_allowed']);
export const partnerCheckKind = pgEnum('partner_check_kind', ['company', 'contacts', 'gallery', 'services', 'cancellation_policy', 'bank_account']);
export const checkState = pgEnum('check_state', ['ok', 'waiting', 'failed']);
export const partnerDecisionKind = pgEnum('partner_decision_kind', ['approved', 'returned', 'rejected']);
export const providerAccountStatus = pgEnum('provider_account_status', ['not_started', 'pending', 'enabled', 'restricted']);

// ── Media and services ───────────────────────────────────────────────────
export const mediaKind = pgEnum('media_kind', [
  'partner_avatar', 'partner_cover', 'gallery', 'service_cover', 'request_attachment', 'brief_attachment',
  'dispute_evidence', 'review_photo', 'message_attachment', 'bank_proof', 'legal_document', 'invoice_pdf', 'report_file',
  // ✚ catalogue: a client's ‹Смени снимката› (user.image); DATA-MODEL has no kind for it.
  'user_avatar',
]);
export const serviceKind = pgEnum('service_kind', ['package_fixed', 'on_request', 'addon']);
export const priceUnit = pgEnum('price_unit', ['per_event', 'per_guest']);
export const serviceStatus = pgEnum('service_status', ['draft', 'pending_review', 'returned', 'ready', 'active', 'archived']);
export const revisionType = pgEnum('revision_type', ['new', 'edit']);
export const revisionStatus = pgEnum('revision_status', ['pending', 'approved', 'returned']);
export const serviceTier = pgEnum('service_tier', ['required', 'common', 'extra']);

// ── Requests, briefs, offers ─────────────────────────────────────────────
export const spaceType = pgEnum('space_type', ['indoor', 'garden_hall', 'outdoor', 'undecided']);
export const budgetBand = pgEnum('budget_band', ['lt_1000', 'b1000_2000', 'gt_2000', 'unknown']);
export const requestKind = pgEnum('request_kind', ['package', 'quote', 'brief']);
export const requestStatus = pgEnum('request_status', ['pending', 'offer_sent', 'awaiting_confirmation', 'approved', 'declined', 'expired']);
export const declineReason = pgEnum('decline_reason', ['date_taken', 'other']);
export const briefStatus = pgEnum('brief_status', ['open', 'offer_chosen', 'closed']);
export const invitationStatus = pgEnum('invitation_status', ['invited', 'offered', 'declined', 'lapsed']);
export const offerStatus = pgEnum('offer_status', ['sent', 'chosen', 'not_chosen', 'lapsed', 'withdrawn']);

// ── Bookings ─────────────────────────────────────────────────────────────
export const bookingStatus = pgEnum('booking_status', [
  'awaiting_payment', 'confirmed', 'cancellation_requested', 'completed', 'payment_expired', 'approval_withdrawn', 'cancelled',
]);
export const cancelledBy = pgEnum('cancelled_by', ['client', 'partner', 'team', 'non_payment', 'dispute']);
export const cancellationReason = pgEnum('cancellation_reason', ['date_change', 'other_vendor', 'event_cancelled', 'other']);
export const reviewState = pgEnum('review_state', ['not_due', 'invited', 'reviewed']);

// ── Money ────────────────────────────────────────────────────────────────
export const paymentMode = pgEnum('payment_mode', ['full', 'deposit_balance']);
export const chargeKind = pgEnum('charge_kind', ['full', 'deposit', 'balance']);
export const paymentMethod = pgEnum('payment_method', ['card', 'bank_transfer']);
export const paymentProvider = pgEnum('payment_provider', ['simulated', 'stripe']);
export const chargeStatus = pgEnum('charge_status', ['pending', 'awaiting_transfer', 'succeeded', 'failed', 'expired', 'partially_refunded', 'refunded']);
export const refundReason = pgEnum('refund_reason', ['client_cancel', 'partner_cancel', 'team_cancel', 'dispute_decision', 'duplicate_charge']);
export const refundStatus = pgEnum('refund_status', ['pending', 'succeeded', 'failed']);
export const ledgerAccount = pgEnum('ledger_account', ['provider_held', 'client_funds', 'partner_payable', 'partner_receivable', 'commission_revenue', 'platform_cash']);
export const ledgerTxnKind = pgEnum('ledger_txn_kind', ['charge', 'refund', 'release', 'early_release', 'payout', 'payout_reversal', 'receivable_netting', 'adjustment']);

// ── Payouts ──────────────────────────────────────────────────────────────
export const payoutBatchStatus = pgEnum('payout_batch_status', ['scheduled', 'ready', 'released', 'paid', 'partially_failed']);
export const payoutItemStatus = pgEnum('payout_item_status', ['ready', 'held', 'sent', 'paid', 'failed']);
export const payoutLineStatus = pgEnum('payout_line_status', ['awaiting_event', 'ready', 'held', 'released_early', 'in_batch', 'paid', 'cancelled']);
export const holdReason = pgEnum('hold_reason', ['dispute', 'account_check', 'provider_disabled', 'returned']);
export const payoutAccountStatus = pgEnum('payout_account_status', ['pending_verification', 'confirmed', 'rejected', 'superseded']);

// ── Disputes ─────────────────────────────────────────────────────────────
export const disputeStatus = pgEnum('dispute_status', ['collecting', 'awaiting_decision', 'resolved', 'withdrawn']);
export const disputeParty = pgEnum('dispute_party', ['client', 'partner', 'team']);
export const disputeReason = pgEnum('dispute_reason', ['no_show', 'not_as_described', 'payment_problem', 'client_unresponsive', 'terms_changed_on_site', 'other']);
export const disputeDecisionKind = pgEnum('dispute_decision_kind', [
  'enforce_terms', 'partial_refund', 'cancel_full_refund', 'cancel_unpaid', 'restore_price', 'accept_new_price', 'no_refund', 'refund_duplicate', 'mediate', 'close',
]);
export const disputeMessageKind = pgEnum('dispute_message_kind', ['statement', 'question', 'reminder', 'note']);

// ── Messaging, saved, notifications ──────────────────────────────────────
export const senderRole = pgEnum('sender_role', ['client', 'partner', 'team', 'system']);
export const watchStatus = pgEnum('watch_status', ['watching', 'notified', 'closed', 'expired', 'removed']);
export const searchSort = pgEnum('search_sort', ['recommended', 'rating', 'price', 'newest']);
export const notificationChannel = pgEnum('notification_channel', ['email', 'sms']);
export const messageStatus = pgEnum('message_status', ['queued', 'sent', 'failed', 'suppressed']);

// ── System, team, invoices ───────────────────────────────────────────────
export const reportKind = pgEnum('report_kind', [
  'partner_earnings', 'partner_requests', 'partner_bookings', 'admin_dashboard', 'admin_partners', 'admin_clients', 'admin_bookings', 'accounting', 'batch_report',
]);
export const reportStatus = pgEnum('report_status', ['requested', 'ready', 'failed']);
export const teamRole = pgEnum('team_role', ['admin', 'moderator', 'support', 'accounting']);
export const teamMemberStatus = pgEnum('team_member_status', ['active', 'removed']);
export const teamInviteStatus = pgEnum('team_invite_status', ['pending', 'accepted', 'revoked', 'expired']);
export const invoiceType = pgEnum('invoice_type', ['invoice', 'credit_note', 'commission_invoice']);
export const invoiceIssuerType = pgEnum('invoice_issuer_type', ['partner', 'platform']);
export const invoiceStatus = pgEnum('invoice_status', ['issued', 'cancelled']);

// ── Value types (one per enum) ───────────────────────────────────────────
export type Locale = V<typeof locale>;
export type ClientType = V<typeof clientType>;
export type InvoiceRecipient = V<typeof invoiceRecipient>;
export type AcquisitionSource = V<typeof acquisitionSource>;
export type ConsentDocument = V<typeof consentDocument>;
export type DeletionStatus = V<typeof deletionStatus>;
export type PartnerStatus = V<typeof partnerStatus>;
export type PartnerMemberRole = V<typeof partnerMemberRole>;
export type LegalForm = V<typeof legalForm>;
export type ExperienceBand = V<typeof experienceBand>;
export type BookingsPerDayMode = V<typeof bookingsPerDayMode>;
export type CancellationPolicy = V<typeof cancellationPolicy>;
export type ReschedulePolicy = V<typeof reschedulePolicy>;
export type PartnerCheckKind = V<typeof partnerCheckKind>;
export type CheckState = V<typeof checkState>;
export type PartnerDecisionKind = V<typeof partnerDecisionKind>;
export type ProviderAccountStatus = V<typeof providerAccountStatus>;
export type MediaKind = V<typeof mediaKind>;
export type ServiceKind = V<typeof serviceKind>;
export type PriceUnit = V<typeof priceUnit>;
export type ServiceStatus = V<typeof serviceStatus>;
export type RevisionType = V<typeof revisionType>;
export type RevisionStatus = V<typeof revisionStatus>;
export type ServiceTier = V<typeof serviceTier>;
export type SpaceType = V<typeof spaceType>;
export type BudgetBand = V<typeof budgetBand>;
export type RequestKind = V<typeof requestKind>;
export type RequestStatus = V<typeof requestStatus>;
export type DeclineReason = V<typeof declineReason>;
export type BriefStatus = V<typeof briefStatus>;
export type InvitationStatus = V<typeof invitationStatus>;
export type OfferStatus = V<typeof offerStatus>;
export type BookingStatus = V<typeof bookingStatus>;
export type CancelledBy = V<typeof cancelledBy>;
export type CancellationReason = V<typeof cancellationReason>;
export type ReviewState = V<typeof reviewState>;
export type PaymentMode = V<typeof paymentMode>;
export type ChargeKind = V<typeof chargeKind>;
export type PaymentMethod = V<typeof paymentMethod>;
export type PaymentProviderId = V<typeof paymentProvider>;
export type ChargeStatus = V<typeof chargeStatus>;
export type RefundReason = V<typeof refundReason>;
export type RefundStatus = V<typeof refundStatus>;
export type LedgerAccount = V<typeof ledgerAccount>;
export type LedgerTxnKind = V<typeof ledgerTxnKind>;
export type PayoutBatchStatus = V<typeof payoutBatchStatus>;
export type PayoutItemStatus = V<typeof payoutItemStatus>;
export type PayoutLineStatus = V<typeof payoutLineStatus>;
export type HoldReason = V<typeof holdReason>;
export type PayoutAccountStatus = V<typeof payoutAccountStatus>;
export type DisputeStatus = V<typeof disputeStatus>;
export type DisputeParty = V<typeof disputeParty>;
export type DisputeReason = V<typeof disputeReason>;
export type DisputeDecisionKind = V<typeof disputeDecisionKind>;
export type DisputeMessageKind = V<typeof disputeMessageKind>;
export type SenderRole = V<typeof senderRole>;
export type WatchStatus = V<typeof watchStatus>;
export type SearchSort = V<typeof searchSort>;
export type NotificationChannel = V<typeof notificationChannel>;
export type MessageStatus = V<typeof messageStatus>;
export type ReportKind = V<typeof reportKind>;
export type ReportStatus = V<typeof reportStatus>;
export type TeamRole = V<typeof teamRole>;
export type TeamMemberStatus = V<typeof teamMemberStatus>;
export type TeamInviteStatus = V<typeof teamInviteStatus>;
export type InvoiceType = V<typeof invoiceType>;
export type InvoiceIssuerType = V<typeof invoiceIssuerType>;
export type InvoiceStatus = V<typeof invoiceStatus>;
