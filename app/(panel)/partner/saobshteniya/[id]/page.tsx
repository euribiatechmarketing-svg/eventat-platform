// /partner/saobshteniya/[id] — one conversation (SCREENS §7 vendor/messages.html; guard: partner, own conversation).
import { notFound } from 'next/navigation';
import { PartnerMessagesScreen } from '../MessagesScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Съобщения' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PartnerConversationPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; neprocheteni?: string }>;
}) {
  const [{ id }, { q, neprocheteni }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  return <PartnerMessagesScreen id={id} q={typeof q === 'string' ? q : undefined} unreadOnly={neprocheteni === '1'} />;
}
