// Private files (SPEC §14 "Storage"): `/api/files/[id]` serves a media row's bytes after
// media.canAccess() — message attachments to the conversation's parties, dispute evidence to both
// sides and the team, and so on. Public files are served as well; static demo photos redirect.
// `/api/files/private/…` is the same file addressed by its storage key: lib/storage fileUrl()
// builds that form for private keys (request inspiration photos, review photos, documents).
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
const PRIVATE_KEY = /^private\/[\w./-]+$/;

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  let parts: string[];
  try { parts = (await params).path.map(decodeURIComponent); } catch { return new NextResponse(null, { status: 404 }); }
  const key = parts.join('/');
  const byId = parts.length === 1 && UUID.test(parts[0]);
  if (!byId && (!PRIVATE_KEY.test(key) || parts.includes('..'))) return new NextResponse(null, { status: 404 });
  const [m] = await db.select().from(media).where(byId ? eq(media.id, parts[0]) : eq(media.storageKey, key)).limit(1);
  const u = await currentUser();
  const actor = u ? await actorFromUser(u) : null;
  if (!m || !(await canAccess(actor, m.id))) return new NextResponse(null, { status: u ? 404 : 401 });
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
