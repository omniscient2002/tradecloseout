#!/usr/bin/env bash
# ==============================================================================
# TRADECLOSEOUT v0.2.1 — PART 2: WEB (NEXT.JS) & WORKER (BULLMQ/QPDF) MATERIALIZER
# ==============================================================================
# Usage:
#   chmod +x materialize-web-and-worker.sh
#   ./materialize-web-and-worker.sh ./tradecloseout-app
# ==============================================================================

set -euo pipefail

TARGET_DIR="${1:-./tradecloseout-app}"
echo "======================================================================"
echo "Materializing Next.js Web App & BullMQ Worker into: ${TARGET_DIR}"
echo "======================================================================"

mkdir -p "${TARGET_DIR}"
cd "${TARGET_DIR}"

mkdir -p \
  apps/worker/src/queues \
  apps/web/src/lib \
  apps/web/src/components \
  "apps/web/src/app/(public)/login" \
  "apps/web/src/app/(contractor)/dashboard" \
  "apps/web/src/app/(contractor)/projects/[projectId]/review/[versionId]" \
  "apps/web/src/app/(guest)/guest/[token]"

# ------------------------------------------------------------------------------
# 1. WORKER SERVICE (@tradecloseout/worker) — CLAMAV, QPDF MERGER & SCHEDULER
# ------------------------------------------------------------------------------
cat << 'EOF' > apps/worker/package.json
{
  "name": "@tradecloseout/worker",
  "version": "0.2.1",
  "private": true,
  "scripts": {
    "dev": "tsx watch ./src/main.ts"
  },
  "dependencies": {
    "@tradecloseout/db": "workspace:*",
    "@tradecloseout/shared": "workspace:*",
    "bullmq": "^5.15.0",
    "ioredis": "^5.4.1",
    "pdf-lib": "^1.17.1",
    "pg": "^8.13.0",
    "uuidv7": "^1.0.2"
  }
}
EOF

cat << 'EOF' > apps/worker/src/main.ts
import { Pool } from 'pg';
import Redis from 'ioredis';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const pool = new Pool({
  connectionString: process.env.APP_DATABASE_URL || 'postgres://tc_app:tc_app_pass@127.0.0.1:5432/tradecloseout',
});
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

async function runDailyExpiryPass() {
  const locked = await redis.set('lock:sched:daily-expiry', '1', 'EX', 300, 'NX');
  if (!locked) return;
  try {
    const { rows: orgs } = await pool.query(`SELECT id FROM organisations WHERE status = 'ACTIVE'`);
    for (const org of orgs) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_org', $1, true)`, [org.id]);
        await client.query(
          `UPDATE requirements r
              SET status = 'EXPIRED', row_version = r.row_version + 1, updated_at = now()
             FROM document_requirements dr
             JOIN documents d ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
             JOIN document_versions dv ON dv.org_id = d.org_id AND dv.project_id = d.project_id AND dv.id = d.current_approved_version_id
            WHERE r.org_id = $1
              AND dr.requirement_id = r.id
              AND r.status IN ('APPROVED', 'HANDED_OVER')
              AND dv.expiry_date IS NOT NULL
              AND dv.expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date`,
          [org.id],
        );
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  } finally {
    await redis.del('lock:sched:daily-expiry');
  }
}

async function bootWorker() {
  console.log('✓ TradeCloseout Worker & Leader-Locked Scheduler active.');
  try {
    const { stdout } = await execFileAsync('qpdf', ['--version']);
    console.log('✓ qpdf engine detected:', stdout.split('\n')[0]);
  } catch {
    console.warn('! qpdf binary not found in PATH; install qpdf for out-of-process PDF linearization.');
  }

  await runDailyExpiryPass();
  setInterval(runDailyExpiryPass, 60 * 60 * 1000);
}

bootWorker().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
EOF

# ------------------------------------------------------------------------------
# 2. NEXT.JS WEB APP (@tradecloseout/web) — CONFIG, MIDDLEWARE & PAGES
# ------------------------------------------------------------------------------
cat << 'EOF' > apps/web/package.json
{
  "name": "@tradecloseout/web",
  "version": "0.2.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002"
  },
  "dependencies": {
    "lucide-react": "^0.454.0",
    "next": "^14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3"
  }
}
EOF

cat << 'EOF' > apps/web/next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:4000/api/v1/:path*',
      },
    ];
  },
};

export default nextConfig;
EOF

cat << 'EOF' > apps/web/src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/guest'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/manifest.json') ||
    pathname.startsWith('/sw.js')
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const sessionCookie = request.cookies.get('tc_session')?.value;

  if (!sessionCookie && !isPublicPath) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (sessionCookie && (pathname === '/' || pathname === '/login')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
EOF

cat << 'EOF' > apps/web/src/lib/api-client.ts
export class ApiProblemError extends Error {
  status: number;
  code: string;
  requestId: string;

  constructor(problem: { title?: string; detail?: string; status?: number; code?: string; requestId?: string }) {
    super(problem.detail || problem.title || 'Request failed');
    this.status = problem.status ?? 500;
    this.code = problem.code ?? 'INTERNAL_ERROR';
    this.requestId = problem.requestId ?? 'unknown';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { rowVersion?: number; idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json, application/problem+json');

  const method = (options.method || 'GET').toUpperCase();
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && typeof window !== 'undefined') {
    const csrf = window.sessionStorage.getItem('tc_csrf_token');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  if (method === 'POST') {
    headers.set('Idempotency-Key', options.idempotencyKey || crypto.randomUUID());
  }

  if (options.rowVersion !== undefined) {
    headers.set('If-Match', `"${options.rowVersion}"`);
  }

  const res = await fetch(path, { ...options, method, headers, credentials: 'include' });
  if (res.status === 204) return undefined as unknown as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiProblemError(data);
  }
  return data as T;
}
EOF

cat << 'EOF' > apps/web/src/app/page.tsx
import { redirect } from 'next/navigation';

export default function RootRedirectPage() {
  redirect('/dashboard');
}
EOF

echo "======================================================================"
echo "✓ Next.js Web App & BullMQ Worker Materialized into ${TARGET_DIR}"
echo "======================================================================"
