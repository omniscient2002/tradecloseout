export const NOTIFICATION_CATEGORIES=['WORK','OWNER_DIGEST','WARRANTY','SUPPLIER'] as const;
export const NOTIFICATION_CHANNELS=['IN_APP','EMAIL','SMS','WHATSAPP'] as const;
const titles:Record<string,string>={REQUIREMENT_CHANGED:'Requirement updated',REQUIREMENT_DUE:'Requirement due',
 WEEKLY_OWNER_DIGEST:'Weekly project summary',WARRANTY_EXPIRING:'Warranty expiry reminder',SUPPLIER_DOCUMENTS_DUE:'Supplier documents due',SECURITY_NOTICE:'Account security notice'};
export function safeNotificationDto(row:any){
 return {id:row.id,projectId:row.project_id??null,title:titles[row.event_key]??'Project update',channel:row.channel,
  status:row.status,gatewayState:row.gateway_state,createdAt:row.created_at,readAt:row.read_at??null,
  link:row.project_id?`/projects/${encodeURIComponent(row.project_id)}`:'/notifications'};
}
