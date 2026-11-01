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

  documents: {
    async createUploadIntent(
      projectId: string,
      data: { mimeType: string; sizeBytes: number; fileName: string; requirementId?: string }
    ) {
      return request<{
        documentId: string;
        versionId: string;
        uploadMode: string;
        presignedUrl?: string;
        parts?: Array<{ partNumber: number; presignedUrl: string }>;
      }>(`/api/v1/projects/${projectId}/documents/upload-intents`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async refreshUploadUrls(versionId: string) {
      return request<any>(`/api/v1/document-versions/${versionId}/refresh-upload-urls`, {
        method: 'POST',
      });
    },
  },

  reviews: {
    async decideReview(
      reviewId: string,
      data: { decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT'; comment?: string; isOverride?: boolean }
    ) {
      return request<any>(`/api/v1/reviews/${reviewId}/decisions`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async recordExternalApproval(
      versionId: string,
      data: {
        decision: 'APPROVE';
        externalMethod: 'STAMPED_PDF' | 'EMAIL' | 'PORTAL' | 'PHYSICAL';
        externalApproverName: string;
        externalApproverRole?: string;
        externalReference?: string;
        comment?: string;
      }
    ) {
      return request<any>(`/api/v1/document-versions/${versionId}/external-approval`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },

  packages: {
    async recordRecipientDecision(
      submissionId: string,
      recipientId: string,
      data: { decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT'; comment?: string }
    ) {
      return request<any>(
        `/api/v1/submissions/${submissionId}/recipients/${recipientId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
    },
  },

  notifications: {
    async list() {
      return request<any[]>('/api/v1/notifications');
    },
    async create(data: {
      projectId?: string;
      channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';
      eventKey: string;
      payload: Record<string, any>;
      dedupKey: string;
      isUrgent?: boolean;
    }) {
      return request<any>('/api/v1/notifications', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async getOwnerDigest(projectId: string) {
      return request<any>(`/api/v1/projects/${projectId}/owner-digest`);
    },
  },

  billing: {
    async listPlans() {
      return request<any[]>('/api/v1/billing/plans');
    },
    async listInvoices() {
      return request<any[]>('/api/v1/billing/invoices');
    },
    async createInvoice(data: {
      subtotalPaise: number;
      buyerGstin?: string;
      placeOfSupply: string;
      isInterState?: boolean;
    }) {
      return request<any>('/api/v1/billing/invoices', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async recordTds(
      invoiceId: string,
      data: {
        section: '194J_A_2PCT' | '194J_B_10PCT' | '194C';
        rateBps: number;
        amountPaise: number;
        certificateReference?: string;
      }
    ) {
      return request<any>(`/api/v1/billing/invoices/${invoiceId}/tds`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
};
