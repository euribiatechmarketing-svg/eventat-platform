import 'server-only';
// Page and action guard for the admin-ops screens: admin role + active team role (layout), then the
// screen's permission (SPEC §1.2). A team member without it goes back to the dashboard.
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser, can, type Actor, type Permission } from '@/lib/domain/actor';

const team = cache(async (next: string) => {
  const user = await requireRole('admin', next);
  const actor = await actorFromUser(user);
  if (!actor.teamRole) redirect('/');
  return { user, actor };
});

export async function requireTeam(permission?: Permission, next = '/admin'): Promise<{ user: Awaited<ReturnType<typeof requireRole>>; actor: Actor }> {
  const t = await team(next);
  if (permission && !can(t.actor, permission)) redirect('/admin');
  return t;
}
