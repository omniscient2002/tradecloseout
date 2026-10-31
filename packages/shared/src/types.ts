// packages/shared/src/types.ts

export interface UserContext {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  activeOrgId?: string;
  role?: string;
  mfaVerified?: boolean;
}

export interface TenantContext {
  orgId: string;
  userId: string;
  actorType: 'USER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  requestId: string;
}

export interface RfC9457ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  invalidParams?: Array<{ name: string; reason: string }>;
}
