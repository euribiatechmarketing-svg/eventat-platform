import 'server-only';
import { cookies } from 'next/headers';

/** Set a one-time toast shown on the next page (use before redirect() in a server action). */
export async function setFlash(message: string, kind: 'ok' | 'error' = 'ok') {
  (await cookies()).set('flash', JSON.stringify({ message, kind }), { path: '/', maxAge: 60, httpOnly: false, sameSite: 'lax' });
}

export async function readFlash(): Promise<{ message: string; kind: 'ok' | 'error' } | null> {
  const v = (await cookies()).get('flash')?.value;
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
