# Manual/stub KYC audit guide

Run `pnpm kyc:audit`; use `--local-only` to omit external observations
explicitly. Read `scripts/lib/check-registry.ts` and the code below alongside
the results. Manual review remains configured; only `manual` and `stub` adapters
exist. Unsupported provider names fail instead of falling back silently.

## Trace the workflow

1. `src/app/api/verification/session/start/route.ts` authenticates the owner and
   creates/reuses their verification session. Check session/status route tests.
2. `src/app/api/verification/upload/route.ts` validates origin/auth, bounded
   body, file MIME/magic/integrity, ID checksum and encryption configuration. It
   stores encrypted artifacts and runs the KYC risk engine. Review its cleanup
   helper and tests for failed artifact/session/risk writes.
3. `src/lib/services/kyc-engine.ts` hashes IDs with HMAC, detects duplicates,
   velocity and document signals, and records risk and provider evidence. Raw
   IDs must not appear in public API results or ordinary logs.
4. `kyc-provider.ts` supplies null scores and sends manual/stub submissions to
   human review. The shared `src/lib/validations/kyc-webhook.ts` accepts only
   finite 0–100 scores, optional/missing or explicit null unknown scores,
   bounded metadata, known statuses and bounded references/reasons.
5. `src/app/api/webhooks/kyc/provider/route.ts` verifies HMAC before data
   access, bounds the body, rejects unsupported configuration and production
   unsigned bypasses, then calls `apply_kyc_provider_webhook` once.
   Finalized/old artifacts do not replay current risk; missing publication and
   failed writes remain retryable. Manual workflow has no genuine external KYC
   vendor attestation.
6. `src/app/api/admin/verification/decide/route.ts` authorizes reviewer roles.
   High/critical approvals require an override reason and a second reviewer.
   Provider results do not independently grant verified status.
7. Evidence routes and `kyc-evidence-access.ts` enforce staff/role access,
   private encrypted retrieval and access audit logs. Check no-cache headers,
   bounded metadata and sensitive-error responses, including preview component
   tests.
8. `workers/retention-cleanup.ts` and the KYC purge migrations own retention.
   Check approved/rejected/pending distinctions and deletion recovery rather
   than assuming an HTTP response proves object deletion.

## Evidence and limitations

`test:kyc` discovers maintained KYC/encryption/review regression files;
`test:kyc:db` is PGlite supplementary evidence. `test:db:isolated` verifies the
complete migration history on PostgreSQL/PostgREST and races separate requests.
`test:browser:isolated` records local deterministic KYC flows and any skips.
Reports live under `tmp/kyc-audit`; INCOMPLETE is required when tools or
credentials are unavailable. Preserve only synthetic fixtures and redacted
metadata in tracked evidence. See
[encryption and recovery](encryption-recovery.md) and
[audit policy](audit-tools.md).
