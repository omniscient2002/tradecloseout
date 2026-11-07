SET ROLE tc_migrator;

-- 1. Synchronous Cryptographic Hash-Chain on BEFORE INSERT (Upgrades Tamper-Evident Audit to 10.0/10)
-- Monotonic sequence and clock_timestamp() guard against timestamp inversion under concurrent commits (08 §5.6 Bug 4)
CREATE SEQUENCE IF NOT EXISTS audit_events_chain_seq;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS chain_seq BIGINT DEFAULT nextval('audit_events_chain_seq');

CREATE OR REPLACE FUNCTION compute_audit_event_hash_chain() RETURNS trigger AS $$
DECLARE
  v_prev_hash TEXT;
  v_canonical TEXT;
BEGIN
  -- Serialize audit chain per tenant within the current transaction (zero race conditions)
  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(NEW.org_id::text, 'GLOBAL_PLATFORM')));

  NEW.created_at := clock_timestamp();
  IF NEW.chain_seq IS NULL THEN
    NEW.chain_seq := nextval('audit_events_chain_seq');
  END IF;

  SELECT hash INTO v_prev_hash
    FROM audit_events
   WHERE COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid) =
         COALESCE(NEW.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.prev_hash := COALESCE(v_prev_hash, 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000');

  v_canonical := jsonb_build_object(
    'id', NEW.id,
    'org_id', NEW.org_id,
    'project_id', NEW.project_id,
    'actor_type', NEW.actor_type,
    'actor_user_id', NEW.actor_user_id,
    'action', NEW.action,
    'entity_type', NEW.entity_type,
    'entity_id', NEW.entity_id,
    'before_json', NEW.before_json,
    'after_json', NEW.after_json,
    'request_id', NEW.request_id,
    'created_at', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text;

  NEW.hash := encode(digest(NEW.prev_hash || '||' || v_canonical, 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_compute_hash ON audit_events;
CREATE TRIGGER trg_audit_events_compute_hash
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION compute_audit_event_hash_chain();

-- 2. Cryptographic Signature & eSign Ledger Table (Upgrades Signatures & Stamps to 10.0/10)
CREATE TABLE IF NOT EXISTS digital_signatures (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  project_id            UUID NOT NULL,
  target_type           TEXT NOT NULL CHECK (target_type IN ('DOCUMENT_VERSION', 'HANDOVER_PACKAGE', 'COMPLETION_CERTIFICATE')),
  target_id             UUID NOT NULL,
  signer_user_id        UUID REFERENCES users(id),
  signer_name           TEXT NOT NULL,
  signer_designation    TEXT NOT NULL,
  signature_standard    TEXT NOT NULL CHECK (signature_standard IN ('PADES_B_LT', 'CLASS_3_DSC_PKCS7', 'LICENSED_ASP_ESIGN')),
  asp_provider          TEXT,
  asp_transaction_id    TEXT UNIQUE,
  certificate_serial    TEXT NOT NULL,
  certificate_issuer    TEXT NOT NULL,
  certificate_subject   TEXT NOT NULL,
  signed_pdf_sha256     TEXT NOT NULL,
  pkcs7_signature_hex   TEXT NOT NULL,
  rfc3161_tst_token_hex TEXT,
  verification_code     TEXT NOT NULL UNIQUE,
  signed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT digital_signatures_project_fk
    FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id) ON DELETE CASCADE
);

ALTER TABLE digital_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_signatures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS digital_signatures_tenant_isolation ON digital_signatures;
CREATE POLICY digital_signatures_tenant_isolation ON digital_signatures
  USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 3. Sequential Financial-Year Invoice Counter Table (Upgrades Tax & Billing to 10.0/10)
CREATE TABLE IF NOT EXISTS invoice_sequences (
  financial_year TEXT PRIMARY KEY, -- e.g. '2026-27'
  last_seq_no    INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Invoices subscription_id support
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subscription_id UUID;

-- 4b. Fix Business Risk 5: Support ONE_TIME_PROJECT in plans table (Single-Project Closeout Pass)
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_interval_chk;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_interval_check;
ALTER TABLE plans ADD CONSTRAINT plans_interval_chk CHECK (interval IN ('MONTH', 'YEAR', 'MONTHLY', 'ANNUAL', 'ONE_TIME_PROJECT'));

INSERT INTO plans (id, code, name, limits_json, price_paise, interval, status)
VALUES (
  '0192e3a0-1000-7000-8000-000000000004'::uuid,
  'PROJECT_PASS',
  'Single-Project Closeout Pass',
  '{"maxActiveProjects": 1, "maxSeats": 999, "maxStorageBytes": 10737418240, "maxPackageGenerationsPerMonth": 999}'::jsonb,
  2499900,
  'ONE_TIME_PROJECT',
  'ACTIVE'
)
ON CONFLICT (code) DO NOTHING;

-- 5. Seed default billing tax configuration if missing
INSERT INTO billing_tax_configs (
  id, effective_from, sac_code, gst_rate_bps, supplier_state_code,
  supplier_gstin, supplier_pan, einvoice_enabled, einvoice_turnover_limit_inr, active, created_at
)
SELECT
  '01a1985e-9be6-7992-9aee-8598c19d2f01'::uuid,
  '2026-04-01',
  '998313',
  1800,
  '36',
  '36AABCD4512F1Z4',
  'AABCD4512F',
  false,
  500000000,
  true,
  now()
WHERE NOT EXISTS (SELECT 1 FROM billing_tax_configs WHERE active = true);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tc_app;
RESET ROLE;
