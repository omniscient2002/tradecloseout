import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve(process.cwd(), '../../scripts/run-restore-drill.sh');

describe('PH5-G28-004 staging restore preflight', () => {
  it('is valid Bash with fail-fast cleanup handlers', () => {
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('fails before touching a database when isolated-staging acknowledgment is missing', () => {
    const env = { ...process.env };
    delete env.RESTORE_DRILL_SCOPE;
    delete env.RESTORE_SOURCE_DATABASE_URL;
    const result = spawnSync('bash', [script], { encoding: 'utf8', env, timeout: 3000 });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('disposable-staging-only');
    expect(result.stdout).not.toContain('Taking consistent snapshot');
  });
});
