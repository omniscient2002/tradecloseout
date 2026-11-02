# AGENT DIRECTIVE: IMPLEMENT FULL END-TO-END AUTHENTICATION, MULTI-PROJECT PORTFOLIO, AND REAL PDF STREAMING

**Objective:** Eliminate the single-page root shortcut (`app/page.tsx` rendering a project directly). Re-architect `apps/web` and `apps/api` so opening the UI link enforces the real enterprise user journey defined in `11-UI-UX-SPECIFICATION.md` (§2, §3, §4, §8) and `10-API-AND-INTEGRATIONS.md` (§2):

1. **Unauthenticated Visitor (`/`)** → Redirected by `src/middleware.ts` to **`/login` (`SCR-002` / `SCR-003`)**.
2. **Sign-In & OTP Verification (`/login` → `/verify-otp`)** → User signs in with their real email or `+91` mobile number (e.g., `vikram@deccanmep.in`, `meera@deccanmep.in`, `karthik@deccanmep.in`, `amit@deccanmep.in`), receives a 6-digit OTP from `POST /api/v1/auth/otp/request`, verifies it via `POST /api/v1/auth/otp/verify`, and receives the `HttpOnly` `tc_session` cookie + `csrfToken`.
3. **Company Home Dashboard & Project Portfolio (`/dashboard` — `SCR-010` & `/projects` — `SCR-011`)** → After login, the user lands on the **Deccan EnviroTech MEP Pvt Ltd** company dashboard showing company-wide KPIs (`Active Projects`, `Missing Documents`, `Awaiting My Review`, `Expiring Soon`, `Total Retention at Risk`) and a portfolio of **3 real commercial HVAC projects** stored in PostgreSQL.
4. **Project Selection (`/projects/[projectId]` — `SCR-013` to `SCR-059`)** → Clicking any project opens that project's live workspace (`Overview`, `Checklist`, `Equipment`, `Documents`, `Reviews`, `Packages`, `Warranties & Defects`, `Audit`) populated from PostgreSQL with **real binary PDF certificates** streamed from disk/S3 via signed URLs.

---

## STEP 1: MATERIALIZE THE NEXT.JS APP ROUTER FILE TREE (`apps/web/src`)

Delete the monolithic demo `app/page.tsx` and create this exact Next.js App Router structure in `apps/web/src`:

```text
apps/web/src/
├── middleware.ts                                      # Server-side route guard checking tc_session cookie
├── lib/
│   └── api-client.ts                                  # Fetch wrapper injecting credentials, X-CSRF-Token, Idempotency-Key, If-Match
├── app/
│   ├── layout.tsx                                     # Root HTML shell + Auth/CSRF context provider
│   ├── page.tsx                                       # Redirects / -> /dashboard (or /login via middleware)
│   ├── (public)/
│   │   └── login/
│   │       └── page.tsx                               # SCR-002 / SCR-003: Sign In + 6-Digit OTP Verification
│   ├── (contractor)/
│   │   ├── layout.tsx                                 # Authenticated Enterprise Shell (Top Bar + Left Nav + Org Switcher)
│   │   ├── dashboard/
│   │   │   └── page.tsx                               # SCR-010: Company Home Dashboard & Multi-Project Portfolio
│   │   ├── projects/
│   │   │   ├── page.tsx                               # SCR-011 / SCR-012: Projects Directory & Create Project Modal
│   │   │   └── [projectId]/
│   │   │       ├── page.tsx                           # SCR-013..028: Project Workspace (Overview, Checklist, Assets, Reviews, Packages)
│   │   │       └── review/[versionId]/
│   │   │           └── page.tsx                       # SCR-025 / SCR-027: Real Binary PDF Stream Viewer + Decision Dock
│   │   ├── parties/
│   │   │   └── page.tsx                               # SCR-032: Counterparty & Supplier Directory
│   │   ├── audit/
│   │   │   └── page.tsx                               # SCR-046: Hash-Chained Audit Log Viewer
│   │   └── billing/
│   │       └── page.tsx                               # SCR-044: Plan Limits, Usage Counters, GST Invoices & TDS
│   └── (guest)/
│       └── guest/[token]/
│           └── page.tsx                               # SCR-034 / SCR-031: Isolated Supplier Upload & Client Acceptance Portals
```

---

## STEP 2: IMPLEMENT SERVER-SIDE ROUTE PROTECTION (`apps/web/src/middleware.ts`)

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/guest'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow Next.js internals, static assets, and API proxy routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon.ico')
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const sessionCookie = request.cookies.get('tc_session')?.value;

  // 1. Unauthenticated user hitting protected route -> Redirect to /login (SCR-002)
  if (!sessionCookie && !isPublicPath) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // 2. Authenticated user hitting / or /login -> Redirect to Company Dashboard (/dashboard, SCR-010)
  if (sessionCookie && (pathname === '/' || pathname === '/login')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

## STEP 3: PRODUCTION API CLIENT WITH CSRF, IDEMPOTENCY & `If-Match` (`apps/web/src/lib/api-client.ts`)

```typescript
export class ApiProblemError extends Error {
  status: number;
  code: string;
  requestId: string;
  fieldErrors: Array<{ field: string; message: string }>;

  constructor(problem: {
    title?: string;
    detail?: string;
    status?: number;
    code?: string;
    requestId?: string;
    fieldErrors?: Array<{ field: string; message: string }>;
  }) {
    super(problem.detail || problem.title || 'Request failed');
    this.status = problem.status ?? 500;
    this.code = problem.code ?? 'INTERNAL_ERROR';
    this.requestId = problem.requestId ?? 'unknown';
    this.fieldErrors = problem.fieldErrors ?? [];
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

  // Attach CSRF token from sessionStorage on unsafe methods (10 §2.2)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && typeof window !== 'undefined') {
    const csrf = window.sessionStorage.getItem('tc_csrf_token');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  // Attach Idempotency-Key on state-changing POSTs (10 §5)
  if (method === 'POST') {
    headers.set('Idempotency-Key', options.idempotencyKey || crypto.randomUUID());
  }

  // Attach If-Match optimistic concurrency header when rowVersion provided (10 §1)
  if (options.rowVersion !== undefined) {
    headers.set('If-Match', `"${options.rowVersion}"`);
  }

  const res = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: 'include',
  });

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiProblemError(data);
  }

  return data as T;
}
```

---

## STEP 4: SIGN-IN & OTP VERIFICATION SCREEN (`apps/web/src/app/(public)/login/page.tsx`)
(See directive implementation with seeded Deccan EnviroTech personas).

---

## STEP 5: COMPANY HOME DASHBOARD & MULTI-PROJECT SELECTOR (`apps/web/src/app/(contractor)/dashboard/page.tsx`)
(See directive implementation with 4 KPIs, project portfolio cards, and immediate attention items).

---

## STEP 6: REAL BINARY PDF STREAMING ENDPOINT & VIEWER (`apps/api` + `SCR-025`)
Endpoint at `GET /api/v1/projects/:projectId/document-versions/:versionId/stream`.

---

## STEP 7: SEED 3 REAL COMMERCIAL PROJECTS & REAL MULTI-PAGE PDF CERTIFICATES
Projects:
1. `HYD-BIO-09` (Aurobindo Cleanroom HVAC)
2. `HYD-IT-04` (Sattva Raidurg Tower-3 Chiller & VRF)
3. `SEC-HOSP-02` (AIG Hospital OT & ICU Cleanroom)
