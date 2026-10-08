// Drizzle relations for the relational query API (db.query.*). Kept in one
// file so the table files never import each other just for relations.
import { relations } from 'drizzle-orm';
import { user, session, account } from './auth';
import { city, category, categorySubtype, categoryTip, eventType, eventTypeService, legalDocument } from './reference';
import { media } from './media';
import { clientProfile, clientInvoiceProfile, consent } from './profiles';
import {
  partner, partnerMember, partnerEventType, partnerTag, partnerSubtype, partnerPhoto, partnerCheck, partnerDecision,
} from './partners';
import { service, serviceInclusion, serviceEventType, serviceRevision } from './services';
import { availabilityBlock, availabilityOpenDate } from './availability';
import { clientEvent, request, requestAttachment, brief, briefCategory, briefAttachment, briefInvitation, offer } from './requests';
import { booking, paymentExtension, cancellation, partnerCancellationRequest } from './bookings';
import { charge, refund, ledgerTransaction, ledgerEntry } from './money';
import { payoutAccount, payoutBatch, payoutItem, payoutLine } from './payouts';
import { dispute, disputeOption, disputeMessage, disputeAttachment } from './disputes';
import { conversation, message, messageAttachment } from './messaging';
import { review, reviewPhoto } from './reviews';
import { savedSearch, dateWatch } from './saved';
import { teamMember } from './team';
import { invoice, invoiceLine } from './invoices';

// ── Accounts ─────────────────────────────────────────────────────────────
export const userRelations = relations(user, ({ one, many }) => ({
  clientProfile: one(clientProfile),
  invoiceProfile: one(clientInvoiceProfile),
  partnerMember: one(partnerMember),
  teamMember: one(teamMember),
  sessions: many(session),
  accounts: many(account),
  consents: many(consent),
}));
export const sessionRelations = relations(session, ({ one }) => ({ user: one(user, { fields: [session.userId], references: [user.id] }) }));
export const accountRelations = relations(account, ({ one }) => ({ user: one(user, { fields: [account.userId], references: [user.id] }) }));
export const consentRelations = relations(consent, ({ one }) => ({ user: one(user, { fields: [consent.userId], references: [user.id] }) }));
export const clientProfileRelations = relations(clientProfile, ({ one }) => ({
  user: one(user, { fields: [clientProfile.userId], references: [user.id] }),
  city: one(city, { fields: [clientProfile.cityId], references: [city.id] }),
}));
export const clientInvoiceProfileRelations = relations(clientInvoiceProfile, ({ one }) => ({
  user: one(user, { fields: [clientInvoiceProfile.userId], references: [user.id] }),
}));
export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  user: one(user, { fields: [teamMember.userId], references: [user.id] }),
}));

// ── Reference ────────────────────────────────────────────────────────────
export const categoryRelations = relations(category, ({ many }) => ({
  subtypes: many(categorySubtype),
  tips: many(categoryTip),
}));
export const categorySubtypeRelations = relations(categorySubtype, ({ one }) => ({
  category: one(category, { fields: [categorySubtype.categoryId], references: [category.id] }),
}));
export const categoryTipRelations = relations(categoryTip, ({ one }) => ({
  category: one(category, { fields: [categoryTip.categoryId], references: [category.id] }),
}));
export const eventTypeRelations = relations(eventType, ({ many }) => ({ tierServices: many(eventTypeService) }));
export const eventTypeServiceRelations = relations(eventTypeService, ({ one }) => ({
  eventType: one(eventType, { fields: [eventTypeService.eventTypeId], references: [eventType.id] }),
  category: one(category, { fields: [eventTypeService.categoryId], references: [category.id] }),
}));
export const legalDocumentRelations = relations(legalDocument, ({ one }) => ({
  media: one(media, { fields: [legalDocument.mediaId], references: [media.id] }),
}));

