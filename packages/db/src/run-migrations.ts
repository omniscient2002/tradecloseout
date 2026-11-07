import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

// These names were moved without changing their SQL in the reviewed working tree.
// Keep aliases so databases that recorded the original names do not replay the same DDL.
const LEGACY_MIGRATION_ALIASES: Record<string, string> = {
  '0002_v021_redteam_patches.sql': '0003_v021_redteam_patches.sql',
  '0003_perfect_10_hardening.sql': '0004_perfect_10_hardening.sql',
  '0004_add_project_contract_columns.sql': '0005_add_project_contract_columns.sql',
};

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.MIGRATOR_DATABASE_URL ||
      'postgres://postgres:postgres@127.0.0.1:5432/tradecloseout',
  });

  const migrationsDir = path.join(__dirname, '../migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`Applying PostgreSQL migrations from ${migrationsDir}...`);

  const migrationClient = await pool.connect();
  try {
  // One migrator may change the schema at a time. The lock is session-scoped and
  // automatically released if this process exits or its connection is lost.
  await migrationClient.query('SELECT pg_advisory_lock($1, $2)', [74531, 1]);

  // Ensure migration ledger table exists (TC2-021)
  await migrationClient.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum    TEXT NOT NULL
    );
  `);

  const { rows: appliedRows } = await migrationClient.query<{ name: string; checksum: string }>(
    `SELECT name, checksum FROM schema_migrations`
  );
  const appliedChecksums = new Map(appliedRows.map((r) => [r.name, r.checksum]));
  const migrationSet = new Set(files);
  const unknownApplied = appliedRows
    .map((r) => r.name)
    .filter((name) => !migrationSet.has(name) && !LEGACY_MIGRATION_ALIASES[name]);
  if (unknownApplied.length > 0) {
    throw new Error(
      `UNKNOWN_APPLIED_MIGRATIONS: The database ledger contains migration names absent from this checkout (${unknownApplied.join(', ')}). Restore the original migration files or add a human-reviewed compatibility mapping after verifying deployed checksums; refusing to continue.`,
    );
  }

  for (const [legacyName, currentName] of Object.entries(LEGACY_MIGRATION_ALIASES)) {
    const legacyChecksum = appliedChecksums.get(legacyName);
    if (!legacyChecksum) continue;
    const currentPath = path.join(migrationsDir, currentName);
    const currentSql = readFileSync(currentPath, 'utf8');
    const currentChecksum = createHash('sha256').update(currentSql).digest('hex');
    if (legacyChecksum !== currentChecksum) {
      throw new Error(
        `MIGRATION_ALIAS_CHECKSUM_MISMATCH: Legacy migration ${legacyName} does not match ${currentName}; refusing to treat it as applied.`,
      );
    }
    const recordedCurrentChecksum = appliedChecksums.get(currentName);
    if (recordedCurrentChecksum && recordedCurrentChecksum !== currentChecksum) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: Both legacy and current ledger names exist with conflicting content for ${currentName}.`);
    }
    appliedChecksums.set(currentName, currentChecksum);
  }
  const { rows: baselineRows } = await migrationClient.query<{ hasApplicationSchema: boolean }>(
    `SELECT to_regclass('public.organisations') IS NOT NULL AS "hasApplicationSchema"`,
  );
  if (appliedRows.length === 0 && baselineRows[0]?.hasApplicationSchema) {
    throw new Error(
      'MIGRATION_BASELINE_REQUIRED: This database already has TradeCloseout tables but no migration ledger. Inventory and record the verified applied baseline before running migrations; refusing to replay historical DDL.',
    );
  }

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = readFileSync(filePath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (appliedChecksums.has(file)) {
      if (appliedChecksums.get(file) !== checksum) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH: Applied migration ${file} differs from its recorded checksum. Restore the original file and add a new forward migration.`);
      }
      console.log(`  - Migration already applied: ${file} (skipped)`);
      continue;
    }

    try {
      await migrationClient.query('BEGIN');
      await migrationClient.query(sql);
      await migrationClient.query(
        `INSERT INTO schema_migrations (name, applied_at, checksum)
         VALUES ($1, now(), $2)
         ON CONFLICT (name) DO NOTHING`,
        [file, checksum],
      );
      await migrationClient.query('COMMIT');
      console.log(`  ✓ Applied migration: ${file}`);
    } catch (err) {
      await migrationClient.query('ROLLBACK');
      console.error(`  ✗ Migration failed on ${file}:`, err);
      throw err;
    }
  }

  console.log('✓ All migrations applied successfully.');
  } finally {
    migrationClient.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
