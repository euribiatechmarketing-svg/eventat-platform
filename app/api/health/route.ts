// GET /api/health — 200 {ok, db: 'up', time} when the database answers, 503 otherwise (docs/DEPLOY.md).
import { NextResponse } from 'next/server';
import { sql } from '@/db';
import { healthReport } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { status, body } = await healthReport(() => sql`select 1`);
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
