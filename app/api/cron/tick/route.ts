import { NextResponse } from 'next/server';
import { runDueJobs } from '@/lib/jobs';
import { deliverQueued } from '@/lib/email/send';
import { purgeUnlinkedMedia } from '@/lib/domain/media';
import { pruneThrottle } from '@/lib/domain/throttle';
import { cronAuthorized } from '@/lib/jobs/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Vercel Cron (every minute) calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const jobs = await runDueJobs();
  const emails = await deliverQueued();
  // Hourly housekeeping (wall clock): uploads nothing links to, and expired throttle rows.
  let purged = 0;
  if (new Date().getUTCMinutes() === 17) {
    purged = await purgeUnlinkedMedia().catch(e => { console.error('tick: media purge failed', e); return 0; });
    await pruneThrottle().catch(() => 0);
  }
  return NextResponse.json({ jobs, emails, purged });
}
