-- Add perceptual hash column for near-duplicate image detection.
-- dHash produces a 64-bit hash stored as 16-char hex.
-- Hamming distance ≤ 10 between two hashes indicates near-duplicates.

ALTER TABLE kyc_artifacts
  ADD COLUMN IF NOT EXISTS phash text;

-- Index for efficient lookups (exact match first, then app-layer Hamming)
CREATE INDEX IF NOT EXISTS idx_kyc_artifacts_phash
  ON kyc_artifacts (phash)
  WHERE phash IS NOT NULL;
