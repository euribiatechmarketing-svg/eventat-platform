// The timers (SPEC §3) that the seeded states imply. Kinds, dedupe keys and
// payloads are the ones the owning modules schedule (lifecycle:
// lib/domain/bookings.ts `jobKey`; aftercare: disputes.ts, payouts.ts;
// catalogue: saved.ts, team.ts), so their handlers pick these rows up unchanged.
//
// Rule for the seed: a deadline job (expiry, completion, batch preparation,
// dispute position) is always scheduled, even when already due, because its
// state change has not happened yet. A reminder is scheduled only while it is
// still ahead of "now" (as the modules' scheduleAhead does): one whose time
// has come would have been sent already, and the seed records no sent emails.
import { addDays, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';

export const JOB_KINDS = {
  /** T1 */ requestReminder: 'request.reminder',
  /** T2, T4 */ requestExpire: 'request.expire',
  /** T5 */ clientPayReminder: 'booking.client_pay_reminder',
  /** T6 */ partnerPayReminder: 'booking.partner_pay_reminder',
  /** T7 */ teamPaymentAlert: 'booking.team_payment_alert',
  /** T8 */ paymentExpire: 'booking.payment_expire',
  /** T11 */ clientEventReminder: 'event.client_reminder',
  /** T12 */ partnerEventReminder: 'booking.partner_event_reminder',
  /** T13 */ bookingComplete: 'booking.complete',
  /** T14 */ reviewInvite: 'booking.review_invite',
  /** T15 */ disputePosition: 'dispute.position',
  /** T17 */ payoutsPrepare: 'payouts.prepare',
  /** T19 */ teamDigest: 'digest.daily',
  /** T20 */ savedSearchScan: 'savedsearch.scan',
  /** T21 */ dateWatchExpire: 'datewatch.expire',
  /** T25 */ teamInviteExpire: 'teaminvite.expire',
} as const;

export type PlannedJob = { kind: string; runAt: Date; payload: Record<string, unknown>; dedupeKey: string; reminder: boolean };

const H = 3600_000;

/** The ⚙ values the timers use (SPEC §2 defaults, read from settings by the seed). */
export type TimerSettings = {
  partnerReminderBeforeH: number;
  clientPayRemindersBeforeH: number[];
  partnerPayReminderBeforeH: number;
  teamAlertBeforeH: number;
  clientEventDays: number[];
  partnerEventDays: number[];
  sendTime: string;
  reviewInviteDaysAfter: number;
  reviewInviteTime: string;
  payoutPrepareTime: string;
  digestTime: string;
  savedSearchScanTime: string;
};

const atTime = (d: DateStr, hhmm: string) => sofiaInstant(d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));

export type JobInputs = {
  now: Date;
  settings: TimerSettings;
  pendingRequests: { id: string; responseDueAt: Date }[];
  awaitingPayment: { id: string; paymentDueAt: Date }[];
  confirmed: { id: string; eventDate: DateStr }[];
  /** Client events with ≥ 1 confirmed booking. */
  clientEvents: { id: string; date: DateStr }[];
  collectingDisputes: { id: string; positionDueAt: Date }[];
  nextBatchDate: DateStr;
  watches: { id: string; date: DateStr }[];
  invites: { id: string; expiresAt: Date }[];
};

