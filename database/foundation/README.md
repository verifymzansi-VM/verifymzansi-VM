# Guarded clean backend candidate

Application updates to the already-provisioned London project use
`pnpm preflight:foundation --provisioned-runtime`: this checks the SQL reference
digest, live public/service API contracts, credentials and hidden schemas. It
never installs or changes the database. The default preflight still refuses an
unreleased clean assembly, and its SQL installation guard remains intact.

## Replay gate (CI job `foundation-replay`)

`pnpm db:foundation:replay` rebuilds the production schema from this folder
alone, in an embedded Postgres (PGlite) that cannot reach any hosted database:

1. `replay/platform-prelude.sql`: stand-ins for what Supabase provides (API
   roles, the Auth schema and helpers, the extensions schema);
2. `candidate.sql`, the reviewed baseline;
3. every file in `updates/` in filename order, with
   `replay/baseline-supplement.sql` applied just before
   `20261103154538_owner_signup_access.sql` (production received that hook
   outside the repository; the supplement recreates its accepted body).

It then runs `fingerprint.sql` (read-only catalogue queries: function bodies and
metadata, columns, constraints, indexes, triggers, policies, grants, row level
security, the event trigger) and compares the result with `fingerprint.json`. CI
fails on any difference, including a new update whose fingerprint was not
recorded. When a reviewed update intentionally changes the schema, run
`pnpm db:foundation:replay -- --write` and commit the new `fingerprint.json` in
the same pull request.

To compare production, the owner runs `fingerprint.sql` unchanged in the
Supabase SQL editor (it reads only the catalogue) and checks each row against
`fingerprint.json`. Function bodies, columns, constraints, indexes and triggers
matched production on 6 November 2026.

The same job then checks two generated views of that replay:

- `current/` is the readable current schema: one file per function, table and
  view, plus schemas, sequences and platform hooks.
  `pnpm db:foundation:snapshot` rewrites it; CI rewrites it and fails if
  `git diff` or untracked files show a change, so an edited function cannot
  merge without its regenerated file.
- `pnpm db:foundation:api-check` compares `api-manifest.json`,
  `runtime-api-manifest.json` and `runtime-api-types.ts` with the replayed `api`
  schema (names, arguments, defaults, return types, volatility, execute grants).
  Hand-written fields such as `updates` and `authority` are not derived.

## SQL lint (CI job `foundation-sql-lint`)

`pnpm db:foundation:lint` replays the same files into a throwaway local Postgres
17 container (the pinned Supabase image, which ships plpgsql_check), started
with no network and reached only through `docker exec`; it accepts no connection
settings. It confirms the replay matches `fingerprint.json` and `current/`,
applies `replay/lint-platform-stubs.sql` (declarations of Supabase platform
functions called through dynamic SQL), and runs plpgsql_check over every
PL/pgSQL function, checking trigger functions against each table they are
attached to. A deliberately broken canary function must be reported. Findings
are compared with `lint-baseline.json`: errors fail unless listed in
`knownErrors` with a reason, warnings fail when they exceed the recorded counts,
and fixed entries must be removed, so the baseline only shrinks
(`pnpm db:foundation:lint -- --write-baseline`).

The same job then runs `pnpm db:foundation:lifecycle-test`: a second throwaway
container replays this folder up to the post lifecycle guards update, seeds
synthetic members and posts, applies that update, seeds again before the post
expiry rules update, applies it and every later one, and checks the post
lifecycle guards, the expiry rules and their races through the production API
commands (`updates/README.md`).

The same command then runs `scripts/test-foundation-staff-rules.mjs`, which
replays every file into a third throwaway container first and only then checks
staff rules through the production API commands, as members and staff with
synthetic sessions (staff with a verified authenticator app) or as
`service_role`: every staff command needs an AAL2 claim (not anonymous, role
`authenticated`) backed by a live, unexpired AAL2 session of an unsuspended
account, a verified authenticator app (not a phone factor), a current staff role
and an authenticator code from the last 12 hours (15 minutes for capabilities
such as `role:review`); six commands browsers must never call (privacy request
intake, report intake, mail outbox, enquiries, retention) are refused to `anon`
and `authenticated` (the full grant set is compared with the manifests by
`pnpm db:foundation:api-check`); staff role changes need an independent second
staff member and nobody can propose or approve a change to their own role;
privacy requests get their deadline from the rule, one extension at most,
identity verification before completion or export, and never processing by the
requester; report warnings, content hides and appeals keep reviewers
independent; a stale mail outbox lease cannot acknowledge a delivery; and the
activation limit per period holds with free slots. These checks complement the
ones in `scripts/test-restored-post-commands.mjs`, which still runs on the older
prototype fixture with only some of the updates.

