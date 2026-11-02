import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  TZ: z.literal('Asia/Kolkata'),
  PORT: z.coerce.number().int().positive(),
  PUBLIC_APP_URL: z.string().url(),

  // Database & Redis (RT-005: runtime connects exclusively as tc_app NOBYPASSRLS)
  APP_DATABASE_URL: z.string().min(10),
  MIGRATOR_DATABASE_URL: z.string().min(10).optional(),
  REDIS_URL: z.string().min(8),

  // Private S3-Compatible Storage (FR-DOC-027)
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(2),
  S3_PRIVATE_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(3),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900), // <= 15m per NFR-SEC-008

  // ClamAV Daemon (WF-11 / RT-026)
  CLAMD_HOST: z.string().min(2),
  CLAMD_PORT: z.coerce.number().int().positive(),
  PDF_MAX_PAGES: z.coerce.number().int().min(1).max(1000), // RT-034
  PDF_MAX_OBJECTS: z.coerce.number().int().min(100).max(25000), // RT-034

  // DLT SMS & Transactional Email (FR-INT-001, FR-INT-012)
  DLT_SMS_PROVIDER_URL: z.string().url(),
  DLT_SMS_API_KEY: z.string().min(8),
  DLT_ENTITY_ID: z.string().min(4),
  DLT_OTP_TEMPLATE_ID: z.string().min(4),
  SMTP_FROM_EMAIL: z.string().email(),

  // Razorpay Billing (FR-BIL-004)
  RAZORPAY_KEY_ID: z.string().min(6),
  RAZORPAY_KEY_SECRET: z.string().min(8),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadAndValidateEnv(rawEnv: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`BOOT_CONFIG_INVALID: Missing or invalid environment variables: ${missing}`);
  }
  return parsed.data;
}
