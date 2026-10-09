// Where Google / Facebook send the visitor back (SPEC §4.1 A4): a first sign-in gets the welcome
// email and the toast ‹Профилът е създаден›; then the usual sign-in redirect (§1.3).
import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { setFlash } from '@/lib/flash';
import { verifyEmail } from '@/lib/domain/clients';
import { recordSignIn, signInDestination } from '@/lib/domain/views-auth-account';

export async function GET(req: NextRequest) {
  const u = await currentUser();
  const base = new URL(req.url);
  if (!u) return NextResponse.redirect(new URL('/vhod', base));
  if (base.searchParams.get('nov') === '1' && u.role === 'client') {
    await verifyEmail({ userId: u.id });
    await setFlash('Профилът е създаден');
  }
  await recordSignIn(u.id);
  return NextResponse.redirect(new URL(await signInDestination(u, base.searchParams.get('next')), base));
}
