export type OutboxEventCategory = 'EXECUTABLE' | 'INFORMATIONAL';

export interface OutboxEventRegistration {
  type: string;
  category: OutboxEventCategory;
  version: number;
  description: string;
}

export const OUTBOX_EVENT_REGISTRY: Record<string, OutboxEventRegistration> = {
  // Executable events: processed by BullMQ queues with retry, backoff and DLQ
  FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN: {
    type: 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN',
    category: 'EXECUTABLE',
    version: 1,
    description: 'Enqueues antivirus scanning and structural verification for uploaded storage object',
  },
  HANDOVER_PACKAGE_QUEUED: {
    type: 'HANDOVER_PACKAGE_QUEUED',
    category: 'EXECUTABLE',
    version: 1,
    description: 'Enqueues handover package dossier compilation, PDF sanitisation and Bates stamping',
  },
  PROJECT_ARCHIVE_EXPORT_QUEUED: {
    type: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
    category: 'EXECUTABLE',
    version: 1,
    description: 'Enqueues immutable portable archive ZIP generation with verifiable manifest',
  },

  // Project lifecycle informational events
  PROJECT_ARCHIVED: {type:'PROJECT_ARCHIVED',category:'INFORMATIONAL',version:1,description:'Audited project lifecycle transition'},
  PROJECT_CANCELLED: {type:'PROJECT_CANCELLED',category:'INFORMATIONAL',version:1,description:'Audited project lifecycle transition'},
  PROJECT_RESUMED: {type:'PROJECT_RESUMED',category:'INFORMATIONAL',version:1,description:'Audited project lifecycle transition'},
  PROJECT_SUSPENDED: {type:'PROJECT_SUSPENDED',category:'INFORMATIONAL',version:1,description:'Audited project lifecycle transition'},
  PROJECT_BASELINE_REVIEWED: {type:'PROJECT_BASELINE_REVIEWED',category:'INFORMATIONAL',version:1,description:'Versioned configuration and independent review history'},
  REQUIREMENT_CHANGE_DECIDED:{type:'REQUIREMENT_CHANGE_DECIDED',category:'INFORMATIONAL',version:1,description:'Independent baseline change decision recorded'},
  BASELINE_CHANGE_REQUESTED: {type:'BASELINE_CHANGE_REQUESTED',category:'INFORMATIONAL',version:1,description:'Versioned configuration and independent review history'},
  CONFIGURATION_VERSION_ARCHIVED: {type:'CONFIGURATION_VERSION_ARCHIVED',category:'INFORMATIONAL',version:1,description:'Versioned configuration and independent review history'},
  CONFIGURATION_VERSION_PUBLISHED: {type:'CONFIGURATION_VERSION_PUBLISHED',category:'INFORMATIONAL',version:1,description:'Versioned configuration and independent review history'},
  CONFIGURATION_VERSION_CREATED: {type:'CONFIGURATION_VERSION_CREATED',category:'INFORMATIONAL',version:1,description:'Versioned configuration and independent review history'},
  NOTIFICATION_PREFERENCE_UPDATED:{type:'NOTIFICATION_PREFERENCE_UPDATED',category:'INFORMATIONAL',version:1,description:'Current user notification preference changed'},
  NOTIFICATION_REDRIVEN:{type:'NOTIFICATION_REDRIVEN',category:'INFORMATIONAL',version:1,description:'Audited notification dead-letter recovery'},
  ORGANISATION_DELETION_CANCELLED:{type:'ORGANISATION_DELETION_CANCELLED',category:'INFORMATIONAL',version:1,description:'Audited organisation administration operation'},
  ORGANISATION_DELETION_REQUESTED:{type:'ORGANISATION_DELETION_REQUESTED',category:'INFORMATIONAL',version:1,description:'Audited organisation administration operation'},
  ORGANISATION_ONBOARDING_UPDATED:{type:'ORGANISATION_ONBOARDING_UPDATED',category:'INFORMATIONAL',version:1,description:'Audited organisation administration operation'},
  MEMBER_WORK_ALLOCATED:{type:'MEMBER_WORK_ALLOCATED',category:'INFORMATIONAL',version:1,description:'Audited per-work operational allocation'},
  MEMBER_REACTIVATED:{type:'MEMBER_REACTIVATED',category:'INFORMATIONAL',version:1,description:'Audited organisation administration operation'},
  PROJECT_OFFER_BOUND:{type:'PROJECT_OFFER_BOUND',category:'INFORMATIONAL',version:1,description:'Approved project offer bound to its immutable project scope'},
  PROJECT_CREATED: { type: 'PROJECT_CREATED', category: 'INFORMATIONAL', version: 1, description: 'Project record created' },
  PROJECT_ACTIVATED: { type: 'PROJECT_ACTIVATED', category: 'INFORMATIONAL', version: 1, description: 'Project transitioned to active delivery' },
  PROJECT_CLOSED: { type: 'PROJECT_CLOSED', category: 'INFORMATIONAL', version: 1, description: 'Project closed following acceptance' },
  PROJECT_REOPENED: { type: 'PROJECT_REOPENED', category: 'INFORMATIONAL', version: 1, description: 'Project reopened for warranty/aftercare' },
  PROJECT_HANDOVER_INITIATED: { type: 'PROJECT_HANDOVER_INITIATED', category: 'INFORMATIONAL', version: 1, description: 'Project handover phase initiated' },
  PROJECT_ARCHIVE_MANIFEST_CREATED: { type: 'PROJECT_ARCHIVE_MANIFEST_CREATED', category: 'INFORMATIONAL', version: 1, description: 'Archive manifest generated' },

  // Asset lifecycle informational events
  ASSET_CREATED: { type: 'ASSET_CREATED', category: 'INFORMATIONAL', version: 1, description: 'Equipment asset registered' },
  ASSET_UPDATED: { type: 'ASSET_UPDATED', category: 'INFORMATIONAL', version: 1, description: 'Equipment asset metadata updated' },
  ASSET_DELETED: { type: 'ASSET_DELETED', category: 'INFORMATIONAL', version: 1, description: 'Equipment asset removed or retired' },
  ASSET_IDENTITY_REVISED: { type: 'ASSET_IDENTITY_REVISED', category: 'INFORMATIONAL', version: 1, description: 'Asset serial or make/model revised' },
  EVIDENCE_REVALIDATION_DECIDED: { type: 'EVIDENCE_REVALIDATION_DECIDED', category: 'INFORMATIONAL', version: 1, description: 'Revalidation outcome decided' },

  UPLOAD_INTENT_EXPIRED: {type:'UPLOAD_INTENT_EXPIRED',category:'INFORMATIONAL',version:1,description:'Local upload expiry; physical provider cleanup not confirmed'},

  // Document & review informational events
  DOCUMENT_VERSION_CREATED: { type: 'DOCUMENT_VERSION_CREATED', category: 'INFORMATIONAL', version: 1, description: 'New document version uploaded' },
  DOCUMENT_SUBMITTED_FOR_REVIEW: { type: 'DOCUMENT_SUBMITTED_FOR_REVIEW', category: 'INFORMATIONAL', version: 1, description: 'Document version submitted for review' },
  DOCUMENT_REVIEW_DECIDED: { type: 'DOCUMENT_REVIEW_DECIDED', category: 'INFORMATIONAL', version: 1, description: 'Review decision recorded on version' },
  DOCUMENT_APPROVED: { type: 'DOCUMENT_APPROVED', category: 'INFORMATIONAL', version: 1, description: 'Document approved by reviewer' },
  EXTERNAL_APPROVAL_RECORDED: { type: 'EXTERNAL_APPROVAL_RECORDED', category: 'INFORMATIONAL', version: 1, description: 'External authority approval registered' },

  // Checklist, requirement & waiver events
  CHECKLIST_SNAPSHOT_CREATED: { type: 'CHECKLIST_SNAPSHOT_CREATED', category: 'INFORMATIONAL', version: 1, description: 'Baseline checklist snapshot frozen' },
  REQUIREMENT_PENDING: { type: 'REQUIREMENT_PENDING', category: 'INFORMATIONAL', version: 1, description: 'Requirement awaiting evidence' },
  REQUIREMENT_IN_REVIEW: { type: 'REQUIREMENT_IN_REVIEW', category: 'INFORMATIONAL', version: 1, description: 'Requirement evidence in review' },
  REQUIREMENT_APPROVED: { type: 'REQUIREMENT_APPROVED', category: 'INFORMATIONAL', version: 1, description: 'Requirement evidence approved' },
  REQUIREMENT_REJECTED: { type: 'REQUIREMENT_REJECTED', category: 'INFORMATIONAL', version: 1, description: 'Requirement evidence rejected' },
  REQUIREMENT_WAIVED: { type: 'REQUIREMENT_WAIVED', category: 'INFORMATIONAL', version: 1, description: 'Requirement waived with justification' },
  WAIVER_REQUESTED: { type: 'WAIVER_REQUESTED', category: 'INFORMATIONAL', version: 1, description: 'Checklist waiver initiated' },
  WAIVER_INITIATED_PENDING_COUNTERSIGN: { type: 'WAIVER_INITIATED_PENDING_COUNTERSIGN', category: 'INFORMATIONAL', version: 1, description: 'Mandatory waiver requires PMC countersignature' },
  WAIVER_APPROVED: { type: 'WAIVER_APPROVED', category: 'INFORMATIONAL', version: 1, description: 'Checklist waiver approved' },
  MANDATORY_WAIVER_APPROVED: { type: 'MANDATORY_WAIVER_APPROVED', category: 'INFORMATIONAL', version: 1, description: 'Mandatory waiver countersigned and approved' },
  MANDATORY_WAIVER_REJECTED: { type: 'MANDATORY_WAIVER_REJECTED', category: 'INFORMATIONAL', version: 1, description: 'Mandatory waiver countersignature rejected' },

  // Submission & recipient events
  SUBMISSION_DRAFT: { type: 'SUBMISSION_DRAFT', category: 'INFORMATIONAL', version: 1, description: 'Package submission draft created' },
  SUBMISSION_SENT: { type: 'SUBMISSION_SENT', category: 'INFORMATIONAL', version: 1, description: 'Package submission sent to recipients' },
  SUBMISSION_ACKNOWLEDGED: { type: 'SUBMISSION_ACKNOWLEDGED', category: 'INFORMATIONAL', version: 1, description: 'Submission delivery acknowledged' },
  SUBMISSION_PARTIALLY_ACCEPTED: { type: 'SUBMISSION_PARTIALLY_ACCEPTED', category: 'INFORMATIONAL', version: 1, description: 'Submission accepted with remarks/exceptions' },
  SUBMISSION_ACCEPTED: { type: 'SUBMISSION_ACCEPTED', category: 'INFORMATIONAL', version: 1, description: 'Submission fully accepted by recipient' },
  SUBMISSION_REJECTED: { type: 'SUBMISSION_REJECTED', category: 'INFORMATIONAL', version: 1, description: 'Submission rejected by recipient' },
  SUBMISSION_WITHDRAWN: { type: 'SUBMISSION_WITHDRAWN', category: 'INFORMATIONAL', version: 1, description: 'Submission withdrawn by contractor' },
  SUBMISSION_SUBMITTED: { type: 'SUBMISSION_SUBMITTED', category: 'INFORMATIONAL', version: 1, description: 'Submission formal dispatch committed' },
  SUBMISSION_DISPATCHED: { type: 'SUBMISSION_DISPATCHED', category: 'INFORMATIONAL', version: 1, description: 'Submission dispatched with transmittal receipt' },
  SUBMISSION_STATUS_CHANGED: { type: 'SUBMISSION_STATUS_CHANGED', category: 'INFORMATIONAL', version: 1, description: 'Submission status transitioned' },
  SUBMISSION_AGGREGATED_ACCEPTED: { type: 'SUBMISSION_AGGREGATED_ACCEPTED', category: 'INFORMATIONAL', version: 1, description: 'All recipient decisions converged to accepted' },
  SUBMISSION_AGGREGATED_PARTIALLY_ACCEPTED: { type: 'SUBMISSION_AGGREGATED_PARTIALLY_ACCEPTED', category: 'INFORMATIONAL', version: 1, description: 'Multi-recipient decision converged to partial' },
  SUBMISSION_AGGREGATED_REJECTED: { type: 'SUBMISSION_AGGREGATED_REJECTED', category: 'INFORMATIONAL', version: 1, description: 'Multi-recipient decision converged to rejected' },

  // Supplier guest portal events
  PARTY_CREATED: { type: 'PARTY_CREATED', category: 'INFORMATIONAL', version: 1, description: 'Counterparty directory entry and audit committed' },
  PROCUREMENT_ORDER_ISSUED: { type: 'PROCUREMENT_ORDER_ISSUED', category: 'INFORMATIONAL', version: 1, description: 'Purchase order and explicit supplier obligations committed' },
  SUPPLIER_UPLOAD_LINK_CREATED: { type: 'SUPPLIER_UPLOAD_LINK_CREATED', category: 'INFORMATIONAL', version: 1, description: 'Supplier magic link issued' },

  OWNERSHIP_TRANSFER_ACCEPTED:{type:'OWNERSHIP_TRANSFER_ACCEPTED',category:'INFORMATIONAL',version:1,description:'Two-party ownership transition committed'},
  OWNERSHIP_TRANSFER_REQUESTED:{type:'OWNERSHIP_TRANSFER_REQUESTED',category:'INFORMATIONAL',version:1,description:'Recipient must independently confirm ownership intent'},
  OWNERSHIP_TRANSFER_CANCELLED:{type:'OWNERSHIP_TRANSFER_CANCELLED',category:'INFORMATIONAL',version:1,description:'Ownership intent cancelled by a participant'},
  HANDOVER_PACKAGE_READY:{type:'HANDOVER_PACKAGE_READY',category:'INFORMATIONAL',version:1,description:'Verified handover package output persisted'},
  // Organisation & membership events
  ORG_PROFILE_UPDATED: { type: 'ORG_PROFILE_UPDATED', category: 'INFORMATIONAL', version: 1, description: 'Tenant organisation profile updated' },
  ORG_OWNERSHIP_TRANSFERRED: { type: 'ORG_OWNERSHIP_TRANSFERRED', category: 'INFORMATIONAL', version: 1, description: 'Primary tenant ownership transferred' },
  MEMBER_INVITED: { type: 'MEMBER_INVITED', category: 'INFORMATIONAL', version: 1, description: 'New organisation member invited' },
  MEMBER_ACTIVATED: { type: 'MEMBER_ACTIVATED', category: 'INFORMATIONAL', version: 1, description: 'Member accepted invitation' },
  MEMBER_DEACTIVATED: { type: 'MEMBER_DEACTIVATED', category: 'INFORMATIONAL', version: 1, description: 'Member access deactivated' },
  MEMBER_ROLE_CHANGED: { type: 'MEMBER_ROLE_CHANGED', category: 'INFORMATIONAL', version: 1, description: 'Member role assignment updated' },
  MEMBER_REMOVED: { type: 'MEMBER_REMOVED', category: 'INFORMATIONAL', version: 1, description: 'Member removed from organisation' },

  // Warranty, snagging & commercial events
  WARRANTY_EVENT_RECORDED: { type: 'WARRANTY_EVENT_RECORDED', category: 'INFORMATIONAL', version: 1, description: 'Warranty milestone or DLP claim recorded' },
  DEFECT_RAISED: { type: 'DEFECT_RAISED', category: 'INFORMATIONAL', version: 1, description: 'Warranty snag or defect reported' },
  DEFECT_CREATED: { type: 'DEFECT_CREATED', category: 'INFORMATIONAL', version: 1, description: 'Defect item registered' },
  DEFECT_REMEDY_SUBMITTED: { type: 'DEFECT_REMEDY_SUBMITTED', category: 'INFORMATIONAL', version: 1, description: 'Defect remedy evidence submitted for verification' },
  DEFECT_CLOSED: { type: 'DEFECT_CLOSED', category: 'INFORMATIONAL', version: 1, description: 'Defect verified closed with ready evidence' },
  GST_INVOICE_ISSUED: { type: 'GST_INVOICE_ISSUED', category: 'INFORMATIONAL', version: 1, description: 'GST Rule 46 invoice issued' },
  INVOICE_TDS_RECORDED: { type: 'INVOICE_TDS_RECORDED', category: 'INFORMATIONAL', version: 1, description: 'TDS deduction recorded on billing' },
  INVOICE_TDS_FORM16A_RECONCILED: { type: 'INVOICE_TDS_FORM16A_RECONCILED', category: 'INFORMATIONAL', version: 1, description: 'Form 16A TDS certificate verified' },

  // Commissioning, TAB & quality inspection events (XP16, XP17, XP18)
  TAB_WORKSHEET_RECORDED: { type: 'TAB_WORKSHEET_RECORDED', category: 'INFORMATIONAL', version: 1, description: 'Air/water TAB balancing worksheet recorded' },
  INSPECTION_TEST_RECORDED: { type: 'INSPECTION_TEST_RECORDED', category: 'INFORMATIONAL', version: 1, description: 'Quality inspection test request recorded' },
  INSPECTION_WITNESS_SIGNED: { type: 'INSPECTION_WITNESS_SIGNED', category: 'INFORMATIONAL', version: 1, description: 'Witness sign-off recorded for inspection' },
  SEASONAL_COMMISSIONING_SCHEDULED: { type: 'SEASONAL_COMMISSIONING_SCHEDULED', category: 'INFORMATIONAL', version: 1, description: 'Deferred seasonal commissioning schedule established' },
  SEASONAL_COMMISSIONING_COMPLETED: { type: 'SEASONAL_COMMISSIONING_COMPLETED', category: 'INFORMATIONAL', version: 1, description: 'Seasonal commissioning test completed' },

  // Security test events
  SECURITY_TEST_EVENT_1: { type: 'SECURITY_TEST_EVENT_1', category: 'INFORMATIONAL', version: 1, description: 'Security regression test event 1' },
  SECURITY_TEST_EVENT_2: { type: 'SECURITY_TEST_EVENT_2', category: 'INFORMATIONAL', version: 1, description: 'Security regression test event 2' },
  TEST_APPEND: { type: 'TEST_APPEND', category: 'INFORMATIONAL', version: 1, description: 'Test audit event' },
};
