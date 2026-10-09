// vendor/service-new.html → /partner/uslugi/nova (SCREENS §7)
import '@/styles/m-partner-catalogue.css';
import { editorOptions } from '@/lib/domain/views-partner-catalogue';
import { partnerActor } from '../../_catalogue/server';
import { ServiceEditor } from '../../_catalogue/ServiceEditor';
import { uploadServiceCoverAction } from '../actions';
import { createServiceAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Нова услуга' };

export default async function NewServicePage() {
  const actor = await partnerActor('/partner/uslugi/nova');
  const o = await editorOptions(actor);
  return (
    <div className="pc-page">
      <ServiceEditor mode="new" options={o} canPublish={o.canPublish} saveAction={createServiceAction} uploadAction={uploadServiceCoverAction}
        initial={{
          kind: 'package_fixed', name: '', categoryId: o.primaryCategoryId ?? o.categories[0]?.id ?? '', description: '', eventTypeIds: [], inclusions: [],
          priceCents: null, priceUnit: 'per_event', minGuests: null, durationLabel: '', extraHourEnabled: false, extraHourPriceCents: null,
          travelFeeEnabled: false, coverMediaId: null, coverUrl: null, showInProfile: true, acceptingRequests: true,
        }} />
    </div>
  );
}
