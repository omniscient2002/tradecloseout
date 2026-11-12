# G01 independent external-party signatory authority — restricted operations SOP

## Scope and prohibition

The ordinary contractor API can issue a client/consultant guest invitation but **cannot declare that recipient independently authorised to sign**, even after a valid SMS/email OTP. An issuer-selected OTP destination proves possession of that inbox/number only, not a legal right to bind a client or consultant.

Sensitive `inspection.witness`, `package.accept`, and consultant `review.decide` remain fail-closed until the guest grant has been independently reviewed. Database migration `0024` prevents app-role self-approval; `0025` prevents reassigning identity, party, capabilities, contact, issuer or project after issuance; `0026` provides two distinct reviewer attestations; `0027` forces ledger RLS; `0028` binds independent approval to the project's currently designated active counterparty; `0029` makes project reassignment enforcement tenant-RLS safe; `0030` protects review immutability and party-deactivation lifecycle. These controls must all exist together on the deployed candidate SHA.

## Separation of duties

Only platform-managed individual reviewer login roles may be members of `tc_external_authority_reviewer` (NOLOGIN base role). Neither `tc_app`, `tc_migrator`, a contractor administrator, an ordinary product user nor a shared service account may be granted this reviewer membership. Provision individual accounts out of band through platform IAM/DBA change management, with hardware-backed MFA at the connection gateway, TLS client identity, scoped network access, named-account traceability and revocation. This repository does **not** provision reviewer passwords or approve any real counterparty automatically.

Two **different** reviewer login identities are required; the database records the actual PostgreSQL `session_user` rather than trusting a user-supplied name. Reviewers have **EXECUTE only** on `approve_external_guest_authority`; they have no direct access to the decision ledger or tenant application tables. Superuser/migrator credentials must remain separate from the review team. Production permissions and `pg_hba.conf`/TLS evidence must be inspected.

## Required independent evidence, prior to either reviewer action

1. Identify the legal client/consultant entity independently from the contractor's application record. Verify project/contract association using independent documents or directly established counterparty records.
2. Verify representative name, designation, actual authority/delegation, dates, revocation and scope using a directly obtained signed authorisation or counterparty-controlled channel. A contractor-supplied email address, party row or forwarded guest link **never counts alone**.
3. Verify the recipient's destination directly with an independent known contact, not a number or mailbox supplied or recently edited by the issuer. Check whether the destination is contractor-controlled or conflicts with another party; deny doubtful cases.
4. Confirm the locked grant's organisation, project, exact party ID, grant type, destination and capability set against the reviewed external evidence. A mismatched project client/consultant party must be denied.
5. Preserve the evidence in access-controlled tamper-evident storage outside the customer-editable grant table. Generate a SHA-256 digest of the canonical approved evidence bundle; assign an opaque, non-personal `evidence_ref` (8–128 allowed characters). Do not put invitations, raw phone/email, document titles, URLs or OTPs into `evidence_ref`.
6. Each reviewer independently checks the source bundle, confirms the same SHA-256 digest and opaque reference, and documents sign-off in a separate privileged ticketing/IAM system. Never approve based only on the first reviewer's assertion.

## Restricted human reviewer command (implemented)

The repository includes `apps/api/scripts/approve-external-authority.ts`, accessible as `pnpm --filter @tradecloseout/api review:external`. Run **only** from a dedicated reviewer workstation or secure platform access gateway, not the application deployment, contractor machine, web server, production worker or CI service. Authenticate to PostgreSQL as an individually attributable reviewer login that inherits only `tc_external_authority_reviewer`. Set `G01_REVIEWER_DATABASE_URL` via the platform's approved secret injection facility and `G01_REVIEWER_CA_PATH` to the verified PostgreSQL CA certificate. Never use `APP_DATABASE_URL` or `MIGRATOR_DATABASE_URL`, put passwords on the command line, commit credentials, or paste real evidence in tickets or logs.

