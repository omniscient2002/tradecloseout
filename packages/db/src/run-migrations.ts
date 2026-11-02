import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

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

  console.log(`Applying ${files.length} PostgreSQL migrations in sequence...`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = readFileSync(filePath, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`  ✓ Applied migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ Migration failed on ${file}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('✓ All migrations applied successfully.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
