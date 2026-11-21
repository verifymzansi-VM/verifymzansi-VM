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
4. There is no KYC provider module: the unused `kyc-provider.ts` stub (null
   scores, every submission to human review) was removed on 20 November 2026.
   Every identity check goes to staff review.
5. The provider callback route (`src/app/api/webhooks/kyc/provider/route.ts`),
   its payload schema and its `KYC_WEBHOOK_SECRET` were removed on 20 November
   2026 (owner decision): they wrote only to the retired source backend. The
   manual workflow has no external KYC vendor attestation; a provider
   integration will be built fresh.
6. `src/app/api/admin/verification/decide/route.ts` authorizes reviewer roles.
   High/critical approvals require an override reason and a second reviewer.
   Provider results do not independently grant verified status.
   `20261004120000_kyc_override_submission_binding.sql` binds proposals to the
   exact reviewed step version and checks it again at approval. Application
   execution uses that same version in its conditional update. A retry can
   finish a partially applied override only when the step records that decision;
   the subject and proposer cannot retry it. Apply this migration before
   deploying the corresponding application changes. Older proposals without a
   version snapshot must be rejected and reviewed again. Governance approval and
   retry also require a recent second factor and the shared sensitive-action
   limiter. Keep the `admin:governance:decide` worker policy deployed with this
   application change (10/minute, 60/hour).
7. Evidence routes and `kyc-evidence-access.ts` enforce staff/role access,
   private encrypted retrieval and access audit logs. Check no-cache headers,
   bounded metadata and sensitive-error responses, including preview component
   tests.
8. `workers/retention-cleanup.ts` and the KYC purge migrations own retention.
   Check approved/rejected/pending distinctions and deletion recovery rather
   than assuming an HTTP response proves object deletion.

## Evidence and limitations

`test:kyc` discovers maintained KYC/encryption/review regression files. The
retired source schema's database lanes (`test:kyc:db`, `test:db:isolated`) were
removed; the live schema is checked by `foundation-replay` and
`foundation-native`. The retired stub suite's synthetic KYC scenarios
(`test:browser:isolated`) were removed on 2026-11-11. The signed-in KYC journey
(ID and selfie through the website, staff claim and review, acceptance) runs on
the production schema in the foundation browser suite
(`e2e/foundation/member-post-publish.spec.ts`,
`e2e/foundation/staff-review.spec.ts`), part of the main release gate. The
high-risk governance screens have no browser test there yet
(`e2e/foundation/PORTING.md`); their database rules and routes have their own
tests. Genuine provider behavior remains a separate coverage requirement.
Fixture storage uses the shared E2E mode guard, and cannot be enabled by test
flags in a production environment. Reports live under `tmp/kyc-audit`;
INCOMPLETE is required when tools or credentials are unavailable. Preserve only
synthetic fixtures and redacted metadata in tracked evidence. See
[encryption and recovery](encryption-recovery.md) and
[audit policy](audit-tools.md).
