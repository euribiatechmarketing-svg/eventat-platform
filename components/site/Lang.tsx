'use client';
// ‹BG› / ‹EN› in the site header (SCREENS §1). English is not published yet (⚙ locale.en_enabled =
// false, D36): ‹EN› answers with the prototype's toast; ‹BG› is the current language.
import { toast } from '@/components/ui/client';

export function Lang() {
  const en = () => toast('Английската версия идва скоро');
  return (
    <span className="lang" role="group" aria-label="Език">
      <b aria-current="true">BG</b>
      <span className="ui-click" role="button" tabIndex={0} onClick={en}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); en(); } }}>EN</span>
    </span>
  );
}
