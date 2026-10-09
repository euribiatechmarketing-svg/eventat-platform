// The signed-out nav of auth.html / register.html / verify.html: logo → start page,
// the four public links and the language switch (no sign-in buttons on these screens).
import Link from 'next/link';
import { Burger } from '@/components/ui/client';
import { LangSwitch } from './LangSwitch';

const LINKS: [string, string][] = [
  ['Категории', '/kategorii'],
  ['Търсене', '/tarsene'],
  ['Как работи', '/kak-raboti'],
  ['Стани партньор', '/stani-partnyor'],
];

export function AuthNav() {
  return (
    <header className="nav">
      <Burger target="nav" />
      <Link className="nav-brand" href="/"><img className="nav-logo" src="/assets/eventat-logo.png" alt="EventAT" /></Link>
      <nav className="nav-links">
        {LINKS.map(([label, href]) => <Link key={href} className="nav-link" href={href}>{label}</Link>)}
      </nav>
      <div className="nav-right">
        <LangSwitch />
      </div>
    </header>
  );
}
