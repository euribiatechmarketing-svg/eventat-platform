import 'server-only';
// Read models for the partner and admin panel chrome (rail counters, user card, admin bell).
import { and, asc, count, eq, inArray, sum } from 'drizzle-orm';
import { db } from '@/db';
import { partner, partnerMember, category, media, serviceRevision, dispute, payoutBatch } from '@/db/schema';
import { panelCounts } from './partners';
import { mediaUrl } from './catalogue-kit';
import type { Actor } from './actor';
import { can } from './actor';
import { date, moneyShort, plural } from '@/lib/format';
import type { BellItem } from '@/components/ui/Bell';

export const TEAM_ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор', moderator: 'Модератор', support: 'Поддръжка', accounting: 'Счетоводство',
};

export async function partnerChrome(userId: string) {
  const [row] = await db
    .select({
      id: partner.id, slug: partner.slug, status: partner.status, onboardingStep: partner.onboardingStep,
      businessName: partner.businessName, categoryName: category.name, avatarKey: media.storageKey,
    })
    .from(partnerMember)
    .innerJoin(partner, eq(partner.id, partnerMember.partnerId))
    .leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .leftJoin(media, eq(media.id, partner.avatarMediaId))
    .where(eq(partnerMember.userId, userId))
    .limit(1);
  return row ? { ...row, avatarUrl: mediaUrl(row.avatarKey) } : null;
}

export async function partnerRailCount(actor: Actor): Promise<number> {
  return (await panelCounts(actor)).newRequests;
}

export async function adminRailCounts() {
  const [[{ n: partners }], [{ n: revisions }], [{ n: disputes }]] = await Promise.all([
    db.select({ n: count() }).from(partner).where(eq(partner.status, 'submitted')),
    db.select({ n: count() }).from(serviceRevision).where(eq(serviceRevision.status, 'pending')),
    db.select({ n: count() }).from(dispute).where(inArray(dispute.status, ['collecting', 'awaiting_decision'])),
  ]);
  return { partners, revisions, disputes };
}

/** Admin bell (SPEC §4 bell rule, D54): computed attention items, not stored. */
export async function adminBell(actor: Actor): Promise<BellItem[]> {
  const items: BellItem[] = [];
  const pending = await db.select({ id: partner.id, name: partner.businessName, at: partner.submittedAt })
    .from(partner).where(eq(partner.status, 'submitted')).orderBy(asc(partner.submittedAt)).limit(1);
  const [{ n: pendingCount }] = await db.select({ n: count() }).from(partner).where(eq(partner.status, 'submitted'));
  if (pending[0] && can(actor, 'approve_partners'))
    items.push({ id: 'partners', title: `${plural(pendingCount, 'изпълнител чака', 'изпълнители чакат')} одобрение`, body: pending[0].at ? `Най-старата заявка: ${pending[0].name} · ${date(pending[0].at)}` : pending[0].name, href: '/admin/partnyori', unread: true });
  const [open] = await db.select({ n: count(), held: sum(dispute.heldCents) }).from(dispute).where(inArray(dispute.status, ['collecting', 'awaiting_decision']));
  if (open.n > 0 && can(actor, 'resolve_disputes'))
    items.push({ id: 'disputes', title: `${plural(open.n, 'отворен спор', 'отворени спора')}`, body: `${moneyShort(Number(open.held ?? 0))} задържани`, href: '/admin/sporove', unread: true });
  const [batch] = await db.select().from(payoutBatch).where(inArray(payoutBatch.status, ['scheduled', 'ready'])).orderBy(asc(payoutBatch.batchDate)).limit(1);
  if (batch && can(actor, 'view_finance'))
    items.push({ id: 'batch', title: `Партида ${date(batch.batchDate)}`, body: `${plural(batch.partnerCount ?? 0, 'изпълнител', 'изпълнители')} · ${moneyShort(batch.netCents ?? 0)}`, href: '/admin/plashtaniya', unread: false });
  return items;
}

export { and };
