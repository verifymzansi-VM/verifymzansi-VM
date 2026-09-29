# Admin access inventory

Baseline taken on 27 September 2026 (Phase 0 of the admin rebuild). It lists
every path through which staff read or change data, and how each one is
authorised today. Phase 1 moves all of them onto a single `staff_roles`
authority. Each row here is a checklist item for that work.

Legend for "Authorised by":

- **JWT**: the role in the session token, checked by `isStaff` / `isAdmin` /
  `hasCapability`. `auth.getUser()` returns current `app_metadata`, so pages see
  role changes on their next request.
- **DB**: the role re-read through `verifyStaffActorRoleFromDb` /
  `verifyCapabilityFromDb` (the Auth Admin API).
- **Guard**: `enforceAdminMutationGuard`, which does same-origin, CSRF, a DB
  role check and a rate limit.

## Status after Phase 1 (staff role authority)

- **Pages.** Every admin page and the layout use `requireStaff(capability)`
  (`src/lib/auth/require-staff.ts`). It reads the role and account status from
  `staff_roles` on every request and enforces staff two-step verification.
- **API routes.** Every `/api/admin/*` route re-checks the role against
  `staff_roles` and enforces two-step verification. The check lives in
  `enforceAdminMutationGuard` or `checkStaffApiMfa`. These actions need a code
  entered in the last 15 minutes:
  - role changes
  - high-risk KYC overrides
  - DSAR exports
- **Database.**
  - `has_role()` / `has_any_role()` read `staff_roles`, and role checks in
    policies are wrapped in `(SELECT ...)`.
  - Moderators and governors have no direct write access through PostgREST.
  - The three legacy staff write policies are dropped.
  - The 12 functions that read the role from auth metadata now read
    `staff_roles`.
- **Realtime.** It follows the same policies, so a demoted staff member stops
  receiving events at once.
- **Still open.** The rows below record the Phase 0 baseline. Pagination, the
  DSAR export as a POST, the decision execution layer and removing unused routes
  are later phases.

## Status after Phase 2 (decision execution layer)

- **Enforcement.** Enforcement, appeals and lifts run in database functions that
  apply a decision, its effects and its audit row together (`moderate_report`,
  `approve_decision`, `reject_decision`, `lift_restriction`, `submit_appeal`,
  `resolve_appeal`, `propose_kyc_override`).
- **Account status.** It is written only by `recompute_account_status()`.
- **Append-only tables.** `audit_logs`, `decision_record_events` and
  `role_assignments_history` are append-only.
- **New routes.**
  - `POST /api/appeals` (member)
  - `POST /api/admin/governance/restrictions/lift`
  - `POST /api/admin/ops/jobs/retry` (admin)
  - `POST /api/webhooks/ops-jobs` (worker; shared secret)
- **New pages.** `/appeals`, `/appeals/new` and `/admin/operations`.
- **Removed.**
  - `src/lib/services/enforcement.ts`
  - direct account-status writes from the flagging route
  - the typed secondary-approver field

## Status after Phase 3 (queue claims and data requests)

- **Queue claims.** Moderators claim the next items from a queue
  (`claim_queue_items`: up to 20 live claims each, 15 minutes, renewable 4
  times). The database locks the work rows, so two moderators never get the same
  item.
  - The decide routes (`flagging/action`, `verification/decide`,
    `content/decide`, `content-edits/decide`) call `check_queue_claim` first. A
    moderator must hold the claim.
  - Governors and admins may act on unclaimed items, and can free or reassign a
    claim with a reason. That action is audited.
  - Claims are released when a decision is made, when the holder loses their
    staff role, or when they expire (the `expire-queue-claims` pg_cron job).
- **Data requests (DSAR).**
  - Deadlines come from `dsar_deadline_rules` and are set by the database when a
    case is created. Each case stores `received_at`, `legal_basis`, `due_by` and
    any `extended_due_at`.
  - The rule values are the owner's defaults and still need the Information
    Officer's confirmation:
    - access: 30 days, plus one 30-day extension with notice
    - correction, deletion and objection: a 30-day internal target, with no
      extension
  - An extension (`extend_dsar_deadline`) is allowed once, before the deadline
    passes, with a reason. The requester is emailed through a durable job.
  - Cases can be assigned. `/admin/dsar` has overdue, due-soon and
    assigned-to-me views.
  - `/admin/dsar/new` records requests received by email, post or phone. These
    cases start with identity unchecked (`identity_check = 'manual'`).
  - The export is a POST with CSRF and needs a second factor from the last 15
    minutes. It refuses to run until identity is verified.
    - It reads every dataset in full, or returns nothing (`export_incomplete`).
    - Other people are never identified: message senders become `sent_by_you`,
      and staff appear as "VerifyMzansi staff".
    - The file is sent straight to the staff member's browser and is not stored.
