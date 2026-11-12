import type { PoolClient } from 'pg';

/**
 * PH1-G01-004 / PH1-G26-004: same-transaction authority revalidation.
 * Query in stable lock order: account, organisation, membership/grant, session.
 * Hold FOR SHARE until COMMIT so a concurrent suspension, demotion, grant
 * revocation or session termination cannot overtake an admitted mutation.
 *
 * This is deliberately limited to authenticated browser transactions. Native
 * system work and pre-auth flows have separate, reviewed entry points; no
 * missing session may be silently interpreted as a browser identity.
 */
export async function assertCurrentSessionEligibility(client: PoolClient, ctx: {
  orgId: string;
  userId: string;
  actorType: 'MEMBER' | 'USER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  sessionId?: string;
  authGeneration?: string;
  /** Server-selected initial project lock mode; never read from request JSON. */
  projectWrite?: boolean;
  orgRole?: string;
  guestGrantId?: string;
  projectId?: string;
  organisationWrite?: boolean;
}): Promise<void> {
  if (!ctx.sessionId && !ctx.authGeneration) return;
  if (!ctx.sessionId || !ctx.authGeneration) {
    throw new Error('AUTH_SESSION_CONTEXT_INCOMPLETE');
  }

  const account = await client.query<{status:string}>(
    `SELECT status FROM users WHERE id=$1 FOR SHARE`, [ctx.userId],
  );
  if (account.rows[0]?.status !== 'ACTIVE') throw new Error('AUTH_ACCOUNT_INACTIVE');

  const organisation = await client.query<{status:string}>(
    `SELECT status FROM organisations WHERE id=$1 FOR ${ctx.organisationWrite ? 'UPDATE' : 'SHARE'}`, [ctx.orgId],
  );
  if (organisation.rows[0]?.status !== 'ACTIVE') throw new Error('AUTH_ORGANISATION_INACTIVE');

  const guest = ctx.actorType === 'GUEST' || !!ctx.guestGrantId;
  if (guest) {
    if (!ctx.guestGrantId) throw new Error('AUTH_GUEST_GRANT_INACTIVE');
    const {rows} = await client.query<{
      project_id:string;grant_type:string;party_id:string;
      client_party_id:string|null;consultant_party_id:string|null;
    }>(
      `SELECT g.project_id,g.grant_type,g.party_id,p.client_party_id,p.consultant_party_id
         FROM guest_grants g
         JOIN projects p ON p.org_id=g.org_id AND p.id=g.project_id
         JOIN parties pt ON pt.org_id=g.org_id AND pt.id=g.party_id
        WHERE g.org_id=$1 AND g.id=$2 AND g.principal_user_id=$3
          AND g.status='ACTIVE' AND g.expires_at>now()
          AND p.status NOT IN ('CANCELLED','ARCHIVED') AND pt.status='ACTIVE'
        FOR SHARE OF g,pt ${ctx.projectWrite?'FOR UPDATE':'FOR SHARE'} OF p`,
      [ctx.orgId,ctx.guestGrantId,ctx.userId],
    );
    const grant=rows[0];
    if (!grant || (ctx.projectId && ctx.projectId !== grant.project_id) ||
        (grant.grant_type === 'CLIENT_VIEW' && grant.party_id !== grant.client_party_id) ||
        (grant.grant_type === 'CONSULTANT_REVIEW' && grant.party_id !== grant.consultant_party_id)) {
      throw new Error('AUTH_GUEST_GRANT_INACTIVE');
    }
  } else {
    const {rows} = await client.query<{role:string}>(
      `SELECT role FROM memberships
        WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE'
        FOR SHARE`, [ctx.orgId,ctx.userId],
    );
    if (!rows.length) throw new Error('AUTH_MEMBERSHIP_INACTIVE');
    if (ctx.orgRole && rows[0].role !== ctx.orgRole) {
      throw new Error('AUTH_ORG_ROLE_CHANGED');
    }
  }

  const {rows:sessions} = await client.query<{guest_grant_id:string|null}>(
    `SELECT guest_grant_id FROM sessions
      WHERE id=$1 AND user_id=$2 AND active_org_id=$3 AND auth_generation=$4
        AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now()
      FOR SHARE`,
    [ctx.sessionId,ctx.userId,ctx.orgId,ctx.authGeneration],
  );
  const actualGrant=sessions[0]?.guest_grant_id ?? null;
  if (!sessions.length ||
      (guest && actualGrant !== ctx.guestGrantId) ||
      (!guest && actualGrant !== null)) {
    throw new Error('AUTH_SESSION_CONTEXT_CHANGED');
  }
}