// ── Partners ─────────────────────────────────────────────────────────────
export const partnerRelations = relations(partner, ({ one, many }) => ({
  city: one(city, { fields: [partner.cityId], references: [city.id] }),
  primaryCategory: one(category, { fields: [partner.primaryCategoryId], references: [category.id] }),
  avatar: one(media, { fields: [partner.avatarMediaId], references: [media.id], relationName: 'partner_avatar' }),
  cover: one(media, { fields: [partner.coverMediaId], references: [media.id], relationName: 'partner_cover' }),
  members: many(partnerMember),
  eventTypes: many(partnerEventType),
  tags: many(partnerTag),
  subtypes: many(partnerSubtype),
  photos: many(partnerPhoto),
  checks: many(partnerCheck),
  decisions: many(partnerDecision),
  services: many(service),
  blocks: many(availabilityBlock),
  openDates: many(availabilityOpenDate),
  payoutAccounts: many(payoutAccount),
  requests: many(request),
  bookings: many(booking),
}));
export const partnerMemberRelations = relations(partnerMember, ({ one }) => ({
  partner: one(partner, { fields: [partnerMember.partnerId], references: [partner.id] }),
  user: one(user, { fields: [partnerMember.userId], references: [user.id] }),
}));
export const partnerEventTypeRelations = relations(partnerEventType, ({ one }) => ({
  partner: one(partner, { fields: [partnerEventType.partnerId], references: [partner.id] }),
  eventType: one(eventType, { fields: [partnerEventType.eventTypeId], references: [eventType.id] }),
}));
export const partnerTagRelations = relations(partnerTag, ({ one }) => ({
  partner: one(partner, { fields: [partnerTag.partnerId], references: [partner.id] }),
}));
export const partnerSubtypeRelations = relations(partnerSubtype, ({ one }) => ({
  partner: one(partner, { fields: [partnerSubtype.partnerId], references: [partner.id] }),
  subtype: one(categorySubtype, { fields: [partnerSubtype.subtypeId], references: [categorySubtype.id] }),
}));
export const partnerPhotoRelations = relations(partnerPhoto, ({ one }) => ({
  partner: one(partner, { fields: [partnerPhoto.partnerId], references: [partner.id] }),
  media: one(media, { fields: [partnerPhoto.mediaId], references: [media.id] }),
}));
export const partnerCheckRelations = relations(partnerCheck, ({ one }) => ({
  partner: one(partner, { fields: [partnerCheck.partnerId], references: [partner.id] }),
}));
export const partnerDecisionRelations = relations(partnerDecision, ({ one }) => ({
  partner: one(partner, { fields: [partnerDecision.partnerId], references: [partner.id] }),
}));

// ── Services and availability ────────────────────────────────────────────
export const serviceRelations = relations(service, ({ one, many }) => ({
  partner: one(partner, { fields: [service.partnerId], references: [partner.id] }),
  category: one(category, { fields: [service.categoryId], references: [category.id] }),
  cover: one(media, { fields: [service.coverMediaId], references: [media.id] }),
  inclusions: many(serviceInclusion),
  eventTypes: many(serviceEventType),
  revisions: many(serviceRevision),
}));
export const serviceInclusionRelations = relations(serviceInclusion, ({ one }) => ({
  service: one(service, { fields: [serviceInclusion.serviceId], references: [service.id] }),
}));
export const serviceEventTypeRelations = relations(serviceEventType, ({ one }) => ({
  service: one(service, { fields: [serviceEventType.serviceId], references: [service.id] }),
  eventType: one(eventType, { fields: [serviceEventType.eventTypeId], references: [eventType.id] }),
}));
export const serviceRevisionRelations = relations(serviceRevision, ({ one }) => ({
  service: one(service, { fields: [serviceRevision.serviceId], references: [service.id] }),
}));
export const availabilityBlockRelations = relations(availabilityBlock, ({ one }) => ({
  partner: one(partner, { fields: [availabilityBlock.partnerId], references: [partner.id] }),
}));
export const availabilityOpenDateRelations = relations(availabilityOpenDate, ({ one }) => ({
  partner: one(partner, { fields: [availabilityOpenDate.partnerId], references: [partner.id] }),
}));

