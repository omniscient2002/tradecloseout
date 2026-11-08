import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  date,
  timestamp,
  jsonb,
  inet,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ========================================================================== */
/* 3.1 IDENTITY AND TENANCY (08-DATA-MODEL-AND-ERD.md §3.1)                   */
/* ========================================================================== */

export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // UUIDv7
  name: text('name').notNull(),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUSPENDED | DELETED
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  mfaTotpSecret: text('mfa_totp_secret'),
  mfaTotpPendingSecret: text('mfa_totp_pending_secret'),
  mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
  mfaTotpLastStep: bigint('mfa_totp_last_step', { mode: 'number' }).notNull().default(-1),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // EMAIL | PHONE
    value: text('value').notNull(), // normalised lowercase email or E.164 +91 phone
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeValueUq: uniqueIndex('user_identities_type_value_uq').on(t.type, t.value),
    userIdIdx: index('user_identities_user_id_idx').on(t.userId),
  }),
);

export const organisations = pgTable(
  'organisations',
  {
    id: uuid('id').primaryKey(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    entityType: text('entity_type').notNull(), // PROPRIETORSHIP | PARTNERSHIP | LLP | PRIVATE_LIMITED | PUBLIC_LIMITED | OTHER
    status: text('status').notNull().default('PENDING'), // PENDING | ACTIVE | SUSPENDED | CANCELLED | DELETED
    country: text('country').notNull().default('IN'),
    state: text('state').notNull(),
    allowSelfApproval: boolean('allow_self_approval').notNull().default(false),
    allowGenericReview: boolean('allow_generic_review').notNull().default(false),
    docControllerOrgWideDownload: boolean('document_controller_org_wide_download')
      .notNull()
      .default(false),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const orgProfiles = pgTable('org_profiles', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  gstin: text('gstin'),
  pan: text('pan'),
  addressJson: jsonb('address_json').notNull().default({}),
  logoObjectId: uuid('logo_object_id'),
  signatoryName: text('signatory_name'),
  signatoryDesignation: text('signatory_designation'),
  brandColor: text('brand_color').notNull().default('#0F2942'),
  defaultTimezone: text('default_timezone').notNull().default('Asia/Kolkata'),
  defaultLocale: text('default_locale').notNull().default('en-IN'),
  rowVersion: integer('row_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    authGeneration: uuid('auth_generation').notNull().default(sql`gen_random_uuid()`),
    guestGrantId: uuid('guest_grant_id'),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true })
      .notNull().default(sql`now() + interval '90 days'`),
    activeOrgId: uuid('active_org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUq: uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    userActiveIdx: index('sessions_user_active_idx').on(t.userId, t.activeOrgId),
  }),
);

/** G01 one-use verification proofs. SQL maintains the generation/replay checks. */
export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey(),
  channel: text('channel').notNull(),
  identifier: text('identifier').notNull(),
  purpose: text('purpose').notNull(),
  guestGrantId: uuid('guest_grant_id'),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  deliveryStatus: text('delivery_status').notNull().default('SENT'),
  otpGeneration: uuid('otp_generation'),
  authIntentHash: text('auth_intent_hash'),
  ip: inet('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Shared, pseudonymous abuse budgets; no tenant identity before login. */
export const authRequestBudgets = pgTable('auth_request_budgets', {
  budgetKey: text('budget_key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only security outcomes; runtime UPDATE/DELETE is not granted. */
export const authSecurityEvents = pgTable('auth_security_events', {
  id: uuid('id').primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  orgId: uuid('org_id').references(() => organisations.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  outcome: text('outcome').notNull(),
  subjectDigest: text('subject_digest'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mfaRecoveryCodes = pgTable('mfa_recovery_codes', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // R-OWNER | R-ADMIN | R-BILLING | R-PM | R-SITE | R-DOC | R-PROC | R-QC | R-SAFETY | R-REVIEWER | R-AUDITOR
    status: text('status').notNull().default('INVITED'), // INVITED | ACTIVE | SUSPENDED | REMOVED | EXPIRED | REVOKED
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgUserUq: uniqueIndex('memberships_org_user_uq').on(t.orgId, t.userId),
  }),
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    email: text('email'),
    phone: text('phone'),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | ACCEPTED | EXPIRED | REVOKED
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUq: uniqueIndex('invitations_token_hash_uq').on(t.tokenHash),
  }),
);

/* ========================================================================== */
/* 3.2 PARTIES AND PROJECTS (08-DATA-MODEL-AND-ERD.md §3.2)                   */
/* ========================================================================== */

export const parties = pgTable(
  'parties',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    types: text('types').array().notNull(), // CLIENT | MC | CONSULTANT | SUPPLIER_OEM | SUB_SUBCONTRACTOR | LAB | INSURER | OTHER
    gstin: text('gstin'),
    email: text('email'),
    phone: text('phone'),
    addressJson: jsonb('address_json').notNull().default({}),
    notes: text('notes'),
    status: text('status').notNull().default('ACTIVE'),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
  },
  (t) => ({
    orgNameIdx: index('parties_org_name_idx').on(t.orgId, sql`lower(${t.name})`),
    orgGstinIdx: index('parties_org_gstin_idx').on(t.orgId, t.gstin),
  }),
);

export const partyContacts = pgTable('party_contacts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  partyId: uuid('party_id')
    .notNull()
    .references(() => parties.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  designation: text('designation'),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    clientPartyId: uuid('client_party_id').references(() => parties.id),
    mcPartyId: uuid('mc_party_id').references(() => parties.id),
    consultantPartyId: uuid('consultant_party_id').references(() => parties.id),
    status: text('status').notNull().default('DRAFT'), // DRAFT | ACTIVE | SUSPENDED | HANDOVER | CLOSED | CANCELLED | ARCHIVED
    siteJson: jsonb('site_json').notNull().default({}),
    startDate: date('start_date'),
    targetHandoverDate: date('target_handover_date'),
    contractValuePaise: bigint('contract_value_paise', { mode: 'bigint' }),
    currency: text('currency').notNull().default('INR'),
    settingsJson: jsonb('settings_json').notNull().default({}),
    reopenCount: integer('reopen_count').notNull().default(0),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => ({
    orgCodeUq: uniqueIndex('projects_org_code_uq').on(t.orgId, sql`upper(${t.code})`),
    orgIdIdUq: uniqueIndex('projects_org_id_id_uq').on(t.orgId, t.id),
  }),
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    scopeJson: jsonb('scope_json').notNull().default({}),
    status: text('status').notNull().default('ACTIVE'),
    addedBy: uuid('added_by').notNull().references(() => users.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => ({
    projUserUq: uniqueIndex('project_members_proj_user_uq').on(t.projectId, t.userId),
  }),
);

export const guestGrants = pgTable(
  'guest_grants',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id),
    targetEmail: text('target_email'),
    targetPhoneE164: text('target_phone_e164'),
    principalUserId: uuid('principal_user_id').references(() => users.id),
    independentAuthorityVerifiedAt: timestamp('independent_authority_verified_at', { withTimezone: true }),
    independentAuthorityEvidenceRef: text('independent_authority_evidence_ref'),
    failedOtpCount: integer('failed_otp_count').notNull().default(0),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    userId: uuid('user_id').references(() => users.id),
    role: text('role').notNull(), // R-CONSULT | R-CLIENT | R-MC | R-SUPPLIER-OEM | R-SUBCONTRACTOR | R-SUPPLIER-UP | R-LAB | R-OEM-SERVICE
    grantType: text('grant_type').notNull(), // SUPPLIER_UPLOAD | SUPPLIER_CONTRIBUTOR | CONSULTANT_REVIEW | CLIENT_VIEW | MC_VIEW | AUDITOR_READ
    capabilities: text('capabilities').array().notNull(),
    scopeJson: jsonb('scope_json').notNull().default({}), // e.g. { requirementIds: [...] }
    otpRequired: boolean('otp_required').notNull().default(true), // Default true per 05 §6.2
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | EXPIRED | REVOKED
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    tokenHashUq: uniqueIndex('guest_grants_token_hash_uq').on(t.tokenHash),
  }),
);

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    parentContractId: uuid('parent_contract_id'),
    type: text('type').notNull(), // ITEM_RATE | PERCENTAGE_RATE | LUMP_SUM | EPC | OTHER
    valuePaise: bigint('value_paise', { mode: 'bigint' }).notNull().default(0n),
    retentionBps: integer('retention_bps').notNull().default(0), // 0..10000
    dlpMonths: integer('dlp_months').notNull().default(12),
    warrantyTerms: text('warranty_terms'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUPERSEDED
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projRefUq: uniqueIndex('contracts_project_ref_uq').on(t.projectId, t.reference),
    orgProjIdUq: uniqueIndex('contracts_org_proj_id_uq').on(t.orgId, t.projectId, t.id),
  }),
);

export const specificationRefs = pgTable('specification_refs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  contractId: uuid('contract_id').references(() => contracts.id),
  title: text('title').notNull(),
  issuer: text('issuer'),
  revision: text('revision'),
  issueDate: date('issue_date'),
  objectId: uuid('object_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ========================================================================== */
/* 3.3 CONFIGURATION AND CHECKLISTS (08-DATA-MODEL-AND-ERD.md §3.3)           */
/* ========================================================================== */

export const templatePacks = pgTable(
  'template_packs',
  {
    id: uuid('id').primaryKey(),
    trade: text('trade').notNull(), // HVAC
    code: text('code').notNull(), // TPL-HVAC-IN-001
    name: text('name').notNull(),
    version: integer('version').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    payloadJson: jsonb('payload_json').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tradeVerUq: uniqueIndex('template_packs_trade_ver_uq').on(t.trade, t.version),
  }),
);

export const configVersions = pgTable(
  'config_versions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').references(() => organisations.id),
    level: text('level').notNull(), // PLATFORM | TRADE | ORG | CLIENT_CONTRACT | PROJECT
    scopeType: text('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(), // Sentinel 00000000-0000-0000-0000-000000000000 when unscoped
    versionNo: integer('version_no').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    payloadJson: jsonb('payload_json').notNull(),
    checksum: text('checksum').notNull(),
    status: text('status').notNull().default('DRAFT'), // DRAFT | ACTIVE | ARCHIVED
    sourcePackId: uuid('source_pack_id').references(() => templatePacks.id),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => ({
    levelScopeVerUq: uniqueIndex('config_versions_level_scope_ver_uq').on(
      t.level,
      t.scopeType,
      t.scopeId,
      t.versionNo,
    ),
  }),
);

export const clientProfiles = pgTable('client_profiles', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  name: text('name').notNull(),
  clientPartyId: uuid('client_party_id').references(() => parties.id),
  payloadJson: jsonb('payload_json').notNull().default({}),
  status: text('status').notNull().default('ACTIVE'),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const checklistSnapshots = pgTable(
  'checklist_snapshots',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    status: text('status').notNull().default('DRAFT'), // DRAFT | ACTIVE | SUPERSEDED | ARCHIVED
    resolvedPayloadJson: jsonb('resolved_payload_json').notNull(),
    provenanceJson: jsonb('provenance_json').notNull(),
    sourceJson: jsonb('source_json').notNull(),
    checksum: text('checksum').notNull(),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projVerUq: uniqueIndex('checklist_snapshots_proj_ver_uq').on(t.projectId, t.versionNo),
    orgProjIdUq: uniqueIndex('checklist_snapshots_org_proj_id_uq').on(t.orgId, t.projectId, t.id),
  }),
);

export const requirements = pgTable(
  'requirements',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    currentSnapshotId: uuid('current_snapshot_id')
      .notNull()
      .references(() => checklistSnapshots.id),
    requirementKey: text('requirement_key').notNull(),
    scopeKey: text('scope_key').notNull().default('project'), // 'project' or 'asset:{uuid}' (AUD-002)
    groupKey: text('group_key').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    docTypeKey: text('doc_type_key').notNull(),
    mandatory: boolean('mandatory').notNull().default(true),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    ownerPartyId: uuid('owner_party_id').references(() => parties.id),
    reviewerRole: text('reviewer_role'), // Enforced per requirement by FR-REV-002 / AUD-005
    dueAt: timestamp('due_at', { withTimezone: true }), // NULL => never MISSING (FR-CHK-010)
    status: text('status').notNull().default('NOT_STARTED'),
    validityRuleJson: jsonb('validity_rule_json').notNull().default({}),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProjIdUq: uniqueIndex('requirements_org_proj_id_uq').on(t.orgId, t.projectId, t.id),
    projStatusIdx: index('requirements_proj_status_idx').on(t.orgId, t.projectId, t.status),
  }),
);

