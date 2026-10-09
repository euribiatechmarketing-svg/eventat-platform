// Partner and admin panels (prototype: .shell = dark .side rail + .main with .topbar and .content).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Bell, type BellItem } from '@/components/ui/Bell';
import { Burger, Menu, type MenuItem } from '@/components/ui/client';
import { initials } from '@/lib/initials';
import { signOutAction } from '@/lib/actions/common';
import { RailNav, TopbarTitle, type RailGroup } from './RailNav';

export type { RailGroup, RailItem } from './RailNav';

export function PanelShell({ area, groups, titles, aliases, userName, userRole, avatarUrl, menu, bell, children, topbarExtra }: {
  area: 'partner' | 'admin';
  groups: RailGroup[];
  /** Topbar titles for routes that are not rail items, by path prefix. */
  titles?: Record<string, string>;
  /** Path prefixes that are not rail items, mapped to the rail item they belong under. */
  aliases?: Record<string, string>;
  userName: string;
  userRole: string;
  avatarUrl?: string | null;
  menu: MenuItem[];
  bell: BellItem[];
  children: ReactNode;
  topbarExtra?: ReactNode;
}) {
  const home = area === 'admin' ? '/admin' : '/partner';
  return (
    <div className="shell">
      <aside className="side">
        <Link className="side-brand" href={home}>
          <img className="side-logo" src="/assets/eventat-logo-white.png" alt="EventAT" />
          {area === 'admin' && <span className="side-tag">Админ</span>}
        </Link>
        <RailNav groups={groups} home={home} aliases={aliases} />
        <div className="side-foot">
          <Menu align="up" className="side-user-menu" items={[...menu, null, { label: 'Изход', onSelect: signOutAction }]}
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
          <TopbarTitle groups={groups} home={home} titles={titles} aliases={aliases} />
          <div className="topbar-right">
            {topbarExtra}
            <Bell items={bell} />
          </div>
        </header>
        <div className="content"><div className="content-inner" id="main" role="main">{children}</div></div>
      </div>
    </div>
  );
}