// ── Events, requests, briefs, offers ─────────────────────────────────────
export const clientEventRelations = relations(clientEvent, ({ one, many }) => ({
  client: one(user, { fields: [clientEvent.clientId], references: [user.id] }),
  eventType: one(eventType, { fields: [clientEvent.eventTypeId], references: [eventType.id] }),
  city: one(city, { fields: [clientEvent.cityId], references: [city.id] }),
  requests: many(request),
  bookings: many(booking),
}));
export const requestRelations = relations(request, ({ one, many }) => ({
  client: one(user, { fields: [request.clientId], references: [user.id] }),
  partner: one(partner, { fields: [request.partnerId], references: [partner.id] }),
  service: one(service, { fields: [request.serviceId], references: [service.id] }),
  clientEvent: one(clientEvent, { fields: [request.clientEventId], references: [clientEvent.id] }),
  eventType: one(eventType, { fields: [request.eventTypeId], references: [eventType.id] }),
  city: one(city, { fields: [request.cityId], references: [city.id] }),
  brief: one(brief, { fields: [request.briefId], references: [brief.id] }),
  /** The current / chosen offer. */
  offer: one(offer, { fields: [request.offerId], references: [offer.id], relationName: 'request_current_offer' }),
  /** Every offer made on this quote request. */
  offers: many(offer, { relationName: 'offer_request' }),
  booking: one(booking),
  attachments: many(requestAttachment),
}));
export const requestAttachmentRelations = relations(requestAttachment, ({ one }) => ({
  request: one(request, { fields: [requestAttachment.requestId], references: [request.id] }),
  media: one(media, { fields: [requestAttachment.mediaId], references: [media.id] }),
}));
export const briefRelations = relations(brief, ({ one, many }) => ({
  client: one(user, { fields: [brief.clientId], references: [user.id] }),
  clientEvent: one(clientEvent, { fields: [brief.clientEventId], references: [clientEvent.id] }),
  eventType: one(eventType, { fields: [brief.eventTypeId], references: [eventType.id] }),
  city: one(city, { fields: [brief.cityId], references: [city.id] }),
  categories: many(briefCategory),
  attachments: many(briefAttachment),
  invitations: many(briefInvitation),
  requests: many(request),
}));
export const briefCategoryRelations = relations(briefCategory, ({ one }) => ({
  brief: one(brief, { fields: [briefCategory.briefId], references: [brief.id] }),
  category: one(category, { fields: [briefCategory.categoryId], references: [category.id] }),
}));
export const briefAttachmentRelations = relations(briefAttachment, ({ one }) => ({
  brief: one(brief, { fields: [briefAttachment.briefId], references: [brief.id] }),
  media: one(media, { fields: [briefAttachment.mediaId], references: [media.id] }),
}));
export const briefInvitationRelations = relations(briefInvitation, ({ one, many }) => ({
  brief: one(brief, { fields: [briefInvitation.briefId], references: [brief.id] }),
  partner: one(partner, { fields: [briefInvitation.partnerId], references: [partner.id] }),
  offers: many(offer),
}));
export const offerRelations = relations(offer, ({ one }) => ({
  request: one(request, { fields: [offer.requestId], references: [request.id], relationName: 'offer_request' }),
  invitation: one(briefInvitation, { fields: [offer.invitationId], references: [briefInvitation.id] }),
  partner: one(partner, { fields: [offer.partnerId], references: [partner.id] }),
}));