export const requirementChangeRequests = pgTable('requirement_change_requests', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  requestedBy: uuid('requested_by').references(() => users.id),
  reason: text('reason').notNull(),
  itemsJson: jsonb('items_json').notNull(),
  impactJson: jsonb('impact_json').notNull().default({}),
  status: text('status').notNull().default('DRAFT'), // DRAFT | SUBMITTED | APPROVED | REJECTED | APPLIED
  approvedBy: uuid('approved_by').references(() => users.id),
  appliedSnapshotId: uuid('applied_snapshot_id').references(() => checklistSnapshots.id),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const requirementRevisions = pgTable('requirement_revisions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  requirementId: uuid('requirement_id')
    .notNull()
    .references(() => requirements.id),
  snapshotId: uuid('snapshot_id')
    .notNull()
    .references(() => checklistSnapshots.id),
  changeRequestId: uuid('change_request_id').references(() => requirementChangeRequests.id),
  fieldDiffJson: jsonb('field_diff_json').notNull(),
  reason: text('reason').notNull(),
  changedBy: uuid('changed_by')
    .notNull()
    .references(() => users.id),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
});

export const waivers = pgTable('waivers', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  requirementId: uuid('requirement_id')
    .notNull()
    .references(() => requirements.id),
  type: text('type').notNull(), // WAIVE | NOT_APPLICABLE
  reason: text('reason').notNull(),
  evidenceObjectId: uuid('evidence_object_id'),
  approvedBy: uuid('approved_by')
    .notNull()
    .references(() => users.id),
  secondApprovedBy: uuid('second_approved_by').references(() => users.id), // Mandatory when requirement.mandatory = true (FR-CHK-016)
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('ACTIVE'),
});

