// Who is acting, and what they may do (SPEC §1). Every domain function takes
// an Actor; jobs and webhooks act as SYSTEM.
import { and, eq } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import { partnerMember, teamMember, type TeamRole, type UserRole } from '@/db/schema';

export type Actor = {
  userId: string;
  role: UserRole;
  /** Set for partner users: the one partner they act for (D52). */
  partnerId?: string | null;
  /** Set for admins with an active team_member row. */
  teamRole?: TeamRole | null;
};

/** Jobs, cron and provider webhooks. Logged in audit_log with actor_role = 'system'. */
export const SYSTEM = { userId: null, role: 'system' } as const;
export type SystemActor = typeof SYSTEM;
export type AnyActor = Actor | SystemActor;

export const isSystem = (a: AnyActor): a is SystemActor => a.role === 'system';

/** The permission matrix of SPEC §1.2 (admin/team.html „Какво може всяка роля“). */
export const TEAM_PERMISSIONS = [
  'approve_partners', 'moderate_listings', 'resolve_disputes', 'message_users', 'view_finance', 'release_payouts', 'manage_team_settings',
] as const;
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<TeamRole, readonly TeamPermission[]> = {
  admin: TEAM_PERMISSIONS,
  moderator: ['approve_partners', 'moderate_listings', 'resolve_disputes', 'message_users'],
  support: ['message_users'],
  accounting: ['view_finance'],
};

/** Actions outside the matrix (D39) and what they need. */
export type ExtraPermission =
  | 'invite_partner'          // ‹Покани изпълнител›: approve_partners
  | 'confirm_payout_account'  // view_finance
  | 'cancel_booking'          // team cancellation: resolve_disputes
  | 'block_client'            // ‹Блокирай профила›: admin, or moderator while a dispute is open on the booking
  | 'extend_payment_deadline';// ‹Удължи срока›: same rule as block_client
export type Permission = TeamPermission | ExtraPermission;

const EXTRA: Record<Exclude<ExtraPermission, 'block_client' | 'extend_payment_deadline'>, TeamPermission> = {
  invite_partner: 'approve_partners',
  confirm_payout_account: 'view_finance',
  cancel_booking: 'resolve_disputes',
};

/** Context for the permissions that depend on the record (D39). */
export type PermissionContext = { disputeOpen?: boolean };

/** Can this actor do this? Only team members (admins with an active team role) hold permissions. */
export function can(actor: AnyActor | null | undefined, permission: Permission, ctx: PermissionContext = {}): boolean {
  if (!actor || isSystem(actor) || actor.role !== 'admin' || !actor.teamRole) return false;
  const role = actor.teamRole;
  if (permission === 'block_client' || permission === 'extend_payment_deadline') {
    return role === 'admin' || (role === 'moderator' && !!ctx.disputeOpen);
  }
  const needed: TeamPermission = permission in EXTRA ? EXTRA[permission as keyof typeof EXTRA] : (permission as TeamPermission);
  return ROLE_PERMISSIONS[role].includes(needed);
}

export class ForbiddenError extends Error {
  constructor(public permission: string) { super(`Forbidden: ${permission}`); this.name = 'ForbiddenError'; }
}

export function assertCan(actor: AnyActor | null | undefined, permission: Permission, ctx?: PermissionContext): asserts actor is Actor {
  if (!can(actor, permission, ctx)) throw new ForbiddenError(permission);
}

/** Team roles holding a permission — e.g. the recipients of team emails (SPEC §11.5). */
export function teamRolesWith(permission: TeamPermission): TeamRole[] {
  return (Object.keys(ROLE_PERMISSIONS) as TeamRole[]).filter(r => ROLE_PERMISSIONS[r].includes(permission));
}

/** Build the Actor for a signed-in user (lib/session currentUser()): loads partnerId and the active team role. */
export async function actorFromUser(u: { id: string; role: UserRole }, q: Queryable = db): Promise<Actor> {
  if (u.role === 'partner') {
    const [m] = await q.select({ partnerId: partnerMember.partnerId }).from(partnerMember).where(eq(partnerMember.userId, u.id)).limit(1);
    return { userId: u.id, role: u.role, partnerId: m?.partnerId ?? null };
  }
  if (u.role === 'admin') {
    const [m] = await q.select({ role: teamMember.role }).from(teamMember)
      .where(and(eq(teamMember.userId, u.id), eq(teamMember.status, 'active'))).limit(1);
    return { userId: u.id, role: u.role, teamRole: m?.role ?? null };
  }
  return { userId: u.id, role: u.role };
}
