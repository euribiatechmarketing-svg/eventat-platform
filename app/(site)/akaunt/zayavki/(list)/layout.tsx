// /akaunt/zayavki: the client's requests (SCREENS §4). The page guards itself.
// The header marks ‹Моите заявки›, as on client/requests.html.
import '@/styles/m-client-booking.css';
import { SiteHeader } from '@/components/site/SiteHeader';

export default function RequestsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader active="/akaunt/zayavki" />
      <main className="wrap" id="main">{children}</main>
    </>
  );
}