/* ========================================================================== */
/* 3.4 ASSETS / EQUIPMENT REGISTER (08-DATA-MODEL-AND-ERD.md §3.4)            */
/* ========================================================================== */

export const assetCategories = pgTable(
  'asset_categories',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').references(() => organisations.id), // NULL = platform default
    key: text('key').notNull(),
    name: text('name').notNull(),
    parentKey: text('parent_key'),
    metadataSchemaJson: jsonb('metadata_schema_json').notNull().default({}),
  },
  (t) => ({
    orgKeyUq: uniqueIndex('asset_categories_org_key_uq').on(t.orgId, t.key),
  }),
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    name: text('name').notNull(),
    categoryKey: text('category_key').notNull(),
    make: text('make'),
    model: text('model'),
    serialNo: text('serial_no'),
    location: text('location'),
    capacityJson: jsonb('capacity_json').notNull().default({}),
    refrigerant: text('refrigerant'),
    installDate: date('install_date'),
    warrantyStart: date('warranty_start'),
    warrantyStartBasis: text('warranty_start_basis').notNull().default('HANDOVER'), // COMMISSIONING | HANDOVER | ACCEPTANCE | SUPPLY
    warrantyEnd: date('warranty_end'),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | REPLACED | RETIRED
    replacedByAssetId: uuid('replaced_by_asset_id'),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    projTagUq: uniqueIndex('assets_proj_tag_uq').on(t.projectId, sql`upper(${t.tag})`),
    orgProjIdUq: uniqueIndex('assets_org_proj_id_uq').on(t.orgId, t.projectId, t.id),
  }),
);

