// /akaunt/zayavki/[nomer]: one request (SCREENS §4). The page guards itself.
// The header marks ‹Категории›, as on client/request-status.html.
import '@/styles/m-client-booking.css';
import { SiteHeader } from '@/components/site/SiteHeader';

export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader active="/kategorii" />
      <main className="wrap" id="main">{children}</main>
    </>
  );
}
