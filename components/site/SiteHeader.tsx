// Client-side top navigation (prototype: <header class="nav"> on every client screen).
import Link from 'next/link';
import { currentUser } from '@/lib/session';
import { bellItems } from '@/lib/bell';
import { initials, shortName } from '@/lib/initials';
import { Bell } from '@/components/ui/Bell';
import { Burger, Menu, type MenuItem } from '@/components/ui/client';
import { signOutAction } from '@/lib/actions/common';

const LINKS: [string, string][] = [
  ['Категории', '/kategorii'],
  ['Търсене', '/tarsene'],
  ['Как работи', '/kak-raboti'],
  ['Стани партньор', '/stani-partnyor'],
];

export async function SiteHeader({ active }: { active?: string }) {
  const u = await currentUser();
  const links = u?.role === 'client' ? [...LINKS, ['Моите заявки', '/akaunt/zayavki'] as [string, string]] : LINKS;
  const items: MenuItem[] = !u ? [] : u.role === 'client'
    ? [
        { label: 'Моите събития', href: '/akaunt/sabitiya' },
        { label: 'Съобщения', href: '/akaunt/saobshteniya' },
        { label: 'Запазени', href: '/akaunt/zapazeni' },
        { label: 'Поддръжка', href: '/akaunt/poddrazhka' },
        { label: 'Моите заявки', href: '/akaunt/zayavki' },
        { label: 'Моите резервации', href: '/akaunt/rezervacii' },
        { label: 'Настройки', href: '/akaunt/nastroyki' },
        null,
        { label: 'Изход', onSelect: signOutAction },
      ]
    : [{ label: u.role === 'admin' ? 'Админ панел' : 'Партньорски панел', href: u.role === 'admin' ? '/admin' : '/partner' }, null, { label: 'Изход', onSelect: signOutAction }];
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
        {u ? (
          <>
            <Bell items={await bellItems(u.id)} />
            <Menu label="Профил" align="down" items={items}
              trigger={<span className="nav-user" style={{ cursor: 'pointer' }}><span className="avatar avatar--sm">{initials(u.name)}</span><span className="nav-user-name">{shortName(u.name)}</span></span>}>
            </Menu>
          </>
        ) : (
          <span className="ui-guest">
            <Link className="btn btn--ghost" href="/vhod">Вход</Link>
            <Link className="btn btn--primary" href="/registratsiya">Регистрация</Link>
          </span>
        )}
      </div>
    </header>
  );
}