/* ========================================================================== */
/* 3.5 STORAGE AND DOCUMENTS (08-DATA-MODEL-AND-ERD.md §3.5)                  */
/* ========================================================================== */

export const storageObjects = pgTable(
  'storage_objects',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    provider: text('provider').notNull().default('S3'),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull().default('document'),
    s3UploadId: text('s3_upload_id'),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    expectedSha256: text('expected_sha256'),
    observedSizeBytes: bigint('observed_size_bytes', { mode: 'bigint' }),
    providerVersionId: text('provider_version_id'),
    sha256: text('sha256'), // Observed digest; required once READY (08 §8 Rule 16)
    status: text('status').notNull().default('PENDING'), // PENDING | READY | QUARANTINED | FAILED | DELETED
    retentionClass: text('retention_class').notNull().default('PROJECT_PLUS_8Y'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerBucketKeyUq: uniqueIndex('storage_objects_bucket_key_uq').on(
      t.provider,
      t.bucket,
      t.objectKey,
    ),
    orgShaIdx: index('storage_objects_org_sha_idx').on(t.orgId, t.sha256),
  }),
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    docTypeKey: text('doc_type_key').notNull(),
    categoryKey: text('category_key').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUPERSEDED | ARCHIVED
    latestVersionId: uuid('latest_version_id'),
    currentApprovedVersionId: uuid('current_approved_version_id'),
    language: text('language').notNull().default('en'),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    retentionClass: text('retention_class').notNull().default('PROJECT_PLUS_8Y'),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
  },
  (t) => ({
    orgProjIdUq: uniqueIndex('documents_org_proj_id_uq').on(t.orgId, t.projectId, t.id),
    projStatusIdx: index('documents_proj_status_idx').on(t.orgId, t.projectId, t.status),
  }),
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    revisionCode: text('revision_code').notNull(), // Reserved even when soft-deleted (AUD-P-04)
    objectId: uuid('object_id')
      .notNull()
      .references(() => storageObjects.id),
    fileStatus: text('file_status').notNull().default('PENDING_UPLOAD'), // PENDING_UPLOAD | UPLOADING | PROCESSING | READY | QUARANTINED | FAILED | ARCHIVED
    reviewStatus: text('review_status').notNull().default('NOT_SUBMITTED'), // NOT_SUBMITTED | IN_REVIEW | APPROVED | CHANGES_REQUESTED | REJECTED | SUPERSEDED
    supersedesVersionId: uuid('supersedes_version_id'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    issueDate: date('issue_date').notNull(),
    expiryDate: date('expiry_date'),
    validityBasis: text('validity_basis').notNull().default('REVISION_BASED'),
    externalComment: text('external_comment'),
    internalNote: text('internal_note'), // Never exposed to guests (FR-DOC-024 / 05 §6.4)
    metadataJson: jsonb('metadata_json').notNull().default({}),
    checksJson: jsonb('checks_json').notNull().default({}),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    uploadedByGuestGrantId: uuid('uploaded_by_grant_id').references(() => guestGrants.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    docVerNoUq: uniqueIndex('document_versions_doc_ver_no_uq').on(t.documentId, t.versionNo),
    docRevCodeUq: uniqueIndex('document_versions_doc_rev_code_uq').on(
      t.documentId,
      t.revisionCode,
    ),
    orgProjIdUq: uniqueIndex('document_versions_org_proj_id_uq').on(
      t.orgId,
      t.projectId,
      t.id,
    ),
  }),
);

export const documentRequirements = pgTable(
  'document_requirements',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docReqUq: uniqueIndex('document_requirements_doc_req_uq').on(t.documentId, t.requirementId),
  }),
);

export const documentAssets = pgTable(
  'document_assets',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docAssetUq: uniqueIndex('document_assets_doc_asset_uq').on(t.documentId, t.assetId),
  }),
);

