# Authorized production rollout — 11 October 2026

The owner authorized publication to main, deployment, the reviewed migrations,
and an encrypted administrative backup with an isolated restore. This rollout
does not resolve the assessment's NO-GO verdict for real personal information
and payments. No live credentials were rotated and no subscription was changed.

## Applied and verified

- Initial production release: source 417e9e60, successful CI 38032684485 and
  deployment 38115106116. All five deployment-workflow workers uploaded.
- Production Supabase project tnygdgormnofpgjknlhr: migrations
  20261009205230_require_staff_mfa_without_exceptions and
  20261009225604_expire_inactive_incomplete_kyc applied. All 230 repository
  migration versions exist in the remote ledger; no pending or extra versions.
  Two historical names/statements differ (see limitations below).
- Deployed privileged role checks require AAL2 and a matching active Auth
  session. The inactive incomplete KYC helper uses the approved 90-day limit,
  preserves holds and active governance work, and is service-only.
- Public media domains enforce TLS 1.2; live handshakes rejected TLS 1.0/1.1.
  Supabase password composition restrictions removed; minimum length remains 8.
- Encrypted consistent SQL API records plus encrypted schema backup restored
  into a temporary network-isolated, memory-backed PostgreSQL instance.
  Normalized records matched across all 130 captured tables. Cron disabled;
  restore container removed. Customer records, credentials and backup files
  remain outside Git and reports.
- Initial live read-only checks: homepage/login/register/pricing/health 200;
  anonymous private evidence, evidence metadata and payment status 401. Nine
  desktop/mobile public browser checks passed without form submissions.

## Additional reviewed source

The shared checkout contains a separate security audit's completed patch: shared
public-preview throttling with failure blocking, anonymous cacheable preview
reads, preserved client CSRF proof and final middleware request headers, stable
source-only type checking, and tightly bounded generated dependency-link scanner
exclusions. Focused regression verification: 5 files / 43 tests passed. Format,
lint, types, imports, dead-code, duplication, strict secrets, contracts and
security canaries passed. The separate isolated production build/browser and
bundle checks passed; synthetic provider models are not hosted evidence. This
patch must pass CI and a subsequent production rollout before being reported as
live. This document records the initial rollout and review evidence; the final
GitHub deployment run supplies the exact published commit receipt.

## Outstanding verification and launch controls

- Native Supabase breached-password protection remains disabled: enabling it
  returned HTTP 402. Application password checks do not establish protection for
  direct Auth access. A subscription change was not authorized.
- Eight moderators lacked enrolled MFA at inspection. Strict controls now
  require enrollment for privileged access; do not reintroduce grace bypasses.
- Current local PostgreSQL password still fails authentication after the owner
  updated local keys. Management token access and migration parity work. Do not
  reset or rotate the production password without separate authorization.
- Historical migration versions 20260303000000 and 20260411000000 have remote
  names/statements for evidence-desk enablement and an event-type index rather
  than the repository's promotions-table creation and logo-column addition.
  Those remote operations also have correctly named later ledger entries. The
  promotions table, text logo column and event-type index exist. Version parity
  alone does not prove identical historical migration execution. Preserve the
  ledger; independently reconcile its provenance before certifying history.
- Restore verified database records, not provider Auth sign-in, R2 object bytes,
  external encryption/signing keys, or complete service recovery. Provider
  backup API lists no available backups and PITR is disabled.
- Database SSL enforcement remains disabled; the backup client used certificate
  verification. No unsupported provider upgrade or database setting was applied.
- No isolated staging exists. Hosted cross-user/organisation authorization,
  revoked-session scenarios and genuine Ozow callback delivery still need
  isolated verification. No intrusive production tests or real payments run.
- Upload malware scanning, alert/incident exercises and remaining ASVS coverage
  gaps remain in the assessment. CodeQL Analyze was unavailable/skipped.
- GitHub had no open issues or PRs at inspection; assessment findings remain
  actionable even when no issue exists. Clean tests do not establish ASVS L2.

Use the assessment, coverage record, maintenance plan and independent-review
brief alongside this receipt. Do not interpret deployment as launch clearance.
