-- A durable global inbox for signed Razorpay events. Provider events do not
-- carry a trustworthy TradeCloseout tenant ID: never derive org_id from notes
-- or allow an unsigned webhook to update a subscription.
CREATE TABLE IF NOT EXISTS razorpay_webhook_inbox (
  id                 UUID PRIMARY KEY,
  event_id           TEXT NOT NULL UNIQUE,
  event_type         TEXT NOT NULL,
  body_sha256        TEXT NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  payload_json       JSONB NOT NULL,
  processing_status  TEXT NOT NULL DEFAULT 'PENDING_RECONCILIATION'
                     CHECK (processing_status IN ('PENDING_RECONCILIATION','PROCESSED','IGNORED')),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,
  CHECK (length(event_id) BETWEEN 8 AND 128),
  CHECK (length(event_type) BETWEEN 3 AND 128)
);

-- The application role can only invoke the write-only, duplicate-safe receipt
-- function. It cannot read or modify the stored payloads or impersonate a
-- global tenant via regular SQL. The function owner may use its table-owner
-- privileges; FORCE RLS would incorrectly block this narrowly scoped function.
ALTER TABLE razorpay_webhook_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON razorpay_webhook_inbox FROM PUBLIC;
REVOKE ALL ON razorpay_webhook_inbox FROM tc_app;

CREATE OR REPLACE FUNCTION record_verified_razorpay_webhook(
  p_id UUID,
  p_event_id TEXT,
  p_event_type TEXT,
  p_body_sha256 TEXT,
  p_payload JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  stored_hash TEXT;
  inserted_id UUID;
BEGIN
  IF p_id IS NULL
    OR p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 8 AND 128
    OR p_event_type IS NULL OR length(p_event_type) NOT BETWEEN 3 AND 128
    OR p_body_sha256 IS NULL OR p_body_sha256 !~ '^[a-f0-9]{64}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'INVALID_VERIFIED_WEBHOOK_RECEIPT';
  END IF;

  INSERT INTO public.razorpay_webhook_inbox
    (id, event_id, event_type, body_sha256, payload_json)
  VALUES (p_id, p_event_id, p_event_type, p_body_sha256, p_payload)
  ON CONFLICT(event_id) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN 'RECEIVED';
  END IF;

  SELECT body_sha256 INTO stored_hash
    FROM public.razorpay_webhook_inbox WHERE event_id = p_event_id;
  IF stored_hash = p_body_sha256 THEN
    RETURN 'DUPLICATE';
  END IF;
  RETURN 'PAYLOAD_CONFLICT';
END
$$;

REVOKE ALL ON FUNCTION record_verified_razorpay_webhook(UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_verified_razorpay_webhook(UUID,TEXT,TEXT,TEXT,JSONB) TO tc_app;