export const assetIdentityRevisions = pgTable(
  'asset_identity_revisions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    tag: text('tag').notNull(),
    name: text('name').notNull(),
    make: text('make'),
    model: text('model'),
    serialNo: text('serial_no'),
    location: text('location'),
    changeType: text('change_type').notNull().default('CLERICAL_CORRECTION'),
    reason: text('reason').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetRevUq: uniqueIndex('asset_identity_rev_uq').on(t.assetId, t.revisionNo),
  }),
);

export const evidenceRevalidations = pgTable(
  'evidence_revalidations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    identityRevisionId: uuid('identity_revision_id')
      .notNull()
      .references(() => assetIdentityRevisions.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'),
    revalidationNotes: text('revalidation_notes'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docRevUq: uniqueIndex('evidence_reval_doc_rev_uq').on(t.identityRevisionId, t.documentVersionId),
  }),
);

export const evidenceCompanionRules = pgTable(
  'evidence_companion_rules',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    ruleCode: text('rule_code').notNull(),
    ruleName: text('rule_name').notNull(),
    primaryDocType: text('primary_doc_type').notNull(),
    companionDocType: text('companion_doc_type').notNull(),
    description: text('description'),
    isMandatory: boolean('is_mandatory').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCodeUq: uniqueIndex('companion_rules_org_code_uq').on(t.orgId, t.ruleCode),
  }),
);

export const procurementOrders = pgTable(
  'procurement_orders',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    poNumber: text('po_number').notNull(),
    supplierPartyId: uuid('supplier_party_id')
      .notNull()
      .references(() => parties.id),
    status: text('status').notNull().default('ISSUED'),
    orderedAt: date('ordered_at').notNull().defaultNow(),
    promisedDeliveryAt: date('promised_delivery_at'),
    totalAmountPaise: bigint('total_amount_paise', { mode: 'bigint' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProjPoUq: uniqueIndex('procurement_orders_org_proj_po_uq').on(
      t.orgId,
      t.projectId,
      t.poNumber,
    ),
  }),
);

export const procurementOrderLines = pgTable(
  'procurement_order_lines',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    poId: uuid('po_id')
      .notNull()
      .references(() => procurementOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    assetCategoryKey: text('asset_category_key').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    assetId: uuid('asset_id').references(() => assets.id),
    make: text('make'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    poLineUq: uniqueIndex('po_lines_po_line_uq').on(t.poId, t.lineNo),
  }),
);

export const supplierDocumentObligations = pgTable(
  'supplier_document_obligations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    poLineId: uuid('po_line_id')
      .notNull()
      .references(() => procurementOrderLines.id, { onDelete: 'cascade' }),
    docTypeKey: text('doc_type_key').notNull(),
    stageKey: text('stage_key').notNull().default('FAT'),
    title: text('title').notNull(),
    dueDate: date('due_date'),
    supplierPartyId: uuid('supplier_party_id').references(() => parties.id),
    status: text('status').notNull().default('PENDING'),
    requirementId: uuid('requirement_id').references(() => requirements.id),
    documentVersionId: uuid('document_version_id').references(() => documentVersions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const documentContracts = pgTable(
  'document_contracts',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    docContractUq: uniqueIndex('document_contracts_doc_contract_uq').on(
      t.documentId,
      t.contractId,
    ),
  }),
);

export const documentEvents = pgTable('document_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payloadJson: jsonb('payload_json').notNull().default({}),
  actorId: uuid('actor_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ========================================================================== */
/* 3.6 REVIEW AND APPROVAL (08-DATA-MODEL-AND-ERD.md §3.6)                    */
/* ========================================================================== */

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    stageKey: text('stage_key').notNull().default('DEFAULT'),
    reviewerSubjectType: text('reviewer_subject_type').notNull(), // USER | PARTY (AUD-A-07)
    reviewerSubjectId: uuid('reviewer_subject_id').notNull(),
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id),
    reviewerPartyId: uuid('reviewer_party_id').references(() => parties.id),
    method: text('method').notNull().default('IN_APP'), // IN_APP | EXTERNAL (AUD-010 / WF-23)
    externalMethod: text('external_method'), // STAMPED_PDF | EMAIL | PORTAL | PHYSICAL
    externalApproverName: text('external_approver_name'),
    externalApproverRole: text('external_approver_role'),
    externalReference: text('external_reference'),
    evidenceObjectId: uuid('evidence_object_id').references(() => storageObjects.id),
    externalProofVersionId: uuid('external_proof_version_id').references(() => documentVersions.id),
    status: text('status').notNull().default('PENDING'), // PENDING | IN_REVIEW | APPROVED | CHANGES_REQUESTED | REJECTED | CANCELLED
    decision: text('decision'), // APPROVE | REQUEST_CHANGES | REJECT
    comment: text('comment'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    occurredAtPrecision: text('occurred_at_precision').notNull().default('INSTANT'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    backdatingReason: text('backdating_reason'),
    onBehalfOfUserId: uuid('on_behalf_of_user_id').references(() => users.id),
    isOverride: boolean('is_override').notNull().default(false),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    verStageSubjectUq: uniqueIndex('reviews_ver_stage_subject_uq').on(
      t.documentVersionId,
      t.stageKey,
      t.reviewerSubjectType,
      t.reviewerSubjectId,
    ),
  }),
);

