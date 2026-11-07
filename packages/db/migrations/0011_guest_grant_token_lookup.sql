-- Guest token exchange needs read-only lookup before the tenant is known.
-- Mutations remain subject to the tenant policy after the server binds the grant's org.
DROP POLICY IF EXISTS guest_grants_token_lookup ON guest_grants;
CREATE POLICY guest_grants_token_lookup ON guest_grants
  FOR SELECT
  USING (
    token_hash = NULLIF(current_setting('app.current_token_hash', true), '')
    AND status = 'ACTIVE'
    AND expires_at > now()
  );

-- Sessions issued by the legacy exchange cannot prove that an OTP was consumed.
-- Existing links remain intact, but their guests must authenticate again.
UPDATE sessions SET revoked_at = now()
 WHERE guest_grant_id IS NOT NULL AND revoked_at IS NULL;
