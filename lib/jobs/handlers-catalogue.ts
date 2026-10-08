// Job handlers registered by the catalogue modules (SPEC §3). Each re-checks state and is
// idempotent: running a handler twice changes nothing the second time. A handler never
// cancels or re-schedules its own job (lib/jobs holds that row locked while it runs); the
// daily jobs schedule the NEXT day under a new dedupe key.
//
//   T19 digest.daily       digest:<date>              team-daily-digest at ⚙ digest.time
//   T20 savedsearch.scan   savedsearch:<date>         client-saved-search-alert at ⚙ saved_search.scan_time
//   T21 datewatch.expire   datewatch:<id>:expire      watch → expired after its date
//   T24 deletion.expire    deletion:<id>:expire       account deletion link unused for 24 h → expired
//   T25 teaminvite.expire  teaminvite:<id>:expire     team invite pending for 7 days → expired
//   —   partners.metrics   partnermetrics:<date>      nightly responsiveness cache (§12.4)
import type { Tx } from '@/db';
import { expireDeletion } from '@/lib/domain/clients';
import { refreshResponsiveness, schedulePartnerMetrics } from '@/lib/domain/partners';
import { expireWatch, scanSavedSearches, scheduleSavedSearchScan } from '@/lib/domain/saved';
import { expireInvite, scheduleDigest, sendDailyDigest } from '@/lib/domain/team';
import { sofiaInstant } from '@/lib/format';
import { now } from '@/lib/clock';

const str = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));

export const catalogueHandlers: Record<string, (p: Record<string, unknown>) => Promise<void>> = {
  'digest.daily': async p => { await sendDailyDigest({ date: p.date ? str(p.date) : undefined }); },
  'savedsearch.scan': async p => { await scanSavedSearches({ date: p.date ? str(p.date) : undefined }); },
  'datewatch.expire': async p => { await expireWatch({ watchId: str(p.watchId) }); },
  'deletion.expire': async p => { await expireDeletion({ requestId: str(p.requestId) }); },
  'teaminvite.expire': async p => { await expireInvite({ inviteId: str(p.inviteId) }); },
  'partners.metrics': async p => {
    await refreshResponsiveness();
    const day = p.date ? str(p.date) : null;
    const at = await now();
    await schedulePartnerMetrics(undefined, day ? new Date(Math.max(sofiaInstant(day, 23, 59).getTime(), at.getTime())) : at);
  },
};

/**
 * Start the catalogue's daily timers (T19, T20 and the nightly metrics). Idempotent: call it from
 * the seed and once at deploy; afterwards each run schedules the next day itself.
 */
export async function ensureCatalogueJobs(tx?: Tx): Promise<void> {
  await scheduleDigest(tx);
  await scheduleSavedSearchScan(tx);
  await schedulePartnerMetrics(tx);
}
