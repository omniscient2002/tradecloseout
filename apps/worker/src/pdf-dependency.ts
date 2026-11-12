import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Production must not accept processing work without the required PDF inspector. */
export async function checkWorkerPdfDependency(
  probe: () => Promise<unknown> = () => exec('qpdf', ['--version'], { timeout: 5000 }),
  mode = process.env.NODE_ENV,
): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    if (mode !== 'test' && mode !== 'development') throw new Error('WORKER_QPDF_REQUIRED');
    return false;
  }
}
