// /vhod/nova-parola?token= — the screen behind the email CTA ‹Задай нова парола› (SCREENS §3).
// Better Auth checks the link first and sends ?token= (valid) or ?error=INVALID_TOKEN here.
import type { Metadata } from 'next';
import Link from 'next/link';
import { resetTokenUser } from '@/lib/domain/views-auth-account';
import { AuthSides } from '../../_ui/AuthSides';
import { ERR } from '../../_ui/messages';
import { guestOnly, one } from '../../_ui/server';
import { ResetForm } from './ResetForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Нова парола' };

export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await guestOnly();
  const sp = await searchParams;
  const token = one(sp.token);
  // The link's lifetime is Better Auth's (60 min, wall clock).
  const u = one(sp.error) ? null : await resetTokenUser(token, Date.now());
  return (
    <div className="auth">
      <div className="auth-form ver-form">
        <div className="auth-box">
          <div className="ver-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
          </div>
          <h1 className="auth-t">Задайте нова парола</h1>
          {u ? (
            <ResetForm token={token} />
          ) : (
            <>
              <p className="acc-err acc-expired" role="alert">{ERR.link}</p>
              <Link className="btn btn--primary btn--lg btn--block" href="/vhod">Вход</Link>
            </>
          )}
        </div>
      </div>
      <AuthSides role={u?.role === 'partner' ? 'partner' : 'client'} />
    </div>
  );
}
