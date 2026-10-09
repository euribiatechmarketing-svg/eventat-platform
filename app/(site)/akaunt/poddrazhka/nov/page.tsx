// /akaunt/poddrazhka/nov?rezervaciya=[nomer] — the same screen with the booking preselected (SCREENS §4).
// A booking that already has its case (one per booking) opens the case, as ‹Сигнал до екипа› on the booking
// does: e.g. ‹Назад› after ‹Изпрати сигнала›, or an old link.
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { existingCaseNumber } from '@/lib/domain/views-messaging-support';
import { ClientSupportScreen } from '../SupportScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Сигнал до екипа' };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ rezervaciya?: string }> }) {
  const { rezervaciya } = await searchParams;
  const n = typeof rezervaciya === 'string' ? rezervaciya : null;
  const path = `/akaunt/poddrazhka/nov${n ? `?rezervaciya=${encodeURIComponent(n)}` : ''}`;
  if (n) {
    const existing = await existingCaseNumber(await actorFromUser(await requireRole('client', path)), n);
    if (existing) redirect(`/akaunt/poddrazhka/${encodeURIComponent(existing)}`);
  }
  return <ClientSupportScreen preselect={n} path={path} />;
}
