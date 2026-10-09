// ‹Отвори› / the title of a saved search → saved.openSearch(): restores every filter and resets
// what counts as ‹нови› (seen_at), then the search itself (SPEC §13.9). Guard: client, own search
// (someone else's or a deleted one → the 404 page). Reached by a plain link, never prefetched.
import { notFound, redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { openSearch } from '@/lib/domain/saved';
import { NotFoundError } from '@/lib/domain/catalogue-kit';

export const dynamic = 'force-dynamic';

export default async function OpenSavedSearch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireRole('client', `/akaunt/zapazeni/${id}/otvori`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  let href: string;
  try {
    ({ href } = await openSearch(await actorFromUser(u), { id }));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  redirect(href);
}
