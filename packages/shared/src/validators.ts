import { z } from 'zod';

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Validates a 15-character Indian GSTIN including state code (01-38/97/99),
 * embedded PAN structure, and Modulo-36 checksum digit (FR-ORG-005 / 10 §13).
 */
export function isValidIndianGstin(gstin: string): boolean {
  const normalized = gstin.trim().toUpperCase();
  if (!/^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const charIndex = GSTIN_CHARS.indexOf(normalized[i]!);
    if (charIndex === -1) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = charIndex * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }

  const checkCodeIndex = (36 - (sum % 36)) % 36;
  return normalized[14] === GSTIN_CHARS[checkCodeIndex];
}

export const IndianMobileSchema = z
  .string()
  .trim()
  .regex(/^\+91[6-9][0-9]{9}$/, 'Must be a valid Indian mobile number starting with +91 and 10 digits.');

export const IndianPanSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN format (expected 10 characters, e.g., ABCDE1234F).');

export const IndianGstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidIndianGstin, {
    message: 'Invalid 15-character GSTIN or checksum mismatch.',
  });

export const ProjectCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, 'Project code must be 2–30 uppercase alphanumeric/hyphen characters.');

export const AssetTagSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(50)
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,49}$/, 'Asset tag must be 1–50 characters with no spaces.');

export const RevisionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9.-]{1,10}$/, 'Revision code must be 1–10 alphanumeric characters (e.g., R0, R1, A).');

export const CreateUploadIntentSchema = z.object({
  requirementId: z.string().uuid(),
  assetId: z.string().uuid().optional().nullable(),
  filename: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (name) => !/\.(svg|exe|bat|cmd|sh|docm|xlsm)$/i.test(name),
      "This file type isn't supported. Use PDF, JPG, PNG, WebP, DOCX, XLSX, DWG or ZIP (SVG is strictly banned).",
    ),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024, 'File exceeds the 100 MB limit.'),
  mimeType: z.enum([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/vnd.dwg',
    'application/zip',
  ]),
  revisionCode: RevisionCodeSchema,
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  title: z.string().trim().min(2).max(300),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  externalComment: z.string().max(1000).optional(),
  internalNote: z.string().max(1000).optional(),
});

/**
 * Formats integer paise into Indian Rupee grouping (e.g. ₹1,25,000) per 11 §10.
 */
export function formatInrFromPaise(paise: bigint | number): string {
  const rupees = typeof paise === 'bigint' ? Number(paise) / 100 : paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}
