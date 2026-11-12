# Phase 2 implementation — integrated candidate, not release approval

Canonical audit: PR17, `470ea86728021b3fd8a715e5704cb1c890154a43`, 58 group work items. Current repair source incorporated: PR21 `301efedd2f3e023577b3b9f15ceb7ae5ff4c4c31`. G03 source incorporated: PR13 `7b2b649ecf33b69e8cf1b5753630d82ed89aaf08`. Main and the original registers are unchanged. This branch contains unmerged foundation ancestry and is not an isolated patch ready to merge/deploy.

The [progress register](progress.json) keeps all 58 original IDs, twelve planned engineering passes, per-item evidence and separate external gates. **No audit item has been independently closed.** A passing engineering pass records only the work and checks described for that pass; it is not production approval.

The user confirmed that neither HVAC mappings/packs nor billing/grace policy has independent approval. Those gates remain **BLOCKED_EXTERNAL**. Catalogue IDs and contractual obligations must be preserved. No grace duration, price or capacity is inferred as approved. Charging, automatic paid activation and tax issuance remain disabled. Provider integrations are deferred to the final stage; unrelated technical work continues.

## Current verification checkpoint

- Current PR21 plus G03 integration and regression repairs: full workspace tests pass locally — API465/80 suites, shared91/5, database13, worker32, archive/auth-storage browser10, plus PDF engine checks.
- Production build/typecheck, security15 and RBAC8 passed locally. These checks do not establish deployed or provider acceptance.
- New ownership database regression exercises independent recipient identity, fresh MFA, cancellation, expiry, stale organisation version, competing requests, one active owner, session invalidation and an attributable terminal audit event. The G01 role/invitation regression now uses two authenticated sessions and the real two-party flow, retaining ordinary-owner-role escalation denial and the disabled one-sided endpoint.
- Earlier targeted entitlement/configuration experiments in a superseded local checkout are **not** counted as verification of this integrated candidate. Revalidate any selectively retained changes here.
- Exact-head remote CI, complete Phase2 browser journeys and independent review remain required.

## Ownership configuration and limits

`OWNERSHIP_INTENT_TTL_SECONDS` (60–86400) and `OWNERSHIP_MFA_MAX_AGE_SECONDS` (30–900) must be explicitly configured. Missing/invalid policy fails with `OWNERSHIP_POLICY_NOT_CONFIGURED`; test settings are synthetic mechanics, not approved deployment policy. A current owner requests an intent with recipient, current organisation version and UUID request key. Only the independently authenticated intended active member can accept, after fresh MFA and version/expiry checks. Cancellation is limited to the participants. Request/accept/cancel are transactional and preserve exactly one active owner.

These controls do not provide sole-owner account recovery, legal delegation review or a complete administration UI. Those remain tracked work. Do not enable a deployment merely because fixture transactions passed.

## Required final acceptance record

For HVAC, billing/grace and provider acceptance record the exact final candidate SHA, immutable reviewed pack/policy version, accountable qualified reviewer identity, approval date, real acceptance evidence and explicit exceptions. Keep every field unapproved until supplied. Preserve real verified object bytes, current authority, tenant/resource isolation and approved baseline history throughout the remaining work.
