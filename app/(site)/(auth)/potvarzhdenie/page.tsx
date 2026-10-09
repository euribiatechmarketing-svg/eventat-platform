// /potvarzhdenie?email=&as=&next= — the 6-digit email code (prototype client/verify.html).
// Guard: guest with an unverified email. A signed-in client who opens the code email of an
// email change (D55) is taken to that screen instead.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { pendingEmailChange, resendWaitMs, safeNext, verificationView } from '@/lib/domain/views-auth-account';
import { AuthSides } from '../_ui/AuthSides';
import { CodeForm, MailMark } from '../_ui/CodeForm';
import { carry } from '../_ui/messages';
import { guestOnly, one } from '../_ui/server';
import { changeEmailAction, resendCodeAction, verifyCodeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Потвърждение на имейла' };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const email = one(sp.email).trim().toLowerCase();
  const me = await currentUser();
  if (me?.role === 'client' && email && (await pendingEmailChange(await actorFromUser(me)))?.newEmail === email) redirect('/akaunt/nastroyki/imeyl');
  await guestOnly();
  const next = safeNext(one(sp.next));
  const asParam = one(sp.as) === 'partner' ? 'partner' : 'client';
  if (!email) redirect(`/registratsiya${carry(asParam, next)}`);
  const v = await verificationView(email);
  if (!v.account) redirect(`/registratsiya${carry(asParam, next)}`);
  if (v.account.emailVerified) redirect(`/vhod${carry(asParam, next)}`);
  const role = v.account.role === 'partner' ? 'partner' : 'client';
  const fields = { email, as: role, next: next ?? '' };
  return (
    <div className="auth">
      <div className="auth-form ver-form">
        <div className="auth-box">
          <MailMark />
          <div className="ver-eyebrow">Потвърждение на имейла</div>
          <h1 className="auth-t">Проверете имейла си</h1>
          <p className="auth-d ver-lead">
            Изпратихме код за потвърждение <br />на <b>{email}</b>. <button type="submit" form="ver-change" className="ver-change acc-linkbtn">Сменете имейла</button>
          </p>
          <form id="ver-change" action={changeEmailAction} hidden>
            {Object.entries(fields).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
          </form>
          {/* Better Auth's code runs on the wall clock, so the resend countdown does too. */}
          <CodeForm verify={verifyCodeAction} resend={resendCodeAction} fields={fields} waitMs={resendWaitMs(v.sentAt, Date.now())} />
        </div>
      </div>
      <AuthSides role={role} />
    </div>
  );
}