An update that backfills existing rows or is hard to undo can come with two
reviewed companions named after it, which the replay never applies:
`preflight/<update>.check.sql`, a read-only check the owner runs in the SQL
editor before applying, and `rollback/<update>.down.sql`, which restores the
previous function bodies and drops what the update added. Its behaviour test
proves apply, rollback and re-apply on the throwaway database.

## Browser test copy (CI job `e2e-foundation`)

`playwright.foundation.config.ts` runs the restored website in foundation mode
against a private, throwaway local Supabase stack (CLI project
`vm-foundation-e2e`, API `127.0.0.1:55443`, workspace `tmp/foundation-e2e`).
`node --import tsx scripts/foundation-e2e.mjs up` copies the same replay
(without the platform prelude, which the real stack provides) byte for byte into
the workspace's migrations folder, starts the stack, and proves zero tables in
public and a fingerprint equal to `fingerprint.json`. It then adds
`replay/hosted-auth-hook-grants.sql` (a grant the hosted dashboard makes when
the sign-up hook is switched on) and seeds the test people and posts from
`e2e/foundation/fixture/` through the real local Auth, the mail catcher and the
production API commands. Every entry point refuses any database address that is
not this local stack, and the copy uses the native fixture's Docker guard (see
below), so it runs only on Docker Desktop on Windows or a GitHub-hosted Linux
runner. `reset` rebuilds the copy; `down` deletes the stack, its data and the
files the copy wrote (`tmp/foundation-e2e/state.json`, the fake SMS sink,
`public/e2e-media/*` and `tmp/e2e-private-storage/*`, all git-ignored).

The website environment blanks every key named in the root `.env*` files, so
Next cannot refill real settings from them; `build` stamps `.next` with a hash
of the copy's public and foundation settings, and `serve` refuses a build
without a matching stamp or whose client bundle names a hosted project. `serve`
also starts two loopback stand-ins: a rate limiter that allows every well-formed
request (55456) and an email relay (55451). The copy points the email provider's
SDK at the relay (`RESEND_BASE_URL`, set only in the copy), so the website's own
emails, such as the email job's seller notices, land in the mail catcher; the
relay accepts only `.test` recipients and never contacts the provider. The email
job route runs with a synthetic local secret. Exposure: the pinned Supabase CLI
cannot bind ports to 127.0.0.1 only, so while the copy runs, Docker publishes
its database (55452, local default password), gateway (55443) and mail catcher
(55454) on all interfaces. Run it only on a trusted network or behind the
machine's firewall, and stop it with `down`.

In CI each Playwright project (`chromium`, `mobile-chrome`) runs in its own job
with its own copy, as `e2e-foundation (<project>)`; the job `e2e-foundation`
passes only when both did. Playwright stops a project's run after 12 minutes
(`PLAYWRIGHT_GLOBAL_TIMEOUT_MS`) and still writes its JSON report, from which
`scripts/e2e-foundation-summary.mjs` writes the job summary: failed tests with
their first error, or "timed out — no test failure recorded" when the run ran
out of time without a failure.

## Retired source schema and first administrator

The root `supabase/migrations` tree, `bootstrap:operator` and supplemental REST
export belong to the retired source schema. Their wrappers refuse foundation
targets. Do not replay that tree into the new project. Use reviewed additive
foundation migrations; keep this clean baseline guarded until acceptance. The
`Database Backup` workflow dumps the private/API/internal/auth schemas and
encrypts the backup; a public REST export cannot replace it.

The first foundation administrator must already have a confirmed active account
and a verified authenticator app. An owner SQL session can then call
`internal.bootstrap_first_administrator(email)` for the explicitly selected
operator. No browser or service API role can execute it. It refuses once any
staff role exists. Subsequent grants use the native staff governance commands.
Do not create legacy metadata roles or reset an existing user's password to
bootstrap the new project.

This separate target baseline records its function inventory in `assembly.json`
and its API commands and audiences in `api-manifest.json`. It preserves the
reviewed domain transactions while excluding six test-only functions and
synthetic category compatibility. Browser roles have no base-table access. API
execution eligibility remains distinct from business authorization.

