# VerifyMzansi prelaunch security assessment

**Verdict: NO-GO for collecting real identity/KYC evidence or taking real
payments.** Confirmed privileged-access and evidence-authorization defects have
local fixes, but none are deployed. Hosted authorization/revocation/provider
callback tests, isolated staging and verified recovery remain launch gates. This
is an evidence-based scoped assessment, not a claim of complete security or
legal compliance.

Assessment dates:9–10 October 2026 (Africa/Johannesburg). Stable
baseline:[OWASP ASVS 5.0.0 cumulative Levels1+2](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release).
The newer artifact named Bleeding Edge is not the stable baseline. A
separate253-requirement coverage record retains exact requirements, evidence and
limitations. No untested requirement is marked passed.

## Boundaries and provenance

- Repository:[verifymzansi-VM/verifymzansi-VM](https://github.com/verifymzansi-VM/verifymzansi-VM),
  original main HEAD da5787db24fe9ad36c5968d04c7519ae6b7b3079. Local installed
  Next16.3.8, Node22.22, pnpm10.34.5; inspected framework-local
  data-security/auth/route documentation before edits. Root AGENTS.md read and
  preserved. Root SECURITY.md does not exist. Repository
  security/KYC/payment/release skills and maintained registry reviewed; Supabase
  and applicable security/fix skills applied. No Daybreak approval assumed
  necessary for standard defensive review.
- Production:[verifymzansi.com](https://verifymzansi.com),
  [public media](https://media.verifymzansi.com). Supabase tnygdgormnofpgjknlhr,
  org xqjjkkquknffgertgtxd, region ap-south-1. Cloudflare
  app/rate-limiter/retention Workers and verifymzansi-public/private R2 buckets.
  R2 location hint WEUR/default jurisdiction is not a residency guarantee. These
  cross-border processing locations require an independent privacy/legal
  assessment; none is supplied here.
- Active app Worker03b48e23-1dd1-411f-a630-a75d6076a948 deployed9 October11:18
  UTC. GitHub deploy run37922352475 records that exact Worker version and
  baseline commit. CI37918370688 actually ran relevant tests. These provenance
  observations attest the inspected version at that time, not a future rollout.
- Staging Worker404; Supabase development branches absent; user confirms no
  staging. Checked-in staging shares live DB, R2 and limiter resources and uses
  development markers. Existing local Docker also targets live resources.
  Neither is safe for intrusive synthetic tests.
- Remediation worktree:the isolated remediation checkout, branch
  codex/prelaunch-security-fixes. Original user Docker/README changes and
  untracked NUL preserved. App source changed only in isolated worktree;
  synthetic temporary runners use dedicated resources. Baseline pre-remediation
  assessment and session addendum preserved separately before their fixes.

## Methods and limits

Combined implementation/caller/error-path review, dependency and secret scans,
connected database/grant/cron/cloud/CI metadata inspection, bounded anonymous
HTTP/TLS checks, synthetic unit/PGlite tests, native ephemeral
PostgreSQL/PostgREST fixtures and isolated browser journeys. Scan cleanliness is
not proof of control effectiveness.

The Codex Security deep-scan tool failed before starting: **Unsupported
untracked file type: NUL**. There is no completed deep scan or scan ID.
Available direct checks continued; these are supplemental standalone assessment
artifacts. Original secret scan reported two unclassified64-hex matches in NUL
and three nonregular Next cache scan errors. Exact blind comparison with current
configured credentials found no match, which does not establish that they are
harmless or exclude old secrets. Isolated source strict scan passed. Git
history/binaries and all ignored deployment artifacts remain incompletely
scanned. No values were printed or deleted.

Supabase Management Auth/backup API returnedHTTP 401; catalog MCP remained
accessible. Browser fallback reached sign-in, so protected UI was inaccessible
without a session; no terms were accepted. Full cloud-account IAM/MFA, Ozow
portal, current recoverable backup inventory and alert destinations were not
obtained. Native Canvas SDK/managed workspace/renderer were unavailable;
Markdown/JSON artifacts are the reviewable deliverables.

Production checks used bounded GET/configuration reads and TLS negotiation only.
No unrelated users' records/documents/log entries were read, no production
signup/payment/callback mutations, no load attacks, no live credential rotation,
deployment, migration, subscription change or production data modification.
Intrusive hosted tests are deferred until isolation exists.

## Sensitive data and trust boundaries

Browser account/password/OAuth/OTP inputs pass through Cloudflare Worker APIs to
Supabase Auth and database. Names, phone, location, identity workflow metadata,
organisation roles/memberships, possible extracted CIPC evidence and
payment/provider risk fields are personal or sensitive; not every database field
is separately encrypted. Service-role credentials bypass RLS, making server
authorization and key scope critical.

Identity documents/selfies pass bounded validation and metadata stripping, then
application AES256-GCM encryption to private R2; identity numbers use separate
encrypted fields and keyed duplicate hashes. Current KYC is manual/stub, not
government/vendor identity attestation. Staff decryption crosses a privileged
boundary; access must be case-bound, recent-MFA authorized, limited and audited
before retrieval. Public media is a separate bucket. Reviewer/administrator
service routes and narrowly scoped browser policies are different access paths
and both need validation.

Third parties:Cloudflare hosts requests/objects/logs; Supabase processes
Auth/database; Ozow receives hosted payment/ref/merchant data and sends signed
status callbacks; Resend email and Africa’sTalking SMS receive contact/delivery
data; GoogleOAuth receives authentication traffic; HIBP receives padded SHA1
prefixes, not plaintext passwords; Sentry may receive diagnostics/replay
depending on configuration. Browser model/static assets contact Google/Unsplash
endpoints; no evidence was found that face images are sent there. Obtain
provider agreements/retention/IAM evidence independently; no inferred privacy
compliance.

Evidence encryption keys, Auth/service-role credentials, webhook secrets and
telemetry credentials use production secret bindings. Secret presence/type
proves neither entropy nor appropriate custody/scope/rotation/recovery. Account
deletion and cleanup queues are examined source paths; actual hosted deletion
across objects, logs, backups and restored copies remains unverified.

## Findings ordered by urgency

Each location below is repository-relative under the baseline/isolated worktree;
a fixed file’s baseline behavior is available in the branch diff. Confirmed
source evidence does not imply a successful production exploit.

### VM-01 — High: Staff MFA exceptions can bypass privileged authentication

**Status:** Confirmed in baseline source; conditional live exposure. **Impact:**
A staff password/session can authorize sensitive reads and decisions without a
second factor when the flag is off or enrollment grace applies. Future AMR
timestamps also passed recent-factor checks.

**Affected:** [src/lib/auth/staff-mfa.ts](../../../src/lib/auth/staff-mfa.ts),
[src/lib/auth/staff-mfa-guard.ts](../../../src/lib/auth/staff-mfa-guard.ts),
[src/lib/auth/require-staff.ts](../../../src/lib/auth/require-staff.ts),
`public.current_staff_role()`.

**Evidence:** Baseline accepts not_enforced and seven-day unenrolled grace.
Deployed helper contains equivalent exceptions. Live staff_mfa_enforced is
currently on: this is not evidence of a present flag-off bypass or compromise.
**Prerequisites:** A valid staff account/session plus an allowed exception;
future signed AMR claims require provider/operator influence and were not
attacker-minted. **Existing protections:** Database-backed current staff roles,
account status and MFA when enforced already exist.

**Fix:** Local guards require verified recent MFA without production exceptions,
including development processes targeting the known live database; reviewed
database migration requires AAL2. Enrollment remains reachable with an active
session. **Verification:** Locally exercise AAL1/off/grace/future/stale denial
and valid AAL2/fresh success. Before rollout prove enrollment/recovery and both
API/PostgREST behavior in isolated staging.

**ASVS 5.0.0:** 6.3.3, 6.3.4, 6.8.4, 7.5.3 (stronger L3). **Disposition:**
Implemented locally; database migration and deployment not applied.

### VM-02 — High: Privileged access does not bind signed JWTs to a live session

**Status:** Confirmed baseline authorization gap; hosted replay unverified.
**Impact:** A still-valid staff JWT can retain privileged database authority
after its session is removed, until token expiry.

**Affected:** `public.current_staff_role()`,
[src/lib/auth/require-staff.ts](../../../src/lib/auth/require-staff.ts),
[src/lib/auth/staff-mfa-guard.ts](../../../src/lib/auth/staff-mfa-guard.ts),
[supabase/migrations/20261009205230_require_staff_mfa_without_exceptions.sql](../../../supabase/migrations/20261009205230_require_staff_mfa_without_exceptions.sql).

**Evidence:** Baseline role helper checks AAL/role but not auth.sessions. Local
database and guard tests reproduce/deny missing, cross-user and expired
sessions. Supabase documents JWT persistence after logout. **Prerequisites:**
Possession of a valid signed staff token, current staff role and sufficient MFA;
its original session has been revoked/expired. **Existing protections:** JWT
verification, current database role/account status and AAL requirements still
limit access.

**Fix:** Service-only staff_session_is_active checks verified sub/session_id,
ownership and not_after; app errors fail closed. Database current_staff_role
requires matching active session. Synthetic tokens now remain invalid after
logout/re-login. **Verification:** Local deleted/expired/cross-user session and
fixture replay tests. Stage real logout, admin revocation, factor changes and
direct PostgREST; separately test ordinary-user JWT/RLS revocation.

**ASVS 5.0.0:** 7.4.1, 7.4.2, 8.3.1. **Disposition:** Staff-specific
implementation local only. General owner-session revocation is unverified and
not claimed fixed.

### VM-03 — High: Evidence streaming proceeds after failed or missing case authorization

**Status:** Confirmed baseline source defect; targeted local regression tests.
**Impact:** A staff caller knowing an artifact ID can decrypt evidence outside a
successfully resolved active, linked case. Historical fallback broadens the set
of accessible documents.

**Affected:**
[src/app/api/admin/verification/evidence/route.ts](../../../src/app/api/admin/verification/evidence/route.ts)
GET/POST,
[src/app/api/admin/verification/evidence/metadata/route.ts](../../../src/app/api/admin/verification/evidence/metadata/route.ts),
[src/lib/services/kyc-evidence-access.ts](../../../src/lib/services/kyc-evidence-access.ts),
[src/app/api/admin/verification/_lib/evidence-route-auth.ts](../../../src/app/api/admin/verification/_lib/evidence-route-auth.ts).

**Evidence:** Baseline streaming warns on inactive/unlinked/error cases then
continues. Metadata falls back to recent artifacts, and helper includes
historical IDs. No real document was retrieved. **Prerequisites:** An
authenticated authorized staff role and known artifact ID; not an anonymous or
ordinary-user bypass. **Existing protections:** Existing staff role checks,
private encrypted storage, access audit before decryption and no-store
responses. All staff case access is intentional policy, not a newly invented
role defect.

**Fix:** Require active case and committed current links; fail closed on
lookup/audit/limiter errors; reject expired or malformed deadlines; require
fresh MFA and shared evidence limits (20/minute, 200/hour). Session publication
failure now returns 503 and preserves earlier evidence until new publication
succeeds. **Verification:** Positive current-linked evidence and upload
workflows, negative closed/unlinked/expired/unauthorized/outage
GET/POST/metadata tests. Stage legacy-link repair, legal-hold retrieval and
concurrent upload/reviewer/cleanup behavior.

**ASVS 5.0.0:** 8.2.2, 8.3.1, 14.2.4, 7.5.3 (stronger L3). **Disposition:**
Implemented locally. Historical access needs a deliberate authorized recovery
process.

### VM-04 — High: No isolated hosted test environment; local development accesses production data

**Status:** Confirmed configuration and user confirmation. **Impact:** Ordinary
development or intrusive security fixtures can alter live identity/payment data
or use weaker development controls. Broad local credential/container exposure
increases the impact.

**Affected:** [wrangler.toml](../../../wrangler.toml) staging bindings,
[docker-compose.yml](../../../docker-compose.yml),
[Dockerfile](../../../Dockerfile), `running verifymzansi-app-1`,
[src/lib/utils/local-dev.ts](../../../src/lib/utils/local-dev.ts).

**Evidence:** Staging Worker returns 404, Supabase has no development branches,
and user has no staging. Staging config shares production DB/R2/limiter.
Read-only Docker inspection shows development mode, live Supabase/buckets,
service/encryption credential presence, root user, full source bind and port3000
published on all interfaces. No bypass flags currently enabled.
**Prerequisites:** Developer/test tool or someone reaching that dev server;
exploitation of its privileges was not attempted. **Existing protections:**
Production Worker has production markers and no test bypass bindings; local test
runners use separate synthetic ephemeral resources.

**Fix:** Local security-environment guard preserves strict staff controls and
disables local fallback for the known live backend. Provision separate Supabase,
buckets, limiter/KV/DO and merchant test credentials; scope dev credentials and
bind loopback. Existing Docker/user files were preserved. **Verification:**
Final production-data environment unit tests pass. Externally verify resource
IDs and network/credential scope before enabling hosted authenticated tests.

**ASVS 5.0.0:** 13.2.2, 14.2.4, 15.2.5. **Disposition:** Partial local guard
fixed; configuration isolation remains a launch gate. Existing container was not
modified/stopped.

### VM-05 — High: Linked incomplete KYC has no finite inactivity deadline

**Status:** Confirmed live function and source. **Impact:** Pending or partially
approved identity documents can remain indefinitely, increasing breach exposure
and frustrating predictable deletion.

**Affected:** `public.run_kyc_retention()`,
[supabase/migrations/20260929150000_launch_access_hardening.sql](../../../supabase/migrations/20260929150000_launch_access_hardening.sql),
[src/lib/services/verification-decision.ts](../../../src/lib/services/verification-decision.ts),
[supabase/migrations/20261009225604_expire_inactive_incomplete_kyc.sql](../../../supabase/migrations/20261009225604_expire_inactive_incomplete_kyc.sql).

**Evidence:** Live function deletes unlinked pending uploads after 90 days,
rejected after 30 days and approved evidence after purge_after. Linked
incomplete submissions are excluded; partial approval lacks the
full-verification purge schedule. **Prerequisites:** A linked incomplete account
with old evidence and no full-verification deadline. **Existing protections:**
Legal holds, approved purge schedule, cleanup queue and worker exist; cron
execution was successful, which does not prove byte deletion.

**Fix:** User approved90 days inactivity. Review-only migration integrates
expiry into existing daily function, denies evidence immediately, clears links
and submitted identity fields, requires resubmission and queues R2 removal.
Preserves verified accounts, profile/decision holds, recent submissions/reviews,
active claims and unexpired proposals; retains audit/hash metadata.
**Verification:** Native synthetic fixture checks pending/partial expiry, nine
case variants, protected cases, grants, field clearing, queue uniqueness and
idempotency via daily function. Hosted concurrent decision/upload, cleanup
completion, metadata lifetime and backup tombstones require external validation.

**ASVS 5.0.0:** 14.1.2, 14.2.4, 14.2.7 (stronger L3). **Disposition:**
Migration/test implementation prepared; never applied to production. Object and
backup deletion unverified.

### VM-06 — High readiness gap: Current recoverable backup and restoration evidence unavailable

**Status:** Unverified readiness control, not proof that backups are absent.
**Impact:** Database/Auth/R2/key loss or a bad migration may be unrecoverable;
restored backups may resurrect deleted personal information.

**Affected:** [scripts/backup-supabase.ts](../../../scripts/backup-supabase.ts),
[docs/encryption-recovery.md](../../../docs/encryption-recovery.md),
`Supabase backup inventory`, `R2/key recovery and retention journals`.

**Evidence:** Management backup API returned HTTP 401. No current consistent
backup/restore inventory or drill obtained. Repository REST export explicitly is
supplemental, not transaction-consistent/restorable schema/Auth/R2 backup.
**Prerequisites:** Incident, deletion, failed migration or provider failure
requiring restoration. **Existing protections:** Recovery documentation,
encryption and cleanup journals exist; current recovery effectiveness not
demonstrated.

**Fix:** Operator must identify consistent DB/Auth backups, independently
recover R2 and versioned keys, define RPO/RTO and isolated
restoration/deletion-tombstone procedure. **Verification:** Restore authorized
synthetic backups into isolation; prove account Auth, documents, key decryption,
payment reconciliation and reapplication of deletions. Record backup
ID/time/access and measured recovery.

**ASVS 5.0.0:** 11.1.1, 14.1.2, 14.2.4. **Disposition:** External verification
required before production migration or launch.

### VM-07 — High potential / pending provider attestation: Hosted PostgreSQL security patch status unresolved

**Status:** Suspected, not confirmed exploitable vulnerability. **Impact:**
Unpatched database-engine defects can affect confidentiality, integrity or
availability depending on access and installed features.

**Affected:** `Supabase project tnygdgormnofpgjknlhr PostgreSQL 17.6.1.063`.

**Evidence:** Connected provider reports17.6.1.063; current upstream17 security
page includes fixes through 17.11. Supabase backports and reachable exploit
conditions were not verified. **Prerequisites:** Applicable unpatched flaw and a
reachable exploit path; neither is established from version alone. **Existing
protections:** Managed service, browser roles without superuser/BYPASSRLS and
selected RPC grants restrict access. Version suffix may include provider
backports.

**Fix:** Obtain provider patch/backport attestation or prepare a supported
upgrade after verified backups, extension checks and isolated tests.
**Verification:** Provider CVE mapping/attestation and controlled post-upgrade
verification. No engine exploit tests on production.

**ASVS 5.0.0:** 15.2.1. **Disposition:** External attestation required; no
upgrade authorized/performed.

### VM-08 — Medium: Upload scanner is a custom heuristic rather than full antivirus

**Status:** Confirmed source capability gap. **Impact:** Malformed or malicious
identity documents may evade pattern checks and reach staff/browser/parser
workflows.

**Affected:**
[src/lib/utils/malware-scan.ts](../../../src/lib/utils/malware-scan.ts),
[src/lib/utils/file-validation.ts](../../../src/lib/utils/file-validation.ts),
[src/app/api/verification/upload/route.ts](../../../src/app/api/verification/upload/route.ts).

**Evidence:** Header/byte/PDF active-name and Flate object-stream inspection
found; no full AV/CDR engine or quarantine service found. **Prerequisites:**
Authenticated upload of a file escaping bounded custom checks; no malicious
production file submitted. **Existing protections:**
Size/extension/magic/dimension limits, metadata removal, private AES-GCM
storage, restrictive rendering/no-store and active-PDF checks.

**Fix:** Design a real isolated AV/CDR/quarantine stage with privacy-reviewed
processor/retention and fail-closed verdicts before reviewer access.
**Verification:** Bounded harmless AV fixtures and malformed/polyglot tests in
staging, scanner outage/timeouts, clean-file positive flows and worker parser
isolation.

**ASVS 5.0.0:** 5.4.3, 5.2.2, 5.4.2. **Disposition:** Infrastructure/processor
decision remains; no new vendor introduced.

### VM-09 — Medium: Production invocation logs do not redact authentication query strings

**Status:** Confirmed logging configuration; actual disclosure untested.
**Impact:** Logged callback URLs can retain temporary authorization codes/token
hashes, broadening credential access and privacy risk.

**Affected:** [wrangler.toml](../../../wrangler.toml) observability,
`active Cloudflare Worker observability.redact_query_string=false`,
[src/app/(auth)/auth/callback/route.ts](<../../../src/app/(auth)/auth/callback/route.ts>).

**Evidence:** Live logging persist enabled with query redaction false; callback
accepts code/token_hash URL parameters. Personal/auth log entries were not read.
**Prerequisites:** Authentication callback invocation captured by logging plus
access to logs; token validity/reuse depends on provider. **Existing
protections:** Application redaction and short-lived/single-use callback tokens
reduce some exposure; neither proves provider log scrubbing.

**Fix:** Branch prepares redact_query_string=true at top-level and production.
Separately review Sentry/errors/replay, filenames, provider bodies and log
access/retention. **Verification:** In staging submit synthetic marker callback
and inspect authorized logs for absence of query/token/body identifiers, then
verify live config read-only after approved change.

**ASVS 5.0.0:** 14.2.1, 16.2.5. **Disposition:** Prepared only; no logging
configuration deployed.

### VM-10 — Medium: Public media accepts TLS1.0 and TLS1.1

**Status:** Confirmed low-impact live negotiation. **Impact:** Public media
transport permits obsolete protocol protection. This does not demonstrate
private KYC exposure.

**Affected:** `media.verifymzansi.com R2 custom domain minimum TLS1.0`,
`media-staging.verifymzansi.com attached to public bucket`.

**Evidence:** Certificate-validated TLS1.0 and1.1 handshakes succeeded on public
media; main site rejects both and supports1.2. Staging media minimum reported in
configuration, not separately handshake-tested. **Prerequisites:**
Client/attacker conditions allowing obsolete TLS negotiation. **Existing
protections:** HTTPS, current main-site TLS policy, public-content-only bucket.
Private bucket managed endpoint disabled and no custom domains.

**Fix:** Review raise media minimum to1.2 and isolate staging media
bucket/domain. **Verification:** Repeat bounded handshake tests:1.0/1.1
rejected,1.2/1.3 legitimate delivery succeeds.

**ASVS 5.0.0:** 12.1.1. **Disposition:** Cloud configuration review only.

### VM-11 — Medium: Provider-wide breached-password protection unresolved

**Status:** Confirmed native setting disabled; bypass exposure unverified.
**Impact:** Direct provider signup/reset/update paths could accept known
compromised passwords if application HIBP controls are bypassed.

**Affected:** `Supabase Auth leaked-password setting`,
[src/lib/security/pwned-passwords.ts](../../../src/lib/security/pwned-passwords.ts),
[src/app/api/auth](../../../src/app/api/auth).

**Evidence:** Connected advisor reports native leaked-password protection
disabled. Application registration/reset/change pathways perform fail-closed
HIBP prefix lookup. Management Auth settings/hook API401 prevents full
alternate-path verification. **Prerequisites:** An accessible alternate provider
pathway without equivalent checks; not confirmed by testing. **Existing
protections:** Application HIBP checks, password8–128 length and
recovery/current-password proofs.

**Fix:** Verify all provider paths/hooks and enforce an equivalent
breached-password check globally. Supabase documents plan-dependent
availability; no plan/subscription assumption or change. **Verification:** Test
documented synthetic breached/clean passwords against every allowed
signup/recovery/update path in isolated provider staging and prove consistent
denial.

**ASVS 5.0.0:** 6.2.12, 6.3.4. **Disposition:** Provider access and
architectural decision needed.

### VM-12 — Medium: Release protections and monitoring report green without required execution

**Status:** Confirmed connected GitHub configuration/run evidence. **Impact:**
Sensitive changes may merge without review/check enforcement, and missed
outages/security signals may go unnoticed.

**Affected:** `GitHub Protect main ruleset`,
`.github/workflows/synthetic-monitoring.yml`, `CodeQL workflow / Analyze step`,
`production environment protection`.

**Evidence:** Active main rules only deletion/nonfastforward; no required
checks/review and no deployment environments returned. CodeQL Analyze skipped,
coverage-unavailable job succeeded. Scheduled production-smoke/worker-health
meaningful steps skipped due missingPRODUCTION_APP_URL. GitHub MFA field null is
unknown, not off. **Prerequisites:** An authorized writer/deployer or an actual
outage; credential compromise not tested. **Existing protections:** Relevant CI
and deployment jobs do execute, and source-level tests exist. App alert/audit
hooks exist.

**Fix:** Review require actual security/build tests and independent review;
configure protected release/IAM and supported CodeQL. Replace/authorize
production POST probes before enabling smoke, use bounded read-only uptime and
verify alerts. **Verification:** Demonstrate blocked bad merge/release in test
branch, actual CodeQL analysis receipt, executed monitor steps, synthetic alert
delivery and named responder acknowledgement.

**ASVS 5.0.0:** 15.1.1, 15.2.1, 16.1.1, 16.3.1. **Disposition:** External
configuration/rehearsal required; no settings or workflow deployment changed.

### VM-13 — Low: Password composition rules conflict with current ASVS

**Status:** Confirmed source; local correction tested. **Impact:** Unnecessary
uppercase/lowercase/digit rules discourage usable passphrases without replacing
breach detection.

**Affected:**
[src/lib/validations/shared.ts](../../../src/lib/validations/shared.ts),
[src/components/auth/password-requirements.tsx](../../../src/components/auth/password-requirements.tsx),
[src/app/dashboard/profile/page.tsx](../../../src/app/dashboard/profile/page.tsx).

**Evidence:** Baseline requires character classes; ASVS6.2.5 prohibits these
composition rules. **Prerequisites:** Normal password registration/change; not
an account compromise proof. **Existing protections:** 8–128 length and
application breached-password checks remain.

**Fix:** Remove class restrictions and align both password UIs while retaining
length, HIBP and recovery checks. **Verification:** Accept long passphrases
without artificial classes; retain too-short/too-long/breached password
rejection and normal reset/change flow tests.

**ASVS 5.0.0:** 6.2.5, 6.2.12. **Disposition:** Implemented and tested locally;
provider policy still unverified.

## Verified protections and local remediation

Live metadata shows all88public tables have RLS enabled; browser roles are not
superuser/BYPASSRLS and lack public-schema CREATE. Selected sensitive tables
lack browser SELECT and payment/KYC/staff/override RPCs have service-only
effective grants. Seven public SECURITY DEFINER helpers were evaluated as
self-scoped/bounded with pinned search paths; advisory warnings are not
automatically seven vulnerabilities. Full policy matrices remain untested.

Live private R2 has no managed public endpoint or custom domains. App Worker
secrets use secret_text and production markers, without test bypass bindings.
Anonymous evidence/metadata/business-file/payment-status GETs reject. Public
synthetic KYC media path is not served, test/mock GETs404; root sends nonce CSP,
HSTS, nosniff, DENY and no-store. CSP base-uri self remains weaker than strict
ASVS none and is not a full CSP compliance pass. Zone
HTTPS/TLS1.3/DNSSEC/managed-WAF metadata inspected, not exhaustive penetration
proof.

Payments already validate callback signature, site/currency/exact expected
amount/environment/reference and use atomic confirmation/idempotency and
reconciliation controls. Local payment audit covers forged/repeated callbacks
and fulfillment behavior; real merchant secret provenance/delivery and all
cancellation/fulfillment races require provider staging. No live payment was
created.

Nine retention cron jobs each recorded seven successes and zero failures in the
checked last seven days; DB daily retention runs02:00 UTC and R2 cleanup03:00
UTC. This proves scheduling/execution receipts, not final document deletion,
restore readiness or alert delivery. Existing approved/rejected/unlinked
policies and profile holds were considered when designing the proposed90-day
linked-incomplete policy.

Local fixes address VM-01/02/03/13 and the development/live-data control escape
in VM-04. VM-05 is a review-only retention migration, and VM-09 a prepared
Worker configuration change. New shared worker secret comparison and synthetic
token decoder preserve existing behavior while avoiding duplication; regression
tests cover them. Independent read-only prepatch investigation and fresh patch
review required by the fix skill were completed. Reviewer-identified
upload-publication and deterministic synthetic-session replay regressions were
corrected. This is not an independent professional sign-off.

## Validation results and coverage limits

Final receipts are in validation-results.json and the closing validation
section. Earlier completed evidence: payment audit49 files/644 tests; KYC
audit65 files/653 tests; isolated browser69 passed,15 skipped,0unexpected/flaky,
including all three required KYC journeys on desktopChromium/mobileChrome (six
positive scenarios), checkout and route/bundle budgets. WebKit/mobileSafari
quarantine and other skipped scenarios remain gaps. Browser
Auth/database/storage are simulated while HTTP/application routes are real;
these are not hosted RLS/provider tests.

Full unit reruns initially revealed two obsolete limiter mocks, repaired and
positively retested. A subsequent5320-test run had5319passes and one startup
import timeout during simultaneous coverage; focused safety/staff/environment
retest57 passed without contention. Completed coverage run5242 tests passed with
statements77.65%, branches68.03%, functions84.44%, lines79.47%, above configured
thresholds; later source additions require final receipts rather than treating
this as exact final-state coverage.

Static source checks include format/lint/types/import
boundaries/deadcode/contracts/db-static/security canaries/strict secrets;
duplication now passes without baseline weakening. Dependency audit WARN retains
GHSA-vfj7-8cjw-p6xm with exact installed braces3.0.3 backport/source/provenance
hash verification; do not call the unmodified version clean or blindly suppress
the warning. No dependency upgrade was forced without evidence.

Native local PostgreSQL applies complete migration history and checks selected
PostgREST RLS, service-only sensitive RPC grants, concurrent KYC
callback/reconciliation claims, and independent override proposal/approval
races. Staff PGlite tests exercise current
role/session/AAL/grants/deletion/absolute-expiry semantics. New retention
fixtures invoke the actual daily function, not merely a helper. These scopes do
not cover every policy/function or ordinary-user revocation.

Required user test goals: cross-user/organisation and ordinary-user-to-staff
negatives are locally covered in representative fixtures; hosted full
route/field matrix is deferred. Anonymous production document retrieval is
rejected at tested paths. Forged/repeated callbacks are tested locally; genuine
provider delivery remains unverified. Expired evidence and revoked/expired staff
sessions are locally rejected; owner-token hosted revocation remains unverified.
Never treat fixture tokens, forged SQL claims or simulated storage as real
provider proof.

## ASVS coverage summary

253 cumulative L1+L2 requirements:3 FAIL,120 PARTIAL,123 NOT_TESTED,7
NOT_APPLICABLE (WebRTC service features absent),0 globallyPASSED. PARTIAL means
evidence exists for a listed scope; it is not a pass. Known FAIL entries:5.4.3
full antivirus absent;12.1.1 obsolete media TLS;16.2.5 query logging
configuration. Remaining confirmed findings sit within partial controls because
whole-requirement/provider scope is not fully examined; counts are a coverage
inventory, not a count of all defects. JSON preserves exact official requirement
text, source and per-control limits.

Stronger selected controls:7.5.3 recent second factor for evidence/exports/role
or high-risk decisions;4.1.5 signed callbacks plus atomic/replay-safe
processing;14.2.7 verified retention/deletion including restore
implications;14.2.8 removal of document/image metadata;16.3.2 sensitive access
audit before decryption. Key recovery, privileged cloud IAM, independent
override approval and isolation deserve stricter review because compromise
exposes irreplaceable identity information or payment benefits. This does not
assert complete Level3 coverage.

## Launch gates, deployment review and residual risk

1. Review local patch and both migrations. Verify privileged
   enrollment/recovery, active-session RPC and grant compatibility. Apply to
   genuinely isolated staging only after separate resources exist; require
   current positive reviewer and user workflows, negative role/owner/org tests
   and Cloudflare runtime-binding integration.
2. Obtain consistent recoverable DB/Auth backups and separate R2/versioned-key
   recovery. Run an isolated restoration/deletion-tombstone rehearsal and record
   RPO/RTO before production migration. REST export alone is insufficient.
3. Close hosted access-control, revoked-owner-token, provider
   Auth/leaked-password, genuine Ozow signature/delivery, cloud-account MFA/IAM
   and key least-privilege gaps. Independently evaluate ordinary consumer
   authentication strength/rationale under6.3.3.
4. Resolve real AV/quarantine and public media TLS, logging privacy, effective
   release reviews/checks, executed monitors/alerts and provider database patch
   attestation. Verify retention cleanup and policy-specific metadata/backup
   lifetimes;90-day evidence expiry is not deletion of every identity-derived
   field or backup copy.
5. Obtain explicit approval for concrete production
   configuration/migrations/deployment only after review. Proposed
   order:backups/isolation/enrollment, reviewed DB functions, limiter policies,
   app, privacy/TLS/monitor configuration, read-only post-release verification.
   Changed function attestations must be reviewed/re-hashed rather than reuse
   old source hashes. Preserve previous Worker version and prefer reviewed
   forward DB correction; never blindly restore a database over later payments.

No production changes are applied. Full plan is in
hardening/production-review-plan.md. User's90-day policy answer authorizes the
proposal, not a production migration. Missing access does not turn these gates
into passes.

## Maintenance and incident readiness plan

Assign named owners before launch:application/security engineer, database/cloud
operator, KYC/privacy owner, payment operations and incident commander. Proposed
patch SLA:known exploitable/critical issues assessed same day and
fixed/contained within 48 hours; high within 7 days, medium14 days, low30 days,
with documented exceptions and retest evidence. Run dependency/advisory and
strict source/artifact-secret checks on each merge and weekly; verify
provider-managed patch/backport state monthly. Revisit signed-credential scope
and staff membership/MFA quarterly and immediately on departure.

Require actual enforced CI jobs on every change, with security canaries and
meaningful route/RLS/payment/upload regression tests. Repeat scoped threat/ASVS
review after Auth/role/storage/payment/deletion/framework changes and
independent review before launch and at least annually. Retest archived/retired
paths and direct provider APIs, not just visible UI.

Daily bounded read-only uptime and worker health, backup freshness, cleanup
queue age/failure, signature failures, repeat callbacks, staff-MFA/session
denials, privileged role/evidence access and key-decrypt failures need
actionable thresholds and alert destinations. Weekly review anomaly/audit events
with least-privilege access and scrubbed logs; monthly test synthetic alert
delivery and skipped-job detection. Document privacy-compatible log retention
and access, not indefinite diagnostics.

Take provider-consistent database/Auth backups per agreed RPO, include separate
private/public objects and protected versioned encryption keys with access
segregation. Weekly sample restore/decrypt checks and quarterly full isolated
restoration/reconciliation/deletion-tombstone drills should measure RPO/RTO.
Maintain hold/delete journals so restored data cannot silently reappear. Confirm
backup deletion schedules and provider guarantees externally.

Incident runbook must cover stolen staff/service credentials, KYC disclosure,
malicious uploads, forged/duplicate payments and unrecoverable data. Name
responder/escalation contacts, preserve scrubbed immutable evidence, revoke
affected sessions and contain routes, reconcile payment effects, and document
communication/legal decision ownership. Rehearse a tabletop before launch and
semiannually. Live credential rotation, production containment/mutations and
notifications require designated operator authorization; none were undertaken by
this review.

## Independent professional review brief

Use hardening/independent-security-review-brief.md as the concrete
scope:baseline commit and remediation branch, exact hosted resource IDs,
read-only production rules, isolated synthetic user/org/reviewer/governance
accounts, requested provider/IAM/backup/merchant access and priority
attack/recovery tests. The independent reviewer should retest all13findings,
build the complete endpoint/function/field matrix, verify real revocation and
MFA, native Worker bindings, payment callback provenance/races, upload
quarantine, concurrent retention/holds/cleanup and actual recovery/alerts.
Deliver evidence-backed status/ASVS mapping and explicit release blockers; no
legal-compliance or blanket-security claims.

Primary
references:[Supabase session revocation](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out),
[password security](https://supabase.com/docs/guides/auth/password-security),
[Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[PostgreSQL 17 security](https://www.postgresql.org/support/security/17/),
[version support](https://www.postgresql.org/support/versioning/). Provider
backports and hosted behavior are explicitly distinguished from general
documentation.

Requirement text attribution:OWASP ASVS contributors, version5.0.0,
[CC BY-SA4.0](https://github.com/OWASP/ASVS/blob/v5.0.0/LICENSE.md). The
coverage selection and evidence/status annotations are adaptations; OWASP has
not endorsed this assessment.

## Final local validation and immutable patch

Commit **880758e3cbb9db81e751dc2ef28773c580907236** on
**codex/prelaunch-security-fixes**, baseline
**da5787db24fe9ad36c5968d04c7519ae6b7b3079**; isolated worktree clean after
commit. Exact patch saved as hardening/prelaunch-fixes.patch, SHA256 (base64url)
**Rj-JVovv3kVR3oIqPyZZIo4IcnEWMuwuGHzs1BS5ikw**. No push or deployment.

- Complete direct unit lane: **579 files, 5323/5323 tests passed**, zero
  failures/skips.
- Final coverage-core lane: **574 files, 5245/5245 tests passed**, thresholds
  met. Statements77.65%, branches68.04%, functions84.44%, lines79.47%. Coverage
  excludes specified UI/runtime/generated/fixture scopes; it is not ASVS
  coverage.
- Final native isolated PostgreSQL/PostgREST lane: **PASS**, all migrations
  applied locally; selected RLS/grants/concurrent
  callback/reconciliation/override tests and new daily-function retention
  protections/idempotency passed; disposable stack stopped.
- Final static checks passed in their recorded partitions; dependency audit
  remains **WARN** with verified backport. Wrapped full unit command timed out
  and remains **INCOMPLETE** despite successful direct rerun.

Earlier browser receipt:69passed/15skipped at checkout-Z8M9pN. It precedes final
helper/environment/retention additions; do not claim exact final-commit browser
or native Cloudflare acceptance. Independent reviewer must stage final compiled
Worker and legitimate user/reviewer/payment flows. Final unit/coverage now
supersede earlier counts for source tests, while historical failure/timeout
receipts remain available.
