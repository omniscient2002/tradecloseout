import { PoolClient } from 'pg';

/**
 * PH3-G07-002: One qualification predicate for every consumer.
 * A recorded exception only relieves the EXACT current obligation revision.
 * Legacy rows lacking revision binding remain historic but cannot establish
 * closeout readiness or qualify a generated package.
 *
 * Requires the caller's r = requirements, w = waivers SQL aliases.
 */
export const QUALIFIED_WAIVER_PREDICATE = `
  w.status = 'ACTIVE'
  AND w.type IN ('WAIVE', 'NOT_APPLICABLE')
  AND w.is_mandatory_item = r.mandatory
  AND w.obligation_row_version IS NOT NULL
  AND r.row_version = w.obligation_row_version + CASE WHEN r.mandatory THEN 2 ELSE 1 END
  AND r.status = CASE WHEN w.type = 'WAIVE' THEN 'WAIVED' ELSE 'NOT_APPLICABLE' END
  AND r.superseded_at IS NULL
  AND EXISTS (
    SELECT 1 FROM checklist_snapshots cs
    WHERE cs.org_id = r.org_id AND cs.project_id = r.project_id
      AND cs.id = r.current_snapshot_id AND cs.status = 'ACTIVE'
  )
  AND (NOT r.mandatory OR
    (w.second_approved_by IS NOT NULL AND w.second_approved_by <> w.approved_by))
`;

/**
 * Authoritative mandatory-closeout qualification over the caller's tenant-bound
 * PostgreSQL transaction. Used by readiness GET and final project closure so
 * evidence expiry, revoked waivers and added obligations cannot be ignored.
 */
export async function evaluateReadinessInTransaction(
  client: PoolClient,
  orgId: string,
  projectId: string,
) {
      const { rows: reqs } = await client.query(
        `SELECT r.id, r.requirement_key, r.title, r.mandatory, r.status, r.due_at,
                evidence.expiry_date, evidence.revision_code,
                COALESCE(evidence.has_approved_evidence, false) AS has_approved_evidence,
                COALESCE(evidence.has_expired_approved_evidence, false) AS has_expired_approved_evidence,
                COALESCE(evidence.has_expiring_approved_evidence, false) AS has_expiring_approved_evidence,
                a.tag AS asset_tag,
                EXISTS (
                  SELECT 1 FROM waivers w
                   WHERE w.org_id = r.org_id AND w.project_id = r.project_id
                     AND w.requirement_id = r.id
                     AND ${QUALIFIED_WAIVER_PREDICATE}
                ) AS has_valid_waiver
           FROM requirements r
           LEFT JOIN LATERAL (
             SELECT
               bool_or(dv.id IS NOT NULL AND (dv.expiry_date IS NULL OR
                       dv.expiry_date >= CURRENT_DATE)) AS has_approved_evidence,
               bool_or(dv.id IS NOT NULL AND dv.expiry_date < CURRENT_DATE) AS has_expired_approved_evidence,
               bool_or(dv.id IS NOT NULL AND dv.expiry_date >= CURRENT_DATE
                       AND dv.expiry_date <= CURRENT_DATE + 30) AS has_expiring_approved_evidence,
               (array_agg(dv.expiry_date ORDER BY dv.expiry_date DESC NULLS FIRST)
                 FILTER (WHERE dv.id IS NOT NULL))[1] AS expiry_date,
               (array_agg(dv.revision_code ORDER BY dv.expiry_date DESC NULLS FIRST, dv.version_no DESC)
                 FILTER (WHERE dv.id IS NOT NULL))[1] AS revision_code
             FROM document_requirements dr
             JOIN documents d
               ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
              AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
              AND d.doc_type_key = r.doc_type_key
             JOIN document_versions dv
               ON dv.org_id = d.org_id AND dv.project_id = d.project_id
              AND dv.document_id = d.id AND dv.id = d.current_approved_version_id
              AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
              AND dv.review_status = 'APPROVED' AND dv.file_status = 'READY'
             JOIN storage_objects so
               ON so.org_id = dv.org_id AND so.id = dv.object_id
              AND so.status = 'READY' AND so.sha256 IS NOT NULL
              AND so.observed_size_bytes = so.size_bytes
              AND so.provider_version_id IS NOT NULL
             WHERE dr.org_id = r.org_id AND dr.project_id = r.project_id
               AND dr.requirement_id = r.id
               AND NOT EXISTS (
                 SELECT 1 FROM evidence_revalidations er
                  WHERE er.org_id = dv.org_id AND er.project_id = dv.project_id
                    AND er.document_version_id = dv.id
                    AND (r.scope_key IS NULL OR r.scope_key NOT LIKE 'asset:%' OR er.asset_id::text = substring(r.scope_key from 7))
                    AND er.status IN ('PENDING', 'MISMATCH')
               )
           ) evidence ON true
           LEFT JOIN assets a
             ON r.scope_key = ('asset:' || a.id::text) AND a.org_id = r.org_id AND a.project_id = r.project_id
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL`,
        [orgId, projectId],
      );

      const { rows: snapshots } = await client.query(
        `SELECT id, resolved_payload_json FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2
            AND status = 'ACTIVE' LIMIT 1`,
        [orgId, projectId],
      );
      const rawConfig = snapshots[0]?.resolved_payload_json;
      const snapshotConfig = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
      const configured = Array.isArray(snapshotConfig?.requirements) &&
        snapshotConfig.requirements.length > 0 &&
        reqs.some((r: any) => r.mandatory === true);
      const missingMandatory: any[] = [];
      const expiredMandatory: any[] = [];
      const expiringWarnings: any[] = [];

      // The lateral query returns one row per requirement and only counts evidence whose
      // exact current approved version is scanned, immutable and backed by a verified object.
      for (const r of reqs) {
        r.hasApprovedEvidence = r.has_approved_evidence === true;
        const isExpired = !r.hasApprovedEvidence &&
          (r.status === 'EXPIRED' || r.has_expired_approved_evidence === true);
        const isExpiringSoon = r.has_expiring_approved_evidence === true;

        const isWaivedOrNA = r.has_valid_waiver === true;
        if (isExpiringSoon && !isWaivedOrNA) expiringWarnings.push(r);

        if (isExpired && r.mandatory && !isWaivedOrNA) {
          expiredMandatory.push(r);
        } else if (r.mandatory) {
          if (isWaivedOrNA) {
            // Satisfied by formal waiver or not-applicable decision
          } else if (r.hasApprovedEvidence) {
            // A stored status string cannot invalidate or create evidence qualification.
            // The exact current approved version and its verified object are authoritative here.
          } else {
            missingMandatory.push(r);
          }
        }
      }

      return {
        readyWithoutOverride: configured && missingMandatory.length === 0 && expiredMandatory.length === 0,
        configurationBlocker: configured ? null : 'ACTIVE_CHECKLIST_WITH_MANDATORY_REQUIREMENTS_REQUIRED',
        blockers: {
          missingMandatoryCount: missingMandatory.length,
          expiredMandatoryCount: expiredMandatory.length,
          missingMandatory,
          expiredMandatory,
        },
        warnings: {
          expiringSoonCount: expiringWarnings.length,
          expiringWarnings,
        },
      };
}
