// vendor/service-edit.html → /partner/uslugi/[id] (SCREENS §7). Own services only (404 otherwise).
import '@/styles/m-partner-catalogue.css';
import { notFound } from 'next/navigation';
import { editorOptions, serviceEditor } from '@/lib/domain/views-partner-catalogue';
import { partnerActor } from '../../_catalogue/server';
import { ServiceEditor } from '../../_catalogue/ServiceEditor';
import { uploadServiceCoverAction } from '../actions';
import { archiveServiceAction, saveServiceAction, setServiceVisibilityAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Редактиране на услуга' };

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await partnerActor(`/partner/uslugi/${id}`);
  const s = await serviceEditor(actor, id);
  if (!s) notFound();
  const o = await editorOptions(actor);
  return (
    <div className="pc-page">
      <ServiceEditor key={`${s.id}-${s.status}`} mode={s.mode} serviceId={s.id} options={o} canPublish={o.canPublish}
        initial={{ ...s.values, coverUrl: s.coverUrl }}
        live={{
          status: s.status, statusLabel: s.statusLabel, name: s.liveName, kindLabel: s.liveKindLabel, category: s.liveCategory,
          price: s.livePrice, coverUrl: s.liveCoverUrl, bookings: s.bookings, inquiries: s.inquiries, activeSince: s.activeSince,
        }}
        revision={s.revision}
        saveAction={saveServiceAction.bind(null, s.id)}
        archiveAction={s.mode === 'archived' ? undefined : archiveServiceAction}
        visibilityAction={setServiceVisibilityAction.bind(null, s.id)}
        uploadAction={uploadServiceCoverAction} />
    </div>
  );
}