- **Evidence retention.** Admin → Operations Health shows
  `retention_overview()`:
  - the purge and retention job runs, with failures over the last 7 days
  - evidence past its purge date
  - stuck file deletions
  - accounts on legal hold
- **New routes.**
  - `POST /api/admin/queue` (claim, renew, release, reassign)
  - `POST /api/admin/dsar/case` (extend, assign)
  - `POST /api/admin/dsar/intake`
  - `POST /api/admin/dsar/export` (replaces the GET)

## Status after Phase 4 (shell and role homes)

- **One navigation registry.** `src/lib/admin/nav.ts` lists every admin page and
  the capability its page guard requires. The sidebar shows a page exactly when
  the viewer's role holds that capability. `nav.test.ts` reads each page's
  `requireStaff(...)` call and fails if the two disagree, or if a new admin page
  is added without a menu entry or a named parent.
- **Role homes at `/admin`.**
  - Moderator, "My shift": held items with time left, renew and release, claim
    buttons, and the queues with their size, oldest item and SLA breaches.
  - Governor, "Decisions": escalations (with those expiring in 24 hours),
    appeals, overdue and upcoming data requests, active restrictions, decisions
    that failed to apply, role changes, and 30-day oversight rates shown with
    their totals.
  - Admin, "Platform": health (reports past deadline, incidents, stuck jobs,
    evidence past its purge date, the expiry job), the team, everything a
    governor sees, and website traffic streamed separately.
- **Counts come from the database in one call.** `staff_dashboard(actor)` and
  `staff_nav_counts(actor)` (migration `20260929120000_staff_dashboard.sql`)
  return only the sections for the actor's role. A section that cannot be read
  shows as "Unavailable", never as 0.
- **Support inbox.** Governors can read it but not change it; the update route
  already required `case:recommend`, and the buttons are now hidden too.
- **Realtime refresh.** Queue events are merged, with at most one refresh every
  10 seconds per screen, so a busy platform does not make every staff screen
  reload continuously.
- **Removed.**
  - `dashboard-cards.tsx` and `strategy-dashboard.tsx`
  - nine dashboard-only query functions in `admin-queries.ts`
  - the separate governor, moderator and admin sidebar builders
- **Not built: a TypeScript copy of the action policy.** Who may propose,
  approve or decide each action is enforced inside the database functions
  (`moderate_report`, `approve_decision`, `propose_staff_role_change` and
  others), and is covered by the PGlite suites. A second copy in TypeScript
  would drift from them. Page and menu access comes from the capability map in
  `src/lib/auth/roles.ts`.

## Status after Phase 5 (sub-page fixes and cleanup)

- **Queues show what you hold.** The verification and moderation queues always
  load the items the viewer has claimed, even when they fall beyond the page's
  limit (claims take the highest-risk or oldest items, which may not be among
  those shown). Both show the true total with "Showing X of Y", and a failed
  read shows an error rather than an empty queue.
- **No writes from staff pages.** The verification queue no longer creates
  account profiles or calls the Auth admin API once per member; a missing name
  shows as "New Member".
- **Paging with totals:**
  - audit log: 50 per page, filters kept, a link to clear filters, and a notice
    when an ID filter is not a full ID
  - staff roles: 50 per page, with a filter by role
  - payments: 50 per page, so older payments can be found and refunded
- **Totals computed in the database** (migration
  `20260929130000_admin_list_helpers.sql`):
  - `staff_directory`: names and emails in one query (was one Auth call per
    person on the roles page)
  - `organisation_list_counts` and `partner_referral_counts` (were reads of
    every active affiliation, sponsorship, application and referred account)
  - `revenue_summary` (was a read of every payment and invoice, 1,000 rows at a
    time, with errors ignored)
  - `trial_entitlements_for` (was one call per search result on Programmes)
- **Area pages** filter reports by area in the database instead of taking the
  first 100 across all areas.
- **Removed.** `POST /api/admin/promotions/[id]/moderate`: no caller, and it
  skipped the claim and self-review checks that `content/decide` enforces.
- **`/admin/tourism-events`** now redirects to `/admin/promotions-events`.
- **Consistent pages.** The admin error page no longer draws a second header
  inside the admin layout. Commercial, organisations, partners, payments and
  programmes use the standard page header.