export const reviewComments = pgTable('review_comments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  pageNo: integer('page_no'),
  pinX: integer('pin_x'),
  pinY: integer('pin_y'),
  body: text('body').notNull(),
  visibility: text('visibility').notNull().default('EXTERNAL'), // INTERNAL | EXTERNAL
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalOverrides = pgTable('approval_overrides', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  reason: text('reason').notNull(),
  previousDecision: text('previous_decision'),
  newDecision: text('new_decision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ========================================================================== */
/* 3.7 HANDOVER PACKAGES AND SUBMISSIONS (08-DATA-MODEL-AND-ERD.md §3.7)      */
/* ========================================================================== */

export const handoverPackages = pgTable(
  'handover_packages',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    status: text('status').notNull().default('DRAFT'), // DRAFT | QUEUED | GENERATING | READY | FAILED | SUBMITTED | ACCEPTED | REJECTED | SUPERSEDED
    scopeJson: jsonb('scope_json').notNull().default({}),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => checklistSnapshots.id),
    snapshotChecksum: text('snapshot_checksum').notNull(), // Required per FR-HND-021 / 08 §8 Rule 17
    overrideReason: text('override_reason'),
    pdfObjectId: uuid('pdf_object_id').references(() => storageObjects.id),
    zipObjectId: uuid('zip_object_id').references(() => storageObjects.id),
    manifestObjectId: uuid('manifest_object_id').references(() => storageObjects.id),
    checksum: text('checksum'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projVerUq: uniqueIndex('handover_packages_proj_ver_uq').on(t.projectId, t.versionNo),
    orgProjIdUq: uniqueIndex('handover_packages_org_proj_id_uq').on(
      t.orgId,
      t.projectId,
      t.id,
    ),
  }),
);

export const packageItems = pgTable('package_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  packageId: uuid('package_id')
    .notNull()
    .references(() => handoverPackages.id, { onDelete: 'cascade' }),
  documentVersionId: uuid('document_version_id')
    .notNull()
    .references(() => documentVersions.id),
  sectionKey: text('section_key').notNull(),
  sortOrder: integer('sort_order').notNull(),
  pageStart: integer('page_start'),
  pageEnd: integer('page_end'),
  included: boolean('included').notNull().default(true),
  exclusionReason: text('exclusion_reason'),
});

export const packageRequirements = pgTable('package_requirements', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  packageId: uuid('package_id')
    .notNull()
    .references(() => handoverPackages.id, { onDelete: 'cascade' }),
  requirementId: uuid('requirement_id')
    .notNull()
    .references(() => requirements.id),
  requirementKey: text('requirement_key').notNull(),
  scopeKey: text('scope_key').notNull(),
  title: text('title').notNull(),
  docTypeKey: text('doc_type_key').notNull(),
  mandatory: boolean('mandatory').notNull(),
  statusAtGeneration: text('status_at_generation').notNull(),
  dueAtAtGeneration: timestamp('due_at_at_generation', { withTimezone: true }),
  assetTag: text('asset_tag'),
  decision: text('decision'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionMethod: text('decision_method'),
});

export const transmittals = pgTable('transmittals', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  transmittalNo: text('transmittal_no').notNull(),
  status: text('status').notNull().default('DRAFT'),
  notes: text('notes'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProjectIdUq: uniqueIndex('transmittals_org_project_id_uq').on(t.orgId, t.projectId, t.id),
  projectNumberUq: uniqueIndex('transmittals_project_number_uq').on(t.orgId, t.projectId, t.transmittalNo),
  projectCreatedIdx: index('transmittals_project_created_idx').on(t.orgId, t.projectId, t.createdAt),
}));

export const transmittalItems = pgTable('transmittal_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  transmittalId: uuid('transmittal_id').notNull().references(() => transmittals.id, { onDelete: 'cascade' }),
  documentVersionId: uuid('document_version_id').notNull().references(() => documentVersions.id),
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  documentVersionUq: uniqueIndex('transmittal_items_version_uq').on(t.orgId, t.projectId, t.transmittalId, t.documentVersionId),
}));

export const archiveExports = pgTable(
  'archive_exports',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    schemaVersion: text('schema_version').notNull().default('2.0'),
    status: text('status').notNull().default('PENDING'),
    archiveSha256: text('archive_sha256'),
    totalObjects: integer('total_objects').notNull().default(0),
    totalBytes: bigint('total_bytes', { mode: 'bigint' }).notNull().default(sql`0`),
    manifestJson: jsonb('manifest_json').notNull().default({}),
    verificationReceiptJson: jsonb('verification_receipt_json').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    orgProjStatusIdx: index('idx_archive_exports_proj').on(t.orgId, t.projectId, t.status),
  }),
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id').references(() => handoverPackages.id),
    method: text('method').notNull(), // PORTAL | EMAIL | PHYSICAL
    reference: text('reference'),
    status: text('status').notNull().default('DRAFT'), // DRAFT | SENT | ACKNOWLEDGED | ACCEPTED | REJECTED | WITHDRAWN
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    notes: text('notes'),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProjIdUq: uniqueIndex('submissions_org_proj_id_uq').on(t.orgId, t.projectId, t.id),
  }),
);

