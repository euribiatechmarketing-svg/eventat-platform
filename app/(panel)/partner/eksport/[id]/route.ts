// The file behind ‹Експорт› on /partner/zayavki and /partner/rezervacii (SPEC §4.17): own reports only.
import { currentUser } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { partnerReportCsv } from '@/lib/domain/views-partner-ops';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await currentUser();
  if (!u || u.role !== 'partner') return new Response('Not found', { status: 404 });
  const r = await partnerReportCsv(await actorFromUser(u), id);
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(r.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${r.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
