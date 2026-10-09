// /vhod?as=&next= — sign-in (prototype client/auth.html). Guard: guest.
import type { Metadata } from 'next';
import { safeNext } from '@/lib/domain/views-auth-account';
import { guestOnly, one, socialProviders } from '../_ui/server';
import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Вход' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await guestOnly();
  const sp = await searchParams;
  return (
    <SignInForm as={one(sp.as) === 'partner' ? 'partner' : 'client'} next={safeNext(one(sp.next))}
      email={one(sp.email)} social={socialProviders()} />
  );
}