```bash
pnpm --filter @tradecloseout/api review:external -- \
  --org "$VERIFIED_ORG_UUID" --grant "$VERIFIED_GRANT_UUID" \
  --sha256 "$INDEPENDENT_EVIDENCE_SHA256" --case "$OPAQUE_CASE_REFERENCE" \
  --attest-independent-source --attest-legal-delegation --attest-destination
```

The CLI validates all fields and attestations before connecting, requires certificate-verified TLS and a separate named reviewer database identity, opens one short transaction, and uses the audited `approve_external_guest_authority` function. It does not expose the connection URL, reviewer credentials, raw evidence digest, contact, legal evidence, or case reference in output or error messages. In a negative/failed run, inspect the restricted server-side reviewer audit rather than retrying with privileged credentials. A first reviewer can record exactly one decision; a separate authenticated login must independently verify the same source evidence and record the second decision. **The CLI cannot substitute for genuine human independent verification.**

## Executing an approval

Connect through the independently controlled DB access gateway as the first **named reviewer login**. The reviewer role must be inherited through approved DBA policy (never via the contractor API). Execute a parameterised statement against the dedicated database:

```sql
SELECT review_count, independently_verified
  FROM approve_external_guest_authority(
    :verified_contractor_org_uuid,
    :exact_guest_grant_uuid,
    :lowercase_sha256_evidence_bundle,
    :opaque_authority_case_reference
  );
```

The first legitimate reviewer receives `review_count=1, independently_verified=false`; the grant is still unauthorised for witness/acceptance. A different named reviewer repeats the independent verification and calls the same function with **exactly matching evidence digest and reference**. Only then does `review_count=2, independently_verified=true` commit alongside the immutable audit ledger and grant approval marker.

Duplicate approvals from one reviewer, disjoint evidence, expired/revoked grant, unrelated party or invalid grant type must fail; do not override database errors. No automated background process should self-approve a grant.

## Offline external document decision attestation (migration 0032)

The contractor-facing `recordExternalApproval` API cannot treat a contractor-uploaded stamped PDF, claimed counterparty name, portal screenshot or email attachment as independently authorised acceptance. In production, `has_verified_external_document_approval` must return true for the **exact target document revision, separately stored READY proof revision, designated project counterparty, and SHA-256 of the immutable proof bytes**. Migration `0032` creates an append-only tenant-scoped reviewer ledger; only named individual platform reviewers can record decisions. Ordinary `tc_app` gets a boolean-only checker with no direct ledger access.

After independently verifying source authenticity, the actual client/consultant/MC's decision and the precise document revision against independently obtained contract/delegation evidence, each reviewer uses the dedicated restricted command. The evidence SHA-256 **must equal the stored proof object's SHA-256**, not a hash of a contractor-provided text description. Reviewers must read the actual evidence with a verified, non-contractor-controlled chain of custody; merely observing a READY malware-scanned file is not sufficient.

```bash
pnpm --filter @tradecloseout/api review:external-document -- \
  --org "$VERIFIED_ORG_UUID" --version "$TARGET_VERSION_UUID" \
  --proof "$SIGNED_PROOF_VERSION_UUID" --party "$COUNTERPARTY_UUID" \
  --sha256 "$STORED_PROOF_SHA256" --case "$OPAQUE_CASE_REFERENCE" \
  --attest-independent-source --attest-document-decision --attest-counterparty
```

Two different named reviewer accounts must approve the same values. Before the second review commits, the ordinary API must return `INDEPENDENT_EXTERNAL_PROOF_REQUIRED` and leave the document unchanged. After two matches, authorised internal recording can proceed only if the target is still the latest eligible document revision, proof remains READY and storage-verifiable, and the designated counterparty has not changed. Any changed proof, revision, party or evidence reference requires a fresh independent review, not relabelling an earlier decision. The reviewer cannot approve from the normal API; this is a platform operations pathway only.

## Independent emergency revocation commands (migration 0033)

