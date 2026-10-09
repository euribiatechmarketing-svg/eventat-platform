// ‹Отвори› / the title of a saved search → saved.openSearch(): restores every filter and resets
// what counts as ‹нови› (seen_at), then the search itself (SPEC §13.9).
import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { openSearch } from '@/lib/domain/saved';
import { NotFoundError } from '@/lib/domain/catalogue-kit';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = new URL(req.url);
  const u = await currentUser();
  if (!u) return NextResponse.redirect(new URL(`/vhod?next=${encodeURIComponent('/akaunt/zapazeni')}`, base));
  if (u.role !== 'client' || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(new URL('/akaunt/zapazeni', base));
  try {
    const { href } = await openSearch(await actorFromUser(u), { id });
    return NextResponse.redirect(new URL(href, base));
  } catch (e) {
    if (e instanceof NotFoundError) return new NextResponse(null, { status: 404 });
    throw e;
  }
}
