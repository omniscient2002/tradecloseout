import { Pool } from 'pg';
import { randomBytes, createHash } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { readdir, readFile } from 'fs/promises';

export async function migrateDatabase(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve(__dirname, '../../src/run-migrations.ts')], {
      env: { ...process.env, MIGRATOR_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const deadline = setTimeout(() => child.kill('SIGTERM'), 60_000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(deadline); reject(error); });
    child.on('exit', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error(`Disposable migration failed: ${output}`)); });
  });
}

/** Never resets an existing database. Only a random database created here is removed. */
export async function withDisposableDatabase(work: (db: {
  admin: Pool; app: Pool; url: string; name: string;
}) => Promise<void>, options: { baselineThrough?: string } = {}) {
  const source = new URL(process.env.MIGRATOR_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/tradecloseout');
  const controlUrl = new URL(source);
  controlUrl.pathname = '/postgres';
  const control = new Pool({ connectionString: controlUrl.toString() });
  const name = `tc_test_${randomBytes(10).toString('hex')}`;
  let admin: Pool | undefined;
  let app: Pool | undefined;
  let created = false;
  try {
    await control.query(`CREATE DATABASE "${name}"`);
    created = true;
    source.pathname = `/${name}`;
    const url = source.toString();
    if (options.baselineThrough) {
      // Build a real earlier ledger/schema using original files, then exercise the
      // actual migrator's upgrade path. Never edit applied migration files.
      const baseline = new Pool({ connectionString: url });
      const client = await baseline.connect();
      try {
        await client.query(`CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text NOT NULL)`);
        const directory = path.resolve(__dirname, '../../migrations');
        const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
        if (!files.includes(options.baselineThrough)) throw new Error('UNKNOWN_TEST_BASELINE');
        for (const file of files.filter(file => file <= options.baselineThrough!)) {
          const sql = await readFile(path.join(directory, file), 'utf8');
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name,checksum,applied_at) VALUES ($1,$2,now())', [file, createHash('sha256').update(sql).digest('hex')]);
          await client.query('COMMIT');
        }
      } finally { client.release(); await baseline.end(); }
    }
    await migrateDatabase(url);
    admin = new Pool({ connectionString: url });
    admin.on('error', () => {});
    const runtime = new URL(process.env.APP_DATABASE_URL || 'postgres://tc_app:tc_app_pass@127.0.0.1:5432/tradecloseout');
    runtime.pathname = `/${name}`;
    app = new Pool({ connectionString: runtime.toString() });
    app.on('error', () => {});
    const role = await app.query(`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    if (!role.rows.length || role.rows[0].rolsuper || role.rows[0].rolbypassrls || role.rows[0].name === 'tc_migrator')
      throw new Error('TEST_RUNTIME_ROLE_IS_PRIVILEGED');
    await work({ admin, app, url, name });
  } finally {
    await app?.end();
    await admin?.end();
    if (created) await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await control.end();
  }
}
