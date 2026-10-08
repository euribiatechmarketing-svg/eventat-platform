// Email CTA ‹Потвърди изтриването› → /partner/nastroyki/iztrivane?token= (SCREENS §3, SPEC P10).
import '@/styles/m-partner-catalogue.css';
import { partnerActor } from '../../_catalogue/server';
import { settingsPage } from '@/lib/domain/views-partner-catalogue';
import { ConfirmDeletion } from './ConfirmDeletion';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Изтриване на акаунта' };

export default async function ConfirmDeletionPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const actor = await partnerActor('/partner/nastroyki');
  const d = await settingsPage(actor);
  return (
    <div className="pc-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Потвърдете изтриването на акаунта</h1>
          <p className="page-sub">Изтриването е необратимо — потвърдете, че го искате.</p>
        </div>
      </div>
      <section className="dcard pc-confirm">
        <p className="panel-text">Поискахте да изтриете акаунта на {d.businessName} в EventAT. Изтриването е необратимо и е възможно само без предстоящи резервации.</p>
        {!d.canDelete && <div className="form-alert">Възможно само без предстоящи резервации.</div>}
        <ConfirmDeletion token={d.canDelete ? token : ''} />
      </section>
    </div>
  );
}