A newly discovered forged client/consultant delegation, compromised reviewer credential, revoked signatory authority or disputed externally approved document must be blocked **without requiring contractor cooperation**. Migration `0033` implements immutable, platform-reviewer-only revocation records with dedicated stored procedures. The reviewer command `pnpm --filter @tradecloseout/api review:revoke-external` uses the same separate individual PostgreSQL credentials, TLS CA and strict role isolation as the approval commands. All incidents require an opaque incident/case reference, never personal identifiers or bearer credentials.

For a verified sensitive guest grant, independently revoke grant + all active sessions:

```bash
pnpm --filter @tradecloseout/api review:revoke-external -- \
  --kind guest --org "$ORG_UUID" --grant "$GUEST_GRANT_UUID" \
  --reason "$INCIDENT_CASE_REF" --attest-incident-verified
```

For a particular offline approved document proof, revoke the *exact* proof/version/party attestation and prevent subsequent `recordExternalApproval` calls from using that attestation:

```bash
pnpm --filter @tradecloseout/api review:revoke-external -- \
  --kind document --org "$ORG_UUID" --version "$TARGET_VERSION_UUID" \
  --proof "$PROOF_VERSION_UUID" --party "$EXTERNAL_PARTY_UUID" \
  --reason "$INCIDENT_CASE_REF" --attest-incident-verified
```

**Important:** migration `0034` also invalidates the *current approved document revision* when its independently attested proof is revoked: it marks the revision `CHANGES_REQUESTED` and clears `documents.current_approved_version_id` in the same transaction, so readiness no longer treats it as approved. Historical review rows remain intact. This does not legally annul or recall previously distributed certificates, immutable handover packages or exports. Use the separately authorised incident, notice, dispute/withdrawal and recipient-communication workflow to handle those artifacts. Such deployed incident response remains an operational release gate.

## Revocation, changes and incident response

- Reviewer decisions are append-only under migration `0030`; privileged SQL mutation is rejected. An active, independently approved grant must be revoked before its counterparty party record is archived, so restoring the party cannot silently revive old approval.
- On contact, delegation, issuer, party, role, project or scope change, **revoke the grant and its sessions**, issue a new grant, perform a fresh independent review and require new OTP. Do not UPDATE an approved grant in place. Database migration `0028` rejects changing the designated project client/consultant while an active independently approved grant for that party remains; revoke that grant before reassignment. Reassignment cannot revive an old approval.
- Expired or revoked grants must not re-enter authorised state. Preserve the reviewer ledger for legal/audit retention under a separately approved policy.
- In suspected email compromise, incorrect delegation, leaked reviewer credentials or client dispute, revoke affected grants/sessions immediately, preserve audit evidence and escalate through the platform incident procedure. A contractor cannot restore approval.
- Review and rotate individual reviewer credentials and membership regularly; disable dormant accounts. Audit DBA and platform administrator access to approval grants and SECURITY DEFINER function DDL.

## Deployment acceptance

- [ ] Individual reviewer logins are backed by real platform IAM + independent MFA and TLS; `tc_app` cannot SET ROLE or invoke the approval function.
- [ ] Two independent reviewers verify a **real** delegation case end to end; both agree on the correct evidence digest; first approval alone cannot sign.
- [ ] Forged contractor-controlled contact, unrelated or inactive project party, changed designated client/consultant, reviewer reuse, evidence mismatch, expiration and revocation are denied at HTTP and DB level. Validate SQL 0028 in the exact staging migration history.
- [ ] Actual review audit trail, WORM evidence pointer, operator identity and sign-off are independently inspected.
- [ ] Legitimately approved client and consultant can complete supported witness, consultant review-decision and acceptance journeys through browser and real evidence revision binding.
- [ ] Reviewer approval role is excluded from web/API/worker credentials and deployment secrets.

**Without completed independent evidence and operator sign-off, G01-001 remains blocked even if all automated SQL tests pass.**
