/**
 * TradeCloseout Frontend API Client
 * Interfaces directly with NestJS API on /api/v1
 */

let memoryCsrfToken: string | null = null;

export function getCsrfToken(): string | null {
  if (typeof window !== 'undefined' && !memoryCsrfToken) {
    memoryCsrfToken = localStorage.getItem('tc_csrf_token');
  }
  return memoryCsrfToken;
}

export function setCsrfToken(token: string | null) {
  memoryCsrfToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('tc_csrf_token', token);
    } else {
      localStorage.removeItem('tc_csrf_token');
    }
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null; status: number }> {
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const csrf = getCsrfToken();
  const method = (options.method || 'GET').toUpperCase();
  if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', csrf);
  }

  try {
    const res = await fetch(path, {
      ...options,
      headers,
      credentials: 'include', // send tc_session cookie
    });

    const status = res.status;
    if (status === 204) {
      return { data: null, error: null, status };
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }

    if (!res.ok) {
      return {
        data: null,
        error: json?.message || json?.error || `Request failed (${status})`,
        status,
      };
    }

    return { data: json as T, error: null, status };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Network error', status: 0 };
  }
}

export const api = {
  auth: {
    async requestOtp(phoneOrEmail: string) {
      return request<{ challengeId: string; debugOtp?: string }>(
        '/api/v1/auth/otp/request',
        {
          method: 'POST',
          body: JSON.stringify({ identifier: phoneOrEmail, phoneOrEmail }),
        }
      );
    },
    async verifyOtp(challengeId: string, code: string, identifier?: string) {
      const res = await request<{
        user: { id: string; email?: string; phone?: string; full_name?: string };
        activeOrgId: string;
        csrfToken: string;
      }>('/api/v1/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, code, identifier }),
      });
      if (res.data?.csrfToken) {
        setCsrfToken(res.data.csrfToken);
      }
      return res;
    },
    async me() {
      return request<{
        id: string;
        email: string;
        phone: string;
        full_name: string;
        active_org_id: string;
        org_role: string;
      }>('/api/v1/auth/me');
    },
    async logout() {
      const res = await request('/api/v1/auth/logout', { method: 'POST' });
      setCsrfToken(null);
      return res;
    },
  },

  projects: {
    async list() {
      return request<any[]>('/api/v1/projects');
    },
    async get(id: string) {
      return request<any>(`/api/v1/projects/${id}`);
    },
    async create(data: {
      code: string;
      name: string;
      projectType?: string;
      startDate?: string;
      targetHandoverDate?: string;
      settings?: Record<string, any>;
    }) {
      return request<any>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },

  checklists: {
    async listRequirements(projectId: string) {
      return request<any[]>(`/api/v1/projects/${projectId}/requirements`);
    },
    async createRequirement(
      projectId: string,
      data: {
        key?: string;
        title: string;
        docTypeCode: string;
        mandatory?: boolean;
        assetTag?: string;
        dueDate?: string;
        disciplineCode?: string;
        tradeCode?: string;
      }
    ) {
      return request<any>(`/api/v1/projects/${projectId}/requirements`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async requestWaiver(
      projectId: string,
      reqId: string,
      data: { reason: string; justification: string }
    ) {
      return request<any>(
        `/api/v1/projects/${projectId}/requirements/${reqId}/waiver`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
    },
  },
};
