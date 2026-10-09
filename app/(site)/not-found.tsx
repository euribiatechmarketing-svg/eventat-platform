import { SiteHeader } from '@/components/site/SiteHeader';
import { NotFoundBody } from '@/components/ui/NotFound';

export default function SiteNotFound() {
  return (
    <>
      <SiteHeader />
      <div className="wrap"><div className="hold"><NotFoundBody /></div></div>
    </>
  );
}
