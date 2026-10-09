// /akaunt/iztrivane?token= — behind the email CTA ‹Потвърди изтриването› (SCREENS §3, SPEC §4.1 A10).
// Guard: the token. The wording is the client-delete-confirm email's own.
import type { Metadata } from 'next';
import Link from 'next/link';
import { deletionLinkView } from '@/lib/domain/views-auth-account';
import { AuthSides } from '../../_ui/AuthSides';
import { BinMark, ConfirmDeletion } from '../../_ui/ConfirmDeletion';
import { ERR } from '../../_ui/messages';
import { one } from '../../_ui/server';
import { confirmClientDeletionAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Изтриване на профила' };

export default async function ClientDeletionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = one((await searchParams).token);
  const link = await deletionLinkView(token, 'client');
  return (
    <div className="auth">
      <div className="auth-form ver-form">
        <div className="auth-box">
          <BinMark />
          <h1 className="auth-t">Потвърдете изтриването на профила</h1>
          {link ? (
            <>
              <p className="auth-d">Получихме искане за изтриване на профила ви в EventAT. Профилът се изтрива едва след като потвърдите с бутона по-долу.</p>
              <p className="auth-d">Активните резервации остават валидни до събитието. Данните за плащане и документите по платените резервации се пазят според закона.</p>
              <p className="auth-d ver-lead">Профил: <b>{link.email}</b></p>
              <ConfirmDeletion action={confirmClientDeletionAction} token={token} />
            </>
          ) : (
            <>
              <p className="acc-err acc-expired" role="alert">{ERR.linkUsed}</p>
              <Link className="btn btn--primary btn--lg btn--block" href="/vhod">Вход</Link>
            </>
          )}
        </div>
      </div>
      <AuthSides role="client" />
    </div>
  );
}
