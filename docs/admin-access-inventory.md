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
| `dsar/export`                        | **GET**   | DB `dsar:manage`                                                                                                     | returns personal data from a GET; fail-closed limiter added in Phase 0; POST + CSRF in Phase 3               |
| `feature-flags/toggle`               | POST      | Guard admin only                                                                                                     |                                                                                                              |
| `flagging/action`                    | POST      | Guard, any staff; warn/hide need `enforcement:execute`; ban/suspend by holders of `decision:approve` skip the ledger | fail-closed limiter on ban/suspend added in Phase 0                                                          |
| `governance/appeal`                  | POST      | Guard `appeal:decide`                                                                                                | overturn does not reverse enforcement                                                                        |
| `governance/decide`                  | POST      | Guard `decision:approve`                                                                                             | secondary approver is a typed user ID                                                                        |
| `governance/roles`                   | POST      | DB admin                                                                                                             | fail-closed limiter added in Phase 0                                                                         |
| `promotions/[id]/moderate`           | POST      | DB any staff                                                                                                         | no UI caller; duplicates `content/decide`                                                                    |
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

That totals about 40 database round-trips per load for a moderator, 49 for an
admin and 51 for a governor, plus two Auth calls. Measuring live p95 needs the
local Supabase stack with seeded data; that is taken before Phase 4 replaces the
dashboard. The Phase 4 target is one role/status lookup plus one dashboard RPC
above the fold.
