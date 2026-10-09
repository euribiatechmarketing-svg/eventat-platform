// /akaunt/nastroyki/imeyl — the code for a new email address (D55), laid out like verify.html
// with its own strings. Guard: client with an open email change (otherwise back to settings).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { now } from '@/lib/clock';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { pendingEmailChange, resendWaitMs } from '@/lib/domain/views-auth-account';
import { AuthSides } from '../../../../(auth)/_ui/AuthSides';
import { CodeForm, MailMark } from '../../../../(auth)/_ui/CodeForm';
import { cancelEmailChangeAction, confirmEmailChangeAction, resendEmailChangeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Потвърждение на имейла' };

export default async function EmailChangePage() {
  const u = await requireRole('client', '/akaunt/nastroyki/imeyl');
  const p = await pendingEmailChange(await actorFromUser(u));
  if (!p) redirect('/akaunt/nastroyki');
  return (
    <>
      <SiteHeader />
      <main className="wrap m-acc" id="main">
        <div className="auth">
          <div className="auth-form ver-form">
            <div className="auth-box">
              <MailMark />
              <div className="ver-eyebrow">Потвърждение на имейла</div>
              <h1 className="auth-t">Проверете имейла си</h1>
              <p className="auth-d ver-lead">
                Изпратихме код за потвърждение <br />на <b>{p.newEmail}</b>. <button type="submit" form="imeyl-change" className="ver-change acc-linkbtn">Сменете имейла</button>
              </p>
              <form id="imeyl-change" action={cancelEmailChangeAction} hidden />
              <CodeForm verify={confirmEmailChangeAction} resend={resendEmailChangeAction} fields={{}}
                waitMs={resendWaitMs(p.sentAt, (await now()).getTime())} />
            </div>
          </div>
          <AuthSides role="client" />
        </div>
      </main>
    </>
  );
}
