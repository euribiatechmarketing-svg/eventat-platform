'use client';
// ‹BG› | ‹EN›: the English version is not enabled yet (D36), so ‹EN› only says so.
import { toast } from '@/components/ui/client';

export function LangSwitch() {
  const en = () => toast('Английската версия идва скоро');
  return (
    <span className="lang">
      <b aria-current="true">BG</b>
      <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={en}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); en(); } }}>EN</span>
    </span>
  );
}