The single CLI-created migration deliberately raises an exception. The candidate
is not a deployable migration, and this checkout must not be linked to the
retired source project. Changes to the live London project are reviewed files in
`updates/`, applied by the owner after merge and before the code that needs them
is deployed (see `updates/README.md` and `AGENTS.md`).

candidate.sql is assembled from allowlisted prototype SQL modules. assembly.json
records source and candidate hashes. Generated API types, role aliases and role
OpenAPI manifests are checked by builds and contract tests. Canonical LF source
bytes and generator-owned JSON formatting keep these hashes reproducible across
Windows and CI.

Local reproduction creates its own ignored evidence:

1. Run node scripts/prepare-foundation-native.mjs and the owned local startup.
2. Run node --import tsx scripts/test-foundation-native.mjs.
3. Supply that passing results.json path to node
   scripts/build-foundation-baseline.mjs.
4. Run node scripts/replay-foundation-baseline.mjs.
5. Run node scripts/check-foundation-api-contracts.mjs and maintained review
   gates.

The native suite also runs in CI: the `foundation-native` job
(`.github/workflows/foundation-native.yml`) prepares the fixture, starts the
local stack with the pinned Supabase CLI and runs `pnpm test:foundation:native`
on an ubuntu-latest runner, then uploads the redacted `results.json` (and the
staff-read probe record) as the `foundation-native-results` run artifact. It
runs nightly, on manual dispatch and on every pull request; when a pull request
does not touch `database/foundation/`, `docs/backend-foundation/prototypes/`,
`src/lib/`, `src/types/`, `src/app/api/`, the native scripts or the
dependencies, the job passes without starting Docker. The fixture's Docker guard
(`localDockerContext` in `scripts/lib/foundation-native-isolation.mjs`, also
used by the browser test copy through `localDockerEnvironment`) accepts only
Docker Desktop's local Linux engine pipe on Windows, or the default context on
the local socket `/var/run/docker.sock` of a GitHub-hosted runner; it refuses
TCP, SSH and other remote endpoints, other contexts, a `DOCKER_HOST` or
`DOCKER_CONTEXT` pointing elsewhere, and Linux outside GitHub-hosted CI.

What each part of `pnpm test:foundation:native` proves:

- `scripts/test-foundation-native.mjs` and its two probes build the **prototype
  baseline**: the 41 files in `docs/backend-foundation/prototypes/` that
  `candidate.sql` was assembled from, plus fixture-only drivers, with **none**
  of the files in `updates/` applied. The suite checks that every installed
  function body matches those prototypes, so its results describe the baseline
  behaviour, not the bodies production runs after the updates. On the replayed
  schema (`candidate.sql` plus every update), the CI job `foundation-sql-lint`
  tests the behaviour of four updates with
  `scripts/test-foundation-lifecycle-guards.mjs`
  (`pnpm db:foundation:lifecycle-test`): `20261109073519_post_lifecycle_guards`,
  `20261109104020_post_expiry_rules`, `20261109224337_fix_post_command_target`
  and `20261110045944_intro_trial_at_first_approval`. It tests the staff rules
  listed above with `scripts/test-foundation-staff-rules.mjs`. Other updates are
  not behaviour-tested on the replayed schema by these two scripts.
- `scripts/test-restored-post-commands.mjs` applies a fixed list of 44 of the
  update files on top of that prototype fixture inside one transaction, tests
  the restored-frontend commands (posting forms, staff moderation, identity
  review, governance, reports, privacy requests, staff roles, payments,
  partners, organisations, autosave) and rolls everything back. It does not
  apply the later updates or five earlier ones, so it is a regression net for
  those commands, not proof of the production schema. Its redacted record is
  written to `tmp/backend-reconciliation/native-post-commands.json` and uploaded
  with the other native results.

If replay changes generated types captured by the native run, repeat steps 2–4
with the refreshed inputs. The final native source hashes and clean replay must
match the same working bytes; an earlier passing record remains historical.

The empty-baseline rehearsal copies the local CLI Auth definitions, ownership,
permissions and component migration ledger, without copying accounts or
sessions. It checks SQL, role surfaces, actual SDK transport and a disposable
GoTrue process: fresh fixture accounts, required confirmation, explicit terms
consent, cookie refresh, forged-signature denial and live-session revocation.
Confirmation uses the local admin fixture; no external messages are sent. Its
path translation and local HS256 keys do not establish hosted ES256 keys,
gateway/provider or callback configuration. Separate native proof exercises the
local CLI gateway. Production performance and successful physical recovery
remain outstanding.

