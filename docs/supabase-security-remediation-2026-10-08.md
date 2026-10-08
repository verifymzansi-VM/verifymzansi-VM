# Supabase security remediation — 8 October 2026

The application database fixes are deployed to `tnygdgormnofpgjknlhr`. Platform work remains pending.

## Applied and verified

- Staff MFA is enabled (`mode=on`, `enabled=true`) through a migration that retains the feature-flag audit trigger. A live read-only staff simulation now denies AAL1 and accepts AAL2. All 10 active staff lacked enrolled factors and had expired grace periods when checked; they must enrol at `/staff/two-step`. The enrolment page retains `allowPendingMfa` and uses the service-side role lookup.
- The deployed counter guard now protects `engaged_view_count` on listings, businesses and promotions. Regression tests cover ordinary and engaged counters across all ten deployed post states, cross-owner denial, permitted draft editing, and service-role increments.
- Both API roles now have zero effective `TRUNCATE`, `REFERENCES` or `TRIGGER` grants on public tables. Existing intended DML grants remain.
- New postgres-created functions, tables and sequences require explicit browser-role grants. Both implicit global PUBLIC function execution and schema-specific browser grants were revoked. Regression tests create future objects and verify that table, column, sequence and RPC access is denied.
- Security control attestations include the reviewed organisation-admin verification/state checks and both private post tables. All 19 intentional advisor notices attest against exact bodies, signatures, grants and dependencies; no warnings were suppressed solely by name.

Migration: [20261008182329_fix_supabase_security_review.sql](../supabase/migrations/20261008182329_fix_supabase_security_review.sql). The local filename matches the applied hosted migration version.

## Remaining limits

1. **Native breached-password protection remains blocked by the Free plan**, as requested. The supported enable attempt returned HTTP 402: “available on Pro Plans and up.” Existing application breach checks during registration, password change and password reset were examined and their focused tests passed; they are not a substitute for claiming native Supabase coverage. Direct Auth paths were not declared protected. Strict mode remains FAIL.
2. **PostgreSQL 17.11 is eligible but has not been initiated.** Supabase returns no validation errors or upgrade warnings, estimates up to one hour downtime, and lists no retained backups. The maintenance-window question remains pending. Bounded pg_dump connection attempts did not produce a usable archive; empty files are not backups. A working consistent backup and an agreed maintenance window are required before proceeding.
3. **Supabase-owned defaults require platform privileges.** The project postgres role is not a superuser/member of supabase_admin and cannot modify defaults owned by that role. Those hosted defaults remain in the evidence. Application creator defaults and existing application-table whole-table privileges are fixed. No privilege escalation or managed-role alteration was attempted.

## Validation

Second review: `pnpm safety:review` completed with WARN and no required check failures. All 5,220 unit tests passed across 570 files, and all 13 database/domain fixture suites passed. Coverage is 77.39% statements, 67.54% branches, 84.2% functions and 79.18% lines, exceeding the stricter main-push thresholds. The latest focused remediation/attestation suite passed 33 tests. Added regression coverage verifies column-only grants on both private tables and continued service-role access to future tables, sequences and functions. The applied migration SQL matches the local file exactly; no additional production migration is required.

Warnings remain visible: the reviewed braces backport, development-mode provider verification limits, and unavailable CodeQL analysis. This change review does not certify full production release readiness or resolve the platform limitations above. See [the double-check evidence](audit-evidence/supabase-double-check-2026-10-08.json).

- 107 focused tests passed across eight files (remediation, exact attestations, staff MFA and breached-password routes/helper).
- After test typing/path corrections: all 32 remediation and attestation tests passed.
- TypeScript, scoped ESLint, scoped Prettier and live schema verification passed.
- Live counter-body, MFA flag, audit-event and effective grant checks passed.
- Security Advisor: **0 actionable, 1 plan-blocked, 19 reviewed controls**, with no control-attestation errors. The strict security gate correctly fails on native password protection.
- The complete isolated PostgreSQL/PostgREST lane is INCOMPLETE because Docker is unavailable. PGlite and trusted SQL role simulations do not replace an end-to-end HTTP/Auth test.

[Remediation evidence](audit-evidence/supabase-remediation-2026-10-08.json) records applied state and limits. The earlier review snapshot remains historical evidence. No database upgrade, plan purchase, user deletion or factor reset was performed.