- **Rollout.** The old dashboard was removed in Phase 4, so there is no flag to
  switch back to it. Roll back a release with `git revert` of the Phase 4
  commit; the database changes are additive and safe to keep.

## Gates in front of every admin request

| Layer                   | File                                                | Check                                                                                      |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Middleware              | `src/lib/middleware/auth-gates.ts` `checkAdminGate` | JWT `isStaff`                                                                              |
| Ban and suspension gate | `auth-gates.ts` `checkBanEnforcement`               | Not applied to `/admin` pages (`proxy-handler.ts` excludes them); applied to API mutations |
| Layout                  | `src/app/admin/layout.tsx`                          | JWT `isStaff`                                                                              |

## Pages

| Page                                                        | Authorised by                                                 | Needs (Phase 1 target)                        |
| ----------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `/admin`                                                    | JWT `isStaff`                                                 | any staff                                     |
| `/admin/audit-log`                                          | DB `audit:view` (fixed in Phase 0; governors were redirected) | same                                          |
| `/admin/businesses`, `/mzansi-market`, `/promotions-events` | `AreaAdminPage`, JWT `isStaff`                                | `queue:view`                                  |
| `/admin/tourism-events`                                     | re-exports promotions-events                                  | redirect instead                              |
| `/admin/commercial`                                         | DB `commercial:manage`                                        | same                                          |
| `/admin/dsar`                                               | DB `dsar:manage` (fixed in Phase 0)                           | same                                          |
| `/admin/feature-flags`                                      | JWT `isAdmin`                                                 | `feature_flag:toggle`                         |
| `/admin/governance/appeals`, `/[id]`                        | JWT `appeal:decide`                                           | same                                          |
| `/admin/governance/enforcement`                             | JWT `enforcement:execute`                                     | same                                          |
| `/admin/governance/escalations`, `/[id]`                    | JWT `decision:approve`                                        | same                                          |
| `/admin/governance/oversight`                               | JWT `oversight:view`                                          | same                                          |
| `/admin/governance/roles`                                   | JWT `audit:view` (form shown to admins only)                  | view `audit:view`, change `role:assign`       |
| `/admin/intelligence/*` (6 pages)                           | JWT `bi:view`                                                 | same                                          |
| `/admin/moderation`                                         | JWT `isStaff`                                                 | `queue:view`                                  |
| `/admin/organisations`, `/[id]`                             | DB `organisations:manage`                                     | same                                          |
| `/admin/partners`                                           | DB `partners:manage`                                          | same                                          |
| `/admin/payments`                                           | DB `bi:view`; refunds shown with `payments:refund`            | same                                          |
| `/admin/programmes`                                         | DB `contracts:manage`                                         | same                                          |
| `/admin/reports`                                            | JWT `isStaff`                                                 | `queue:view`                                  |
| `/admin/support`                                            | DB any staff                                                  | view any staff; update `case:recommend`       |
| `/admin/trials`                                             | DB `trials:manage`                                            | same                                          |
| `/admin/verification`, `/evidence`                          | JWT `isStaff` (+ `kyc_evidence_desk` flag)                    | `queue:view`                                  |
| `/dev/business-moderation-preview`                          | none                                                          | `notFound()` in production (fixed in Phase 0) |

## API routes (`/api/admin/*`)

| Route                                | Method    | Authorised by                                                                                                        | Notes                                                                                                        |
| ------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `commercial`                         | POST      | Guard + DB capability per action                                                                                     |                                                                                                              |
| `content/decide`                     | POST      | Guard, any staff                                                                                                     | no self-review check                                                                                         |
| `content-edits/decide`               | POST      | Guard, any staff                                                                                                     | no self-review check                                                                                         |
| `dsar/complete`, `dsar/decide`       | POST      | Guard `dsar:manage`                                                                                                  |                                                                                                              |
| `dsar/export`                        | POST      | Guard `dsar:manage` + recent second factor + shared limiter (fail closed)                                            | refused until identity is verified; complete or nothing; third parties redacted (Phase 3)                    |
| `dsar/case`, `dsar/intake`           | POST      | Guard `dsar:manage`                                                                                                  | extension rules enforced in `extend_dsar_deadline`; assignee must hold `dsar:manage`                         |
| `feature-flags/toggle`               | POST      | Guard admin only                                                                                                     |                                                                                                              |
| `flagging/action`                    | POST      | Guard, any staff; warn/hide need `enforcement:execute`; ban/suspend by holders of `decision:approve` skip the ledger | fail-closed limiter on ban/suspend added in Phase 0                                                          |
| `governance/appeal`                  | POST      | Guard `appeal:decide`                                                                                                | overturn does not reverse enforcement                                                                        |
| `governance/decide`                  | POST      | Guard `decision:approve`                                                                                             | secondary approver is a typed user ID                                                                        |
| `governance/roles`                   | POST      | DB admin                                                                                                             | fail-closed limiter added in Phase 0                                                                         |
| `support/update`                     | POST      | Guard `case:recommend`                                                                                               |                                                                                                              |
| `trials`                             | POST      | Guard `trials:manage`                                                                                                |                                                                                                              |
| `verification/decide`                | POST      | DB any staff                                                                                                         | no self-review check; high-risk override is single-person; fail-closed limiter on overrides added in Phase 0 |
| `verification/evidence`, `/metadata` | GET, POST | `authorizeEvidenceRequest`, DB any staff                                                                             |                                                                                                              |

