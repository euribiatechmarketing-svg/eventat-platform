// /akaunt/poddrazhka/nov?rezervaciya=[nomer] — the same screen with the booking preselected (SCREENS §4).
import { ClientSupportScreen } from '../SupportScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Сигнал до екипа' };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ rezervaciya?: string }> }) {
  const { rezervaciya } = await searchParams;
  const n = typeof rezervaciya === 'string' ? rezervaciya : null;
  return <ClientSupportScreen preselect={n} path={`/akaunt/poddrazhka/nov${n ? `?rezervaciya=${encodeURIComponent(n)}` : ''}`} />;
}
