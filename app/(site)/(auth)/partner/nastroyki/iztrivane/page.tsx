// /partner/nastroyki/iztrivane?token= — behind the vendor-delete-confirm CTA ‹Потвърди изтриването›
// (SCREENS §3, SPEC §4.2 P10). Guard: the token (works signed out, outside the panel shell).
// The wording is the email's own.
import type { Metadata } from 'next';
import { deletionLinkView } from '@/lib/domain/views-auth-account';
import { AuthSides } from '../../../_ui/AuthSides';
import { BinMark, ConfirmDeletion } from '../../../_ui/ConfirmDeletion';
import { ERR } from '../../../_ui/messages';
import { one } from '../../../_ui/server';
import { confirmPartnerDeletionAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Изтриване на акаунта' };

export default async function PartnerDeletionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = one((await searchParams).token);
  const link = await deletionLinkView(token, 'partner');
  return (
    <div className="auth">
      <div className="auth-form ver-form">
        <div className="auth-box">
          <BinMark />
          <h1 className="auth-t">Потвърдете изтриването на акаунта</h1>
          {link ? (
            <>
              <p className="auth-d">Поискахте да изтриете акаунта на {link.partnerName} в EventAT. Изтриването е необратимо и е възможно само без предстоящи резервации.</p>
              <p className="auth-d ver-lead">Акаунт: <b>{link.email}</b></p>
              <ConfirmDeletion action={confirmPartnerDeletionAction} token={token} />
            </>
          ) : (
            <p className="acc-err" role="alert" style={{ marginTop: 14 }}>{ERR.linkUsed}</p>
          )}
        </div>
      </div>
      <AuthSides role="partner" />
    </div>
  );
}
