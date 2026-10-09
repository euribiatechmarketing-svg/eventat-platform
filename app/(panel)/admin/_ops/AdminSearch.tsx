'use client';
// Topbar search (SCREENS §1 admin topbar). Each admin-ops list (and its record pages) searches that list, as in the prototype;
// everywhere else the search goes to /admin/tarsene (booking number → booking; else partners, clients, bookings).
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import '@/styles/m-admin-search.css';

const OWN: { prefix: string; exact?: boolean; placeholder: string; action: string }[] = [
  { prefix: '/admin/partnyori', placeholder: 'Търси по име, категория или град', action: '/admin/partnyori' },
  { prefix: '/admin/moderatsiya', placeholder: 'Търси по услуга или изпълнител', action: '/admin/moderatsiya' },
  { prefix: '/admin/klienti', placeholder: 'Търси по име, имейл или телефон', action: '/admin/klienti' },
  { prefix: '/admin/nastroyki/ekip', placeholder: 'Търси човек или роля', action: '/admin/nastroyki/ekip' },
  { prefix: '/admin/nastroyki', exact: true, placeholder: 'Търси настройка', action: '/admin/nastroyki' },
];
const DEFAULT = { placeholder: 'Търси изпълнител, клиент или резервация', action: '/admin/tarsene' };

/** The topbar search; `inPage` is the same field inside a list page for phones and tablets, where the topbar has no room for it. */
export function AdminSearch({ inPage = false }: { inPage?: boolean }) {
  const path = usePathname();
  const params = useSearchParams();
  const own = OWN.find(o => (o.exact ? path === o.prefix : path === o.prefix || path.startsWith(o.prefix + '/')));
  const cfg = own ?? DEFAULT;
  const keep = own && cfg.action === path ? [...params.entries()].filter(([k]) => k !== 'q') : [];
  const value = own || path === '/admin/tarsene' ? params.get('q') ?? '' : '';
  return (
    <form className={`search ops-search${inPage ? ' ops-search--page ops-search--narrow' : ''}`} role="search" action={cfg.action} key={cfg.action + value}>
      <Icon name="search" />
      {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="search" name="q" defaultValue={value} placeholder={cfg.placeholder} aria-label={cfg.placeholder} />
    </form>
  );
}
