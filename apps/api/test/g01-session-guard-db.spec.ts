import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { deriveSessionCsrf } from '../src/modules/identity/auth-security';

jest.setTimeout(180_000);

describe('G01: real PostgreSQL session generation and CSRF boundaries', () => {
  it('rejects stale browser tabs, wrong CSRF, revocation, absolute expiry and idle expiry', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const userId=uuidv7(), orgId=uuidv7(), sessionId=uuidv7();
      const generation=uuidv7(), rawToken='g01-session-' + uuidv7();
      const csrf=deriveSessionCsrf(rawToken,generation);
      await admin.query(
        `INSERT INTO users(id,name,status) VALUES($1,'Auth Test Member','ACTIVE')`,
        [userId],
      );
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state,status)
           VALUES($1,'G01 Session Org','G01 Session Org','KA','ACTIVE')`,
        [orgId],
      );
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status)
          VALUES($1,$2,$3,'R-PM','ACTIVE')`,
        [uuidv7(),orgId,userId],
      );
      await admin.query(
        `INSERT INTO sessions
          (id,user_id,active_org_id,token_hash,csrf_token_hash,auth_generation,expires_at,absolute_expires_at)
          VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days',now()+interval '90 days')`,
        [sessionId,userId,orgId,createHash('sha256').update(rawToken).digest('hex'),
          createHash('sha256').update(csrf).digest('hex'),generation],
      );
      const guard=new SessionCsrfGuard(app);
      function request(overrides: any = {}) {
        return {
          cookies:{tc_session:rawToken},
          headers:{
            'x-csrf-token':csrf, 'x-auth-generation':generation,
            'user-agent':'G01-session-integration',
            ...overrides.headers,
          },
          method:'POST',path:'/api/v1/projects',params:{},ip:'127.0.0.1',
          ...Object.fromEntries(Object.entries(overrides).filter(([k])=>k!=='headers')),
        };
      }
      const evaluate=(req: any) => guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as any);
      const valid=request();
      await expect(evaluate(valid)).resolves.toBe(true);
      expect(valid).toMatchObject({
        userContext: {userId,orgId,actorType:'USER',orgRole:'R-PM'},
      });

      await admin.query(
        `UPDATE sessions SET last_activity_at=now()-interval '10 minutes' WHERE id=$1`,
        [sessionId],
      );
      const idleBefore=(await admin.query(
        'SELECT last_activity_at FROM sessions WHERE id=$1',[sessionId])).rows[0].last_activity_at;
      await expect(evaluate(request({headers:{
        'x-auth-generation':uuidv7(),
      }}))).rejects.toThrow(ConflictException);

      await expect(evaluate(request({headers:{
        'x-csrf-token':'wrong-token',
      }}))).rejects.toThrow(ForbiddenException);
      const sessionDenials=(await admin.query(
        `SELECT reason_code,source_digest,actor_user_id
           FROM auth_security_events
          WHERE event_type='AUTH_SESSION_DENIED'
            AND session_id=$1 ORDER BY occurred_at ASC`,[sessionId],
      )).rows;
      expect(sessionDenials.map(e=>e.reason_code)).toEqual(
        expect.arrayContaining(['AUTH_CONTEXT_CHANGED','CSRF_INVALID']),
      );
      for(const ev of sessionDenials){
        expect(ev.actor_user_id).toBe(userId);
        expect(ev.source_digest).toMatch(/^[0-9a-f]{64}$/);
      }
            const idleAfterDenials=(await admin.query(
        'SELECT last_activity_at FROM sessions WHERE id=$1',[sessionId])).rows[0].last_activity_at;
      expect(idleAfterDenials.getTime()).toBe(idleBefore.getTime());
      await expect(evaluate(request())).resolves.toBe(true);
      const idleAfterSuccess=(await admin.query(
        'SELECT last_activity_at FROM sessions WHERE id=$1',[sessionId])).rows[0].last_activity_at;
      expect(idleAfterSuccess.getTime()).toBeGreaterThan(idleBefore.getTime());

      await admin.query(
        `UPDATE sessions SET last_activity_at=now()-interval '31 days',
          expires_at=now()+interval '1 day' WHERE id=$1`,
        [sessionId],
      );
      await expect(evaluate(request())).rejects.toThrow(UnauthorizedException);

      await admin.query(
        `UPDATE sessions SET last_activity_at=now(),
          expires_at=now()+interval '1 day',
          absolute_expires_at=now()-interval '1 minute' WHERE id=$1`,
        [sessionId],
      );
      await expect(evaluate(request())).rejects.toThrow(UnauthorizedException);

      await admin.query(
        `UPDATE sessions SET absolute_expires_at=now()+interval '1 day',
          revoked_at=now() WHERE id=$1`,
        [sessionId],
      );
      await expect(evaluate(request())).rejects.toThrow(UnauthorizedException);
    });
  });
});
