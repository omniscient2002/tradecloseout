# G03 production acceptance gates

Status: OPEN / NO_GO. No implementation, remote CI verification, independent release approval or deployment is claimed.

Reviewed source: `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`.

1. Fresh and prior-version PG16 upgrade succeeds, restricted role and RLS unchanged.
2. Exactly one eligible active owner after all commits; deterministic races pass.
3. Full org-role/guest/tenant HTTP matrix, malformed inputs, CSRF and preconditions.
4. Intended verified contact joins intended org once; revoke/expire/race/replay deny.
5. Real email/SMS delivery, queued/failure/retry/bounce behavior and secrets handling.
6. Suspend immediately; revocation across real replicas/sessions within <=60 seconds.
7. In-flight/worker/offline actions respect current authority and lifecycle policy.
8. Complete gap report; eligible replacements; zero orphaned active obligations.
9. Immutable creator/requester/party authority, review evidence and package snapshots.
10. Lost-response/process-crash retry tests; stable receipts; no duplicate effects.
11. Profile defaults/clear/update/versioning; settings affect only permitted behavior.
12. Multi-tenant/two-tab browser journeys with real org data and no demo success paths.
13. Restricted-role worker discovery, event routing, notifications and recovery/DLQ.
14. Realistic load/query plans, pagination, lock budgets and resumable offboarding.
15. Legal-hold/export/deletion/retention and provider/backup operational acceptance.
16. Exact candidate SHA: pnpm typecheck, pnpm build, pnpm test, test:security,
    test:rbac and full application test:e2e with real isolated fixtures; remote CI and
    independent security/domain/migration review. Revalidate affected assertions on
    every new head. User retains merge/deploy authority.

Only after these gates pass can the exact reviewed release be called production
ready for its declared G03 scope. Other product groups and real infrastructure still
need their own acceptance. No finite audit proves that all possible bugs are absent.
