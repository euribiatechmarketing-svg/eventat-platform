// ‹Свали отчета› on /admin/plashtaniya/partidi/[id]: the batch report CSV (payouts.batchReportCsv), view_finance.
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';
import { actorFromUser, can } from '@/lib/domain/actor';
import { batchReportCsv } from '@/lib/domain/payouts';
import { db } from '@/db';
import { payoutBatch } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await currentUser();
  if (!u) return NextResponse.redirect(new URL(`/vhod?next=${encodeURIComponent(`/admin/plashtaniya/partidi/${id}`)}`, req.url));
  if (u.role !== 'admin') return NextResponse.redirect(new URL(u.role === 'partner' ? '/partner' : '/akaunt', req.url));
  const actor = await actorFromUser(u);
  if (!can(actor, 'view_finance')) return NextResponse.redirect(new URL('/admin', req.url));
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const [b] = await db.select({ date: payoutBatch.batchDate }).from(payoutBatch).where(eq(payoutBatch.id, id));
  if (!b) return new NextResponse('Not found', { status: 404 });
  const csv = await batchReportCsv(id);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="partida-${b.date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
