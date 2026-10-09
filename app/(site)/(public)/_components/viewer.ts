// Who is looking at a public page, and where a guest goes before a client-only action.
import 'server-only';
import { currentUser, type CurrentUser } from '@/lib/session';
import { registerHref, signInHref } from './text';
import type { Viewer } from './Results';

export async function viewerFor(next: string): Promise<{ user: CurrentUser | null; viewer: Viewer; clientId: string | null }> {
  const user = await currentUser();
  const kind = !user ? 'guest' : user.role === 'client' ? 'client' : 'other';
  return {
    user,
    clientId: user?.role === 'client' ? user.id : null,
    viewer: { kind, signIn: signInHref(next), register: (href: string) => registerHref(href) },
  };
}
