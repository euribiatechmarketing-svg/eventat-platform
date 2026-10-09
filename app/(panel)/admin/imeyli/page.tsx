// /admin/imeyli?audience=&q=&izgled= — the email catalogue (prototype admin/emails.html).
import type { Metadata } from 'next';
import { EmailsView } from './_view';

export const metadata: Metadata = { title: 'Имейли' };

export default async function AdminEmails({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <EmailsView selectedKey={null} sp={await searchParams} />;
}
