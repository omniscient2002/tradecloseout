import { UnprocessableEntityException } from '@nestjs/common';
import { isValidIndianGstin, IndianPanSchema, canonicalAuthenticationEmail } from '@tradecloseout/shared';

// Fail before binding untrusted HTTP identifiers to uuid-typed PostgreSQL predicates.
// Treat the current alias as an org-only route feature, never as a generic UUID.
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function requireOrganisationUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new UnprocessableEntityException({ code: 'INVALID_UUID', fieldErrors: [{ field, message: 'A UUID is required' }] });
  }
  return value;
}

const ALLOWED_STATES = new Set(
  'AN AP AR AS BR CH CG DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD PB PY RJ SK TN TR TS UK UP WB'.split(' '),
);
const ENTITIES = new Set(['PROPRIETORSHIP','PARTNERSHIP','LLP','PRIVATE_LIMITED','PUBLIC_LIMITED','OTHER']);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const PROFILE_KEYS = new Set([
  'legalName','displayName','entityType','state','timeZone','gstin','pan',
  'brandColor','accentColor','watermarkEnabled','allowSelfApproval',
  'defaultRetentionMonths','signatoryName','signatoryDesignation',
  'logoObjectId','addressJson','contactEmail','contactPhone','footerText',
]);

export interface OrgProfilePatch {
  legalName?: string;
  displayName?: string;
  entityType?: string;
  state?: string;
  timeZone?: string;
  gstin?: string | null;
  pan?: string | null;
  brandColor?: string;
  accentColor?: string | null;
  watermarkEnabled?: boolean;
  allowSelfApproval?: boolean;
  defaultRetentionMonths?: number;
  signatoryName?: string | null;
  signatoryDesignation?: string | null;
  logoObjectId?: string | null;
  addressJson?: Record<string, string>;
  contactEmail?: string | null;
  contactPhone?: string | null;
  footerText?: string | null;
}

function bad(field: string, detail = 'Unsupported or invalid value'): never {
  throw new UnprocessableEntityException({
    code: 'INVALID_ORGANISATION_PROFILE',
    fieldErrors: [{field, message: detail}],
  });
}

/**
 * Typed, allowlisted PATCH. Omitted keys preserve the stored value; explicit
 * null clears only nullable columns. In particular, arbitrary logo URLs (SVG,
 * data:, file:, network endpoints) are not a supported branding source.
 */
export function parseOrgProfilePatch(dto: unknown): {rowVersion: number; input: OrgProfilePatch} {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) bad('body');
  const raw = dto as Record<string, unknown>;
  if (typeof raw.rowVersion !== 'number' || !Number.isSafeInteger(raw.rowVersion) || raw.rowVersion < 1) bad('rowVersion', 'Current positive integer version required');
  for (const key of Object.keys(raw)) {
    if (key !== 'rowVersion' && !PROFILE_KEYS.has(key)) bad(key, 'Field is not supported by this endpoint');
  }
  if (Object.keys(raw).length < 2) bad('body', 'At least one editable field is required');
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'rowVersion') continue;
    if (value === undefined) bad(key);
    if (['legalName','displayName'].includes(key)) {
      const min = 2, max = key === 'legalName' ? 200 : 120;
      if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) bad(key);
      result[key] = value.trim();
    } else if (key === 'entityType') {
      if (typeof value !== 'string' || !ENTITIES.has(value)) bad(key);
      result[key] = value;
    } else if (key === 'state') {
      if (typeof value !== 'string' || !ALLOWED_STATES.has(value)) bad(key);
      result[key] = value;
    } else if (key === 'timeZone') {
      if (typeof value !== 'string' || value.length > 80) bad(key);
      try { new Intl.DateTimeFormat('en-IN', {timeZone: value}); }
      catch { bad(key, 'Expected an IANA time zone'); }
      result[key] = value;
    } else if (['brandColor','accentColor'].includes(key)) {
      if (value === null && key === 'accentColor') result[key] = null;
      else if (typeof value === 'string' && HEX_COLOR.test(value)) result[key] = value.toUpperCase();
      else bad(key, 'Expected a six-digit #RRGGBB colour');
    } else if (['watermarkEnabled','allowSelfApproval'].includes(key)) {
      if (typeof value !== 'boolean') bad(key);
      result[key] = value;
    } else if (key === 'defaultRetentionMonths') {
      // Cannot shorten the eight-year default retention through branding settings.
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 96 || value > 600) bad(key, 'Retain for 96–600 months; legal holds prevail');
      result[key] = value;
    } else if (key === 'gstin') {
      if (value !== null && (typeof value !== 'string' || !isValidIndianGstin(value))) {
        throw new UnprocessableEntityException({code:'INVALID_GSTIN',fieldErrors:[{field:'gstin',message:'Invalid checksum or state code'}]});
      }
      result[key] = value === null ? null : (value as string).toUpperCase();
    } else if (key === 'pan') {
      if (value !== null && (typeof value !== 'string' || !IndianPanSchema.safeParse(value).success)) {
        throw new UnprocessableEntityException({code:'INVALID_PAN',fieldErrors:[{field:'pan',message:'Expected AAAAA9999A'}]});
      }
      result[key] = value === null ? null : (value as string).toUpperCase();
    } else if (['signatoryName','signatoryDesignation','footerText'].includes(key)) {
      const max = key === 'footerText' ? 1000 : 160;
      if (value !== null && (typeof value !== 'string' || value.length > max)) bad(key);
      result[key] = value;
    } else if (key === 'logoObjectId') {
      result[key] = value === null ? null : requireOrganisationUuid(value, key);
    } else if (key === 'addressJson') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) bad(key);
      const entries = Object.entries(value);
      if (entries.length > 20 || JSON.stringify(value).length > 4096 ||
          entries.some(([k,v])=>!/^([a-zA-Z][a-zA-Z0-9_]{0,40})$/.test(k) || typeof v !== 'string' || v.length > 500)) bad(key);
      result[key] = Object.fromEntries(entries);
    } else if (key === 'contactEmail') {
      if (value === null) result[key] = null;
      else {
        const email = canonicalAuthenticationEmail(typeof value === 'string' ? value : '');
        if (!email) bad(key);
        result[key] = email;
      }
    } else if (key === 'contactPhone') {
      if (value !== null && (typeof value !== 'string' || !/^\+91[6-9]\d{9}$/.test(value))) bad(key);
      result[key] = value;
    }
  }
  return {rowVersion: raw.rowVersion as number, input: result as OrgProfilePatch};
}
