import { NotFoundBody } from '@/components/ui/NotFound';

// A missing record inside the admin panel: the rail stays.
export default function AdminNotFound() {
  return <NotFoundBody home="/admin" homeLabel="Към таблото" inShell />;
}
