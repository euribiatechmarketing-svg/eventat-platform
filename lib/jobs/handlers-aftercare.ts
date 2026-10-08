// Job handlers registered by the aftercare modules.
// Keys are the SPEC §3 "Job kind" names (e.g. `request.expire`). A handler receives
// the payload it was scheduled with, must re-check state and be idempotent.
// Only this module's code edits this file; lib/jobs/handlers.ts merges it.
//
//   refund.submit             refund:<id>:submit          F1 → provider refund after commit
//   booking.release_retained  booking:<id>:release        §5.4: retained amount released at event_date + 1
//   dispute.position          dispute:<id>:position       T15
//   dispute.compliance        dispute:<id>:compliance     T16
//   payouts.prepare           batch:<date>                T17
//   payout.submit             payout_item:<id>:submit     Y5 → provider payout after commit
//
// The handlers are wrapped in arrows: the domain modules import lib/jobs, so
// they are only read when a job runs.
import { releaseRetained } from '@/lib/domain/cancellation';
import { complianceDeadline, positionDeadline } from '@/lib/domain/disputes';
import { prepareBatch, submitPayoutItem } from '@/lib/domain/payouts';
import { submitRefund } from '@/lib/domain/refunds';

const str = (p: Record<string, unknown>, k: string): string => {
  const v = p[k];
  if (typeof v !== 'string' || !v) throw new Error(`job payload is missing ${k}`);
  return v;
};

export const aftercareHandlers: Record<string, (p: Record<string, unknown>) => Promise<void>> = {
  'refund.submit': async p => { await submitRefund(str(p, 'refundId')); },
  'booking.release_retained': async p => { await releaseRetained({ bookingId: str(p, 'bookingId') }); },
  'dispute.position': async p => { await positionDeadline({ disputeId: str(p, 'disputeId') }); },
  'dispute.compliance': async p => { await complianceDeadline({ disputeId: str(p, 'disputeId') }); },
  'payouts.prepare': async p => { await prepareBatch(str(p, 'batchDate')); },
  'payout.submit': async p => { await submitPayoutItem(str(p, 'itemId')); },
};
