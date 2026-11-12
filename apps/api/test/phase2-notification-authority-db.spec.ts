import { uuidv7 } from 'uuidv7';
import { openDisposableDatabaseForSuite } from '../../../packages/db/test/helpers/disposable-database';
import { TenantDbService } from '../src/database/tenant-db.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

jest.setTimeout(180_000);

describe('PH2-NEW-011 / PH2-G20-002: notification command authority', () => {
  let db: Awaited<ReturnType<typeof openDisposableDatabaseForSuite>>;
  let service: NotificationsService;
  let org: string, foreign: string, user: string, project: string, otherProject: string;
  let ctx: any;
  beforeAll(async () => {
    db = await openDisposableDatabaseForSuite();
    service = new NotificationsService(new TenantDbService(db.app));
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    org=uuidv7(); foreign=uuidv7(); user=uuidv7(); project=uuidv7(); otherProject=uuidv7();
    await db.admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic issuer','ACTIVE')", [user]);
    for (const id of [org,foreign]) await db.admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
      VALUES($1,'Synthetic notification tenant','Synthetic notification tenant','KA')`, [id]);
    await db.admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
      VALUES($1,$2,$3,'R-OWNER','ACTIVE')`, [uuidv7(),org,user]);
    for (const [id,tenant] of [[project,org],[otherProject,foreign]]) await db.admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
      VALUES($1,$2,'NOT-AUTH','Synthetic project','ACTIVE',$3)`, [id,tenant,user]);
    ctx={orgId:org,userId:user,actorType:'USER',orgRole:'R-OWNER',requestId:uuidv7()};
  });
  const input = (projectId?: string) => ({projectId,channel:'IN_APP' as const,
    eventKey:'REQUIREMENT_CHANGED',dedupKey:uuidv7(),payload:{title:'Synthetic change'}});
  const denied = async (work: Promise<unknown>) => {
    await expect(work).rejects.toMatchObject({status:403});
    expect((await db.admin.query('SELECT count(*)::int AS n FROM notifications WHERE org_id=$1',[org])).rows[0].n).toBe(0);
  };
  const setRole = (role:string) => db.admin.query('UPDATE memberships SET role=$3 WHERE org_id=$1 AND user_id=$2',[org,user,role]);
  const projectMember = (role:string,scope:unknown={}) => db.admin.query(`INSERT INTO project_members
    (id,org_id,project_id,user_id,role,status,scope_json,added_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$4)`,
    [uuidv7(),org,project,user,role,JSON.stringify(scope)]);

  it('permits current administrators and preserves identical retries', async () => {
    await setRole('R-ADMIN');
    const dto=input();
    const first=await service.createNotification({...ctx,orgRole:'R-SITE'},dto);
    const retry=await service.createNotification(ctx,dto);
    expect(first.notification.id).toBe(retry.notification.id);
    expect(first.notification.status).toBe('SENT');
  });
  it.each(['R-SITE','R-BILLING'])('rejects stale owner/project claims after demotion to %s without a project', async role => {
    await setRole(role);
    await denied(service.createNotification({...ctx,projectRole:'R-PM'},input()));
  });
  it.each(['SUSPENDED','REMOVED'])('rejects %s organisation membership without a project', async status => {
    await db.admin.query('UPDATE memberships SET status=$3 WHERE org_id=$1 AND user_id=$2',[org,user,status]);
    await denied(service.createNotification(ctx,input()));
  });
  it('rejects an inactive user without a project', async () => {
    await db.admin.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[user]);
    await denied(service.createNotification(ctx,input()));
  });
  it('cannot use a foreign organisation membership', async () => {
    await denied(service.createNotification({...ctx,orgId:foreign},input()));
  });
  it('requires a concrete project for a scoped PM capability', async () => {
    await setRole('R-PM');
    await denied(service.createNotification(ctx,input()));
  });
  it('does not interpret mere project membership as notification authority', async () => {
    await setRole('R-SITE'); await projectMember('R-SITE');
    await denied(service.createNotification({...ctx,projectRole:'R-PM'},input(project)));
  });
  it('permits a live organisation PM on their project without trusting stale session roles', async () => {
    await setRole('R-PM'); await projectMember('R-PM');
    expect((await service.createNotification({...ctx,orgRole:'R-BILLING',projectRole:'R-SITE'},input(project)))
      .notification.project_id).toBe(project);
  });
  it('does not invent notification capability for a project-only PM role', async () => {
    await setRole('R-SITE'); await projectMember('R-PM');
    await denied(service.createNotification({...ctx,projectRole:'R-PM'},input(project)));
  });
  it('rejects an inactive organisation without a project', async () => {
    await db.admin.query("UPDATE organisations SET status='SUSPENDED' WHERE id=$1",[org]);
    await denied(service.createNotification(ctx,input()));
  });
  it.each([{readOnly:true},{mode:'READ_ONLY'},{assetIds:[]},{requirementIds:[uuidv7()]},{unknown:true}])(
    'fails closed for unresolvable or read-only member scope %j', async scope => {
      await setRole('R-PM'); await projectMember('R-PM',scope);
      await denied(service.createNotification(ctx,input(project)));
    });
  it('rejects a foreign project without writing either tenant', async () => {
    await expect(service.createNotification(ctx,input(otherProject))).rejects.toMatchObject({status:404});
    expect((await db.admin.query('SELECT count(*)::int AS n FROM notifications WHERE org_id IN ($1,$2)',[org,foreign])).rows[0].n).toBe(0);
  });
  it('rechecks authority on a deduplicated retry and retains the original row', async () => {
    const dto=input();
    const first=await service.createNotification(ctx,dto);
    await setRole('R-SITE');
    await expect(service.createNotification(ctx,dto)).rejects.toMatchObject({status:403});
    const stored=(await db.admin.query('SELECT * FROM notifications WHERE id=$1',[first.notification.id])).rows[0];
    expect(stored).toEqual(first.notification);
  });
  it('observes a concurrent demotion that commits before admission', async () => {
    const revoker=await db.admin.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await revoker.query('BEGIN');
      await revoker.query("UPDATE memberships SET role='R-SITE' WHERE org_id=$1 AND user_id=$2",[org,user]);
      pending=service.createNotification(ctx,input());
      // Attach rejection handling immediately while observing the real PG lock wait.
      const outcome=pending.then(value=>({value}),error=>({error}));
      const deadline=Date.now()+5000;
      let waiting=false;
      while(Date.now()<deadline) {
        const {rows}=await db.admin.query(`SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND usename='tc_app' AND wait_event_type='Lock'
            AND query LIKE '%FROM memberships%'`);
        if(rows.length) {waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await revoker.query('COMMIT');
      expect(await outcome).toMatchObject({error:{status:403}});
      expect((await db.admin.query('SELECT count(*)::int AS n FROM notifications WHERE org_id=$1',[org])).rows[0].n).toBe(0);
    } finally {
      await revoker.query('ROLLBACK'); revoker.release();
      await pending?.catch(()=>{});
    }
    // A successful subsequent transaction proves rollback released its pooled connection/context.
    await setRole('R-ADMIN');
    expect((await service.createNotification(ctx,input())).notification.status).toBe('SENT');
  });
});
