import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrustedOutboxPayload, parseTrustedOutboxDispatch } from '../src/outbox-envelope';

const identity = {
  eventId: 'event-1', eventType: 'HANDOVER_PACKAGE_QUEUED',
  orgId: 'org-a', projectId: 'project-a', entityType: 'HANDOVER_PACKAGE',
  entityId: 'package-a', actorUserId: 'actor-a', requestId: 'request-a',
};
const row = (payload_json: unknown, overrides: Record<string, unknown> = {}) => ({
  id: identity.eventId, org_id: identity.orgId,
  project_id: identity.projectId, event_type: identity.eventType,
  payload_json, ...overrides,
});

test('PH1-G27-004: V1 event never spreads domain identity over authoritative envelope', () => {
  const emitted = buildTrustedOutboxPayload(identity, {
    packageId: 'package-a',
    projectId: 'project-a',
    nested: { status: 'QUEUED' },
  });
  assert.equal(emitted.schemaVersion, 1);
  assert.deepEqual(emitted.data, { nested: { status: 'QUEUED' } });
  const { version, payload } = parseTrustedOutboxDispatch(row(emitted));
  assert.equal(version, 1);
  assert.equal(payload.packageId, 'package-a');
  assert.equal(payload.eventId, 'event-1');
  assert.equal(payload.orgId, 'org-a');
  assert.equal(payload.projectId, 'project-a');
  assert.equal(payload.entityId, 'package-a');
  assert.equal(payload.actorUserId, 'actor-a');
  assert.equal(payload.requestId, 'request-a');
  assert.deepEqual(payload.nested, { status: 'QUEUED' });
});

test('PH1-G27-004: all forged reserved fields fail producer closed', () => {
  const forgeries = [
    { eventId: 'spoofed-event' },
    { orgId: 'org-b' },
    { projectId: 'project-b' },
    { entityType: 'PROJECT' },
    { entityId: 'foreign-entity' },
    { actorUserId: 'foreign-actor' },
    { requestId: 'stolen-request' },
    { eventType: 'WRONG_EVENT' },
    { packageId: 'wrong-package' },
    { schemaVersion: 9000 },
  ];
  for (const forged of forgeries) {
    assert.throws(() => buildTrustedOutboxPayload(identity, forged), /OUTBOX_RESERVED_FIELD/,
      JSON.stringify(forged));
  }
  assert.throws(() => buildTrustedOutboxPayload(identity, JSON.parse('{"__proto__":"forged"}')),
    /OUTBOX_RESERVED_FIELD/);
  assert.throws(() => buildTrustedOutboxPayload(identity, [] as any),
    /OUTBOX_DOMAIN_PAYLOAD_INVALID/);
});

test('PH1-G27-004: unknown versions, missing mandatory fields and V1 nested identity are denied', () => {
  const base = buildTrustedOutboxPayload(identity, { source: 'ORIGINAL' });
  for (const corrupt of [
    { ...base, schemaVersion: 2 },
    { ...base, schemaVersion: null },
    { ...base, schemaVersion: '1' },
    { ...base, eventId: 'forged-id' },
    { ...base, orgId: 'foreign-org' },
    { ...base, projectId: 'foreign-project' },
    { ...base, eventType: 'FOREIGN_EVENT' },
    { ...base, entityId: undefined },
    { ...base, actorUserId: '' },
    { ...base, requestId: undefined },
    { ...base, data: { orgId: 'foreign-org' } },
    { ...base, data: [] },
  ]) {
    assert.throws(() => parseTrustedOutboxDispatch(row(corrupt)),
      /OUTBOX_(SCHEMA_UNSUPPORTED|ENVELOPE_INCOMPLETE|ENVELOPE_MISMATCH|RESERVED_FIELD)/,
      JSON.stringify(corrupt));
  }
});

test('PH1-G27-004: pending legacy row is supported only if every supplied row identity matches', () => {
  const legacy = {
    eventId: identity.eventId, orgId: identity.orgId,
    projectId: identity.projectId, entityType: identity.entityType,
    entityId: identity.entityId, packageId: identity.entityId,
    actorUserId: identity.actorUserId, requestId: identity.requestId,
    status: 'QUEUED',
  };
  const result = parseTrustedOutboxDispatch(row(legacy));
  assert.equal(result.version, 0);
  assert.equal(result.payload.eventId, identity.eventId);
  assert.equal(result.payload.packageId, identity.entityId);
  assert.equal(result.payload.requestId, identity.requestId);
  for (const [key, forged] of [
    ['eventId', 'wrong-event'], ['orgId', 'wrong-org'],
    ['projectId', 'wrong-project'], ['packageId', 'wrong-package'],
  ]) {
    assert.throws(() => parseTrustedOutboxDispatch(row({ ...legacy, [key]: forged })),
      /OUTBOX_(ENVELOPE_MISMATCH|RESOURCE_IDENTITY_MISMATCH)/);
  }
  assert.throws(() => parseTrustedOutboxDispatch(row([])), /OUTBOX_ENVELOPE_INVALID/);
});

test('PH1-G27-004: archived exportId and packageId cannot redirect a queued resource', () => {
  const archive = {
    ...identity,
    eventType: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
    entityType: 'PROJECT_ARCHIVE',
    entityId: 'export-a',
  };
  assert.throws(() => buildTrustedOutboxPayload(archive, {
    exportId: 'export-b',
  }), /OUTBOX_RESOURCE_IDENTITY_MISMATCH/);
  const valid = buildTrustedOutboxPayload(archive, { exportId: 'export-a', digest: 'safe' });
  const result = parseTrustedOutboxDispatch({
    id: archive.eventId, org_id: archive.orgId,
    project_id: archive.projectId, event_type: archive.eventType,
    payload_json: valid,
  });
  assert.equal(result.payload.exportId, 'export-a');
  assert.equal(result.payload.digest, 'safe');
});
