import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { securityHeadersMiddleware } from '../src/common/middleware/security-headers.middleware';

describe('PH1-G27-007 safe browser and API response headers', () => {
  it('adds privacy and content-sniffing headers to API responses before routing', () => {
    const res: any = { setHeader: jest.fn() };
    const next = jest.fn();
    securityHeadersMiddleware({} as any, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Permissions-Policy', 'camera=(), microphone=(), geolocation=()',
    );
    // The application is allowed to frame its own protected PDF stream.
    // X-Frame-Options DENY must only be emitted for Next application pages.
    expect(res.setHeader.mock.calls.some(([name]: [string]) => name === 'X-Frame-Options')).toBe(false);
  });

  it('configures Next security headers on pages and disables caching on proxied API routes', () => {
    const url = pathToFileURL(resolve(__dirname, '../../web/next.config.mjs')).href;
    const script = `import config from ${JSON.stringify(url)};
      const rules = await config.headers();
      process.stdout.write(JSON.stringify(rules));`;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', timeout: 10_000,
    });
    const rules = JSON.parse(output) as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const common = rules.find(rule => rule.source === '/:path*');
    const api = rules.find(rule => rule.source === '/api/:path*');
    expect(common).toBeDefined();
    expect(api).toBeDefined();
    expect(Object.fromEntries(common!.headers.map(h => [h.key, h.value]))).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    expect(Object.fromEntries(api!.headers.map(h => [h.key, h.value]))).toMatchObject({
      'Cache-Control': 'private, no-store',
    });
    expect(common!.headers.some(h => h.key === 'X-Frame-Options')).toBe(false);
  });
});
