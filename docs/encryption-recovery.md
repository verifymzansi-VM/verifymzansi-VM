# Encryption and verification recovery

The upload route, storage service, KYC engine and `workers/kyc-encryptor.ts`
must agree on the encrypted document format and key interpretation. Run
`pnpm test:kyc` for Node/worker compatibility, malformed/truncated ciphertext,
authenticated evidence access and upload compensation tests. Never use a real
customer document for an audit fixture or expose a key in evidence.

Key availability validation happens before storage. Review encrypted R2 writes,
AES authentication failures and the cleanup journal when a database or risk
write fails. Check that private artifacts are inaccessible through public URLs,
preview caches and API error messages. HMAC identity matching is a distinct
keyed operation; changing its key affects duplicate-ID detection.

A production key rotation needs a separately approved migration/re-encryption
plan and retained old-key decryption evidence. Local tests cannot prove old
production ciphertext remains decryptable. Preserve encrypted backups and
metadata before any operator mutation; this audit authorizes no rotation,
production purge, object upload or migration.

For provider/database outages retain retryable callbacks and inspect the atomic
callback/fulfillment RPC response. If a response is lost after commit, retry and
confirm duplicate handling with one audit event/invoice and no risk
amplification. For upload failures inspect the cleanup helper's compensation
results; residual orphaned encrypted objects need a scoped operator recovery
action. Audit logs should identify the operation and outcome without raw IDs or
document bytes.
