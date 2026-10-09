// /admin/pokana/[token] — the `team-invite` link ‹Приеми поканата› (SCREENS §8) [new screen]. Outside the
// admin guard: the invitee has no team role yet. The copy is the invite email's own.
import { notFound, redirect } from 'next/navigation';
import '@/styles/m-admin-ops.css';
import { roleDescription, ROLE_SCOPE } from '@/lib/domain/team';
import { invitePage } from '@/lib/domain/views-admin-ops';
import { Email } from '@/app/(panel)/admin/_ops/fmt';
import { ActionForm, Submit } from '@/app/(panel)/admin/_ops/ui';
import { acceptInviteAction } from './actions';

export const metadata = { title: 'Покана в екипа' };

export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await invitePage(decodeURIComponent(token));
  if (!page) notFound();
  if (page.invite.status === 'accepted') redirect('/vhod?next=/admin');
  if (!page.valid || page.existingUser?.role === 'partner') notFound();
  const inv = page.invite;
  const isNew = !page.existingUser;

  return (
    <div className="ops-invite">
      <div className="ops-invite-card">
        <img className="ops-invite-logo" src="/assets/eventat-logo.png" alt="EventAT" />
        <section className="dcard">
          <h1 className="ops-invite-h">Покана в екипа на EventAT</h1>
          <p>{page.inviterName} ви кани в панела на EventAT с роля {page.roleLabel}.</p>
          <p>{roleDescription(inv.role)}</p>
          <div className="kv">
            <div className="kv-item"><div className="kv-label">Роля</div><div className="kv-value">{page.roleLabel} · {ROLE_SCOPE[inv.role].toLocaleLowerCase('bg')}</div></div>
            <div className="kv-item"><div className="kv-label">Имейл за вход</div><div className="kv-value"><Email value={inv.email} /></div></div>
            {page.inviterName && <div className="kv-item"><div className="kv-label">Покана от</div><div className="kv-value">{page.inviterName}{page.inviterRole ? ` · ${page.inviterRole}` : ''}</div></div>}
          </div>
          {isNew && <p>Влизате с {inv.email} и си избирате парола при първото влизане.</p>}
          <ActionForm action={acceptInviteAction}>
            <input type="hidden" name="token" value={decodeURIComponent(token)} />
            <input type="email" name="email" value={inv.email} readOnly hidden autoComplete="username" />
            {isNew && (
              <label className="fld" style={{ marginTop: 16 }}>
                <span className="fld-l">Име и фамилия</span>
                <input className="fld-i" name="name" required minLength={2} maxLength={120} autoComplete="name" />
              </label>
            )}
            <label className="fld" style={{ marginTop: 14 }}>
              <span className="fld-l">Парола</span>
              <input className="fld-i" type="password" name="password" required minLength={8} maxLength={128} autoComplete={isNew ? 'new-password' : 'current-password'} />
            </label>
            <Submit className="btn btn--primary btn--block">Приеми поканата</Submit>
          </ActionForm>
        </section>
      </div>
    </div>
  );
}
