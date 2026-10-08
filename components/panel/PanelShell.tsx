// Partner and admin panels (prototype: .shell = dark .side rail + .main with .topbar and .content).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Bell } from '@/components/ui/Bell';
import { Burger, Menu, type MenuItem } from '@/components/ui/client';
import { bellItems } from '@/lib/bell';
import { initials } from '@/lib/initials';
import { signOutAction } from '@/lib/actions/common';
import type { CurrentUser } from '@/lib/session';

export type RailItem = { label: string; href: string; icon: IconName; count?: number };
export type RailGroup = { label: string; items: RailItem[] };

export async function PanelShell({ user, area, groups, active, title, userName, userRole, avatarUrl, menu, children, topbarExtra }: {
  user: CurrentUser;
  area: 'partner' | 'admin';
  groups: RailGroup[];
  /** href of the active rail item */
  active: string;
  title: string;
  userName: string;
  userRole: string;
  avatarUrl?: string | null;
  menu: MenuItem[];
  children: ReactNode;
  topbarExtra?: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="side">
        <Link className="side-brand" href={area === 'admin' ? '/admin' : '/partner'}>
          <img className="side-logo" src="/assets/eventat-logo-white.png" alt="EventAT" />
          {area === 'admin' && <span className="side-tag">Админ</span>}
        </Link>
        {groups.map((g, gi) => (
          <div key={g.label}>
            <div className={`side-label${gi === 0 ? ' side-label--first' : ''}`}>{g.label}</div>
            <nav className="side-nav">
              {g.items.map(it => (
                <Link key={it.href} className={`side-item${active === it.href ? ' is-active' : ''}`} href={it.href}>
                  <Icon name={it.icon} />{it.label}{it.count ? <span className="side-count">{it.count}</span> : null}
                </Link>
              ))}
            </nav>
          </div>
        ))}
        <div className="side-foot">
          <Menu align="up" label="Акаунт" className="side-user-menu" items={[...menu, null, { label: 'Изход', onSelect: signOutAction }]}
            trigger={
              <span className="side-user" style={{ cursor: 'pointer' }}>
                <span className="side-user-av">{avatarUrl ? <img src={avatarUrl} alt="" /> : initials(userName)}</span>
                <span><span className="side-user-name">{userName}</span><span className="side-user-role">{userRole}</span></span>
                <Icon name="chevronDown" />
              </span>
            } />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Burger target="shell" />
          <span className="topbar-title">{title}</span>
          <div className="topbar-right">
            {topbarExtra}
            <Bell items={await bellItems(user.id)} />
          </div>
        </header>
        <div className="content"><div className="content-inner">{children}</div></div>
      </div>
    </div>
  );
}