Versioned posting terms are stored as immutable public document snapshots in
src/lib/legal/terms-documents. The baseline seeds their version and canonical
document hash only, with no account acceptance data. Authenticated users must
explicitly accept the current version once; SQL blocks submission without that
acceptance. A new version requires a separately shipped snapshot and renewed
acceptance. Existing version files must never be rewritten after publication.
Production sets the FOUNDATION_* application bindings (`wrangler.toml`) and
serves the website from this backend.

Account profiles hold the display name, bio, avatar and an unreviewed legal-name
claim. Identity registration snapshots that claim; an accepted review locks
exactly those names, and a lock must always match an accepted identity fact.
Profile input can never set verified names, roles, badges, phone or locality.
Person names follow one generated Unicode letter/mark table
(scripts/generate-person-name-rule.mjs) shared by SQL and the app, so both
accept the same names. Account authority also requires a confirmed email. The
first administrator is granted only by the operator-only
internal.bootstrap_first_administrator, once, to a confirmed account that
already has a verified authenticator app.

Enquiries on live posts are a trusted server command: the website checks
Turnstile, rate limits and the GoTrue-verified sender, and SQL rechecks the
post, the owner's contact choice, the sender account and flood limits, and
derives whether the reply email is confirmed. Buyer details are visible only to
the post owner. Owners get notifications rendered from a closed kind list, and
an outbox event for email delivery. Realtime carries no content: the database
sends a bare "inbox changed" signal on the private topic owner:<account id>, and
only that account's live session may join it (realtime.messages policy, created
where hosted Realtime exists). Enquiries are kept 12 months and notifications 90
days, purged by a service command.

Organisations (programme partners) are created and published by staff with
organisation:manage and a recent second factor; every change needs a reason and
is recorded in an append-only event log. Administrators join only through an
emailed invitation whose token is never stored (SHA-256 hash only), must sign in
with the invited address and must hold a current verified identity. Business
owners apply with their own business profile and explicit consent; the
organisation sees a fixed minimal view (business name, category, place, whether
identity is verified, and the reviewed name only if the applicant agreed).
Public directory, pages and badges show only listed organisations and live
businesses, and a logo only with recorded written permission. Sponsored places,
programme showcases and referral commissions have separate transactional
commands; their staff screens and scheduled processing still need integration.

Retention commands preserve accepted identity verification when unchanged
evidence files are retired. Fraud holds require a recent staff second factor;
closing one identifies the exact hold so a stale retry cannot close its
replacement. Only the service role may run the bounded retention sweep.
Scheduling and physical object cleanup remain separate deployment work.

Every staff role (moderator, governor, admin) needs a verified authenticator app
(TOTP) on the account and an AAL2 session whose last authenticator code is under
12 hours old; sensitive capabilities need one under 15 minutes. A session raised
by any other factor type grants nothing. An event trigger enables row level
security on every new table in public, api, private and internal, and refuses
any change that would leave an application table without it. The native access
matrix calls every production API command as a signed-out visitor, another
account, an unverified account, an organisation administrator and each staff
role, with the owner's real identifiers and current revisions, and fails if any
of the owner's private values (legal surname, phone, email, enquiries, identity,
payment and application records) appear outside a short reviewed list, or if
anyone else changes the owner's data. Before cutover,
scripts/check-foundation-hosted-exposure.mjs probes the hosted Data API with the
publishable key: private and internal must stay unexposed, GraphQL must answer
nothing, and from cutover api must be the only exposed schema.

Detailed security reports and recovery notes are kept outside the public commit.

The request bridge in src/lib/foundation/request-api.ts uses an explicit
foundation connection and a complete request cookie adapter. It treats the
cookie session as a candidate token, verifies that exact token with GoTrue, and
returns only the typed authenticated API RPC surface. SQL remains responsible
for current session, account, MFA and command authority.

Route handlers can use createFoundationRouteContext from
src/lib/foundation/request-route.ts. Construct it once per request, enforce the
route's origin/CSRF and input checks, then await authenticate() before calling a
domain adapter. Return both success and error responses through respond() to
preserve refresh/clear cookies and private browser/CDN cache headers. No client
or context may be shared across requests. Existing routes use these bridges when
the data backend is `foundation`, as it is in production; they do not provision
Auth accounts. A bounded local transport check is available with node
--conditions=react-server --import tsx
scripts/probe-foundation-staff-adapter.mjs --request-session after preparing the
owned native fixture; it never targets hosted projects.