export const submissionRecipients = pgTable('submission_recipients', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  recipientPartyId: uuid('recipient_party_id')
    .notNull()
    .references(() => parties.id),
  recipientRole: text('recipient_role').notNull(), // CLIENT | MC | CONSULTANT | OTHER (AUD-020 / FR-HND-019)
  status: text('status').notNull().default('SENT'),
  decision: text('decision'), // ACCEPT | ACCEPT_WITH_EXCEPTIONS | REJECT
  remarks: text('remarks'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const submissionEvents = pgTable('submission_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payloadJson: jsonb('payload_json').notNull().default({}),
  actorId: uuid('actor_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const packageLayouts = pgTable('package_layouts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  key: text('key').notNull(),
  name: text('name').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ========================================================================== */
/* 3.8 NOTIFICATIONS, AUDIT, JOBS & OUTBOX (08-DATA-MODEL-AND-ERD.md §3.8)    */
/* ========================================================================== */

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').references(() => organisations.id),
    key: text('key').notNull(),
    channel: text('channel').notNull(), // IN_APP | EMAIL | SMS | WHATSAPP
    locale: text('locale').notNull().default('en'),
    subject: text('subject'),
    body: text('body').notNull(),
    status: text('status').notNull().default('ACTIVE'),
  },
  (t) => ({
    orgKeyChanLocUq: uniqueIndex('notification_templates_uq').on(
      t.orgId,
      t.key,
      t.channel,
      t.locale,
    ),
  }),
);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  recipientUserId: uuid('recipient_user_id').references(() => users.id),
  recipientPartyId: uuid('recipient_party_id').references(() => parties.id),
  channel: text('channel').notNull(), // IN_APP | EMAIL | SMS | WHATSAPP
  eventKey: text('event_key').notNull(),
  payloadJson: jsonb('payload_json').notNull().default({}),
  status: text('status').notNull().default('QUEUED'), // QUEUED | SENT | FAILED | READ
  dedupKey: text('dedup_key').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  channel: text('channel').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  digest: text('digest').notNull().default('IMMEDIATE'), // IMMEDIATE | DAILY | WEEKLY
});

export const securityEvents = pgTable('security_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').references(() => organisations.id),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  eventType: text('event_type').notNull(),
  detailJson: jsonb('detail_json').notNull().default({}),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminAuditEvents = pgTable('admin_audit_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').references(() => organisations.id),
  adminUserId: uuid('admin_user_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  reason: text('reason').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  ip: inet('ip'),
  requestId: text('request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobExecutions = pgTable('job_executions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').references(() => organisations.id),
  jobType: text('job_type').notNull(),
  jobId: text('job_id').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(1),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    endpoint: text('endpoint').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseJson: jsonb('response_json').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgKeyEndpointUq: uniqueIndex('idempotency_keys_org_key_ep_uq').on(
      t.orgId,
      t.key,
      t.endpoint,
    ),
  }),
);

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id'),
  eventType: text('event_type').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ========================================================================== */
/* 3.10 BILLING, GST, E-INVOICE & TDS (08-DATA-MODEL-AND-ERD.md §3.10)        */
/* ========================================================================== */

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(), // STARTER | GROWTH | SCALE
    name: text('name').notNull(),
    limitsJson: jsonb('limits_json').notNull(), // { maxActiveProjects, maxSeats, maxStorageBytes, maxPackageGenerationsPerMonth }
    pricePaise: bigint('price_paise', { mode: 'bigint' }).notNull(),
    interval: text('interval').notNull(), // MONTH | YEAR
    status: text('status').notNull().default('ACTIVE'),
  },
  (t) => ({
    codeUq: uniqueIndex('plans_code_uq').on(t.code),
  }),
);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  status: text('status').notNull().default('TRIAL'), // TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED
  provider: text('provider').notNull().default('RAZORPAY'),
  providerRef: text('provider_ref'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelAt: timestamp('cancel_at', { withTimezone: true }),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
    number: text('number').notNull(),
    status: text('status').notNull().default('ISSUED'), // DRAFT | ISSUED | PAID | VOID
    subtotalPaise: bigint('subtotal_paise', { mode: 'bigint' }).notNull(),
    taxPaise: bigint('tax_paise', { mode: 'bigint' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'bigint' }).notNull(),
    taxRateBps: integer('tax_rate_bps').notNull(), // Configurable, e.g. 1800
    sac: text('sac').notNull(), // Configurable SAC code
    buyerGstin: text('buyer_gstin'),
    placeOfSupply: text('place_of_supply').notNull(),
    irn: text('irn'), // e-Invoice IRN (inactive until CA confirms per AUD-013)
    qrPayload: text('qr_payload'),
    einvoiceStatus: text('einvoice_status').notNull().default('NOT_APPLICABLE'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    pdfObjectId: uuid('pdf_object_id').references(() => storageObjects.id),
  },
  (t) => ({
    numberUq: uniqueIndex('invoices_number_uq').on(t.number),
  }),
);

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitPaise: bigint('unit_paise', { mode: 'bigint' }).notNull(),
  taxRateBps: integer('tax_rate_bps').notNull(),
  amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
});

