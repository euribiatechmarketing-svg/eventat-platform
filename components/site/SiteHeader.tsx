// Client-side top navigation (prototype: <header class="nav"> on every client screen).
import Link from 'next/link';
import { currentUser } from '@/lib/session';
import { bellItems } from '@/lib/bell';
import { initials, shortName } from '@/lib/initials';
import { Bell } from '@/components/ui/Bell';
import { Burger, Menu, type MenuItem } from '@/components/ui/client';
import { signOutAction } from '@/lib/actions/common';
import { Lang } from './Lang';

const LINKS: [string, string][] = [
  ['Категории', '/kategorii'],
  ['Търсене', '/tarsene'],
  ['Как работи', '/kak-raboti'],
  ['Стани партньор', '/stani-partnyor'],
];

/**
 * `guestAs`: on /stani-partnyor the guest's ‹Вход› / ‹Регистрация› open the partner side (SCREENS §1).
 * A partner or an admin on the public site gets ‹Към таблото› instead of the client's menu.
 */
export async function SiteHeader({ active, guestAs }: { active?: string; guestAs?: 'partner' }) {
  const u = await currentUser();
  const links = u?.role === 'client' ? [...LINKS, ['Моите заявки', '/akaunt/zayavki'] as [string, string]] : LINKS;
  const items: MenuItem[] = [
    { label: 'Моите събития', href: '/akaunt/sabitiya' },
    { label: 'Съобщения', href: '/akaunt/saobshteniya' },
    { label: 'Запазени търсения', href: '/akaunt/zapazeni' },
    { label: 'Поддръжка', href: '/akaunt/poddrazhka' },
    { label: 'Моите заявки', href: '/akaunt/zayavki' },
    { label: 'Моите резервации', href: '/akaunt/rezervacii' },
    { label: 'Настройки', href: '/akaunt/nastroyki' },
    null,
    { label: 'Изход', onSelect: signOutAction },
  ];
  const as = guestAs ? `?as=${guestAs}` : '';
  return (
    <header className="nav">
      <Burger target="nav" />
      <Link className="nav-brand" href="/"><img className="nav-logo" src="/assets/eventat-logo.png" alt="EventAT" /></Link>
      <nav className="nav-links">
        {links.map(([label, href]) => (
          <Link key={href} className={`nav-link${active === href ? ' is-active' : ''}`} href={href}>{label}</Link>
        ))}
      </nav>
      <div className="nav-right">
        <Lang />
        {u?.role === 'client' ? (
          <>
            <Bell items={await bellItems(u.id)} />
            <Menu label="Профил" align="down" items={items}
              trigger={<span className="nav-user" style={{ cursor: 'pointer' }}><span className="avatar avatar--sm">{initials(u.name)}</span><span className="nav-user-name">{shortName(u.name)}</span></span>}>
            </Menu>
          </>
        ) : u ? (
          <span className="ui-guest">
            <Link className="btn btn--outline" href={u.role === 'admin' ? '/admin' : '/partner'}>Към таблото</Link>
          </span>
        ) : (
          <span className="ui-guest">
            <Link className="btn btn--outline" href={`/vhod${as}`}>Вход</Link>
            <Link className="btn btn--primary" href={`/registratsiya${as}`}>Регистрация</Link>
          </span>
        )}
      </div>
    </header>
  );
}
