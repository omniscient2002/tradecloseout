import type { PoolClient } from 'pg';

/**
 * PH2-G05-001 / G20-009: one informational, exact-paise financial projection
 * for the project dashboard and the authenticated Owner digest.
 *
 * Approved active contract records are authoritative when present. Project
 * amount is only an estimate used when there are NO active contracts.
 * A partially unpriced contract register is UNKNOWN, not zero. No amount here
 * means an invoice has been issued, payment is withheld or retention is earned.
 */
export async function getProjectCommercialSummary(
  client: PoolClient,
  orgId: string,
  projectId: string,
  project: { contract_value_paise?: string | number | null; retention_bps?: number | null },
): Promise<{
  contractValuePaise: string | null;
  informationalRetentionExposurePaise: string | null;
  basis: 'ACTIVE_CONTRACTS' | 'PROJECT_ESTIMATE' | 'UNKNOWN';
  activeContractCount: number;
}> {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS active_contract_count,
            COUNT(value_paise)::int AS priced_contract_count,
            SUM(value_paise::numeric) AS total_contract_value_paise,
            SUM(TRUNC(value_paise::numeric * retention_bps::numeric / 10000))
              AS retention_exposure_paise
       FROM contracts
      WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'`,
    [orgId, projectId],
  );
  const summary = rows[0] ?? {};
  const active = Number(summary.active_contract_count ?? 0);
  const priced = Number(summary.priced_contract_count ?? 0);
  if (active > 0) {
    if (active !== priced || summary.total_contract_value_paise == null ||
        summary.retention_exposure_paise == null) {
      return { contractValuePaise: null, informationalRetentionExposurePaise: null,
        basis: 'UNKNOWN', activeContractCount: active };
    }
    return {
      contractValuePaise: String(summary.total_contract_value_paise),
      informationalRetentionExposurePaise: String(summary.retention_exposure_paise),
      basis: 'ACTIVE_CONTRACTS',
      activeContractCount: active,
    };
  }
  if (project.contract_value_paise == null) {
    return { contractValuePaise: null, informationalRetentionExposurePaise: null,
      basis: 'UNKNOWN', activeContractCount: 0 };
  }
  // Project estimates are stored as exact integers, not float INR conversions.
  const value = BigInt(project.contract_value_paise);
  const bps = project.retention_bps == null ? null : Number(project.retention_bps);
  const retention = bps !== null && Number.isSafeInteger(bps) && bps >= 0 && bps <= 10000
    ? (value * BigInt(bps) / 10000n).toString() : null;
  return {
    contractValuePaise: value.toString(),
    informationalRetentionExposurePaise: retention,
    basis: 'PROJECT_ESTIMATE',
    activeContractCount: 0,
  };
}

/** Hide imprecise numeric INR projections; the exact decimal remains available. */
export function paiseToSafeInr(value: string | null): number | null {
  if (value == null) return null;
  const paise = BigInt(value);
  if (paise < -BigInt(Number.MAX_SAFE_INTEGER) || paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(paise) / 100;
}
