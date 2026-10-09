// /zayavka/*: SCREENS §5. Pages guard themselves (client only, own records).
// The header marks ‹Категории›, as on client/request.html and brief.html.
import '@/styles/m-client-booking.css';
import { SiteHeader } from '@/components/site/SiteHeader';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader active="/kategorii" />
      <main className="wrap" id="main">{children}</main>
    </>
  );
}
