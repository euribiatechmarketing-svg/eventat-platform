// /akaunt/poddrazhka — SCREENS §4 client/dispute.html: the form and ‹Моите сигнали› (guard: client).
import { ClientSupportScreen } from './SupportScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Сигнал до екипа' };

export default async function SupportPage() {
  return <ClientSupportScreen preselect={null} path="/akaunt/poddrazhka" />;
}
