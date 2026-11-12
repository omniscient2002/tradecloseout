import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { ProjectsService } from '../src/modules/projects/projects.service';
import type { TenantActorContext } from '@tradecloseout/db/tenant-tx';

jest.setTimeout(180_000);

describe('PH2-G05-004: project team eligibility and manager invariants', () => {
  it('prevents cross-tenant and suspended users, project-role escalation and removing the final manager', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const orgId=uuidv7(), projectId=uuidv7(), owner=uuidv7(), site=uuidv7();
      const secondManager=uuidv7(), outsider=uuidv7(), suspended=uuidv7();
      await admin.query(
        `INSERT INTO users(id,name,status) VALUES
           ($1,'Phase 2 owner','ACTIVE'),($2,'Site member','ACTIVE'),
           ($3,'Backup manager','ACTIVE'),($4,'Unrelated user','ACTIVE'),
           ($5,'Suspended user','ACTIVE')`,
        [owner,site,secondManager,outsider,suspended],
      );
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state)
         VALUES($1,'Phase 2 Project Members','Phase 2 Project Members','AP')`,[orgId],
      );
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status) VALUES
         ($1,$2,$3,'R-OWNER','ACTIVE'),
         ($4,$2,$5,'R-SITE','ACTIVE'),
         ($6,$2,$7,'R-PM','ACTIVE'),
         ($8,$2,$9,'R-SITE','SUSPENDED')`,
        [uuidv7(),orgId,owner,uuidv7(),site,uuidv7(),secondManager,uuidv7(),suspended],
      );
      await admin.query(
        `INSERT INTO projects(id,org_id,code,name,status,created_by)
         VALUES($1,$2,'PH2-TEAM','Phase 2 Project Team','ACTIVE',$3)`,
        [projectId,orgId,owner],
      );
      await admin.query(
        `INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by)
         VALUES($1,$2,$3,$4,'R-PM','ACTIVE',$4)`,
        [uuidv7(),orgId,projectId,owner],
      );
      const ctx:TenantActorContext={orgId,userId:owner,actorType:'MEMBER',ip:'127.0.0.1',userAgent:'phase2',requestId:uuidv7()};
      const service=new ProjectsService(app);
      await expect(service.addProjectMember(ctx,projectId,{userId:outsider,role:'R-SITE'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_MEMBER_NOT_ELIGIBLE'})});
      await expect(service.addProjectMember(ctx,projectId,{userId:suspended,role:'R-SITE'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_MEMBER_NOT_ELIGIBLE'})});
      await expect(service.addProjectMember(ctx,projectId,{userId:site,role:'R-PM'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_ROLE_EXCEEDS_MEMBERSHIP'})});
      const added=await service.addProjectMember(ctx,projectId,{userId:site,role:'R-SITE'});
      expect(added.status).toBe('ACTIVE');
      await expect(service.removeProjectMember(ctx,projectId,owner))
        .rejects.toMatchObject({response:expect.objectContaining({code:'LAST_PROJECT_MANAGER_REQUIRED'})});
      const backup=await service.addProjectMember(ctx,projectId,{userId:secondManager,role:'R-PM'});
      expect(backup.role).toBe('R-PM');
      expect(await service.removeProjectMember(ctx,projectId,owner))
        .toEqual({success:true,removedUserId:owner});
      const {rows:state}=await admin.query(
        `SELECT user_id,role,status FROM project_members WHERE org_id=$1 AND project_id=$2`,[orgId,projectId],
      );
      expect(state.filter(x=>x.role==='R-PM'&&x.status==='ACTIVE').map(x=>x.user_id)).toEqual([secondManager]);
      await admin.query(`UPDATE projects SET status='CLOSED' WHERE id=$1`,[projectId]);
      await expect(service.addProjectMember(ctx,projectId,{userId:site,role:'R-SITE'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_COMMERCIAL_WRITES_LOCKED'})});
    });
  });
});
