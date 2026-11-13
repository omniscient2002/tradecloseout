import {Body,Controller,ForbiddenException,Post,Req,ConflictException,UnprocessableEntityException} from '@nestjs/common';
import {NotificationsService} from './notifications.service';
import {TenantDbService} from '../../database/tenant-db.service';
import {verifyAuthDeliverySignature} from '@tradecloseout/db';
import {projectCommandRecord,requireProjectCommandId} from '../projects/project-command-input';
import {uuidv7} from 'uuidv7';
@Controller('api/v1/public/notifications')
export class NotificationPublicController{
 constructor(private readonly service:NotificationsService,private readonly db:TenantDbService){}
 @Post('unsubscribe') unsubscribe(@Body('token')token:unknown){return this.service.unsubscribe(token);}
 @Post('receipts') async receipt(@Req()req:any){
  if(!req.rawBody||!verifyAuthDeliverySignature(req.rawBody,req.headers['x-notification-timestamp'],req.headers['x-notification-signature'],process.env.NOTIFICATION_DELIVERY_CALLBACK_KEY))
    throw new ForbiddenException('NOTIFICATION_RECEIPT_SIGNATURE_INVALID');
  let body:unknown;try{body=JSON.parse(req.rawBody.toString());}catch{throw new UnprocessableEntityException('NOTIFICATION_RECEIPT_INVALID');}
  const dto=projectCommandRecord(body,['eventId','orgId','notificationId','messageId','sequence','status'],'NOTIFICATION_RECEIPT_INVALID');
  for(const key of ['eventId','orgId','notificationId'])requireProjectCommandId(dto[key],'NOTIFICATION_RECEIPT_INVALID');
  if(typeof dto.messageId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(dto.messageId)||!Number.isSafeInteger(dto.sequence)||Number(dto.sequence)<1||!['DELIVERED','BOUNCED','FAILED'].includes(String(dto.status)))
    throw new UnprocessableEntityException('NOTIFICATION_RECEIPT_INVALID');
  return this.db.withTenantContext({orgId:dto.orgId as string,userId:'00000000-0000-4000-8000-000000000000',actorType:'SYSTEM',requestId:uuidv7()},async client=>{
   const {rows}=await client.query('SELECT * FROM notifications WHERE org_id=$1 AND id=$2 FOR UPDATE',[dto.orgId,dto.notificationId]);const notification=rows[0];
   if(!notification||notification.provider_message_id!==dto.messageId)throw new ConflictException('NOTIFICATION_RECEIPT_UNCORRELATED');
   const {rows:previous}=await client.query('SELECT outcome,provider_message_id FROM notification_delivery_receipts WHERE org_id=$1 AND notification_id=$2 AND sequence=$3',[dto.orgId,dto.notificationId,dto.sequence]);
   if(previous.length){if(previous[0].outcome!==dto.status||previous[0].provider_message_id!==dto.messageId)throw new ConflictException('NOTIFICATION_RECEIPT_REPLAY_CONFLICT');return {recorded:true};}
   const {rows:reused}=await client.query('SELECT notification_id,sequence FROM notification_delivery_receipts WHERE id=$1',[dto.eventId]);
   if(reused.length)throw new ConflictException('NOTIFICATION_RECEIPT_EVENT_CONFLICT');
   await client.query(`INSERT INTO notification_delivery_receipts(id,org_id,notification_id,provider_message_id,sequence,outcome)
    VALUES($1,$2,$3,$4,$5,$6)`,[dto.eventId,dto.orgId,dto.notificationId,dto.messageId,dto.sequence,dto.status]);
   if(Number(dto.sequence)>notification.receipt_sequence&&!['DELIVERED','BOUNCED','FAILED'].includes(notification.gateway_state))
    await client.query(`UPDATE notifications SET gateway_state=$3,receipt_sequence=$4,status=CASE WHEN $3='DELIVERED' THEN CASE WHEN read_at IS NOT NULL THEN 'READ' ELSE 'SENT' END ELSE 'FAILED' END,
     claim_token=NULL,claim_until=NULL WHERE org_id=$1 AND id=$2`,[dto.orgId,dto.notificationId,dto.status,dto.sequence]);
   return {recorded:true};
  });
 }
}
