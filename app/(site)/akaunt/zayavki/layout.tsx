// /akaunt/zayavki/*: the client's requests (SCREENS §4). Pages guard themselves.
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
