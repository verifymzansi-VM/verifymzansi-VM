-- Prevent concurrent duplicate KYC artifact uploads for the same user + step.
-- Without this, two simultaneous uploads both INSERT as "pending" and the
-- supersede UPDATE (which rejects older rows) can miss the concurrent twin.
-- Only one pending artifact per (user_id, step_type) is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_artifacts_pending_unique
  ON kyc_artifacts (user_id, step_type)
  WHERE status = 'pending';
