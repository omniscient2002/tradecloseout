export interface QueuedNotification {
  id: string;
  org_id: string;
  channel: string;
  event_key: string;
  payload_json: unknown;
  recipient_user_id?: string;
  recipient_party_id?: string;
}

const ACK_MAX_BYTES = 4096;

function gatewayUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return;
    if (url.protocol === 'https:') return url;
    const fixtureMode = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
    if (fixtureMode && url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url;
  } catch { /* Invalid configuration never sends a credential-bearing request. */ }
}

async function readAcknowledgment(response: Response): Promise<unknown> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > ACK_MAX_BYTES)) return;
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ACK_MAX_BYTES) return;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** The gateway must deduplicate by notification ID, including after a DB rollback. */
export async function deliverNotification(notification: QueuedNotification): Promise<boolean> {
  if (notification.channel === 'IN_APP') return true;
  const rawUrl = process.env.NOTIFICATION_DELIVERY_URL;
  const token = process.env.NOTIFICATION_DELIVERY_TOKEN;
  if (!rawUrl || !token || /[\r\n]/.test(token)) return false;
  const url = gatewayUrl(rawUrl);
  if (!url) return false;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': notification.id,
    },
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return false;
  }
  const acknowledgment = await readAcknowledgment(response);
  // A generic HTTP 200 is not evidence that this notification was accepted.
  if (!acknowledgment || typeof acknowledgment !== 'object' || Array.isArray(acknowledgment)) return false;
  const receipt = acknowledgment as Record<string, unknown>;
  return receipt.accepted === true && receipt.notificationId === notification.id;
}
