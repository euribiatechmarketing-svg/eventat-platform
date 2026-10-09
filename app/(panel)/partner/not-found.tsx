import { NotFoundBody } from '@/components/ui/NotFound';

// A missing or someone else's record inside the partner panel: the rail stays.
export default function PartnerNotFound() {
  return <NotFoundBody home="/partner" homeLabel="Към таблото" />;
}
