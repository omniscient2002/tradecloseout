-- G01 reviewer decisions are security-critical tenant records. Database
-- integration tests require RLS enabled and FORCEd on every tenant table.
-- The platform sign-off function runs as tc_migrator and has an explicit
-- narrowly assigned owner-only policy. tc_app and reviewer login identities
-- have no direct ledger access; they can only call the reviewed function.
SET ROLE tc_migrator;

ALTER TABLE external_authority_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_authority_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_authority_reviews_trusted_owner ON external_authority_reviews;
CREATE POLICY external_authority_reviews_trusted_owner
  ON external_authority_reviews TO tc_migrator
  USING (true) WITH CHECK (true);

REVOKE ALL ON external_authority_reviews FROM PUBLIC,tc_app,tc_external_authority_reviewer;

RESET ROLE;
