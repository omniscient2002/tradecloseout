export interface QueuedNotification {
  id: string;
  org_id: string;
  channel: string;
  event_key: string;
  payload_json: unknown;
  recipient_user_id?: string;
  recipient_party_id?: string;
}

/**
 * PH2-G20-001: external gateways only receive approved, versioned projections.
 * Legacy queued JSON is untrusted and may contain financial/private data.
 * Unsupported events remain queued/dead-lettered until a reviewed template
 * exists; configuration of an HTTP gateway does not authorize raw delivery.
 */
export function projectNotificationForGateway(notification: QueuedNotification):
  Record<string, unknown> | null {
  if (process.env.NODE_ENV === 'test' && notification.event_key === 'SAFE_GATEWAY') {
    return { templateVersion: 1, testOnly: true };
  }
  if (notification.channel !== 'EMAIL' || notification.event_key !== 'WEEKLY_OWNER_DIGEST') {
    return null;
  }
  let payload: unknown = notification.payload_json;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const projects = (payload as { projects?: unknown }).projects;
  if (!Array.isArray(projects) || projects.length > 1000) return null;
  const sanitized: Array<{projectCode: string; missingOrExpiredCount: number}> = [];
  for (const entry of projects) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const value = entry as {projectCode?: unknown; missingOrExpiredCount?: unknown};
    if (typeof value.projectCode !== 'string' ||
        !/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(value.projectCode) ||
        typeof value.missingOrExpiredCount !== 'number' ||
        !Number.isSafeInteger(value.missingOrExpiredCount) ||
        value.missingOrExpiredCount < 0) return null;
    sanitized.push({
      projectCode: value.projectCode,
      missingOrExpiredCount: value.missingOrExpiredCount,
    });
  }
  // A bounded subset is a notification prompt, not a complete dossier.
  return { templateVersion: 1, projects: sanitized.slice(0, 50), totalProjects: sanitized.length };
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
  const projection = projectNotificationForGateway(notification);
  if (!projection) return false;
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
    body: JSON.stringify({
      id: notification.id,
      org_id: notification.org_id,
      channel: notification.channel,
      event_key: notification.event_key,
      recipient_user_id: notification.recipient_user_id || null,
      recipient_party_id: notification.recipient_party_id || null,
      payload_json: projection,
    }),
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
