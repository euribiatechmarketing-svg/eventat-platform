import { NextResponse } from 'next/server';
import { runDueJobs } from '@/lib/jobs';
import { deliverQueued } from '@/lib/email/send';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Vercel Cron (every minute) calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const jobs = await runDueJobs();
  const emails = await deliverQueued();
  return NextResponse.json({ jobs, emails });
}
