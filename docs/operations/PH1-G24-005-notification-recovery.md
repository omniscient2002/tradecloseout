# PH1-G24-005 — Notification delivery, failure handling and recovery

**Status:** engineering candidate, NOT independent acceptance or production approval.

## Durable delivery contract

- Migration `0045_phase1_notification_delivery_claims.sql` adds an additive delivery claim, attempt schedule, bounded-attempt/dead-letter ledger and `gateway_state`.
- `status='QUEUED'` with `gateway_state='PENDING'`: no confirmed provider acceptance. An ambiguous timeout MAY already have been accepted by the provider.
- `status='SENT'` with `gateway_state='ACCEPTED'`: the HTTP gateway explicitly acknowledged the matching notification ID. **Do not interpret as delivered to the recipient.** A final delivery/bounce webhook and signed receipt reconciliation are still required for that claim.
- `status='SENT'` with `gateway_state='DELIVERED'` is used for internally available `IN_APP` content; this is not an external-device read receipt.
- `status='FAILED'` and `dead_lettered_at IS NOT NULL`: the retry budget exhausted; the message cannot be silently retried by the polling worker.
- Historical rows created before migration can have a default `gateway_state='PENDING'` despite older `SENT`/`READ` statuses. **Do not backfill certainty from legacy status alone.** An independently approved conversion/reconciliation procedure is required.

Claims are tenant-scoped, short-lived, acquired with `FOR UPDATE SKIP LOCKED`, and committed before any network call. The claim token and expiry fence late acknowledgments. Each retry uses the **same immutable notification UUID** as the provider `Idempotency-Key`. The system cannot guarantee exactly-once delivery unless the provider honors that key throughout its documented retry window.

Quiet-hour SMS/WhatsApp deferral is checked **before** the due-batch limit. The worker checks every active tenant, claims at most two notifications per tenant per poll, and records bounded exponential retry attempts. An invalid/missing provider configuration leaves external notifications QUEUED without consuming the budget; the runtime/operator must still alert on the missing adapter.

## Read-only investigation (restricted operator, authorised tenant)

Check these metrics without exporting message bodies, personal data, or credentials:

```sql
SELECT org_id,channel,status,gateway_state,failure_code,
       count(*) AS messages,
       max(delivery_attempts) AS max_attempts,
       min(next_attempt_at) AS oldest_due
  FROM notifications
 WHERE created_at >= now() - interval '24 hours'
 GROUP BY org_id,channel,status,gateway_state,failure_code
 ORDER BY org_id,channel,status;
```

For a known authorised tenant and notification ID, inspect `delivery_attempts`, `next_attempt_at`, `claim_until`, `gateway_state`, `failure_code` and `dead_lettered_at`. Do **not** log `payload_json`, provider authorization headers, recipient addresses or gateway exception bodies. A lease still active after an incident is **not** proof that the message was sent. `SENT` means provider acceptance only.

## Recovery gate (no automatic production replay)

1. Identify and isolate the affected tenant, provider channel and time window. Confirm current provider configuration uses HTTPS, bounded replies, no redirects and the documented Idempotency-Key behavior.
2. Independently query the provider for the exact notification ID and last known accepted/bounced/delivered outcome. Account for accepted-but-lost HTTP acknowledgments. Capture a signed or otherwise independently verified provider receipt in the incident record. **Do not re-send on an unknown outcome.**
3. For a verified nonaccepted message, have a separately authorised operator approve replay of that *one* tenant/notification, with event-level incident tracking. Recheck recipient eligibility, quiet-hours consent, retention policy, provider idempotency window and data freshness before any write.
4. A replay implementation must atomically compare `org_id`, `id`, `status='FAILED'`, the verified external outcome and the approved replay ID while resetting attempt/claim fields. The current application deliberately supplies **no unattended override endpoint**; adding one requires its own RBAC, audit and independent review.
5. Exercise a production-like two-worker test using the actual approved SMS/email/WhatsApp provider: transport outage, accepted acknowledgment lost, redirect refusal, duplicate-retry, bounce, user opt-out, quiet-hour rollover and 25+ queued failed messages. Record exact provider acceptance/delivery evidence and approval. These tests are **not yet performed**.

## Alerting / release blockers

Monitor failed/dead-letter counts, oldest queued age by channel and tenant, claim lease expiry rates, retry distribution, external gateway configuration and accepted-to-delivered reconciliation lag. Define and approve SLO/error budget, escalation owner, on-call runbook, IAM privileges and outage response before deployment. This runbook and the local automated tests are **not** release acceptance.
