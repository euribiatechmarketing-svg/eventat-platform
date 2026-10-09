// ‹Изпратете запитване› (client/request.html → SCREENS §5 /zayavka/[partnerSlug]?paket=&sabitie-id=&data=&gosti=).
import { notFound } from 'next/navigation';
import { Crumbs } from '@/components/client-booking/parts';
import { RequestForm } from '@/components/client-booking/RequestForm';
import { now } from '@/lib/clock';
import { requestFormData } from '@/lib/domain/views-client-booking';
import { sofiaDate } from '@/lib/format';
import { one, requireClient, withQuery } from '@/lib/client-booking/guard';
import { sendRequestAction, uploadRequestPhotoAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Изпратете запитване' };

export default async function RequestFormPage({ params, searchParams }: {
  params: Promise<{ partnerSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { partnerSlug } = await params;
  const sp = await searchParams;
  const { actor } = await requireClient(withQuery(`/zayavka/${partnerSlug}`, sp), 'registratsiya');
  const v = await requestFormData(actor, partnerSlug, {
    paket: one(sp.paket), sabitieId: one(sp['sabitie-id']), data: one(sp.data), gosti: one(sp.gosti), sabitie: one(sp.sabitie),
  });
  if (!v || !v.acceptingRequests || !v.services.length) notFound();

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: 'Каталог', href: '/tarsene' }, { label: v.partner.name, href: `/partnyori/${v.partner.slug}` }, { label: 'Запитване' }]} />
      <div className="h-row"><div><h1 className="h-page">Изпратете запитване</h1><p className="h-sub">Изпълнителят отговаря до {v.responseHours} часа. Плащате само ако заявката бъде одобрена.</p></div></div>

      <div className="steps">
        <div className="step is-on" aria-current="step"><span className="step-n">1</span><span className="step-t">Детайли за събитието</span></div>
        <span className="step-line" />
        <div className="step"><span className="step-n">2</span><span className="step-t">Преглед</span></div>
        <span className="step-line" />
        <div className="step"><span className="step-n">3</span><span className="step-t">Изпратено</span></div>
      </div>

      <RequestForm partner={v.partner} slug={v.partner.slug} services={v.services} types={v.types} prefill={v.prefill} phone={v.phone}
        today={sofiaDate(await now())} maxGuests={v.maxGuests} dateTaken={v.dateTaken} maxPhotos={v.maxPhotos} maxMb={v.maxMb}
        action={sendRequestAction} upload={uploadRequestPhotoAction} />
    </div>
  );
}
