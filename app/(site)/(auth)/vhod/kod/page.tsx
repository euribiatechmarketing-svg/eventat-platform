// /vhod/kod — the SMS code after ‹Влез› when two-step confirmation is on (SPEC §1.3).
// Laid out like verify.html; its strings are the settings row's own (‹Потвърждение в две стъпки›,
// ‹Код по SMS при вход от ново устройство›).
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { resendWaitMs, safeNext, twoFactorChallenge } from '@/lib/domain/views-auth-account';
import { AuthSides } from '../../_ui/AuthSides';
import { CodeForm } from '../../_ui/CodeForm';
import { guestOnly, one } from '../../_ui/server';
import { resendTwoFactorAction, verifyTwoFactorAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Потвърждение в две стъпки' };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await guestOnly();
  const sp = await searchParams;
  const jar = await cookies();
  const c = jar.get('better-auth.two_factor') ?? jar.get('__Secure-better-auth.two_factor');
  const wall = Date.now(); // Better Auth's challenge and code expiry run on the wall clock
  const ch = await twoFactorChallenge(c?.value, wall);
  if (!ch) redirect('/vhod');
  const next = safeNext(one(sp.next));
  return (
    <div className="auth">
      <div className="auth-form ver-form">
        <div className="auth-box">
          <div className="ver-mark"><Icon name="phone" /></div>
          <h1 className="auth-t">Потвърждение в две стъпки</h1>
          <p className="auth-d ver-lead">Код по SMS при вход от ново устройство <br /><b>{ch.phone}</b></p>
          <CodeForm verify={verifyTwoFactorAction} resend={resendTwoFactorAction} fields={{ next: next ?? '' }}
            waitMs={resendWaitMs(ch.sentAt, wall)} spamHint={false} />
        </div>
      </div>
      <AuthSides role="client" />
    </div>
  );
}
