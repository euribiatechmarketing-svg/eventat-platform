// ‹Опишете събитието си› (client/brief.html → SCREENS §5 /zayavka/otvorena?cat=&type=&city=&date=&guests=).
import { BriefForm } from '@/components/client-booking/BriefForm';
import { Crumbs } from '@/components/client-booking/parts';
import { now } from '@/lib/clock';
import { BUDGET_OPTIONS, briefFormData } from '@/lib/domain/views-client-booking';
import { sofiaDate } from '@/lib/format';
import { one, requireClient, withQuery } from '@/lib/client-booking/guard';
import { sendBriefAction, uploadBriefPhotoAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Опишете събитието си' };

export default async function BriefPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { actor } = await requireClient(withQuery('/zayavka/otvorena', sp), 'registratsiya');
  const v = await briefFormData(actor, { cat: one(sp.cat), type: one(sp.type), city: one(sp.city), date: one(sp.date), guests: one(sp.guests) });

  return (
    <div className="hold hold--narrow">
      <Crumbs items={[{ label: 'Каталог', href: '/tarsene' }, { label: 'Запитване до изпълнителите' }]} />
      <div className="h-row"><div><h1 className="h-page">Опишете събитието си</h1><p className="h-sub">Изпращаме описанието до свободните изпълнители, които отговарят на него. Те ви отговарят с оферта до {v.offerHours} часа.</p></div></div>
      <BriefForm categories={v.categories} types={v.types} cities={v.cities} budgets={BUDGET_OPTIONS} prefill={v.prefill} phone={v.phone}
        today={sofiaDate(await now())} maxPhotos={v.maxPhotos} maxMb={v.maxMb} action={sendBriefAction} upload={uploadBriefPhotoAction} />
    </div>
  );
}
