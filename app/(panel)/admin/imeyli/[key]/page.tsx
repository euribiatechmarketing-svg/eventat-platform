// /admin/imeyli/[key] — the catalogue with one email selected (prototype admin/emails.html?e=<key>).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TEMPLATES } from '@/lib/email/templates';
import { EmailsView } from '../_view';

type P = Promise<{ key: string }>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  return { title: `Имейл ${(await params).key}` };
}

export default async function AdminEmail({ params, searchParams }: { params: P; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { key } = await params;
  if (!TEMPLATES[key]) notFound();
  return <EmailsView selectedKey={key} sp={await searchParams} />;
}
