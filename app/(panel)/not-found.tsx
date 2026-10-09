import { NotFoundBody } from '@/components/ui/NotFound';
import { currentUser } from '@/lib/session';

// Inside the panel shell (the partner/admin layout wraps it) a missing record keeps the rail.
export default async function PanelNotFound() {
  const u = await currentUser();
  const home = u?.role === 'admin' ? '/admin' : u?.role === 'partner' ? '/partner' : '/';
  return <NotFoundBody home={home} homeLabel={home === '/' ? 'Към началото' : 'Към таблото'} />;
}
