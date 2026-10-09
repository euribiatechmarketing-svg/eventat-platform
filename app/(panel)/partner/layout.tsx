// Partner panel chrome + guard (SCREENS §1, §0 guard "partner"). Onboarding lives in app/(wizard).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { partnerChrome, partnerRailCount } from '@/lib/domain/views-panel';
import { bellItems } from '@/lib/bell';
import { PanelShell, type RailGroup } from '@/components/panel/PanelShell';
import { readFlash } from '@/lib/flash';
import { FlashAgain, TopbarLang, TopbarSearch } from './_ops/ui';
import '@/styles/m-partner-ops.css';

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('partner', '/partner');
  const p = await partnerChrome(user.id);
  if (!p) redirect('/registratsiya?as=partner');
  if (p.status === 'draft' || p.status === 'returned') redirect(`/partner/registratsiya/${p.onboardingStep ?? 1}`);
  if (p.status === 'submitted' || p.status === 'rejected') redirect('/partner/registratsiya/podadeno');
  const actor = await actorFromUser(user);
  const pending = await partnerRailCount(actor);
  const flash = await readFlash();
  const groups: RailGroup[] = [
    { label: 'Партньорски панел', items: [
      { label: 'Табло', href: '/partner', icon: 'dashboard' },
      { label: 'Заявки', href: '/partner/zayavki', icon: 'inbox', count: pending },
      { label: 'Календар', href: '/partner/kalendar', icon: 'calendar' },
      { label: 'Услуги и пакети', href: '/partner/uslugi', icon: 'layers' },
      { label: 'Резервации', href: '/partner/rezervacii', icon: 'booking' },
      { label: 'Приходи', href: '/partner/prihodi', icon: 'wallet' },
    ] },
    { label: 'Акаунт', items: [
      { label: 'Публичен профил', href: '/partner/profil', icon: 'user' },
      { label: 'Ревюта', href: '/partner/revyuta', icon: 'star' },
      { label: 'Настройки', href: '/partner/nastroyki', icon: 'settings' },
    ] },
  ];
  return (
    <PanelShell area="partner" groups={groups}
      aliases={{ '/partner/poddrazhka': '/partner/rezervacii' }}
      titles={{ '/partner/uslugi/nova': 'Нова услуга', '/partner/poddrazhka/nov': 'Сигнал до екипа', '/partner/kalendar': 'Календар и наличност', '/partner/saobshteniya': 'Съобщения', '/partner/poddrazhka': 'Поддръжка', '/partner/smetka': 'Сметка за изплащане', '/partner/tarsene': 'Търсене', '/partner/zapitvaniya': 'Запитвания' }}
      userName={p.businessName} userRole={p.categoryName ?? ''} avatarUrl={p.avatarUrl}
      menu={[
        { label: 'Съобщения', href: '/partner/saobshteniya' },
        { label: 'Поддръжка', href: '/partner/poddrazhka' },
        { label: 'Настройки', href: '/partner/nastroyki' },
        { label: 'Виж профила като клиент', href: `/partnyori/${p.slug}` },
      ]}
      topbarExtra={<><TopbarSearch /><TopbarLang /></>}
      bell={await bellItems(user.id)}>
      {children}
      <FlashAgain message={flash?.message ?? null} kind={flash?.kind} nonce={randomUUID()} />
    </PanelShell>
  );
}
