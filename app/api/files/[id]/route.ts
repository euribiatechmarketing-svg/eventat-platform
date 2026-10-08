// Private files (SPEC §14 "Storage"): `/api/files/[id]` serves a media row's bytes after
// media.canAccess() — message attachments to the conversation's parties, dispute evidence to both
// sides and the team, and so on. Public files are served as well; static demo photos redirect.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { media } from '@/db/schema';
import { currentUser } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { canAccess } from '@/lib/domain/media';
import { getFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });
  const u = await currentUser();
  const actor = u ? await actorFromUser(u) : null;
  if (!(await canAccess(actor, id))) return new NextResponse(null, { status: u ? 404 : 401 });
  const [m] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!m) return new NextResponse(null, { status: 404 });
  // Bundled demo photos (public/photos) are plain static files.
  if (m.storageKey.startsWith('/')) return NextResponse.redirect(new URL(m.storageKey, req.url), 302);
  const f = await getFile(m.storageKey);
  if (!f) return new NextResponse(null, { status: 404 });
  const name = encodeURIComponent(m.originalName ?? `${m.id}`);
  return new NextResponse(new Uint8Array(f.body), {
    headers: {
      'Content-Type': m.mime,
      'Content-Length': String(f.body.length),
      'Content-Disposition': `inline; filename*=UTF-8''${name}`,
      'Cache-Control': m.isPublic ? 'public, max-age=3600' : 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
