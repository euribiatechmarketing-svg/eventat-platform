// Job handlers registered by the lifecycle modules (request → approval →
// payment → booking → completion). Keys are the SPEC §3 job kinds; the
// dedupe keys are in lib/domain/bookings.ts `jobKey`. Each handler re-checks
// the record's state and is idempotent.
// Only this module's code edits this file; lib/jobs/handlers.ts merges it.
//
// The handlers are wrapped in arrow functions on purpose: lib/jobs imports
// this file and the domain modules import lib/jobs, so the domain bindings
// must only be read when a job runs, not while the modules load.
import * as bookings from '@/lib/domain/bookings';
import * as charges from '@/lib/domain/charges';
import * as requests from '@/lib/domain/requests';

type Handler = (p: Record<string, unknown>) => Promise<void>;

export const lifecycleHandlers: Record<string, Handler> = {
  'request.reminder': p => requests.requestReminderJob(p),               // T1
  'request.expire': p => requests.expireRequestJob(p),                   // T2, T4
  'booking.client_pay_reminder': p => bookings.clientPayReminderJob(p),  // T5
  'booking.partner_pay_reminder': p => bookings.partnerPayReminderJob(p), // T6
  'booking.team_payment_alert': p => bookings.teamPaymentAlertJob(p),    // T7
  'booking.payment_expire': p => bookings.expirePaymentJob(p),           // T8
  'booking.balance_charge': p => charges.balanceChargeJob(p),            // T9
  'booking.balance_default': p => charges.balanceDefaultJob(p),          // T10
  'event.client_reminder': p => bookings.clientEventReminderJob(p),      // T11
  'booking.partner_event_reminder': p => bookings.partnerEventReminderJob(p), // T12
  'booking.complete': p => bookings.completeBookingJob(p),               // T13
  'booking.review_invite': p => bookings.reviewInviteJob(p),             // T14
  'charge.hold_limit': p => charges.holdLimitJob(p),                     // T18
  'request.offer_lapse': p => requests.offerLapseJob(p),                 // R10
};
