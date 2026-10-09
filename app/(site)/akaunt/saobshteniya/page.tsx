// /akaunt/saobshteniya — SCREENS §4 client/messages.html (guard: client).
import { MessagesScreen } from './MessagesScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Съобщения' };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <MessagesScreen q={typeof q === 'string' ? q : undefined} />;
}
