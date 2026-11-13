import { ReviewsService, isExpiredOnIndiaDate } from '../src/modules/reviews/reviews.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExternalApprovalDto } from '../src/modules/reviews/dto/external-approval.dto';

describe('review authority and expiry', () => {
  const actor = { orgId: 'org-1', userId: 'user-1', actorType: 'USER' as const, requestId: 'request-1', orgRole: 'R-OWNER' };

  it('does not allow an owner to decide another user’s assigned review', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT project_id FROM reviews')) {
        return { rows: [{ project_id: 'project-1' }] };
      }
      if (sql.includes('SELECT * FROM reviews')) {
        return { rows: [{ id: 'review-1', project_id: 'project-1', status: 'IN_REVIEW', reviewer_subject_type: 'USER', reviewer_subject_id: 'other-user' }] };
      }
      return { rows: [] };
    });
    const service = new ReviewsService({ withTenantContext: async (_ctx: unknown, work: any) => work({ query }) } as any);
    await expect(service.decideReview(actor, 'review-1', { decision: 'APPROVE' })).rejects.toThrow('REVIEW_ASSIGNMENT_REQUIRED');
    expect(query.mock.calls.some(([sql]) => /^(?:INSERT|UPDATE|DELETE)\s/i.test(sql.trim()))).toBe(false);
  });

  it('does not create an assignment as a side effect of deciding', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const service = new ReviewsService({ withTenantContext: async (_ctx: unknown, work: any) => work({ query }) } as any);
    await expect(service.recordVersionReview(actor, 'project-1', { documentVersionId: 'version-1', decision: 'APPROVE' }))
      .rejects.toThrow('REVIEW_ASSIGNMENT_REQUIRED');
    expect(query.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO reviews'))).toBe(false);
  });

  it('does not create an assignment or fabricate metadata when loading review details', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT dv.*')) {
        return { rows: [{ id: 'version-1', document_id: 'document-1', doc_title: 'Manual',
          doc_type_key: 'CUSTOM', revision_code: 'R1', file_status: 'PROCESSING',
          review_status: 'NOT_SUBMITTED', row_version: 1 }] };
      }
      return { rows: [] };
    });
    const service = new ReviewsService({ withTenantContext: async (_ctx: unknown, work: any) => work({ query }) } as any);
    const detail = await service.getVersionReviewDetail(actor, 'project-1', 'version-1');
    // Preserve the exact assertions for this member-only response without
    // incorrectly treating the intentionally narrower guest DTO as identical.
    expect(detail).toMatchObject({
      reviewId: null, requirementId: null, sha256: null, uploadedByName: null,
    });
    expect(detail.fileStatus).toBe('PROCESSING');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO reviews'))).toBe(false);
    expect(query.mock.calls[0][0]).toContain('dv.project_id = $3');
  });

  it('does not let an admin bypass evidence rules with a generic override', async () => {
    const query = jest.fn();
    const service = new ReviewsService({ withTenantContext: async (_ctx: unknown, work: any) => work({ query }) } as any);
    await expect(service.overrideReview(actor, 'review-1', { decision: 'APPROVE', justification: 'Approve despite missing evidence' }))
      .rejects.toThrow('SCOPED_REVIEW_EXCEPTION_WORKFLOW_UNAVAILABLE');
    expect(query).not.toHaveBeenCalled();
  });

  it('does not approve a READY label without a verified storage object', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT project_id FROM reviews')) {
        return { rows: [{ project_id: 'project-1' }] };
      }
      if (sql.includes('SELECT * FROM reviews')) {
        return { rows: [{ id: 'review-1', project_id: 'project-1', status: 'IN_REVIEW', reviewer_subject_type: 'USER',
          reviewer_subject_id: actor.userId, document_version_id: 'version-1' }] };
      }
      if (sql.includes('SELECT * FROM document_versions')) {
        return { rows: [{ id: 'version-1', file_status: 'READY', object_id: 'object-1' }] };
      }
      return { rows: [] };
    });
    const service = new ReviewsService({ withTenantContext: async (_ctx: unknown, work: any) => work({ query }) } as any);
    await expect(service.decideReview(actor, 'review-1', { decision: 'APPROVE' }))
      .rejects.toMatchObject({ response: { code: 'EVIDENCE_OBJECT_NOT_VERIFIED' } });
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE document_versions'))).toBe(false);
  });

  it('requires a verified companion linked to the primary document’s scopes', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT rule_code')) return { rows: [{ rule_code: 'C1', rule_name: 'Calibration',
        primary_doc_type: 'TEST', companion_doc_type: 'CERT', description: 'Calibration required', is_mandatory: true }] };
      return { rows: [] };
    });
    const service = new ReviewsService({} as any);
    const result = await service.evaluateCompanionEvidence({ query } as any, 'org-1', 'project-1', 'TEST', 'document-1');
    expect(result.hasMissingMandatory).toBe(true);
    const companionQuery = query.mock.calls.find(([sql]) => sql.includes('SELECT dv.id, dv.revision_code'))?.[0];
    expect(companionQuery).toContain('cr.scope_key = pr.scope_key');
    expect(companionQuery).toContain("so.status = 'READY'");
    expect(companionQuery).toContain('so.provider_version_id IS NOT NULL');
  });

  it('treats a certificate expiry date as inclusive in India time', () => {
    expect(isExpiredOnIndiaDate('2026-11-06', new Date('2026-11-06T18:29:00Z'))).toBe(false);
    expect(isExpiredOnIndiaDate('2026-11-06', new Date('2026-11-06T18:30:00Z'))).toBe(true);
  });

  it('rejects external approval when the document version has changed', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 'version-1', row_version: 2 }] });
    const service = new ReviewsService({ withTenantContext: async (_ctx: unknown, work: any) => work({ query }) } as any);
    await expect(service.recordExternalApproval(actor, 'version-1', {
      decision: 'APPROVE', externalMethod: 'EMAIL', externalPartyId: 'party-1',
      externalApproverName: 'Reviewer', externalApproverRole: 'Consultant', externalReference: 'R-1',
      decidedAt: '2026-01-01', proofVersionId: 'proof-1',
    }, 1)).rejects.toMatchObject({ status: 412 });
    expect(query.mock.calls[0][0]).toContain('SELECT project_id FROM document_versions');
    expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE document_versions/.test(sql))).toBe(false);
  });

  it('rejects unknown authority-bearing fields in the external response DTO', async () => {
    const dto = plainToInstance(ExternalApprovalDto, {
      decision: 'APPROVE', externalMethod: 'EMAIL', externalPartyId: '0192e3a0-0000-7000-8000-000000000001',
      externalApproverName: 'Reviewer', externalApproverRole: 'Consultant', externalReference: 'R-1',
      decidedAt: '2026-01-01', proofVersionId: '0192e3a0-0000-7000-8000-000000000002', isOverride: true,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === 'isOverride')).toBe(true);
  });
});
