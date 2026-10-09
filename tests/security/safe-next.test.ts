// Security: a sign-in `next` (and a search form's `back`) cannot send the visitor to another site
// (safenext-tab-open-redirect, and the auth review's finding). Browsers drop a tab inside a URL, so
// `/\t/evil.example` used to pass the string checks and resolve to https://evil.example.
import { describe, expect, it } from 'vitest';
import { safeNext, signInDestination } from '@/lib/domain/views-auth-account';
import { sameSitePath } from '@/lib/safe-path';
import { createClient } from '../helpers/factories';

const BASE = 'https://eventat.bg/vhod/prodalzhi';
const ATTACKS = [
  '/\t/evil.example/vhod', '/\n/evil.example', '/\r/evil.example', '/\\evil.example', '/\\/evil.example', '//evil.example',
  '/%09/evil.example'.replace('%09', '\t'), 'https://evil.example', 'javascript:alert(1)', '/\u0000/evil.example', ' //evil.example',
];

describe('safeNext / sameSitePath', () => {
  it('refuses every value the browser would resolve to another origin', () => {
    for (const v of ATTACKS) {
      expect(safeNext(v), JSON.stringify(v)).toBeNull();
      expect(sameSitePath(v), JSON.stringify(v)).toBeNull();
    }
  });

  it('keeps same-site paths as they are, and still refuses the auth pages behind dot segments', () => {
    expect(safeNext('/tarsene?grad=sofia&data=2026-06-14')).toBe('/tarsene?grad=sofia&data=2026-06-14');
    expect(safeNext('/partnyori/studio-melodia#revyuta')).toBe('/partnyori/studio-melodia#revyuta');
    expect(safeNext('/./vhod')).toBeNull();
    expect(safeNext('/x/../api/auth/sign-out')).toBeNull();
  });

  it('the sign-in redirect stays on this site for a signed-in client (GET /vhod/prodalzhi)', async () => {
    const { user } = await createClient();
    const dest = await signInDestination({ id: user.id, role: 'client' }, '/\t/evil.example/vhod');
    expect(new URL(dest, BASE).origin).toBe('https://eventat.bg');
  });
});
