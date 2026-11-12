import { PoolClient } from 'pg';

/**
 * Session guard results may become stale while a command waits for a DB
 * connection. This fence must run *inside* the protected transaction, after
 * setting the RLS org/user context and before executing the command callback.
 *
 * Rows are share-locked in a consistent order so a concurrent offboarding,
 * org suspension, session revocation or role downgrade cannot commit midway
 * through a command whose authority was checked earlier.
 *
 * Only a verified HTTP context supplies sessionId. Internal workers/system
 * jobs intentionally have no browser session and are not authenticated here.
 * This is not a substitute for command-specific resource/permission checks.
 */
export interface LiveSessionFenceContext {
  orgId: string;
  userId: string;
  actorType: 'USER' | 'MEMBER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  sessionId?: string;
  orgRole?: string;
  guestGrantId?: string;
}

/** Coded, non-secret authorization denial consumed by the API error filter. */
export class LiveSessionAuthorityChangedError extends Error {
  readonly code = 'AUTH_SESSION_CONTEXT_CHANGED';

  constructor() {
    super('AUTH_SESSION_CONTEXT_CHANGED');
    this.name = 'LiveSessionAuthorityChangedError';
  }
}

const changed = (): never => {
  // Do not reveal whether the user, organisation, session, membership, guest
  // grant or issuing party was suspended. Caller must re-authenticate.
  throw new LiveSessionAuthorityChangedError();
};

export async function assertLiveSessionEligibleInTransaction(
  client: PoolClient,
  ctx: LiveSessionFenceContext,
): Promise<void> {
  if (!ctx.sessionId) return;
  if (!['USER', 'MEMBER', 'GUEST'].includes(ctx.actorType) ||
      !ctx.userId || !ctx.orgId) changed();

  const user = await client.query(
    "SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE",
    [ctx.userId],
  );
  if (user.rows.length !== 1) changed();

  const org = await client.query(
    "SELECT id FROM organisations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
    [ctx.orgId],
  );
  if (org.rows.length !== 1) changed();

  const session = await client.query(
    `SELECT guest_grant_id FROM sessions
      WHERE id=$1 AND user_id=$2 AND active_org_id=$3
        AND revoked_at IS NULL AND expires_at>now()
      FOR SHARE`,
    [ctx.sessionId, ctx.userId, ctx.orgId],
  );
  if (session.rows.length !== 1) changed();

  if (ctx.actorType === 'GUEST') {
    if (!ctx.guestGrantId ||
        session.rows[0].guest_grant_id !== ctx.guestGrantId) changed();
    const grant = await client.query(
      `SELECT party_id, project_id FROM guest_grants
        WHERE org_id=$1 AND id=$2
          AND status='ACTIVE' AND expires_at>now()
        FOR SHARE`,
      [ctx.orgId, ctx.guestGrantId],
    );
    if (grant.rows.length !== 1) changed();
    // A previously valid grant is not sufficient when the issuing supplier
    // party has been archived or the linked project has been closed. Lock the
    // actual parent records too; do not rely on a stale guard snapshot.
    const party = await client.query(
      `SELECT id FROM parties WHERE org_id=$1 AND id=$2
         AND status='ACTIVE' AND deleted_at IS NULL FOR SHARE`,
      [ctx.orgId, grant.rows[0].party_id],
    );
    if (party.rows.length !== 1) changed();
    const project = await client.query(
      `SELECT id FROM projects WHERE org_id=$1 AND id=$2
         AND status IN ('ACTIVE','HANDOVER') FOR SHARE`,
      [ctx.orgId, grant.rows[0].project_id],
    );
    if (project.rows.length !== 1) changed();
    // Guest document/asset/requirement links still require resource-specific
    // scope checks; this fence does not confer project-wide authority.
    return;
  }
  if (session.rows[0].guest_grant_id != null) changed();
  const membership = await client.query(
    `SELECT role FROM memberships
      WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE`,
    [ctx.orgId, ctx.userId],
  );
  if (membership.rows.length !== 1 ||
      (ctx.orgRole != null && membership.rows[0].role !== ctx.orgRole)) changed();
}
