// /akaunt → /akaunt/zayavki (SCREENS §4). Guard: client.
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AccountIndex() {
  await requireRole('client', '/akaunt');
  redirect('/akaunt/zayavki');
}
