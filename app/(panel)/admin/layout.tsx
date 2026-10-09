// Admin panel chrome + guard (SCREENS §1, §0 guard "admin"; permissions SPEC §1.2).
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser, can } from '@/lib/domain/actor';
import { adminBell, adminRailCounts, TEAM_ROLE_LABEL } from '@/lib/domain/views-panel';
import { Suspense } from 'react';
import { PanelShell, type RailGroup } from '@/components/panel/PanelShell';
import { AdminSearch } from './_ops/AdminSearch';
import '@/styles/m-admin-search.css';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('admin', '/admin');
  const actor = await actorFromUser(user);
  if (!actor.teamRole) redirect('/');
  const c = await adminRailCounts();
  const groups: RailGroup[] = [
    { label: 'Платформа', items: [
      { label: 'Табло', href: '/admin', icon: 'dashboard' },
      ...(can(actor, 'approve_partners') ? [{ label: 'Изпълнители', href: '/admin/partnyori', icon: 'store' as const, count: c.partners }] : []),
      ...(can(actor, 'moderate_listings') ? [{ label: 'Модерация', href: '/admin/moderatsiya', icon: 'shield' as const, count: c.revisions }] : []),
      { label: 'Резервации', href: '/admin/rezervacii', icon: 'calendar' },
      ...(can(actor, 'resolve_disputes') ? [{ label: 'Спорове', href: '/admin/sporove', icon: 'alert' as const, count: c.disputes }] : []),
      ...(can(actor, 'view_finance') ? [{ label: 'Плащания', href: '/admin/plashtaniya', icon: 'wallet' as const }] : []),
      { label: 'Клиенти', href: '/admin/klienti', icon: 'users' },
    ] },
    { label: 'Система', items: [
      { label: 'Имейли', href: '/admin/imeyli', icon: 'mail' },
      ...(can(actor, 'manage_team_settings') ? [{ label: 'Настройки', href: '/admin/nastroyki', icon: 'settings' as const }] : []),
    ] },
  ];
  return (
    <PanelShell area="admin" groups={groups} titles={{ '/admin/tarsene': 'Търсене', '/admin/moderatsiya': 'Модерация на обяви', '/admin/nastroyki': 'Настройки на платформата', '/admin/nastroyki/ekip': 'Екип и достъп' }}
      userName={user.name} userRole={TEAM_ROLE_LABEL[actor.teamRole] ?? ''}
      menu={can(actor, 'manage_team_settings') ? [{ label: 'Настройки', href: '/admin/nastroyki' }] : []}
      bell={await adminBell(actor)} topbarExtra={<Suspense><AdminSearch /></Suspense>}>
      {children}
    </PanelShell>
  );
}
