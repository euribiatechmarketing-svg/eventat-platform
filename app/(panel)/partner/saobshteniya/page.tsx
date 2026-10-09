// /partner/saobshteniya — SCREENS §7 vendor/messages.html (guard: partner).
import { PartnerMessagesScreen } from './MessagesScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Съобщения' };

export default async function PartnerMessagesPage({ searchParams }: { searchParams: Promise<{ q?: string; neprocheteni?: string }> }) {
  const { q, neprocheteni } = await searchParams;
  return <PartnerMessagesScreen q={typeof q === 'string' ? q : undefined} unreadOnly={neprocheteni === '1'} />;
}
