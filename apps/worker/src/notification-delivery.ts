export interface QueuedNotification {
  id: string;
  org_id: string;
  channel: string;
  event_key: string;
  payload_json: unknown;
  recipient_user_id?: string;
  recipient_party_id?: string;
}

/** The gateway must deduplicate by notification ID, including after a DB rollback. */
export async function deliverNotification(notification: QueuedNotification): Promise<boolean> {
  if (notification.channel === 'IN_APP') return true;
  const url = process.env.NOTIFICATION_DELIVERY_URL;
  const token = process.env.NOTIFICATION_DELIVERY_TOKEN;
  if (!url || !token) return false;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': notification.id,
    },
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const acknowledgment = await response.json() as { accepted?: boolean; notificationId?: string };
  // A generic HTTP 200 is not evidence that this notification was accepted.
  return acknowledgment.accepted === true && acknowledgment.notificationId === notification.id;
}
