import {overdueCurrentObligationSql} from '@tradecloseout/db';
// apps/api/src/modules/notifications/notifications.service.ts
// IST Quiet Hours, Deduplication & Rupee-at-Risk Owner Digest (FR-NOT-001..014, RT-029)

import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import {createHmac,timingSafeEqual} from 'crypto';
import {withTenantTransaction} from '@tradecloseout/db';
import {projectCommandRecord,requireProjectCommandId} from '../projects/project-command-input';
import {NOTIFICATION_CATEGORIES,NOTIFICATION_CHANNELS,safeNotificationDto} from './notification-policy';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { hasPermission, isIndiaQuietHour, ORG_ROLE_MATRIX } from '@tradecloseout/shared';
import { assertValidMemberProjectScope } from '@tradecloseout/db/tenant-tx';
import { boundedJsonObject } from '../../common/validation/bounded-json';
import { getProjectCommercialSummary, paiseToSafeInr } from '../projects/project-commercial-summary';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * Checks whether the current time falls within IST quiet hours (22:00 - 08:00 IST)
   */
  isIstQuietHour(date: Date = new Date()): boolean {
    return isIndiaQuietHour(date);
  }

  /** Canonical equality rejects attempts to reuse a notification identity with new meaning. */
  private canonicalNotificationJson(value: unknown): string {
    const sort = (entry: unknown): unknown => {
      if (Array.isArray(entry)) return entry.map(sort);
      if (entry && typeof entry === 'object') {
        return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, sort(val)]));
      }
      return entry;
    };
    return JSON.stringify(sort(value)) ?? '';
  }

  /**
   * API-130 POST /notifications (Deduplicated with quiet hour deferral)
   */
  async createNotification(
    ctx: ExecutionContext,
    dto: {
      projectId?: string;
      channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';
      eventKey: string;
      payload: Record<string, any>;
      dedupKey: string;
      isUrgent?: boolean;
    },
  ) {
    if (ctx.guestGrantId || !['USER', 'ADMIN', 'SYSTEM'].includes(ctx.actorType)) {
      throw new ForbiddenException({ code: 'NOTIFICATION_ISSUER_REQUIRED' });
    }
    dto=projectCommandRecord(dto,['projectId','channel','eventKey','payload','dedupKey','isUrgent'],'INVALID_NOTIFICATION_INPUT') as typeof dto;
    if(dto.isUrgent&&!(ctx.actorType==='SYSTEM'&&dto.eventKey==='SECURITY_NOTICE'))throw new ForbiddenException('NOTIFICATION_URGENCY_NOT_AUTHORIZED');
    if (!dto || typeof dto !== 'object' || Array.isArray(dto) ||
        !['IN_APP','EMAIL','SMS','WHATSAPP'].includes(dto.channel) ||
        (dto.isUrgent !== undefined && typeof dto.isUrgent !== 'boolean')) {
      throw new UnprocessableEntityException({ code: 'INVALID_NOTIFICATION_INPUT' });
    }
    // PH2-G20-001: external delivery is an internal template-only workflow.
    // A user cannot turn arbitrary JSON into an email or SMS by changing channel.
    if (dto.channel !== 'IN_APP' && ctx.actorType !== 'SYSTEM') {
      throw new ServiceUnavailableException({
        code: 'EXTERNAL_NOTIFICATION_TEMPLATES_REQUIRED',
        detail: 'External notifications require a reviewed server-owned event template.',
      });
    }
    if (typeof dto.eventKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(dto.eventKey) ||
        typeof dto.dedupKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(dto.dedupKey) ||
        !dto.payload || Array.isArray(dto.payload) || typeof dto.payload !== 'object' ||
        (dto.projectId !== undefined && (typeof dto.projectId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.projectId)))) {
      throw new UnprocessableEntityException({ code: 'INVALID_NOTIFICATION_INPUT' });
    }
    let payload: Record<string, unknown>;
    try { payload = boundedJsonObject(dto.payload, 4096); }
    catch (error) {
      throw new UnprocessableEntityException({ code: (error as Error).message === 'JSON_TOO_LARGE'
        ? 'NOTIFICATION_PAYLOAD_TOO_LARGE' : 'INVALID_NOTIFICATION_INPUT' });
    }
    const canonicalPayload = this.canonicalNotificationJson(payload);
    if (Buffer.byteLength(canonicalPayload, 'utf8') > 4096) {
      throw new UnprocessableEntityException({ code: 'NOTIFICATION_PAYLOAD_TOO_LARGE' });
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // PH2-NEW-011 / PH2-G20-002: the command must check current
      // issuance authority even when there is no project in the envelope.
      // Keep these locks until the notification (including a retry) settles.
      let liveOrgRole: string | undefined;
      if (ctx.actorType !== 'SYSTEM') {
        const { rows } = await client.query(
          `SELECT m.role FROM memberships m
             JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
             JOIN organisations o ON o.id=m.org_id AND o.status='ACTIVE'
            WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
            FOR SHARE OF m,u,o`,
          [ctx.orgId, ctx.userId],
        );
        liveOrgRole = rows[0]?.role;
        if (!liveOrgRole) {
          throw new ForbiddenException({ code: 'NOTIFICATION_ISSUER_REQUIRED' });
        }
        // Scoped notification capabilities require an actual project target.
        if (!dto.projectId &&
            ORG_ROLE_MATRIX[liveOrgRole as keyof typeof ORG_ROLE_MATRIX]?.['notification.manage'] !== 'ALL') {
          throw new ForbiddenException({ code: 'NOTIFICATION_ISSUER_REQUIRED' });
        }
      }
      if (dto.projectId) {
        const { rows: projects } = await client.query(
          `SELECT id FROM projects
            WHERE org_id = $1 AND id = $2 AND purged_at IS NULL
            FOR SHARE`,
          [ctx.orgId, dto.projectId],
        );
        if (!projects.length) throw new NotFoundException('PROJECT_NOT_FOUND');
        if (ctx.actorType !== 'SYSTEM' && liveOrgRole !== 'R-OWNER' && liveOrgRole !== 'R-ADMIN') {
          const { rows: members } = await client.query(
            `SELECT role,scope_json FROM project_members
              WHERE org_id = $1 AND project_id = $2 AND user_id = $3
                AND status = 'ACTIVE' FOR SHARE`,
            [ctx.orgId, dto.projectId, ctx.userId],
          );
          const member = members[0];
          if (!member) throw new NotFoundException('PROJECT_NOT_FOUND');
          if (!hasPermission({ orgRole: liveOrgRole, projectRole: member.role }, 'notification.manage').allowed) {
            throw new ForbiddenException({ code: 'NOTIFICATION_ISSUER_REQUIRED' });
          }
          try { assertValidMemberProjectScope(member.scope_json); }
          catch { throw new ForbiddenException({ code: 'NOTIFICATION_SCOPE_UNRESOLVED' }); }
          const scope = member.scope_json ?? {};
          // The envelope identifies no asset/document/requirement. Narrower
          // resource/date restrictions therefore cannot authorize this write.
          if (scope.readOnly === true || scope.mode === 'READ_ONLY' ||
              Object.keys(scope).some(key => key !== 'readOnly' && key !== 'mode')) {
            throw new ForbiddenException({ code: 'NOTIFICATION_SCOPE_UNRESOLVED' });
          }
        }
      }

      const external = dto.channel !== 'IN_APP';
      const { rows: inserted } = await client.query(
        `INSERT INTO notifications (
          id, org_id, project_id, recipient_user_id, channel, event_key,
          payload_json, status, dedup_key, sent_at, gateway_state,category,urgent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,$12,$13)
        ON CONFLICT (org_id, dedup_key, channel, recipient_user_id, recipient_party_id)
        DO NOTHING RETURNING *`,
        [uuidv7(), ctx.orgId, dto.projectId ?? null, ctx.userId,
          dto.channel, dto.eventKey, canonicalPayload,
          external ? 'QUEUED' : 'SENT', dto.dedupKey,
          external ? null : new Date(), external ? 'PENDING' : 'DELIVERED',
          dto.eventKey==='SECURITY_NOTICE'?'SECURITY':dto.eventKey==='WEEKLY_OWNER_DIGEST'?'OWNER_DIGEST':'WORK',dto.isUrgent===true],
      );
      if (inserted.length) return { notification: inserted[0], deferredForQuietHours: false };

      const { rows: existing } = await client.query(
        `SELECT * FROM notifications
          WHERE org_id = $1 AND dedup_key = $2 AND channel = $4
            AND recipient_user_id = $3 FOR SHARE`,
        [ctx.orgId, dto.dedupKey, ctx.userId, dto.channel],
      );
      const previous = existing[0];
      const previousPayload = typeof previous?.payload_json === 'string'
        ? JSON.parse(previous.payload_json) : previous?.payload_json;
      if (!previous || previous.project_id !== (dto.projectId ?? null) ||
          previous.event_key !== dto.eventKey ||
          this.canonicalNotificationJson(previousPayload) !== canonicalPayload) {
        throw new ConflictException({
          code: 'NOTIFICATION_DEDUP_CONFLICT',
          detail: 'A notification key was reused with different content or scope.',
        });
      }
      // The first event wins; retries may not rewrite delivered content.
      return { notification: previous, deferredForQuietHours: false };
    });
  }

  /**
   * API-131 GET /notifications
   */
  async listNotifications(ctx: ExecutionContext) {
    // The inbox belongs to a live internal user, not a grant token or an
    // organisation-wide "document.read" capability.
    if (ctx.actorType !== 'USER' || ctx.guestGrantId) {
      throw new ForbiddenException({ code: 'NOTIFICATION_INBOX_RESTRICTED' });
    }
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // G03 offboarding / PH2-G20-002: a stale R-OWNER session must not
      // retain the owner-wide project visibility bypass after demotion.
      const { rows: members } = await client.query(
        `SELECT m.role FROM memberships m
          JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
         WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
         FOR SHARE OF m,u`,
        [ctx.orgId, ctx.userId],
      );
      if (!members.length) {
        throw new ForbiddenException({ code: 'NOTIFICATION_INBOX_RESTRICTED' });
      }
      const liveOrgWide = members[0].role === 'R-OWNER' || members[0].role === 'R-ADMIN';
      const res = await client.query(
        `SELECT * FROM notifications
         WHERE org_id = $1 AND recipient_user_id = $2
           AND (
             project_id IS NULL OR
             EXISTS (
               SELECT 1 FROM projects p
                WHERE p.org_id = notifications.org_id
                  AND p.id = notifications.project_id
                  AND p.purged_at IS NULL
                  AND (
                    $3::boolean OR EXISTS (
                      SELECT 1 FROM project_members pm
                       WHERE pm.org_id = p.org_id AND pm.project_id = p.id
                         AND pm.user_id = $2 AND pm.status = 'ACTIVE'
                    )
                  )
             )
           )
         ORDER BY created_at DESC LIMIT 50`,
        [ctx.orgId, ctx.userId, liveOrgWide],
      );
      return res.rows.map(safeNotificationDto);
    });
  }

  private async inboxAuthority(client:PoolClient,ctx:ExecutionContext):Promise<boolean>{
    if(ctx.actorType!=='USER'||ctx.guestGrantId)throw new ForbiddenException('NOTIFICATION_INBOX_RESTRICTED');
    const {rows}=await client.query(`SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
      JOIN organisations o ON o.id=m.org_id AND o.status='ACTIVE' WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' FOR SHARE OF m,u,o`,[ctx.orgId,ctx.userId]);
    if(!rows.length)throw new ForbiddenException('NOTIFICATION_INBOX_RESTRICTED');
    return ['R-OWNER','R-ADMIN'].includes(rows[0].role);
  }
  private visibleSql(){return `n.org_id=$1 AND n.recipient_user_id=$2 AND (n.project_id IS NULL OR EXISTS(
    SELECT 1 FROM projects p WHERE p.org_id=n.org_id AND p.id=n.project_id AND p.purged_at IS NULL
    AND ($3::boolean OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.org_id=p.org_id AND pm.project_id=p.id AND pm.user_id=$2 AND pm.status='ACTIVE'))))`;}
  async inbox(ctx:ExecutionContext,limit=25,cursor?:string){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new UnprocessableEntityException('INBOX_LIMIT_INVALID');
    let position:{at:string;id:string}|null=null;
    if(cursor){try{if(cursor.length>300)throw new Error();position=JSON.parse(Buffer.from(cursor,'base64url').toString());
      if(!position||typeof position.at!=='string'||Number.isNaN(Date.parse(position.at)))throw new Error();requireProjectCommandId(position.id,'INBOX_CURSOR_INVALID');
    }catch{throw new UnprocessableEntityException('INBOX_CURSOR_INVALID');}}
    return this.db.withTenantContext(ctx,async client=>{
      const wide=await this.inboxAuthority(client,ctx);const args=[ctx.orgId,ctx.userId,wide];
      const {rows}=await client.query(`SELECT n.* FROM notifications n WHERE ${this.visibleSql()}
        AND ($4::timestamptz IS NULL OR (n.created_at,n.id)<($4::timestamptz,$5::uuid))
        ORDER BY n.created_at DESC,n.id DESC LIMIT $6`,[...args,position?.at??null,position?.id??null,limit+1]);
      const {rows:[counts]}=await client.query(`SELECT count(*)::int AS unread FROM notifications n WHERE ${this.visibleSql()} AND n.read_at IS NULL`,args);
      const page=rows.slice(0,limit);const last=page[page.length-1];
      return {items:page.map(safeNotificationDto),unreadCount:counts.unread,nextCursor:rows.length>limit&&last?
        Buffer.from(JSON.stringify({at:new Date(last.created_at).toISOString(),id:last.id})).toString('base64url'):null};
    });
  }
  async markRead(ctx:ExecutionContext,id:string){
    requireProjectCommandId(id,'NOTIFICATION_ID_INVALID');return this.db.withTenantContext(ctx,async client=>{
      const wide=await this.inboxAuthority(client,ctx);
      const {rows}=await client.query(`UPDATE notifications n SET read_at=COALESCE(read_at,now()),
        status=CASE WHEN status='SENT' THEN 'READ' ELSE status END WHERE ${this.visibleSql()} AND n.id=$4 RETURNING n.*`,[ctx.orgId,ctx.userId,wide,id]);
      if(!rows.length)throw new NotFoundException('NOTIFICATION_NOT_FOUND');return safeNotificationDto(rows[0]);
    });
  }
  async preferences(ctx:ExecutionContext){return this.db.withTenantContext(ctx,async client=>{
    await this.inboxAuthority(client,ctx);return {categories:NOTIFICATION_CATEGORIES,channels:NOTIFICATION_CHANNELS,
      items:(await client.query('SELECT category,channel,enabled,digest,row_version FROM notification_preferences WHERE org_id=$1 AND user_id=$2 ORDER BY category,channel',[ctx.orgId,ctx.userId])).rows};
  });}
  async updatePreference(ctx:ExecutionContext,value:unknown){
    const dto=projectCommandRecord(value,['category','channel','enabled','digest','rowVersion'],'NOTIFICATION_PREFERENCE_INVALID');
    if(!NOTIFICATION_CATEGORIES.includes(dto.category as any)||!NOTIFICATION_CHANNELS.includes(dto.channel as any)||typeof dto.enabled!=='boolean'||
      !['IMMEDIATE','WEEKLY'].includes(String(dto.digest))||!Number.isInteger(dto.rowVersion)||Number(dto.rowVersion)<0||
      dto.digest==='WEEKLY'&&dto.category!=='OWNER_DIGEST')throw new UnprocessableEntityException('NOTIFICATION_PREFERENCE_INVALID');
    return withTenantTransaction(this.db.getPool(),{...ctx,actorType:ctx.actorType==='USER'?'MEMBER':ctx.actorType},async(client,emit)=>{
      await this.inboxAuthority(client,ctx);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('notification-preference:'||$1::text||':'||$2::text,0))",[ctx.orgId,ctx.userId]);
      const {rows}=await client.query('SELECT id,row_version FROM notification_preferences WHERE org_id=$1 AND user_id=$2 AND category=$3 AND channel=$4 FOR UPDATE',[ctx.orgId,ctx.userId,dto.category,dto.channel]);
      if((rows[0]?.row_version??0)!==dto.rowVersion)throw new ConflictException('NOTIFICATION_PREFERENCE_STALE');
      const id=rows[0]?.id??uuidv7();const {rows:updated}=await client.query(`INSERT INTO notification_preferences(id,org_id,user_id,category,channel,enabled,digest,row_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(org_id,user_id,category,channel) DO UPDATE SET enabled=EXCLUDED.enabled,digest=EXCLUDED.digest,
        row_version=notification_preferences.row_version+1,updated_at=now() RETURNING category,channel,enabled,digest,row_version`,[id,ctx.orgId,ctx.userId,dto.category,dto.channel,dto.enabled,dto.digest]);
      emit({eventType:'NOTIFICATION_PREFERENCE_UPDATED',entityType:'NOTIFICATION_PREFERENCE',entityId:id,afterJson:{category:dto.category,channel:dto.channel,enabled:dto.enabled}});return updated[0];
    });
  }

  async unsubscribeLink(ctx:ExecutionContext,category:unknown){
    if(!NOTIFICATION_CATEGORIES.includes(category as any))throw new UnprocessableEntityException('NOTIFICATION_CATEGORY_INVALID');
    const key=process.env.NOTIFICATION_UNSUBSCRIBE_KEY;
    if(!key||key.length<32)throw new ServiceUnavailableException('NOTIFICATION_UNSUBSCRIBE_NOT_CONFIGURED');
    await this.db.withTenantContext(ctx,async client=>{await this.inboxAuthority(client,ctx);});
    const data=Buffer.from(JSON.stringify({orgId:ctx.orgId,userId:ctx.userId,category,expires:Math.floor(Date.now()/1000)+30*86400})).toString('base64url');
    const token=data+'.'+createHmac('sha256',key).update(data).digest('hex');
    const base=new URL(process.env.PUBLIC_APP_URL??process.env.FRONTEND_URL??'http://localhost:3002');
    if(base.username||base.password||!['http:','https:'].includes(base.protocol)||['production','staging'].includes(process.env.NODE_ENV??'')&&base.protocol!=='https:')
      throw new ServiceUnavailableException('NOTIFICATION_UNSUBSCRIBE_ORIGIN_INVALID');
    return {url:new URL('/unsubscribe?token='+encodeURIComponent(token),base).toString()};
  }
  async unsubscribe(token:unknown){
    const key=process.env.NOTIFICATION_UNSUBSCRIBE_KEY;
    if(!key||key.length<32||typeof token!=='string'||token.length>1000)throw new ForbiddenException('UNSUBSCRIBE_LINK_INVALID');
    const [data,signature,...extra]=token.split('.');
    if(extra.length||!data||!signature||!/^[a-f0-9]{64}$/.test(signature)||
      !timingSafeEqual(createHmac('sha256',key).update(data).digest(),Buffer.from(signature,'hex')))throw new ForbiddenException('UNSUBSCRIBE_LINK_INVALID');
    let value:any;try{value=JSON.parse(Buffer.from(data,'base64url').toString());
      requireProjectCommandId(value.orgId,'UNSUBSCRIBE_LINK_INVALID');requireProjectCommandId(value.userId,'UNSUBSCRIBE_LINK_INVALID');
      if(!NOTIFICATION_CATEGORIES.includes(value.category)||!Number.isSafeInteger(value.expires)||value.expires<Math.floor(Date.now()/1000)||value.expires>Math.floor(Date.now()/1000)+31*86400)throw new Error();
    }catch{throw new ForbiddenException('UNSUBSCRIBE_LINK_INVALID');}
    return this.db.withTenantContext({orgId:value.orgId,userId:value.userId,actorType:'SYSTEM',requestId:uuidv7()},async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('notification-preference:'||$1::text||':'||$2::text,0))",[value.orgId,value.userId]);
      await client.query(`INSERT INTO notification_preferences(id,org_id,user_id,category,channel,enabled,digest,row_version)
        VALUES($1,$2,$3,$4,'EMAIL',false,'IMMEDIATE',1) ON CONFLICT(org_id,user_id,category,channel)
        DO UPDATE SET enabled=false,row_version=notification_preferences.row_version+1,updated_at=now()`,[uuidv7(),value.orgId,value.userId,value.category]);
      return {unsubscribed:true};
    });
  }
  async redrive(ctx:ExecutionContext,id:string,reason:unknown){
    requireProjectCommandId(id,'NOTIFICATION_ID_INVALID');
    if(typeof reason!=='string'||reason.trim().length<5||reason.length>500)throw new UnprocessableEntityException('REDRIVE_REASON_REQUIRED');
    return withTenantTransaction(this.db.getPool(),{...ctx,actorType:ctx.actorType==='USER'?'MEMBER':ctx.actorType},async(client,emit)=>{
      await this.inboxAuthority(client,ctx);
      const {rows:members}=await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE",[ctx.orgId,ctx.userId]);
      if(!['R-OWNER','R-ADMIN'].includes(members[0]?.role))throw new ForbiddenException('NOTIFICATION_REDRIVE_AUTHORITY_REQUIRED');
      const {rows}=await client.query(`UPDATE notifications SET status='QUEUED',gateway_state='PENDING',delivery_attempts=0,dead_lettered_at=NULL,
        next_attempt_at=now(),failure_code=NULL WHERE org_id=$1 AND id=$2 AND status='FAILED' AND provider_message_id IS NULL
        AND claim_token IS NULL AND (expires_at IS NULL OR expires_at>now()) RETURNING id`,[ctx.orgId,id]);
      if(!rows.length)throw new ConflictException('NOTIFICATION_REDRIVE_NOT_ELIGIBLE');
      emit({eventType:'NOTIFICATION_REDRIVEN',entityType:'NOTIFICATION',entityId:id,afterJson:{reason:reason.trim()}});return {id,status:'QUEUED'};
    });
  }

  /**
   * Weekly Rupee-at-Risk Owner Digest (BR-GTM-07, RT-029)
   */
  async getOwnerDigest(ctx: ExecutionContext, projectId: string) {
    // Owner-only financial projection: project.read does not grant billing visibility.
    if (ctx.actorType !== 'USER' || ctx.orgRole !== 'R-OWNER') {
      throw new ForbiddenException({ code: 'OWNER_DIGEST_RESTRICTED' });
    }
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const { rows: currentOwners } = await client.query(
        `SELECT 1 FROM memberships
          WHERE org_id = $1 AND user_id = $2
            AND role = 'R-OWNER' AND status = 'ACTIVE' FOR SHARE`,
        [ctx.orgId, ctx.userId],
      );
      if (!currentOwners.length) {
        throw new ForbiddenException({ code: 'OWNER_DIGEST_RESTRICTED' });
      }
      const projRes = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 AND purged_at IS NULL`,
        [ctx.orgId, projectId],
      );
      if (!projRes.rows.length) {
        throw new BadRequestException('PROJECT_NOT_FOUND');
      }
      const proj = projRes.rows[0];

      // PH2-G20-009: due-date-based indicators only; closeout acceptance
      // still depends on the independent verified-evidence readiness check.
      // Future NOT_STARTED obligations and superseded rows are not overdue.
      const { rows: dueRows } = await client.query(
        `SELECT r.milestone_key,COUNT(*)::int AS count FROM requirements r
          WHERE r.org_id=$1 AND r.project_id=$2 AND r.mandatory=true AND ${overdueCurrentObligationSql('r')}
          GROUP BY r.milestone_key ORDER BY r.milestone_key`,
        [ctx.orgId, projectId],
      );
      const commercial = await getProjectCommercialSummary(client, ctx.orgId, projectId, proj);
      const contractValuePaise = commercial.contractValuePaise;
      const informationalRetentionExposurePaise = commercial.informationalRetentionExposurePaise;

      return {
        projectId: proj.id,
        projectCode: proj.code,
        projectName: proj.name,
        currency: 'INR',
        contractValuePaise,
        contractValueInr: paiseToSafeInr(contractValuePaise),
        financialSummaryBasis: commercial.basis,
        informationalRetentionExposurePaise,
        informationalRetentionExposureInr: paiseToSafeInr(informationalRetentionExposurePaise),
        // A contractual estimate is NOT evidence that payment or retention
        // has actually been withheld. Keep the deprecated "gated" fields NULL
        // until a separately verified financial event establishes that fact.
        retentionMoneyGatedPaise: null,
        retentionMoneyGatedInr: null,
        blockingRequirementsByMilestone: dueRows,
        overdueOrExpiredRequirementsByMilestone: dueRows,
        generatedAt: new Date(),
        recipientRole: 'R-OWNER',
      };
    });
  }
}
