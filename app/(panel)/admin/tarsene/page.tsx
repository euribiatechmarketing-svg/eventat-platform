// /admin/tarsene — the admin topbar search (SCREENS §1) [new route]: an exact booking number opens the
// booking; otherwise partners, clients and bookings that match, in the admin's row patterns.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import '@/styles/m-admin-ops.css';
import { can } from '@/lib/domain/actor';
import { BOOKING_ADMIN, PARTNER_ADMIN, adminSearch } from '@/lib/domain/views-admin-ops';
import { date, money } from '@/lib/format';
import { requireTeam } from '../_ops/guard';
import { Badge, initials, n } from '../_ops/fmt';

export const metadata = { title: 'Търсене' };

export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor } = await requireTeam(undefined, '/admin/tarsene');
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const r = await adminSearch(actor, q);
  if (r.exact) redirect(`/admin/rezervacii/${encodeURIComponent(r.exact)}`);
  const total = r.partners.length + r.clients.length + r.bookings.length;
  const empty = <div className="ui-empty">Няма записи в този изглед.</div>;

  return (
    <div className="ops-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{q ? `„${q}“` : 'Търсене'}</h1>
          {q && <p className="page-sub">{[can(actor, 'approve_partners') ? n(r.partners.length, 'изпълнител', 'изпълнители') : null, n(r.clients.length, 'клиент', 'клиенти'), n(r.bookings.length, 'резервация', 'резервации')].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>

      <form className="search ops-search ops-search--page" role="search" action="/admin/tarsene" style={{ marginBottom: 20 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input type="search" name="q" defaultValue={q} placeholder="Търси изпълнител, клиент или резервация" aria-label="Търси изпълнител, клиент или резервация" />
      </form>

      {q && total === 0 && <section className="dcard">{empty}</section>}

      {q && can(actor, 'approve_partners') && r.partners.length > 0 && (
        <section className="dcard ops-sec">
          <div className="dcard-head"><h2 className="dcard-title">Изпълнители</h2><span className="badge">{r.partners.length}</span></div>
          {r.partners.map(p => (
            <Link key={p.id} className="rec" href={`/admin/partnyori/${p.id}`}>
              <span className="avatar">{initials(p.name)}</span>
              <span><span className="rec-n">{p.name}</span><span className="rec-s">{[p.categoryName, p.cityName].filter(Boolean).join(' · ')}</span></span>
              <span></span>
              <span className="rec-end"><Badge tone={PARTNER_ADMIN[p.status]?.tone ?? ''}>{PARTNER_ADMIN[p.status]?.label}</Badge></span>
            </Link>
          ))}
        </section>
      )}

      {q && r.clients.length > 0 && (
        <section className="dcard ops-sec">
          <div className="dcard-head"><h2 className="dcard-title">Клиенти</h2><span className="badge">{r.clients.length}</span></div>
          {r.clients.map(c => (
            <Link key={c.id} className="rec" href={`/admin/klienti/${c.id}`}>
              <span className="avatar">{initials(c.name)}</span>
              <span><span className="rec-n">{c.name}</span><span className="rec-s">{[c.typeLabel, c.cityName, c.email].filter(Boolean).join(' · ')}</span></span>
              <span></span>
              <span className="rec-end"><Badge tone={c.badge.tone}>{c.badge.label}</Badge><span className="btn btn--outline btn--sm">Профил</span></span>
            </Link>
          ))}
        </section>
      )}

      {q && r.bookings.length > 0 && (
        <section className="dcard ops-sec">
          <div className="dcard-head"><h2 className="dcard-title">Резервации</h2><span className="badge">{r.bookings.length}</span></div>
          {r.bookings.map(b => (
            <Link key={b.number} className="rec" href={`/admin/rezervacii/${encodeURIComponent(b.number)}`}>
              <span className="cat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg></span>
              <span><span className="rec-n">{b.number}</span><span className="rec-s">{b.client} · {b.partner} · {date(b.event_date)}</span></span>
              <span></span>
              <span className="rec-end"><span className="rec-v">{money(b.amount)}</span><Badge tone={BOOKING_ADMIN[b.status]?.tone ?? ''}>{BOOKING_ADMIN[b.status]?.label}</Badge></span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
