export interface QueuedNotification {
  id: string;
  org_id: string;
  channel: string;
  event_key: string;
  payload_json: unknown;
  recipient_user_id?: string;
  recipient_party_id?: string;
}

/** Invalid or absent provider configuration must not burn the retry budget. */
export function hasConfiguredNotificationGateway(): boolean {
  if (!process.env.NOTIFICATION_DELIVERY_TOKEN || !process.env.NOTIFICATION_DELIVERY_URL) return false;
  try {
    const endpoint=new URL(process.env.NOTIFICATION_DELIVERY_URL);
    return !endpoint.username && !endpoint.password && !endpoint.hash &&
      (endpoint.protocol==='https:' ||
        (endpoint.protocol==='http:' && process.env.NODE_ENV!=='production' && process.env.NODE_ENV!=='staging'));
  } catch { return false; }
}

/** The gateway must deduplicate by notification ID, including after a DB rollback. */
export async function deliverNotification(notification: QueuedNotification): Promise<boolean> {
  if (notification.channel === 'IN_APP') return true;
  const url = process.env.NOTIFICATION_DELIVERY_URL;
  const token = process.env.NOTIFICATION_DELIVERY_TOKEN;
  if (!url || !token || !hasConfiguredNotificationGateway()) return false;
  // Provider URLs are deployment configuration, not caller-controlled data.
  // Production requires HTTPS and prohibits credentials in URLs or redirects.
  const endpoint=new URL(url);
  if (endpoint.username || endpoint.password || endpoint.hash ||
      !['https:','http:'].includes(endpoint.protocol) ||
      ((process.env.NODE_ENV==='production'||process.env.NODE_ENV==='staging') && endpoint.protocol!=='https:')) {
    return false;
  }
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': notification.id,
    },
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
      Number(response.headers.get('content-length')||0)>4096 || !response.body) return false;
  const reader=response.body.getReader();
  let size=0; const chunks:Uint8Array[]=[];
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>4096)return false;
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  const acknowledgment=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  // HTTP 2xx is only provider acceptance, not proof of end-recipient delivery.
  return Boolean(acknowledgment && typeof acknowledgment==='object' &&
    (acknowledgment as {accepted?:unknown}).accepted===true &&
    (acknowledgment as {notificationId?:unknown}).notificationId===notification.id);
}