// ── Bookings ─────────────────────────────────────────────────────────────
export const bookingRelations = relations(booking, ({ one, many }) => ({
  request: one(request, { fields: [booking.requestId], references: [request.id] }),
  client: one(user, { fields: [booking.clientId], references: [user.id] }),
  partner: one(partner, { fields: [booking.partnerId], references: [partner.id] }),
  service: one(service, { fields: [booking.serviceId], references: [service.id] }),
  clientEvent: one(clientEvent, { fields: [booking.clientEventId], references: [clientEvent.id] }),
  eventType: one(eventType, { fields: [booking.eventTypeId], references: [eventType.id] }),
  city: one(city, { fields: [booking.cityId], references: [city.id] }),
  cancellation: one(cancellation),
  dispute: one(dispute),
  review: one(review),
  charges: many(charge),
  refunds: many(refund),
  paymentExtensions: many(paymentExtension),
  partnerCancellationRequests: many(partnerCancellationRequest),
  ledgerTransactions: many(ledgerTransaction),
  payoutLines: many(payoutLine),
  invoices: many(invoice),
}));
export const paymentExtensionRelations = relations(paymentExtension, ({ one }) => ({
  booking: one(booking, { fields: [paymentExtension.bookingId], references: [booking.id] }),
}));
export const cancellationRelations = relations(cancellation, ({ one }) => ({
  booking: one(booking, { fields: [cancellation.bookingId], references: [booking.id] }),
}));
export const partnerCancellationRequestRelations = relations(partnerCancellationRequest, ({ one }) => ({
  booking: one(booking, { fields: [partnerCancellationRequest.bookingId], references: [booking.id] }),
}));

// ── Money and payouts ────────────────────────────────────────────────────
export const chargeRelations = relations(charge, ({ one, many }) => ({
  booking: one(booking, { fields: [charge.bookingId], references: [booking.id] }),
  refunds: many(refund),
}));
export const refundRelations = relations(refund, ({ one }) => ({
  booking: one(booking, { fields: [refund.bookingId], references: [booking.id] }),
  charge: one(charge, { fields: [refund.chargeId], references: [charge.id] }),
  cancellation: one(cancellation, { fields: [refund.cancellationId], references: [cancellation.id] }),
  dispute: one(dispute, { fields: [refund.disputeId], references: [dispute.id] }),
}));
export const ledgerTransactionRelations = relations(ledgerTransaction, ({ one, many }) => ({
  entries: many(ledgerEntry),
  booking: one(booking, { fields: [ledgerTransaction.bookingId], references: [booking.id] }),
  charge: one(charge, { fields: [ledgerTransaction.chargeId], references: [charge.id] }),
  refund: one(refund, { fields: [ledgerTransaction.refundId], references: [refund.id] }),
  payoutItem: one(payoutItem, { fields: [ledgerTransaction.payoutItemId], references: [payoutItem.id] }),
}));
export const ledgerEntryRelations = relations(ledgerEntry, ({ one }) => ({
  transaction: one(ledgerTransaction, { fields: [ledgerEntry.transactionId], references: [ledgerTransaction.id] }),
}));
export const payoutAccountRelations = relations(payoutAccount, ({ one }) => ({
  partner: one(partner, { fields: [payoutAccount.partnerId], references: [partner.id] }),
}));
export const payoutBatchRelations = relations(payoutBatch, ({ many }) => ({ items: many(payoutItem) }));
export const payoutItemRelations = relations(payoutItem, ({ one, many }) => ({
  batch: one(payoutBatch, { fields: [payoutItem.batchId], references: [payoutBatch.id] }),
  partner: one(partner, { fields: [payoutItem.partnerId], references: [partner.id] }),
  payoutAccount: one(payoutAccount, { fields: [payoutItem.payoutAccountId], references: [payoutAccount.id] }),
  lines: many(payoutLine),
}));
export const payoutLineRelations = relations(payoutLine, ({ one }) => ({
  booking: one(booking, { fields: [payoutLine.bookingId], references: [booking.id] }),
  charge: one(charge, { fields: [payoutLine.chargeId], references: [charge.id] }),
  partner: one(partner, { fields: [payoutLine.partnerId], references: [partner.id] }),
  payoutItem: one(payoutItem, { fields: [payoutLine.payoutItemId], references: [payoutItem.id] }),
}));

