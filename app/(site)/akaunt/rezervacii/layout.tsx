// /akaunt/rezervacii/*: SCREENS §4. Pages guard themselves (client only, own records).
// The header marks ‹Моите заявки›, as on client/bookings.html, cancel.html, invoice.html, review.html.
import '@/styles/m-client-booking.css';
import { SiteHeader } from '@/components/site/SiteHeader';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader active="/akaunt/zayavki" />
      <main className="wrap" id="main">{children}</main>
    </>
  );
}