No `"use server"` actions exist in the codebase.

## Database

- **Role helpers.** `public.has_role()` / `has_any_role()` read
  `auth.jwt() -> app_metadata -> role`, so row-level security trusts the token
  until it expires.
- **Role-based RLS policies.** 72 current policies on 51 tables read the role
  through those helpers, `auth.jwt()` or `app_metadata`. Security-relevant ones:
  - `verification_steps` ("Reviewer updates steps"): moderators can write
    directly.
  - `reports` ("Staff updates reports"): moderators can write directly.
  - `moderation_actions` ("Staff creates moderation action"): moderators can
    write directly.
  - `audit_logs`, `dsar_cases`, `feature_flags`: admin only.
  - `decision_records`, `decision_record_events`: all staff read.
  - `appeal_cases`, `role_assignments_history`: governor and admin read.
- **Inline role checks.** 12 functions read
  `auth.users.raw_app_meta_data->>'role'` directly (introductory trials, free
  posts, commercial foundation and completion migrations). They must switch to
  `staff_roles` in Phase 1.
- **`SECURITY DEFINER` functions.** 101, by latest definition. Phase 1 reviews
  `EXECUTE` grants on each one.
- **Guards.** The `guard_account_enforcement_columns` trigger lets only the
  service role, admins, or a trusted context (pg_cron, migrations) change
  enforcement columns.

## Realtime

`src/hooks/use-realtime.ts` subscribes admin clients
(`admin-realtime-refresh.tsx`, `admin-live-notifier.tsx`) to `postgres_changes`
on these tables:

- `verification_steps`, `listings`, `businesses`, `promotions`
- `reports`, `dsar_cases`, `contact_submissions`, `notifications`

Delivery is filtered by the RLS policies above, so it follows the token role
until Phase 1.

## Storage

KYC evidence lives in the private R2 bucket. It is reached only through
`/api/admin/verification/evidence*`, and every read is logged in
`kyc_evidence_access_logs`.

## Performance baseline (static count per `/admin` load)

| Source                                       | Supabase round-trips                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Layout badges                                | 3 counts + moderation counts (7, cached per request with `React.cache`) + 1 feature flag lookup = 11 |
| Dashboard `getAdminDashboardStats`           | 6 (moderation counts reused from cache)                                                              |
| `getDashboardReports`                        | 1                                                                                                    |
| `getExtendedPlatformStats` (governor, admin) | 2 + 6 = 8                                                                                            |
| `getDashboardAreaSummary`                    | 20, three of them row fetches with no limit                                                          |
| `getAreaCardCounts`                          | 1 (up to 10,000 rows)                                                                                |
| `getVerificationStepCounts`                  | 1 (row fetch where a count would do)                                                                 |
| `getSiteVisitStats` (admin)                  | 1 RPC                                                                                                |
| `getGovernanceQueueCounts` (governor)        | 3                                                                                                    |
| Auth                                         | `getUser` twice (layout + page)                                                                      |

That totalled about 40 database round-trips per load for a moderator, 49 for an
admin and 51 for a governor, plus two Auth calls.

After Phase 4, a load of `/admin` makes:

| Source                                                  | Calls                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| Staff check (`requireStaff`, shared by layout and page) | `getUser`, `staff_access_of`, the assurance-level check        |
| Sidebar badges                                          | 1 RPC (`staff_nav_counts`) + 1 feature flag (cached in memory) |
| Home                                                    | 1 RPC (`staff_dashboard`)                                      |
| Traffic (admins only)                                   | 1 RPC, streamed after the rest of the page                     |

That is three database calls for a moderator or governor above the fold (four
for an admin, one of them streamed), down from 40 to 51. Measuring live p95
still needs the local Supabase stack with seeded data.
