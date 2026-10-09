'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/client';
import { requestEarningsReportAction } from './actions';

/** ‹Изтегли справка›: the report is prepared and sent by email. */
export function ReportButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn--outline btn--sm" disabled={pending} onClick={() => start(async () => {
      const r = await requestEarningsReportAction();
      if (!r.ok) { toast(r.error, 'error'); return; }
      toast(r.message);
      router.refresh();
    })}>Изтегли справка</button>
  );
}