export function planJobs(i: JobInputs): PlannedJob[] {
  const s = i.settings;
  const out: PlannedJob[] = [];
  const add = (kind: string, runAt: Date, payload: Record<string, unknown>, dedupeKey: string, reminder = false) => {
    if (reminder && runAt.getTime() <= i.now.getTime()) return;
    out.push({ kind, runAt, payload, dedupeKey, reminder });
  };

  for (const r of i.pendingRequests) {
    add(JOB_KINDS.requestReminder, new Date(r.responseDueAt.getTime() - s.partnerReminderBeforeH * H), { requestId: r.id }, `request:${r.id}:reminder`, true);
    add(JOB_KINDS.requestExpire, r.responseDueAt, { requestId: r.id }, `request:${r.id}:expire`);
  }
  for (const b of i.awaitingPayment) {
    for (const h of s.clientPayRemindersBeforeH) {
      add(JOB_KINDS.clientPayReminder, new Date(b.paymentDueAt.getTime() - h * H), { bookingId: b.id, hours: h }, `booking:${b.id}:payrem:${h}`, true);
    }
    add(JOB_KINDS.partnerPayReminder, new Date(b.paymentDueAt.getTime() - s.partnerPayReminderBeforeH * H),
      { bookingId: b.id, hours: s.partnerPayReminderBeforeH }, `booking:${b.id}:vpayrem`, true);
    // T7 is scheduled with every payment deadline; its handler re-checks for an open dispute.
    add(JOB_KINDS.teamPaymentAlert, new Date(b.paymentDueAt.getTime() - s.teamAlertBeforeH * H),
      { bookingId: b.id, hours: s.teamAlertBeforeH }, `booking:${b.id}:teamalert`, true);
    add(JOB_KINDS.paymentExpire, b.paymentDueAt, { bookingId: b.id }, `booking:${b.id}:payexpire`);
  }
  for (const e of i.clientEvents) {
    for (const d of s.clientEventDays) {
      add(JOB_KINDS.clientEventReminder, atTime(addDays(e.date, -d), s.sendTime), { clientEventId: e.id, days: d }, `event:${e.id}:remind:${d}`, true);
    }
  }
  for (const b of i.confirmed) {
    for (const d of s.partnerEventDays) {
      add(JOB_KINDS.partnerEventReminder, atTime(addDays(b.eventDate, -d), s.sendTime), { bookingId: b.id, days: d }, `booking:${b.id}:vremind:${d}`, true);
    }
    add(JOB_KINDS.bookingComplete, sofiaInstant(addDays(b.eventDate, 1), 0, 0), { bookingId: b.id }, `booking:${b.id}:complete`);
    add(JOB_KINDS.reviewInvite, atTime(addDays(b.eventDate, s.reviewInviteDaysAfter), s.reviewInviteTime), { bookingId: b.id }, `booking:${b.id}:reviewinvite`, true);
  }
  for (const d of i.collectingDisputes) {
    add(JOB_KINDS.disputePosition, d.positionDueAt, { disputeId: d.id }, `dispute:${d.id}:position`);
  }
  // T17: the day before the batch, at ⚙ payout.prepare_time.
  add(JOB_KINDS.payoutsPrepare, atTime(addDays(i.nextBatchDate, -1), s.payoutPrepareTime), { batchDate: i.nextBatchDate }, `batch:${i.nextBatchDate}`);
  // T19 and T20 run daily and schedule the next day themselves; the seed starts each chain at its next run time.
  const today = sofiaDate(i.now);
  const nextDay = (hhmm: string) => (atTime(today, hhmm) > i.now ? today : addDays(today, 1));
  const digestDay = nextDay(s.digestTime);
  add(JOB_KINDS.teamDigest, atTime(digestDay, s.digestTime), { date: digestDay }, `digest:${digestDay}`);
  const scanDay = nextDay(s.savedSearchScanTime);
  add(JOB_KINDS.savedSearchScan, atTime(scanDay, s.savedSearchScanTime), { date: scanDay }, `savedsearch:${scanDay}`);
  for (const w of i.watches) {
    add(JOB_KINDS.dateWatchExpire, sofiaInstant(addDays(w.date, 1), 0, 0), { watchId: w.id }, `datewatch:${w.id}:expire`);
  }
  for (const inv of i.invites) {
    add(JOB_KINDS.teamInviteExpire, inv.expiresAt, { inviteId: inv.id }, `teaminvite:${inv.id}:expire`);
  }
  return out;
}
