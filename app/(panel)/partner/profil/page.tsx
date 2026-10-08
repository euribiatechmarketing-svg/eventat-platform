// vendor/profile.html → /partner/profil (SCREENS §7)
import '@/styles/m-partner-catalogue.css';
import { profilePage, TAG_SUGGESTIONS } from '@/lib/domain/views-partner-catalogue';
import { partnerActor } from '../_catalogue/server';
import { ProfileEditor } from './ProfileEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Публичен профил' };

export default async function ProfilePage() {
  const actor = await partnerActor('/partner/profil');
  const d = await profilePage(actor);
  return (
    <div className="pc-page">
      <ProfileEditor d={{ ...d, tagSuggestions: [...TAG_SUGGESTIONS] }} />
    </div>
  );
}
