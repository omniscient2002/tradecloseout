import { randomUUID } from 'node:crypto';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

describe('PH4-G19-005: retention is an advisory estimate, never payment authority', () => {
  const ctx: any = {
    orgId: randomUUID(), userId: randomUUID(), actorType: 'SYSTEM',
    requestId: randomUUID(), ip: '127.0.0.1', userAgent: 'g19-unit',
  };
  const projectId = randomUUID();
  function fixture(configured: boolean, accepted: boolean, explicitFinanceFacts: boolean) {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT p.id, p.name, p.code, p.status')) {
          return { rows: [{
            id: projectId, status: 'CLOSED',
            contract_value_paise: explicitFinanceFacts ? '100000' : null,
            retention_bps: explicitFinanceFacts ? '500' : null,
          }] };
        }
        if (sql.includes('COUNT(*) FILTER (WHERE r.mandatory = true)')) {
          return { rows: [{
            total_mandatory: configured ? '1' : '0',
            satisfied_mandatory: configured ? '1' : '0',
            pending_mandatory: '0',
          }] };
        }
        if (sql.includes('FROM requirements r')) {
          return { rows: configured
            ? [{ mandatory: true, status: 'APPROVED',
                 has_approved_evidence: true, has_expired_approved_evidence: false,
                 has_valid_waiver: false }]
            : [] };
        }
        if (sql.includes('FROM checklist_snapshots')) {
          return { rows: configured
            ? [{ resolved_payload_json: { requirements: [{ requirementKey: 'DOC-01' }] } }]
            : [] };
        }
        if (sql.includes('FROM defects')) return { rows: [{ open_defects: '0', critical_defects: '0' }] };
        if (sql.includes('FROM submissions s')) return { rows: accepted ? [{ id: randomUUID() }] : [] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    return { service: new WarrantyAndBillingService({
      connect: jest.fn(async () => client),
    } as any), queries };
  }

  it('reports no fabricated 100% checklist or retention when baseline and finance facts are missing', async () => {
    const { service, queries } = fixture(false, false, false);
    const result = await service.getCommercialReadiness(ctx, projectId);
    expect(result.mandatoryRequirements.satisfactionPercentage).toBeNull();
    expect(result.retentionAtRiskPaise).toBeNull();
    expect(result.contractValuePaise).toBeNull();
    expect(result.commercialReadiness.isRetentionEligible).toBe(false);
    expect(result.commercialReadiness.releaseStatus).toBe('INFORMATIONAL_ONLY');
    expect(result.commercialReadiness.configurationBlocker).toBeTruthy();
    expect(queries.some(sql => sql.includes('FROM checklist_snapshots'))).toBe(true);
  });

  it('never authorizes release even if latest full package and technical indicators look ready', async () => {
    const { service, queries } = fixture(true, true, true);
    const result = await service.getCommercialReadiness(ctx, projectId);
    expect(result.commercialReadiness.advisoryPreconditionsMet).toBe(true);
    expect(result.commercialReadiness.isRetentionEligible).toBe(false);
    expect(result.commercialReadiness.financeApprovalVerified).toBe(false);
    expect(result.commercialReadiness.releaseStatus).toBe('INFORMATIONAL_ONLY');
    expect(result.retentionAtRiskPaise).toBe('5000');
    const acceptanceSql = queries.find(sql => sql.includes('FROM submissions s'));
    expect(acceptanceSql).toContain("hp.package_purpose = 'FULL_HANDOVER'");
    expect(acceptanceSql).toContain('newest.version_no DESC');
    expect(acceptanceSql).toContain('sr.is_required_approver = true');
    expect(acceptanceSql).toContain("sr.decision IS DISTINCT FROM 'ACCEPT'");
  });
});
