// The earnings report's CSV (the email's ‹Изтегли справката›): own reports only.
import { currentUser } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { earningsReportCsv } from '@/lib/domain/views-partner-catalogue';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await currentUser();
  if (!u || u.role !== 'partner') return new Response('Not found', { status: 404 });
  const r = await earningsReportCsv(await actorFromUser(u), id);
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(r.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${r.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
