# Introductory trial strategy and implementation

The proposal is a reasonable acquisition experiment for VerifyMzansi. Thirty
days gives a business or listing more time to be discovered, while a
simultaneous allocation bounds the amount of free inventory. It does not
establish that demand or conversion will improve: use real views, enquiries and
paid renewals to assess the experiment. The proposal's old homepage observations
are not treated as current traffic or inventory evidence.

## Adopted policy

- One introductory post across Market, Business and Tourism & Events, tied to
  the existing verified identity HMAC and account history. Seven or 30 days;
  never both after activation. Existing free-post usage counts.
- Three configurable pools defaulting to 50 active 30-day trials each. Tourism
  businesses and events share one pool. Seven-day trials have no aggregate slot
  cap.
- Submission stores a pending choice; approval atomically verifies identity,
  checks capacity, consumes the offer and sets the expiry. Abandoned forms
  consume nothing. A crashed create reservation can be recovered after 15
  minutes if no content was attached.
- Full or paused pools leave the post pending. The member can switch a pending
  30-day choice to the enabled seven-day offer, or apply a paid plan. There is
  no silent downgrade or automatic charge.
- Standard placement, existing free-tier media allowance and normal moderation.
  Premium add-on checkout requires converting the specific post to paid access
  first.
- Expiry hides content without deleting the post or media. Paid renewal checks
  account verification, ownership, plan capacity and media compatibility.
  Expired or hidden content returns for moderation.
- Event visibility ends at the event end or trial expiry, whichever is earlier.
- Admin, governance controller (the existing Governor equivalent), and moderator
  receive a separate publishing-limit capability, verified against current
  server-side role data. Verification and moderation still apply. These posts
  use a standard 30-day visibility window and no customer allocation.

## Changes to the proposal

Unrestricted trial resets and seven-day extensions are omitted: they undermine
the one-time offer or bypass the 30-day allocation. Admin and governance
controllers can pause campaigns, change allocations from 0 to 500, revoke
trials, and extend an active 30-day trial within 60 days of activation. Every
management operation records its actor and reason in the same database
transaction. Pausing or lowering a limit does not shorten existing active
trials; further activations wait for capacity.

Notifications initially use the existing in-app system: activation, 7/3/1 days
for launch trials, 2/1 days for seven-day trials, and expiry. Delivery is
idempotent through an hourly database job. Email and WhatsApp trial campaigns
are deferred until delivery preferences, content and monitoring are validated;
there is no new outbound messaging integration in this change.

The trial dashboard reports starts by duration, active launch allocation,
expirations, revocations, paid renewals and conversion. Conversion is explicitly
paid renewals of activated trials divided by all activated trials. This avoids
presenting an immature expired-only cohort as a mature conversion rate. Existing
owner dashboards retain their actual engagement data; no example statistics are
shown as real results. Pool-full frequency and per-trial contact attribution are
deferred analytics enhancements.

## Security and lifecycle fixes

- Database publication triggers enforce the offer across all three content
  tables, including alternate approval paths. Pool rows are locked until the
  publication transaction commits. Identity redemption has its own unique
  database key.
- Client roles cannot change funding dates, ownership, area, featured/urgent
  flags, or publish content through direct database writes. Trial updates cannot
  restart an activation clock.
- The old per-area claim RPC is disabled; stale applications fail closed instead
  of issuing a second entitlement. Browser code only receives its own
  eligibility and aggregate availability. Identity tokens, configuration and
  audit tables are restricted to service workflows.
- Account deletion does not erase the consumed identity token. The privacy page
  discloses that retention; the data-rights export includes the new member trial
  records. Treat HMAC key rotation as an identity-data migration: preserve
  matching with prior redemption tokens.
- The retention worker no longer deletes expired posts after two days. Paid
  capacity excludes expired posts and shares one tourism/business-event count
  and lock, including renewals.
- Add-on checkout fails closed if funding cannot be checked, and refuses
  unconverted trial posts before charging.
- Updated the existing `fast-uri` pin to 3.1.6 after the audit identified a
  high-severity issue; this is a
  [maintainer-published patched version](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc).
  Also patched the affected esbuild and postcss-selector-parser dependency
  ranges.

## Release sequence

These are repository changes; they do not apply migrations or deploy the live
platform automatically.

1. Back up the database using the existing backup workflow. Review legacy
   free-post records and verified identity coverage in staging. Previously used
   legacy offers keep their existing visibility and count toward eligibility.
2. Apply the three `20260906` migrations together before releasing the
   application. The first replaces the legacy reservation contract; coordinate
   the cutover to avoid temporary errors from old app instances. Do not run only
   the first two migrations: renewal depends on the shared paid-capacity
   function in the third.
3. Deploy the app and retention worker together. Leaving the old retention
   worker running would still delete expired content. Verify the
   `intro-trial-notifications` pg_cron job exists and executes successfully.
4. In a production-like PostgreSQL staging environment, exercise concurrent
   claims for the final available slot and simultaneous tourism business/event
   paid creates. Verify exactly one final-slot activation commits, and failed
   approvals leave their post pending and identity unspent.
5. Smoke test a verified member choosing each duration, a full pool, a paused
   campaign, staff publishing, post rejection, expiry, media-compatible paid
   renewal, and direct database permission denial. Verify public lists and
   detail routes hide elapsed posts while owner dashboards retain them.
6. Review current deployment/schema/security-advisor gates before production
   release. Roll forward on application problems; do not restore the old
   free-claim RPC or erase identity history as a rollback shortcut.

`pnpm test:trials` executes the SQL migrations and behavioral checks using a
local embedded PostgreSQL engine with synthetic data. This catches SQL syntax,
trigger, permission, identity and lifecycle failures. Its minimal schema and
serialized connection are not substitutes for full-schema, multi-connection
staging contention tests. The normal safety gate also runs lint, types, blocking
tests, preflight, secret/dependency/license checks and database invariants;
consult its latest artifacts for the result of this run.

## Verification on 6 September 2026

- `pnpm safety:review`: **PASS**, all 12 checks, zero blockers. The blocking
  suite passed 420 test files and 3,691 tests, followed by all 21 embedded
  PostgreSQL behavior checks.
- Production build: **PASS**, including TypeScript and generation of all 155
  static pages. Existing MediaPipe dynamic-import and Sentry/Edge dependency
  warnings remain non-blocking.
- Built local pricing page: verified the introductory policy, expandable
  eligibility details and visual layout in the browser.
- `git diff --check`: **PASS**. No live migrations or deployment were performed.
  The staging release checks above remain outstanding.

The machine-readable and human-readable gate results are in
`tmp/safety-gate/latest-review.json`, `tmp/safety-gate/latest-review.md`, and
`tmp/safety-gate/latest-review-blockers.txt`.

No finite review can establish that the entire platform has no security gaps.
The release decision must retain the staging and operational checks above,
especially because this change affects payments, account identity and data
retention.
