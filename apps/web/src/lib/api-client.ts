/**
 * TradeCloseout Production API Client
 * Supports CSRF, Idempotency-Key, If-Match, and Problem+JSON
 */

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

export function getCsrfToken(): string | null {
  if (typeof window !== 'undefined') {
    return window.sessionStorage.getItem('tc_csrf_token') || localStorage.getItem('tc_csrf_token');
  }
  return null;
}

export function setCsrfToken(token: string | null) {
  if (typeof window !== 'undefined') {
    if (token) {
      window.sessionStorage.setItem('tc_csrf_token', token);
      localStorage.setItem('tc_csrf_token', token);
    } else {
      window.sessionStorage.removeItem('tc_csrf_token');
      localStorage.removeItem('tc_csrf_token');
    }
  }
}

/**
 * A session boundary invalidates local upload authority. The encrypted/auth
 * credential is never put into IndexedDB; the queue only stores a partition
 * label. Already-blocked drafts need explicit recovery after reauthentication.
 */
function clearLocalUploadAuthority(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('tc_offline_actor_partition');
  } catch {
    // The caller still receives the authoritative authentication result.
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
    const csrf = getCsrfToken();
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

  const authBoundary = method === 'POST' && [
    '/api/v1/auth/otp/verify',
    '/api/v1/auth/logout',
    '/api/v1/auth/switch-org',
  ].includes(path.split('?')[0]);
  if (res.status === 204) {
    if (authBoundary) clearLocalUploadAuthority();
    return undefined as unknown as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearLocalUploadAuthority();
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/login') &&
      !window.location.pathname.startsWith('/guest')
    ) {
      window.location.href = '/login';
    }
    // HTTP status is authoritative even when the server sends an incomplete
    // Problem+JSON envelope; this matters for offline actor/permission fences.
    const problem = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown> : {};
    throw new ApiProblemError({
      title: typeof problem.title === 'string' ? problem.title : undefined,
      detail: typeof problem.detail === 'string' ? problem.detail : undefined,
      code: typeof problem.code === 'string' ? problem.code : undefined,
      requestId: typeof problem.requestId === 'string' ? problem.requestId : undefined,
      fieldErrors: Array.isArray(problem.fieldErrors) ? problem.fieldErrors : undefined,
      status: res.status,
    });
  }

  if (authBoundary) clearLocalUploadAuthority();
  return data as T;
}

// Backward-compatible api object
export const api = {
  auth: {
    async requestOtp(phoneOrEmail: string) {
      try {
        const res = await apiFetch<{ challengeId: string; debugOtp?: string; devOtpPreview?: string }>(
          '/api/v1/auth/otp/request',
          {
            method: 'POST',
            body: JSON.stringify({ identifier: phoneOrEmail, phoneOrEmail }),
          }
        );
        return { data: res, error: null, status: 200 };
      } catch (err: any) {
        return { data: null, error: err.message, status: err.status || 500 };
      }
    },
    async verifyOtp(challengeId: string, code: string, identifier?: string) {
      try {
        const res = await apiFetch<{
          user: { id: string; email?: string; phone?: string; full_name?: string };
          activeOrgId: string;
          csrfToken: string;
        }>('/api/v1/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({ challengeId, code, identifier }),
        });
        if (res.csrfToken) {
          setCsrfToken(res.csrfToken);
        }
        return { data: res, error: null, status: 200 };
      } catch (err: any) {
        return { data: null, error: err.message, status: err.status || 500 };
      }
    },
    async me() {
      try {
        const res = await apiFetch<any>('/api/v1/auth/me');
        return { data: res, error: null, status: 200 };
      } catch (err: any) {
        return { data: null, error: err.message, status: err.status || 500 };
      }
    },
    async logout() {
      try {
        await apiFetch<void>('/api/v1/auth/logout', { method: 'POST' });
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem('tc_csrf_token');
          window.localStorage.removeItem('tc_csrf_token');
        }
        return { data: { success: true }, error: null, status: 204 };
      } catch (err: any) {
        return { data: null, error: err.message, status: err.status || 500 };
      }
    },
  },
  projects: {
    async list() {
      try {
        const res = await apiFetch<any[]>('/api/v1/projects');
        return { data: res, error: null, status: 200 };
      } catch (err: any) {
        return { data: null, error: err.message, status: err.status || 500 };
      }
    },
    async get(id: string) {
      try {
        const res = await apiFetch<any>(`/api/v1/projects/${id}`);
        return { data: res, error: null, status: 200 };
      } catch (err: any) {
        return { data: null, error: err.message, status: err.status || 500 };
      }
    },
  },
  requirements: {
    async list(projectId: string) {
      try {
        const res = await apiFetch<any[]>(`/api/v1/projects/${projectId}/requirements`);
        return { data: res, error: null, status: 200 };
      } catch (err: any) {
        return { data: null, error: err.message, status: err.status || 500 };
      }
    },
  },
};
