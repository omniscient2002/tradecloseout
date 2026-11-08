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

const CSRF_STORAGE_KEY = 'tc_csrf_token';
const GENERATION_STORAGE_KEY = 'tc_auth_generation';
const AUTH_CHANGE_EVENT_KEY = 'tc_auth_epoch';

export function getCsrfToken(): string | null {
  return typeof window === 'undefined' ? null : sessionStorage.getItem(CSRF_STORAGE_KEY);
}
export function getAuthGeneration(): string | null {
  return typeof window === 'undefined' ? null : sessionStorage.getItem(GENERATION_STORAGE_KEY);
}

/** Raw CSRF is deliberately NOT persisted to localStorage or broadcast. */
export function setCsrfToken(token: string | null, generation?: string | null, announce = true) {
  if (typeof window === 'undefined') return;
  if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
  else sessionStorage.removeItem(CSRF_STORAGE_KEY);
  if (generation) sessionStorage.setItem(GENERATION_STORAGE_KEY, generation);
  else if (!token) sessionStorage.removeItem(GENERATION_STORAGE_KEY);
  if (announce) {
    // Only a nonsecret random event is shared. Other tabs must re-bootstrap
    // or pause work rather than retaining actionable stale tenant state.
    localStorage.setItem(AUTH_CHANGE_EVENT_KEY, crypto.randomUUID());
  }
}

export function watchAuthChanges(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key !== AUTH_CHANGE_EVENT_KEY) return;
    sessionStorage.removeItem(CSRF_STORAGE_KEY);
    sessionStorage.removeItem(GENERATION_STORAGE_KEY);
    onChange();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

let bootstrapPromise: Promise<void> | null = null;
async function restoreSessionSecurity(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (getCsrfToken() && getAuthGeneration()) return;
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const response = await fetch('/api/v1/auth/session/bootstrap', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new ApiProblemError({
        status: response.status, code: 'SESSION_BOOTSTRAP_FAILED',
        detail: 'Sign in again to restore your authenticated session.',
      });
      const state = await response.json() as { csrfToken: string; authGeneration: string };
      if (!state?.csrfToken || !state?.authGeneration) throw new Error('INVALID_AUTH_BOOTSTRAP');
      setCsrfToken(state.csrfToken, state.authGeneration, false);
    })().finally(() => { bootstrapPromise = null; });
  }
  await bootstrapPromise;
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
    const isUnauthenticatedOtp = /\/(?:auth\/otp|guest\/[^/]+\/otp)\/(?:request|verify)$/.test(path);
    if (!isUnauthenticatedOtp) {
      await restoreSessionSecurity();
      const csrf = getCsrfToken();
      const generation = getAuthGeneration();
      if (csrf) headers.set('X-CSRF-Token', csrf);
      if (generation) headers.set('X-Auth-Generation', generation);
    }
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
    if (typeof window !== 'undefined' && res.status === 409 &&
        data?.code === 'AUTH_CONTEXT_CHANGED') {
      // Never retry a stale write against a newly selected tenant/session.
      // Force explicit re-bootstrap and human reconfirmation.
      setCsrfToken(null);
    }
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/login') &&
      !window.location.pathname.startsWith('/guest')
    ) {
      window.location.href = '/login';
    }
    throw new ApiProblemError(data);
  }

  if (typeof window !== 'undefined' &&
      /\/api\/v1\/auth\/switch-org$/.test(path) &&
      data?.csrfToken && data?.authGeneration) {
    setCsrfToken(data.csrfToken, data.authGeneration);
  }
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
          authGeneration: string;
        }>('/api/v1/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({ challengeId, code, identifier }),
        });
        if (res.csrfToken) {
          setCsrfToken(res.csrfToken, res.authGeneration);
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
        // Confirmed backend revocation: invalidate both the CSRF and its
        // session-generation binding; notify other tabs and offline workers.
        setCsrfToken(null);
        if (typeof window !== 'undefined') {
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
