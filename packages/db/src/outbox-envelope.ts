/**
 * V1 durable outbox envelope: identity and correlation belong to the
 * transaction, never to a controller-provided afterJson/domain object.
 * Outbox rows written before V1 remain readable through a strict legacy
 * boundary; explicit unknown versions are never dispatched.
 */
export const OUTBOX_ENVELOPE_VERSION = 1 as const;

export type TrustedOutboxIdentity = {
  eventId: string;
  eventType: string;
  orgId: string;
  projectId: string | null;
  entityType: string;
  entityId: string;
  actorUserId: string;
  requestId: string;
};

export type OutboxDispatchRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  event_type: string;
  payload_json: unknown;
};

const RESERVED = new Set([
  'schemaVersion', 'eventId', 'eventType', 'orgId', 'projectId',
  'entityType', 'entityId', 'actorUserId', 'requestId',
  '__proto__', 'constructor', 'prototype',
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(code: string): never {
  throw new Error(code);
}

export function buildTrustedOutboxPayload(
  identity: TrustedOutboxIdentity,
  source: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!identity.eventId || !identity.eventType || !identity.orgId ||
      !identity.entityType || !identity.entityId || !identity.actorUserId ||
      !identity.requestId) fail('OUTBOX_TRUSTED_IDENTITY_REQUIRED');
  if (source != null && !record(source)) fail('OUTBOX_DOMAIN_PAYLOAD_INVALID');
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    // A submission can legitimately reference a different package. packageId
    // is only an immutable resource alias when the event itself concerns the
    // HANDOVER_PACKAGE entity. Do not break submission domain metadata.
    if (key === 'packageId' && identity.entityType === 'HANDOVER_PACKAGE') {
      if (value !== identity.entityId) fail('OUTBOX_RESERVED_FIELD');
      continue;
    }
    if (RESERVED.has(key)) {
      // Historical producers included matching IDs in afterJson. Accept
      // matching values but exclude them from the untrusted domain object.
      // A forged value always rejects the surrounding transaction.
      if (key === 'schemaVersion' || key === 'eventId' ||
          key === '__proto__' || key === 'constructor' || key === 'prototype') {
        fail('OUTBOX_RESERVED_FIELD');
      }
      const trusted = identity[key as keyof TrustedOutboxIdentity];
      if (value !== trusted) {
        fail('OUTBOX_RESERVED_FIELD');
      }
      continue;
    }
    // Export IDs are resource identity, not an authority source. Ensure a
    // domain copy is consistent with the immutable entity envelope.
    if (key === 'exportId' && identity.eventType === 'PROJECT_ARCHIVE_EXPORT_QUEUED') {
      if (value !== identity.entityId) fail('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
      continue;
    }
    data[key] = value;
  }
  return {
    schemaVersion: OUTBOX_ENVELOPE_VERSION,
    eventId: identity.eventId,
    eventType: identity.eventType,
    orgId: identity.orgId,
    projectId: identity.projectId,
    entityType: identity.entityType,
    entityId: identity.entityId,
    actorUserId: identity.actorUserId,
    requestId: identity.requestId,
    data,
  };
}

export type ParsedOutboxDispatch = {
  version: 0 | 1;
  payload: Record<string, unknown>;
};

/** Returns a safe, flat job payload (existing BullMQ processor contract). */
export function parseTrustedOutboxDispatch(row: OutboxDispatchRow): ParsedOutboxDispatch {
  const value = typeof row.payload_json === 'string'
    ? JSON.parse(row.payload_json) as unknown : row.payload_json;
  if (!record(value)) fail('OUTBOX_ENVELOPE_INVALID');
  const version = value.schemaVersion === undefined ? 0 : value.schemaVersion;
  if (version !== 0 && version !== OUTBOX_ENVELOPE_VERSION) {
    fail('OUTBOX_SCHEMA_UNSUPPORTED');
  }
  for (const [field, expected] of [
    ['eventId', row.id], ['orgId', row.org_id],
    ['projectId', row.project_id], ['eventType', row.event_type],
  ] as const) {
    if (version === OUTBOX_ENVELOPE_VERSION && !Object.hasOwn(value, field)) {
      fail('OUTBOX_ENVELOPE_INCOMPLETE');
    }
    if (Object.hasOwn(value, field) && value[field] !== expected) {
      fail('OUTBOX_ENVELOPE_MISMATCH');
    }
  }
  if (version === OUTBOX_ENVELOPE_VERSION) {
    if (typeof value.actorUserId !== 'string' || !value.actorUserId ||
        typeof value.requestId !== 'string' || !value.requestId ||
        typeof value.entityType !== 'string' || !value.entityType ||
        typeof value.entityId !== 'string' || !value.entityId ||
        !record(value.data)) {
      fail('OUTBOX_ENVELOPE_INCOMPLETE');
    }
    for (const field of Object.keys(value.data)) {
      if (RESERVED.has(field)) fail('OUTBOX_RESERVED_FIELD');
    }
  }
  const data = version === 1 ? value.data as Record<string, unknown> : value;
  const identity = version === 1 ? value : {
    actorUserId: value.actorUserId, requestId: value.requestId,
    entityType: value.entityType, entityId: value.entityId,
  };
  // Spread only domain keys, then overwrite any authority-bearing fields
  // from the durable outbox row. Legacy rows are accepted only after identity
  // mismatch checks above; untrusted actor fields are never used for access.
  const payload: Record<string, unknown> = {
    ...data,
    schemaVersion: version,
    eventId: row.id,
    eventType: row.event_type,
    orgId: row.org_id,
    projectId: row.project_id,
    entityType: identity.entityType,
    entityId: identity.entityId,
    actorUserId: identity.actorUserId,
    requestId: identity.requestId,
  };
  if (row.event_type === 'HANDOVER_PACKAGE_QUEUED') {
    if (version === 1 && identity.entityType !== 'HANDOVER_PACKAGE') {
      fail('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
    }
    if (version === 1 && Object.hasOwn(data, 'packageId') &&
        data.packageId !== identity.entityId) {
      fail('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
    }
    if (Object.hasOwn(value, 'packageId') && version === 0 &&
        value.packageId !== identity.entityId) fail('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
    payload.packageId = identity.entityId;
  }
  if (row.event_type === 'PROJECT_ARCHIVE_EXPORT_QUEUED') {
    if (version === 1 && identity.entityType !== 'PROJECT_ARCHIVE') {
      fail('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
    }
    if (Object.hasOwn(value, 'exportId') && version === 0 &&
        value.exportId !== identity.entityId) fail('OUTBOX_RESOURCE_IDENTITY_MISMATCH');
    payload.exportId = identity.entityId;
  }
  return { version: version as 0 | 1, payload };
}
