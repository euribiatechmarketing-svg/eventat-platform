// /akaunt/nastroyki — the client's settings (prototype client/settings.html). Guard: client.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { SiteHeader } from '@/components/site/SiteHeader';
import { auth } from '@/lib/auth';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { settingsView } from '@/lib/domain/views-auth-account';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const u = await requireRole('client', '/akaunt/nastroyki');
  const s = await auth.api.getSession({ headers: await headers() });
  const view = await settingsView(await actorFromUser(u), s?.session.id ?? null);
  // Re-mount the form after every save so it starts from what is stored.
  const version = JSON.stringify([view.user, view.cityId, view.marketing, view.preferences, view.invoice]);
  return (
    <>
      <SiteHeader />
      <main className="wrap m-acc" id="main">
        <div className="hold">
          <SettingsForm key={version} view={view} />
        </div>
      </main>
    </>
  );
}
