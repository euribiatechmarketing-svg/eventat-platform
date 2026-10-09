'use client';
// ‹Избери› on a package carries what the booking box shows — the date (from the search or picked
// in the box), the guests and the client's event — so the request form opens on them, the same
// way the box's ‹Изпрати запитване› does. The box publishes its current query through this context.
import { createContext, useContext, useState, type ReactNode } from 'react';
import Link from 'next/link';

type Ctx = { query: string; setQuery: (q: string) => void };
const BookingQuery = createContext<Ctx | null>(null);

/** Holds the booking box's query (`data`, `gosti`, `sabitie-id`; never `paket`). */
export function BookingQueryProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [query, setQuery] = useState(initial);
  return <BookingQuery.Provider value={{ query, setQuery }}>{children}</BookingQuery.Provider>;
}

export const useBookingQuery = () => useContext(BookingQuery);

export function ChooseLink({ slug, serviceId, guest }: { slug: string; serviceId: string; guest: boolean }) {
  const ctx = useContext(BookingQuery);
  const q = new URLSearchParams(ctx?.query ?? '');
  q.delete('paket');
  const href = `/zayavka/${encodeURIComponent(slug)}?${new URLSearchParams([['paket', serviceId], ...q.entries()]).toString()}`;
  return <Link className="btn btn--outline btn--sm" href={guest ? `/registratsiya?next=${encodeURIComponent(href)}` : href}>Избери</Link>;
}
