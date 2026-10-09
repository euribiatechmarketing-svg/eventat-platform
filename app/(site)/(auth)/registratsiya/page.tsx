// /registratsiya?as=&next= — sign-up for clients and partners (prototype client/register.html). Guard: guest.
import type { Metadata } from 'next';
import { safeNext } from '@/lib/domain/views-auth-account';
import { guestOnly, one, socialProviders } from '../_ui/server';
import { RegisterForm } from './RegisterForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Регистрация' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await guestOnly();
  const sp = await searchParams;
  return <RegisterForm as={one(sp.as) === 'partner' ? 'partner' : 'client'} next={safeNext(one(sp.next))} social={socialProviders()} />;
}
