export const NOTIFICATION_CATEGORIES=['WORK','OWNER_DIGEST','WARRANTY','SUPPLIER'] as const;
export const NOTIFICATION_CHANNELS=['IN_APP','EMAIL','SMS','WHATSAPP'] as const;
const titles:Record<string,string>={OWNERSHIP_TRANSFER_REQUESTED:'Confirm ownership transfer',DOCUMENT_SUBMITTED_FOR_REVIEW:'Review requested',DOCUMENT_REVIEW_DECIDED:'Review decision recorded',HANDOVER_PACKAGE_QUEUED:'Package generation queued',HANDOVER_PACKAGE_READY:'Package ready',BASELINE_CHANGE_REQUESTED:'Baseline change awaiting review',REQUIREMENT_CHANGED:'Requirement updated',REQUIREMENT_DUE:'Requirement due',
 WEEKLY_OWNER_DIGEST:'Weekly project summary',WARRANTY_EXPIRING:'Warranty expiry reminder',SUPPLIER_DOCUMENTS_DUE:'Supplier documents due',SECURITY_NOTICE:'Account security notice'};
export function safeNotificationDto(row:any){
 return {id:row.id,projectId:row.project_id??null,title:titles[row.event_key]??'Project update',channel:row.channel,
  status:row.status,gatewayState:row.gateway_state,createdAt:row.created_at,readAt:row.read_at??null,
  link:row.event_key==='OWNERSHIP_TRANSFER_REQUESTED'?'/settings':row.project_id?`/projects/${encodeURIComponent(row.project_id)}`:'/notifications'};
}
