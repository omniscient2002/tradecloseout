/** Applicable review proof for the current obligation, in addition to immutable object verification. */
export function requirementQualificationSql(requirementAlias='r',versionAlias='dv'):string{
 for(const alias of [requirementAlias,versionAlias])if(!/^[a-z][a-z0-9_]*$/.test(alias))throw new Error('QUALIFICATION_ALIAS_INVALID');
 const r=requirementAlias,dv=versionAlias;
 return `(EXISTS(SELECT 1 FROM checklist_snapshots qualification_baseline WHERE qualification_baseline.org_id=${r}.org_id
  AND qualification_baseline.project_id=${r}.project_id AND qualification_baseline.id=${r}.current_snapshot_id
  AND qualification_baseline.status='ACTIVE' AND qualification_baseline.obligation_context_checksum=project_obligation_context_checksum(${r}.org_id,${r}.project_id))
 AND (${r}.qualification_required_since IS NULL OR EXISTS(SELECT 1 FROM requirement_evidence_qualifications qualification
  JOIN reviews qualified_review ON qualified_review.org_id=qualification.org_id AND qualified_review.project_id=qualification.project_id
   AND qualified_review.id=qualification.review_id AND qualified_review.status='APPROVED' AND qualified_review.decision='APPROVE'
   AND (qualified_review.method<>'EXTERNAL' OR EXISTS(SELECT 1 FROM storage_objects qualification_proof
      WHERE qualification_proof.org_id=qualified_review.org_id AND qualification_proof.id=qualified_review.evidence_object_id
       AND qualification_proof.status='READY' AND qualification_proof.sha256 IS NOT NULL AND qualification_proof.provider_version_id IS NOT NULL
       AND qualification_proof.observed_size_bytes=qualification_proof.size_bytes))
  WHERE qualification.org_id=${r}.org_id AND qualification.project_id=${r}.project_id AND qualification.requirement_id=${r}.id
   AND qualification.document_version_id=${dv}.id AND qualification.created_at>=${r}.qualification_required_since AND COALESCE(qualified_review.recorded_at,qualified_review.decided_at)>=${r}.qualification_required_since
   AND qualification.obligation_fingerprint=requirement_obligation_fingerprint(${r}))))`;
}
