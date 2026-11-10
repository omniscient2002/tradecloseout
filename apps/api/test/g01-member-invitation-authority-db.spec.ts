import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';

jest.setTimeout(180_000);
describe('G01 membership privilege escalation and invitation validity', () => {
  it('forbids admins and owners minting R-OWNER via ordinary member or invitation changes', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const org=uuidv7(),owner=uuidv7(),administrator=uuidv7(),member=uuidv7();
      const names=[[owner,'Owner','R-OWNER'],[administrator,'Administrator','R-ADMIN'],[member,'Member','R-SITE']] as const;
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
        VALUES($1,'G01 Membership','G01 Membership','KA','ACTIVE')`,[org]);
      for(const [id,name,role] of names) {
        await admin.query('INSERT INTO users(id,name,status) VALUES($1,$2,$3)',[id,name,'ACTIVE']);
        await admin.query(`INSERT INTO memberships(id,user_id,org_id,role,status)
          VALUES($1,$2,$3,$4,'ACTIVE')`,[uuidv7(),id,org,role]);
      }
      const service=new OrganisationsService(app);
      const ctx=(actor:string,orgRole:string):any=>({
        orgId:org,userId:actor,orgRole,actorType:'MEMBER',
        requestId:'g01-role-change',ip:'127.0.0.1',userAgent:'g01-db-test',
      });
      await expect(service.createInvitation(ctx(owner,'R-OWNER'),org,
        {email:'new-owner@g01.example',role:'R-OWNER'})).rejects.toMatchObject({
          response:expect.objectContaining({code:'INVALID_INVITATION_ROLE'}),
        });
      await expect(service.createInvitation(ctx(administrator,'R-ADMIN'),org,
        {email:'new-admin@g01.example',role:'R-ADMIN'})).rejects.toMatchObject({
          response:expect.objectContaining({code:'INVITATION_ROLE_EXCEEDS_ISSUER'}),
        });
      await expect(service.createInvitation(ctx(administrator,'R-ADMIN'),org,
        {email:null as any,role:'R-SITE'})).rejects.toMatchObject({
          response:expect.objectContaining({code:'INVALID_INVITATION_INPUT'}),
        });
      await expect(service.updateMemberRole(ctx(administrator,'R-ADMIN'),org,
        administrator,{role:'R-OWNER'})).rejects.toMatchObject({
          response:expect.objectContaining({code:'OWNER_ROLE_REQUIRES_TRANSFER'}),
        });
      await expect(service.updateMemberRole(ctx(administrator,'R-ADMIN'),org,
        owner,{role:'R-SITE'})).rejects.toMatchObject({
          response:expect.objectContaining({code:'PROTECTED_MEMBER_ROLE_CHANGE'}),
        });
      await expect(service.updateMemberRole(ctx(administrator,'R-ADMIN'),org,
        member,{role:'R-ADMIN'})).rejects.toMatchObject({
          response:expect.objectContaining({code:'MEMBER_ROLE_CHANGE_NOT_AUTHORIZED'}),
        });
      const invite=await service.createInvitation(ctx(owner,'R-OWNER'),org,
        {email:'valid-admin@g01.example',role:'R-ADMIN'});
      expect(invite.invitationToken).toMatch(/^[a-f0-9]{64}$/);
      const reissued=await service.createInvitation(ctx(owner,'R-OWNER'),org,
        {email:'valid-admin@g01.example',role:'R-SITE'});
      expect(reissued.invitationToken).not.toBe(invite.invitationToken);
      expect((await admin.query(
        'SELECT status FROM invitations WHERE id=$1',[invite.id],
      )).rows[0].status).toBe('REVOKED');
      expect((await admin.query(
        'SELECT status FROM invitations WHERE id=$1',[reissued.id],
      )).rows[0].status).toBe('PENDING');
      expect((await admin.query(
        `SELECT count(*)::int AS n FROM invitations
           WHERE org_id=$1 AND email=$2 AND status='PENDING'`,
        [org,'valid-admin@g01.example'],
      )).rows[0].n).toBe(1);
      const sessionIds=new Map<string,string>();
      for(const uid of [owner,administrator,member]){
        const id=uuidv7();
        sessionIds.set(uid,id);
        await admin.query(
          `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,
            expires_at,mfa_verified,mfa_verified_at)
           VALUES($1,$2,$3,$4,$5,now()+interval '1 day',true,now())`,
          [id,uid,org,uid.replace(/-/g,''), 'c'.repeat(64)],
        );
      }
      await expect(service.transferOwnership(ctx(owner,'R-OWNER'),owner))
        .rejects.toMatchObject({
          response:expect.objectContaining({code:'OWNER_TRANSFER_REQUIRES_DIFFERENT_MEMBER'}),
        });
      await expect(service.transferOwnership(ctx(owner,'R-OWNER'),'not-a-uuid'))
        .rejects.toMatchObject({
          response:expect.objectContaining({code:'INVALID_TARGET_OWNER'}),
        });

      const assigned=await service.updateMemberRole(ctx(owner,'R-OWNER'),org,
        member,{role:'R-PM'});
      expect((await admin.query(
        'SELECT revoked_at,mfa_verified FROM sessions WHERE id=$1',
        [sessionIds.get(member)],
      )).rows[0]).toMatchObject({
        revoked_at:expect.any(Date),mfa_verified:false,
      });
      const unaffected=await admin.query(
        'SELECT revoked_at FROM sessions WHERE id=ANY($1::uuid[])',
        [[sessionIds.get(owner),sessionIds.get(administrator)]],
      );
      expect(unaffected.rows.every(row=>row.revoked_at===null)).toBe(true);
      expect((await admin.query(
        `SELECT COUNT(*)::int AS count FROM auth_security_events
         WHERE actor_user_id=$1 AND event_type='MEMBER_ROLE_CHANGED_SESSION_REVOKED'`,
        [member],
      )).rows[0].count).toBe(1);
      expect(assigned.role).toBe('R-PM');
      const roles=(await admin.query(
        `SELECT user_id,role FROM memberships WHERE org_id=$1`,[org])).rows;
      expect(roles.find(x=>x.user_id===owner).role).toBe('R-OWNER');
      expect(roles.find(x=>x.user_id===administrator).role).toBe('R-ADMIN');
      expect(roles.find(x=>x.user_id===member).role).toBe('R-PM');
      expect((await admin.query(
        `SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='R-OWNER'`,
        [org])).rows[0].n).toBe(1);
      const ownerOnlyInvite=await service.createInvitation(ctx(owner,'R-OWNER'),org,{
        email:'elevated-admin@g01.example',role:'R-ADMIN',
      });
      expect((await admin.query(
        'SELECT status FROM invitations WHERE id=$1',[ownerOnlyInvite.id],
      )).rows[0].status).toBe('PENDING');
      const transferred=await service.transferOwnership(ctx(owner,'R-OWNER'),administrator);
      expect(transferred).toMatchObject({
        previousOwnerUserId:owner,newOwnerUserId:administrator,
      });
      const afterTransfer=(await admin.query(
        'SELECT user_id,role FROM memberships WHERE org_id=$1',[org],
      )).rows;
      expect(afterTransfer.find(row=>row.user_id===owner).role).toBe('R-ADMIN');
      expect(afterTransfer.find(row=>row.user_id===administrator).role).toBe('R-OWNER');
      expect((await admin.query(
        'SELECT status FROM invitations WHERE id=$1',[ownerOnlyInvite.id],
      )).rows[0].status).toBe('REVOKED');
      expect((await admin.query(
        'SELECT status FROM invitations WHERE id=$1',[reissued.id],
      )).rows[0].status).toBe('PENDING');
      const adminIssued=await service.createInvitation(ctx(owner,'R-ADMIN'),org,{
        email:'from-admin@g01.example',role:'R-PM',
      });
      await service.updateMemberRole(ctx(administrator,'R-OWNER'),org,
        owner,{role:'R-PM'});
      expect((await admin.query(
        'SELECT status FROM invitations WHERE id=$1',[adminIssued.id],
      )).rows[0].status).toBe('REVOKED');
      expect((await admin.query(
        'SELECT user_id,revoked_at,mfa_verified FROM sessions WHERE id=ANY($1::uuid[])',
        [[sessionIds.get(owner),sessionIds.get(administrator)]],
      )).rows).toEqual(expect.arrayContaining([
        expect.objectContaining({user_id:owner,revoked_at:expect.any(Date),mfa_verified:false}),
        expect.objectContaining({user_id:administrator,revoked_at:expect.any(Date),mfa_verified:false}),
      ]));
      expect((await admin.query(
        `SELECT COUNT(*)::int AS count FROM auth_security_events
         WHERE event_type='OWNERSHIP_TRANSFER_SESSION_REVOKED' AND org_id=$1`,
        [org],
      )).rows[0].count).toBe(2);
    });
  });
  it('sends identity-bound link to target email, hides raw token and revokes uncertain delivery',async()=>{
    const oldNodeEnv=process.env.NODE_ENV;
    const oldFrontend=process.env.FRONTEND_URL;
    process.env.NODE_ENV='production';
    process.env.FRONTEND_URL='https://app.g01.example';
    try {
      await withDisposableDatabase(async ({admin,app})=>{
        const org=uuidv7(),owner=uuidv7();
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Issuer','ACTIVE')",[owner]);
        await admin.query(
          `INSERT INTO organisations(id,legal_name,display_name,state,status)
            VALUES($1,'Invitation Delivery','Invitation Delivery','KA','ACTIVE')`,
          [org],
        );
        await admin.query(
          `INSERT INTO memberships(id,org_id,user_id,role,status)
            VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,
          [uuidv7(),org,owner],
        );
        const issuer:any={orgId:org,userId:owner,orgRole:'R-OWNER',
          actorType:'MEMBER',requestId:'g01-mail-delivery',
          ip:'127.0.0.1',userAgent:'g01-test'};
        const gateway={
          sendMagicLinkEmail:jest.fn().mockResolvedValue(undefined),
        };
        const service=new OrganisationsService(app,gateway as any);
        const invite=await service.createInvitation(issuer,org,{
          email:'recipient@g01.example',role:'R-SITE',
        });
        expect(invite.deliveryStatus).toBe('SENT');
        expect(invite).not.toHaveProperty('invitationToken');
        expect(gateway.sendMagicLinkEmail).toHaveBeenCalledTimes(1);
        const [to,url]=gateway.sendMagicLinkEmail.mock.calls[0];
        expect(to).toBe('recipient@g01.example');
        const parsed=new URL(url);
        expect(parsed.origin).toBe('https://app.g01.example');
        expect(parsed.pathname).toBe('/login');
        const token=parsed.searchParams.get('invite');
        expect(token).toMatch(/^[a-f0-9]{64}$/);
        expect((await admin.query(
          'SELECT status FROM invitations WHERE id=$1',[invite.id],
        )).rows[0].status).toBe('PENDING');

        // The link cannot be used while email submission is in flight.
        // A second issuance supersedes it atomically, even if the earlier
        // gateway eventually acknowledges its stale message.
        let startDelivery!: () => void;
        let completeDelivery!: () => void;
        const started = new Promise<void>(resolve => {startDelivery=resolve;});
        const delayed = new Promise<void>(resolve => {completeDelivery=resolve;});
        gateway.sendMagicLinkEmail.mockImplementationOnce(async()=>{
          startDelivery();
          await delayed;
        });
        const slow=service.createInvitation(issuer,org,{
          email:'parallel@g01.example',role:'R-SITE',
        });
        await started;
        const pending=(await admin.query(
          'SELECT id,status,token_hash FROM invitations WHERE org_id=$1 AND email=$2',
          [org,'parallel@g01.example'],
        )).rows[0];
        expect(pending.status).toBe('DELIVERY_PENDING');
        expect((await admin.query(
          `SELECT count(*)::int AS n FROM invitations
           WHERE org_id=$1 AND email=$2 AND status='PENDING'`,
          [org,'parallel@g01.example'],
        )).rows[0].n).toBe(0);

        const newer=await service.createInvitation(issuer,org,{
          email:'parallel@g01.example',role:'R-SITE',
        });
        expect(newer.status).toBe('PENDING');
        completeDelivery();
        await expect(slow).rejects.toMatchObject({
          response:expect.objectContaining({code:'INVITATION_SUPERSEDED_DURING_DELIVERY'}),
        });
        expect((await admin.query('SELECT status FROM invitations WHERE id=$1',
          [pending.id])).rows[0].status).toBe('REVOKED');
        expect((await admin.query(
          `SELECT count(*)::int AS n FROM invitations
             WHERE org_id=$1 AND email=$2 AND status='PENDING'`,
          [org,'parallel@g01.example'],
        )).rows[0].n).toBe(1);

        // An in-flight administrator-issued invitation cannot activate
        // after the issuing administrator loses the required membership
        // authority, even if the provider later reports success.
        const adminUser=uuidv7();
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Inviting Admin','ACTIVE')",[adminUser]);
        await admin.query(
          `INSERT INTO memberships(id,org_id,user_id,role,status)
             VALUES($1,$2,$3,'R-ADMIN','ACTIVE')`,
          [uuidv7(),org,adminUser],
        );
        const adminIssuer={...issuer,userId:adminUser,orgRole:'R-ADMIN'};
        let adminStarted!:()=>void;
        let adminRelease!:()=>void;
        const adminSendStarted=new Promise<void>(resolve=>{adminStarted=resolve;});
        const adminSendBlocked=new Promise<void>(resolve=>{adminRelease=resolve;});
        gateway.sendMagicLinkEmail.mockImplementationOnce(async()=>{
          adminStarted();
          await adminSendBlocked;
        });
        const demotedInvite=service.createInvitation(adminIssuer,org,{
          email:'demoted@g01.example',role:'R-SITE',
        });
        await adminSendStarted;
        await service.updateMemberRole(issuer,org,adminUser,{role:'R-SITE'});
        adminRelease();
        await expect(demotedInvite).rejects.toMatchObject({
          response:expect.objectContaining({code:'INVITATION_SUPERSEDED_DURING_DELIVERY'}),
        });
        expect((await admin.query(
          `SELECT status FROM invitations WHERE org_id=$1 AND email=$2`,
          [org,'demoted@g01.example'],
        )).rows[0].status).toBe('REVOKED');

        gateway.sendMagicLinkEmail.mockRejectedValueOnce(
          new Error('accepted delivery then timeout'),
        );
        await expect(service.createInvitation(issuer,org,{
          email:'retry@g01.example',role:'R-SITE',
        })).rejects.toMatchObject({
          response:expect.objectContaining({code:'INVITATION_DELIVERY_UNVERIFIED'}),
        });
        expect((await admin.query(
          `SELECT status FROM invitations WHERE org_id=$1 AND email=$2`,
          [org,'retry@g01.example'],
        )).rows[0].status).toBe('REVOKED');
      });
    }finally{
      if(oldNodeEnv===undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV=oldNodeEnv;
      if(oldFrontend===undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL=oldFrontend;
    }
  });

});
