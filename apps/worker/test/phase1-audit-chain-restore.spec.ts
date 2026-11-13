import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { scoped, seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { TradeCloseoutScheduler } from '../src/scheduler';

test('PH1-G26-008: restored audit chain and internal head registry must agree', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { tenants: [a] } = await seedTenants(admin);
    const id = randomUUID();
    await scoped(app, a.orgId, client => client.query(
      `INSERT INTO audit_events(id,org_id,project_id,actor_type,action,entity_type,entity_id,request_id)
       VALUES ($1,$2,$3,'SYSTEM','RESTORE_CHECK','PROJECT',$3,'g26-restore')`,
      [id, a.orgId, a.projectIds[0]],
    ));
    const scheduler = new TradeCloseoutScheduler(app, {} as any);
    const valid = await scheduler.verifyAuditHashChainIntegrity();
    assert(valid.verifiedEvents >= 1);

    // Simulate a privileged partial restore that lost the tail of the audit
    // table while leaving the protected position registry intact. Ordinary
    // tc_app does not have the ability to perform this mutation.
    const privileged = await admin.connect();
    try {
      await privileged.query('CREATE TEMP TABLE g26_restore_backup AS SELECT * FROM audit_events WHERE id=$1', [id]);
      await privileged.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
      try {
        const deleted = await privileged.query('DELETE FROM audit_events WHERE id=$1', [id]);
        assert.equal(deleted.rowCount, 1);
      } finally {
        await privileged.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
      }

      // A chain with zero remaining events appears locally contiguous, but
      // the separate ledger still expects its terminal count and hash.
      await assert.rejects(scheduler.verifyAuditHashChainIntegrity(),
        (error: unknown) => error instanceof Error &&
          error.message === 'AUDIT_CHAIN_HEAD_MISMATCH');

      // Reconstitute exactly the backed-up source row with privileged restore
      // controls (never through the runtime role). Keep the original hash,
      // timestamp, sequence and registry entry: no resequencing is allowed.
      await privileged.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
      try {
        const restored = await privileged.query(
          'INSERT INTO audit_events SELECT * FROM g26_restore_backup',
        );
        assert.equal(restored.rowCount, 1);
      } finally {
        await privileged.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
      }
      const accepted = await scheduler.verifyAuditHashChainIntegrity();
      assert.equal(accepted.verifiedEvents, valid.verifiedEvents);
      const persisted = await admin.query(
        `SELECT a.chain_seq,a.hash,p.chain_seq AS registered_seq,p.event_hash
           FROM audit_events a JOIN audit_chain_positions p
             ON p.chain_seq=a.chain_seq AND p.event_id=a.id
          WHERE a.id=$1`, [id],
      );
      assert.equal(persisted.rowCount, 1);
      assert.equal(String(persisted.rows[0].chain_seq), String(persisted.rows[0].registered_seq));
      assert.equal(persisted.rows[0].hash, persisted.rows[0].event_hash);
    } finally {
      await privileged.query('ALTER TABLE audit_events ENABLE TRIGGER USER').catch(() => {});
      privileged.release();
    }
  });
});
