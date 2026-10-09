// Where Google / Facebook send the visitor back (SPEC §4.1 A4). Better Auth admits a social identity
// only with an address the provider vouches for (lib/auth.ts); this route never confirms an address
// itself. A client's first sign-in gets the welcome email and the toast ‹Профилът е създаден›; then
// the usual sign-in redirect (§1.3). A session on an unconfirmed address (none is issued any more)
// ends here, and the email code proves the address instead (A2/A3).
import { headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { currentUser } from '@/lib/session';
import { setFlash } from '@/lib/flash';
import { welcomeSocialClient } from '@/lib/domain/clients';
import { hit } from '@/lib/domain/throttle';
import { recordSignIn, resendWaitMs, safeNext, signInDestination, verificationView } from '@/lib/domain/views-auth-account';
import { carry } from '../../_ui/messages';
import { clearAuthCookies, rememberSignup } from '../../_ui/server';

export async function GET(req: NextRequest) {
  const u = await currentUser();
  const base = new URL(req.url);
  if (!u) return NextResponse.redirect(new URL('/vhod', base));
  const next = safeNext(base.searchParams.get('next'));
  if (!u.emailVerified) {
    await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
    await clearAuthCookies();
    // A fresh code (after the 60 s cooldown) to the address, as ‹Влез› does for an unconfirmed one.
    const v = await verificationView(u.email);
    if (resendWaitMs(v.sentAt, Date.now()) === 0 && await hit('codeSend', u.email)) {
      await auth.api.sendVerificationOTP({ body: { email: u.email, type: 'email-verification' } });
    }
    await rememberSignup(u.email);
    return NextResponse.redirect(new URL(`/potvarzhdenie${carry(u.role === 'partner' ? 'partner' : 'client', next, { email: u.email })}`, base));
  }
  if (await welcomeSocialClient({ userId: u.id })) await setFlash('Профилът е създаден');
  await recordSignIn(u.id);
  return NextResponse.redirect(new URL(await signInDestination(u, next), base));
}
