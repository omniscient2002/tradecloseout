-- G01-020: a committed invitation MUST NOT be redeemable before the
-- delivery adapter acknowledges submission. A process crash/timeout cannot
-- leave an actionable token that was never confirmed as sent. The token is
-- single-use and remains inaccessible to other tenants under existing RLS.
SET ROLE tc_migrator;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_status_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_status_check
  CHECK (status IN ('DELIVERY_PENDING','PENDING','ACCEPTED','EXPIRED','REVOKED','SUPERSEDED'));

-- Historical PENDING invitations were emitted by the older send-after-commit
-- path, where provider timeouts could leave a usable token. Fail closed on
-- migration: users can be invited again through the new delivery gate.
UPDATE invitations SET status='REVOKED'
  WHERE status='PENDING' AND expires_at>now();

RESET ROLE;
