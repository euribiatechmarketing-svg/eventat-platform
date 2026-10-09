// /akaunt/saobshteniya/[id] — one conversation (SCREENS §4 client/messages.html; guard: client, own conversation).
import { notFound } from 'next/navigation';
import { MessagesScreen } from '../MessagesScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Съобщения' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ id }, { q }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  return <MessagesScreen id={id} q={typeof q === 'string' ? q : undefined} />;
}
