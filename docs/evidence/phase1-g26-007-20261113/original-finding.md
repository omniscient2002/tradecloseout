### PH1-G26-007 — P2 / SOURCE_CONFIRMED: Tenant alias validation is not applied uniformly

**Source:** [packages/db/migrations/0001_rls_and_constraints.sql](https://github.com/omniscient2002/tradecloseout/blob/9ed91a9e96c77c9eff967f6c845d18c38fb62ac6/packages/db/migrations/0001_rls_and_constraints.sql), [apps/api/src/database/tenant-db.service.ts](https://github.com/omniscient2002/tradecloseout/blob/9ed91a9e96c77c9eff967f6c845d18c38fb62ac6/apps/api/src/database/tenant-db.service.ts), [packages/db/src/tenant-tx.ts](https://github.com/omniscient2002/tradecloseout/blob/9ed91a9e96c77c9eff967f6c845d18c38fb62ac6/packages/db/src/tenant-tx.ts).

**Observation and limits:** The canonical conflicting-alias checker introduced in migration 0016 is used by selected later tables; many core policies still read app.current_org directly. Normal wrappers set both aliases consistently, but the database does not uniformly reject conflicting settings.

**Required correction:** Standardise tenant context and policy functions across all relevant tables and privileged functions, split self-discovery SELECT from writes where appropriate, and retain explicit token/bootstrap exceptions. Do not broaden RLS to repair a caller bug.

**Acceptance:** Test no context, conflicting aliases, pooled commit/rollback, self-membership discovery, guest/invitation token contexts and every tenant table/partition under the restricted role.

**Executed local observations:** P17. See the evidence JSON; a reproduction passing is not a repaired control.