// ── Disputes ─────────────────────────────────────────────────────────────
export const disputeRelations = relations(dispute, ({ one, many }) => ({
  booking: one(booking, { fields: [dispute.bookingId], references: [booking.id] }),
  options: many(disputeOption),
  messages: many(disputeMessage),
  attachments: many(disputeAttachment),
}));
export const disputeOptionRelations = relations(disputeOption, ({ one }) => ({
  dispute: one(dispute, { fields: [disputeOption.disputeId], references: [dispute.id] }),
}));
export const disputeMessageRelations = relations(disputeMessage, ({ one, many }) => ({
  dispute: one(dispute, { fields: [disputeMessage.disputeId], references: [dispute.id] }),
  attachments: many(disputeAttachment),
}));
export const disputeAttachmentRelations = relations(disputeAttachment, ({ one }) => ({
  dispute: one(dispute, { fields: [disputeAttachment.disputeId], references: [dispute.id] }),
  message: one(disputeMessage, { fields: [disputeAttachment.messageId], references: [disputeMessage.id] }),
  media: one(media, { fields: [disputeAttachment.mediaId], references: [media.id] }),
}));

// ── Messaging, reviews, saved ────────────────────────────────────────────
export const conversationRelations = relations(conversation, ({ one, many }) => ({
  client: one(user, { fields: [conversation.clientId], references: [user.id] }),
  partner: one(partner, { fields: [conversation.partnerId], references: [partner.id] }),
  clientEvent: one(clientEvent, { fields: [conversation.clientEventId], references: [clientEvent.id] }),
  request: one(request, { fields: [conversation.requestId], references: [request.id] }),
  booking: one(booking, { fields: [conversation.bookingId], references: [booking.id] }),
  messages: many(message),
}));
export const messageRelations = relations(message, ({ one, many }) => ({
  conversation: one(conversation, { fields: [message.conversationId], references: [conversation.id] }),
  attachments: many(messageAttachment),
}));
export const messageAttachmentRelations = relations(messageAttachment, ({ one }) => ({
  message: one(message, { fields: [messageAttachment.messageId], references: [message.id] }),
  media: one(media, { fields: [messageAttachment.mediaId], references: [media.id] }),
}));
export const reviewRelations = relations(review, ({ one, many }) => ({
  booking: one(booking, { fields: [review.bookingId], references: [booking.id] }),
  partner: one(partner, { fields: [review.partnerId], references: [partner.id] }),
  client: one(user, { fields: [review.clientId], references: [user.id] }),
  eventType: one(eventType, { fields: [review.eventTypeId], references: [eventType.id] }),
  photos: many(reviewPhoto),
}));
export const reviewPhotoRelations = relations(reviewPhoto, ({ one }) => ({
  review: one(review, { fields: [reviewPhoto.reviewId], references: [review.id] }),
  media: one(media, { fields: [reviewPhoto.mediaId], references: [media.id] }),
}));
export const savedSearchRelations = relations(savedSearch, ({ one }) => ({
  client: one(user, { fields: [savedSearch.clientId], references: [user.id] }),
}));
export const dateWatchRelations = relations(dateWatch, ({ one }) => ({
  client: one(user, { fields: [dateWatch.clientId], references: [user.id] }),
  partner: one(partner, { fields: [dateWatch.partnerId], references: [partner.id] }),
  clientEvent: one(clientEvent, { fields: [dateWatch.clientEventId], references: [clientEvent.id] }),
}));

// ── Invoices ─────────────────────────────────────────────────────────────
export const invoiceRelations = relations(invoice, ({ one, many }) => ({
  lines: many(invoiceLine),
  partner: one(partner, { fields: [invoice.partnerId], references: [partner.id] }),
  booking: one(booking, { fields: [invoice.bookingId], references: [booking.id] }),
  charge: one(charge, { fields: [invoice.chargeId], references: [charge.id] }),
  refund: one(refund, { fields: [invoice.refundId], references: [refund.id] }),
}));
export const invoiceLineRelations = relations(invoiceLine, ({ one }) => ({
  invoice: one(invoice, { fields: [invoiceLine.invoiceId], references: [invoice.id] }),
}));