export const invoiceTds = pgTable('invoice_tds', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  section: text('section').notNull(), // e.g. 194J / 194C
  rateBps: integer('rate_bps').notNull(),
  amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
  certificateReference: text('certificate_reference'),
  deductedAt: date('deducted_at').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').references(() => organisations.id),
    provider: text('provider').notNull().default('RAZORPAY'),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdUq: uniqueIndex('payment_events_event_id_uq').on(t.eventId),
  }),
);

export const usageCounters = pgTable(
  'usage_counters',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    metric: text('metric').notNull(), // ACTIVE_PROJECTS | SEATS | STORAGE_BYTES | PACKAGE_GENERATIONS
    period: text('period').notNull(), // ALL_TIME or YYYY-MM
    value: bigint('value', { mode: 'bigint' }).notNull().default(0n),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgMetricPeriodUq: uniqueIndex('usage_counters_org_metric_period_uq').on(
      t.orgId,
      t.metric,
      t.period,
    ),
  }),
);

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    number: text('number').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    reason: text('reason').notNull(),
    approvedBy: uuid('approved_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    numberUq: uniqueIndex('credit_notes_number_uq').on(t.number),
  }),
);

/* ========================================================================== */
/* 3.11 WARRANTY, DEFECTS & VARIATIONS (08-DATA-MODEL-AND-ERD.md §3.11)       */
/* ========================================================================== */

export const warrantyEvents = pgTable('warranty_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(), // REGISTRATION | CONFIRMATION | CLAIM | EXTENSION
  status: text('status').notNull().default('RECORDED'), // RECORDED | CONFIRMED | DISPUTED | CLAIMED
  oemReference: text('oem_reference').notNull(),
  registeredAt: date('registered_at').notNull(),
  warrantyStart: date('warranty_start').notNull(),
  warrantyEnd: date('warranty_end').notNull(),
  basis: text('basis').notNull(), // COMMISSIONING | HANDOVER | ACCEPTANCE | SUPPLY
  evidenceObjectId: uuid('evidence_object_id').references(() => storageObjects.id),
  notes: text('notes'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  occurredAtPrecision: text('occurred_at_precision').notNull().default('DATE'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  backdatingReason: text('backdating_reason'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const defects = pgTable('defects', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').references(() => assets.id),
  requirementId: uuid('requirement_id').references(() => requirements.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  severity: text('severity').notNull().default('MAJOR'), // CRITICAL | MAJOR | MINOR
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  assignedPartyId: uuid('assigned_party_id').references(() => parties.id),
  raisedBy: uuid('raised_by')
    .notNull()
    .references(() => users.id),
  raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: text('status').notNull().default('OPEN'), // OPEN | IN_PROGRESS | RECTIFIED | CLOSED | WAIVED
  closureEvidenceObjectId: uuid('closure_evidence_object_id').references(
    () => storageObjects.id,
  ),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: uuid('closed_by').references(() => users.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  occurredAtPrecision: text('occurred_at_precision').notNull().default('INSTANT'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  backdatingReason: text('backdating_reason'),
  rowVersion: integer('row_version').notNull().default(1),
});

export const variations = pgTable('variations', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  contractId: uuid('contract_id')
    .notNull()
    .references(() => contracts.id),
  reference: text('reference').notNull(),
  description: text('description').notNull(),
  valuePaiseDelta: bigint('value_paise_delta', { mode: 'bigint' }).notNull().default(0n),
  timeDaysDelta: integer('time_days_delta').notNull().default(0),
  status: text('status').notNull().default('DRAFT'), // DRAFT | SUBMITTED | APPROVED | REJECTED | SUPERSEDED
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  changeRequestId: uuid('change_request_id').references(() => requirementChangeRequests.id),
  rowVersion: integer('row_version').notNull().default(1),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ========================================================================== */
/* 3.12 RETENTION, LEGAL HOLDS & DSR (08-DATA-MODEL-AND-ERD.md §3.12)         */
/* ========================================================================== */

export const retentionPolicies = pgTable('retention_policies', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').references(() => organisations.id),
  code: text('code').notNull(), // PROJECT_PLUS_8Y
  entityType: text('entity_type').notNull(),
  retentionMonths: integer('retention_months').notNull().default(96),
  basis: text('basis').notNull().default('PROJECT_CLOSURE'),
  status: text('status').notNull().default('ACTIVE'),
});

export const legalHolds = pgTable('legal_holds', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
});

export const deletionRequests = pgTable('deletion_requests', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  subjectType: text('subject_type').notNull(), // ORG | USER
  subjectId: uuid('subject_id').notNull(),
  status: text('status').notNull().default('REQUESTED'), // REQUESTED | ACKNOWLEDGED | COMPLETED | REJECTED
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
});
