/** Correlated SQL for internal consumers. The alias is code-owned, never request input. */
export function missingCurrentObligationSql(alias='r'):string{
 if(!/^[a-z][a-z0-9_]*$/.test(alias))throw new Error('OBLIGATION_ALIAS_INVALID');const r=alias;
 return `${r}.superseded_at IS NULL AND NOT EXISTS(SELECT 1 FROM waivers w WHERE w.org_id=${r}.org_id
  AND w.project_id=${r}.project_id AND w.requirement_id=${r}.id AND w.status='ACTIVE'
  AND w.type IN('WAIVE','NOT_APPLICABLE') AND (NOT ${r}.mandatory OR w.second_approved_by IS NOT NULL AND w.second_approved_by<>w.approved_by))
  AND NOT EXISTS(SELECT 1 FROM document_requirements dr
   JOIN documents d ON d.org_id=dr.org_id AND d.project_id=dr.project_id AND d.id=dr.document_id
    AND d.deleted_at IS NULL AND d.status='ACTIVE' AND d.doc_type_key=${r}.doc_type_key
   JOIN document_versions dv ON dv.org_id=d.org_id AND dv.project_id=d.project_id AND dv.document_id=d.id
    AND dv.id=d.current_approved_version_id AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
    AND dv.review_status='APPROVED' AND dv.file_status='READY' AND (dv.expiry_date IS NULL OR dv.expiry_date>=CURRENT_DATE)
   JOIN storage_objects so ON so.org_id=dv.org_id AND so.id=dv.object_id AND so.status='READY' AND so.sha256 IS NOT NULL
    AND so.observed_size_bytes=so.size_bytes AND so.provider_version_id IS NOT NULL
   WHERE dr.org_id=${r}.org_id AND dr.project_id=${r}.project_id AND dr.requirement_id=${r}.id
    AND NOT EXISTS(SELECT 1 FROM evidence_revalidations er WHERE er.org_id=dv.org_id AND er.project_id=dv.project_id
      AND er.document_version_id=dv.id AND (${r}.scope_key IS NULL OR ${r}.scope_key NOT LIKE 'asset:%' OR er.asset_id::text=substring(${r}.scope_key from 7))
      AND er.status IN('PENDING','MISMATCH')))`;
}

export function overdueCurrentObligationSql(alias='r'):string{
 const missing=missingCurrentObligationSql(alias),r=alias;
 return `${missing} AND (${r}.due_at IS NOT NULL AND ${r}.due_at<now() OR EXISTS(
  SELECT 1 FROM document_requirements dr JOIN documents d ON d.org_id=dr.org_id AND d.project_id=dr.project_id AND d.id=dr.document_id
   AND d.deleted_at IS NULL AND d.status='ACTIVE' AND d.doc_type_key=${r}.doc_type_key
  JOIN document_versions dv ON dv.org_id=d.org_id AND dv.project_id=d.project_id AND dv.id=d.current_approved_version_id
   AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL AND dv.file_status='READY' AND dv.review_status='APPROVED'
  JOIN storage_objects so ON so.org_id=dv.org_id AND so.id=dv.object_id AND so.status='READY' AND so.sha256 IS NOT NULL
   AND so.observed_size_bytes=so.size_bytes AND so.provider_version_id IS NOT NULL
  WHERE dr.org_id=${r}.org_id AND dr.project_id=${r}.project_id AND dr.requirement_id=${r}.id AND dv.expiry_date<CURRENT_DATE))`;
}
