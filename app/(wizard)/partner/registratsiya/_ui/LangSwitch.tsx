'use client';
// ‹BG› / ‹EN› (SCREENS §1): only Bulgarian exists yet, so ‹EN› answers with the prototype's toast.
import { toast } from '@/components/ui/client';

export function LangSwitch() {
  return (
    <span className="lang" role="group" aria-label="Език">
      <b aria-current="true">BG</b>
      <span role="button" tabIndex={0} className="ui-click" onClick={() => toast('Английската версия идва скоро')}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toast('Английската версия идва скоро'); } }}>EN</span>
    </span>
  );
}
