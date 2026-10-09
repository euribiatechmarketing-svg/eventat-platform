// vendor/settings.html → /partner/nastroyki (SCREENS §7)
import '@/styles/m-partner-catalogue.css';
import { settingsPage } from '@/lib/domain/views-partner-catalogue';
import { partnerActor } from '../_catalogue/server';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const actor = await partnerActor('/partner/nastroyki');
  const d = await settingsPage(actor);
  return (
    <div className="pc-page">
      <SettingsForm key={`${d.status}-${d.businessName}`} d={d} />
    </div>
  );
}
