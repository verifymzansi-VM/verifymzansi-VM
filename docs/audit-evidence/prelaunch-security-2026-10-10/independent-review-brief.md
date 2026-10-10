# Independent VerifyMzansi security review brief

## Objective and acceptance

Review the platform before it collects real identity documents or takes real
payments. Use OWASP ASVS 5.0.0 cumulative Levels1+2, plus stronger controls for
evidence decryption, privileged decisions, role changes, exports, key custody
and deletion. Produce an evidence-backed scoped go/no-go decision, not a claim
of complete security or legal compliance. Start from this assessment and
revalidate findings independently.

## Targets

Repository https://github.com/verifymzansi-VM/verifymzansi-VM, baseline
da5787db24fe9ad36c5968d04c7519ae6b7b3079. Local remediation branch
codex/prelaunch-security-fixes, managed worktree the isolated remediation
checkout. Production https://verifymzansi.com, public media
https://media.verifymzansi.com. Supabase project tnygdgormnofpgjknlhr, region
ap-south-1. Cloudflare Workers verifymzansi, verifymzansi-rate-limiter and
verifymzansi-retention-cleanup, R2 verifymzansi-private/public. Staging Worker
was absent and the checked-in staging configuration shares production resources;
require isolated staging first.

## Access to arrange securely

Read-only source/CI/artifact and ruleset/environment access; Supabase
Auth/session/API/storage/network settings and provider patch/backup inventory;
Cloudflare Worker version/binding/IAM/log/redaction/R2 domain/lifecycle
settings; Ozow merchant/webhook configuration and test-mode delivery records;
notification/alert configuration and responder runbooks. Supply credentials
through an approved vault or platform access, not chat/report text. Use
synthetic ordinary users A/B, organisation admins A/B, moderator, independent
governance controllers and administrator in isolated staging. Do not use real
users' accounts, documents or payment records.

## Priority work

1. Retest production-MFA exception removal, current database role checks,
   invalid/stale/future AMR, lost-factor recovery and privileged cloud-account
   MFA. Check the proposed service-only live-session RPC and current_staff_role
   against both Auth API and direct PostgREST; test logout, revocation, session
   not_after and deleted/suspended accounts. Explicitly assess ordinary-owner
   JWT access after sign-out, which is not covered by the staff-only patch.
   Consumer authentication-strength exceptions need a documented risk decision.
2. Build a complete route/function/field authorisation matrix. Prove user A
   cannot read/update user B, and organisation A cannot affect B through
   REST/RPC, application routes, invitations, exports, billing and public
   projections. Inspect all SECURITY DEFINER dependencies, grants/views/search
   paths and privileged service-key scope. Static RLS-enabled metadata alone is
   insufficient.
3. Test evidence GET/POST and metadata with no session, ordinary user,
   stale/revoked staff, inactive cases, missing links, superseded/expired/held
   files, authorization/audit/limiter outages, guessed keys and signed URLs.
   Confirm genuine linked current evidence works. Examine concurrent
   upload/session publication/reviewer decisions and cleanup compensation with
   real PostgreSQL and storage. Assess legal-hold/historical recovery access
   separately.
4. Evaluate a real AV/CDR/quarantine path, malformed/polyglot files, PDF object
   streams/active content, parser resource limits and privacy metadata removal.
   Validate limits using bounded synthetic fixtures; no load attacks or
   malicious files on production.
5. In the merchant's test environment, verify full/thin signed notifications,
   timestamps, exact amount/currency/site/environment/reference matching,
   stale/repeated/forged events, cancellation races, reconciliation and lost
   committed responses. Confirm one invoice/benefit per transaction. Establish
   genuine webhook-secret provenance and delivery. Local mocks or a deployed
   secret name do not prove this.
6. Independently inspect injection/XSS/CSRF/SSRF/redirect paths and the
   Cloudflare runtime/bundle. Retest public-media TLS and CSP details. Review
   dependency/backport receipts, the hosted17.6.1.063 patch state, Git
   history/ignored binary artifacts and the original NUL file's two
   unclassified64-hex matches without exposing values.
7. Rehearse database/Auth/R2/key restoration using authorised synthetic backups,
   evaluate retention/holds/retry journals and restoration tombstones, verify
   log privacy/immutability/IAM, trigger a synthetic critical alert and run an
   incident tabletop with named responders. Inspect actual execution of
   monitoring and CodeQL jobs; current green wrappers skipped their meaningful
   steps.

## Rules of engagement

Production GET/HEAD/configuration reads only unless a specific test is
explicitly approved. No destructive tests, subscription changes, credential
rotations, real payments, customer-document uploads, unrelated-user reads or
production mutations. Separate approvals for production migrations/deployment,
cloud configuration and any actual recovery exercise. Stop a particular blocked
action and record its exact limitation, while continuing independent checks.

## Deliverables

Retested findings with severity, source/configuration, prerequisites,
counterevidence, reproducible synthetic proof, ASVS IDs and remediation/retest
instructions; complete requirement/endpoint coverage with
untested/inaccessible/deferred distinctions; environment/code-version
provenance; reviewed rollout/recovery plan; residual-risk register and concrete
release blockers. Keep credentials and personal information out of evidence.
Review selected stronger requirements7.5.3,4.1.5,14.2.7/14.2.8 and16.3.2. Do not
sign off until unresolved personal-information/privileged-access risks are
closed or explicitly resolved through a justified risk decision.

Additional scope:revalidate proposed90-day inactivity policy20261009225604,
including fresh concurrent uploads/decisions, legal holds at enqueue/execution,
incomplete partial approval, retained identity hashes/metadata and restoration
tombstones. Existing local development Docker is production-connected; exclude
it from intrusive test targets. Validate new production-data environment
selector and ensure staff controls cannot weaken through development markers.

Reviewed local patch commit:880758e3cbb9db81e751dc2ef28773c580907236,
baseline:da5787db24fe9ad36c5968d04c7519ae6b7b3079. Exact patch and final local
validation receipts are retained with the assessment. No hosted configuration or
application changes have been applied.
