// audit_log writes (CLAUDE.md rule 7: admin actions and money moves). Call it
// inside the same DB transaction as the change it records.
import type { Queryable } from '@/db';
import { auditLog } from '@/db/schema';
import { now } from '@/lib/clock';
import { isSystem, type AnyActor } from './actor';

export type AuditEntry = {
  actor: AnyActor;
  /** Dotted verb: `partner.approved`, `booking.cancelled`, `payout.batch_released`, `settings.changed`. */
  action: string;
  /** Table / aggregate name: `partner`, `booking`, `payout_batch`, `platform_settings`. */
  entity: string;
  entityId: string;
  data?: Record<string, unknown>;
};

export async function audit(tx: Queryable, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: isSystem(e.actor) ? null : e.actor.userId,
    actorRole: e.actor.role,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    data: e.data ?? {},
    createdAt: await now(),
  });
}
