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
      const assigned=await service.updateMemberRole(ctx(owner,'R-OWNER'),org,
        member,{role:'R-PM'});
      expect(assigned.role).toBe('R-PM');
      const roles=(await admin.query(
        `SELECT user_id,role FROM memberships WHERE org_id=$1`,[org])).rows;
      expect(roles.find(x=>x.user_id===owner).role).toBe('R-OWNER');
      expect(roles.find(x=>x.user_id===administrator).role).toBe('R-ADMIN');
      expect(roles.find(x=>x.user_id===member).role).toBe('R-PM');
      expect((await admin.query(
        `SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND role='R-OWNER'`,
        [org])).rows[0].n).toBe(1);
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
