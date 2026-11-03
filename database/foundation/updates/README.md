# Reviewed updates for an already provisioned foundation

These are separately reviewed SQL update artifacts, not the retired root
`supabase/migrations` tree and not a request to remove the clean baseline guard.
Application status is recorded per update; file presence alone does not
establish that a hosted project has received it.

## Owner admin setup and signup hook, 3 November 2026

The following updates were applied to `gntzjtuncsyefujajmjy` after their actual
SQL passed isolated embedded PostgreSQL tests:

- `20261103152035_owner_admin_setup.sql` creates private, owner-controlled
  invitations. An invitation exposes the existing authenticator setup screen,
  with `can_access: false` and no capabilities. Only a confirmed, active account
  that verifies a TOTP factor receives an admin role. Every staff command still
  checks its live session, factor freshness and assigned capability. A consumed
  invitation cannot reactivate a previously assigned or revoked role.
- `20261103152812_restored_staff_dashboard.sql` adds `restored_queues` to the
  existing staff RPC. It preserves its native fields and API grants. Reports,
  identity cases, business cases and content counts come from canonical private
  records. The source-only support queue remains explicitly unavailable.
- `20261103154538_owner_signup_access.sql` replaces the leftover acceptance
  hook's single hardcoded address with the owner invitation list. The hook
  remains security invoker and callable only by Auth's `supabase_auth_admin`
  role, which receives only the required column reads through an RLS policy.
  Public, authenticated and service API roles cannot invoke it. This permits the
  two approved administrators to register; general public signup is still closed
  pending complete frontend/backend integration.

The owner separately approved two administrator addresses. Those addresses were
inserted by an owner SQL session, not committed as schema seeds or accepted from
browser metadata. One address already had a confirmed account. At application
time, the other had no account and neither had a verified authenticator. No
account, password, email confirmation or MFA proof was fabricated, and no
invitation email was sent.

The existing `bootstrap_first_administrator` function and its restrictions are
unchanged. Invitations resolve the circular dependency between requiring TOTP
before the first grant and requiring a staff assignment to see the TOTP screen.
They are not staff authority. Revoking an unclaimed invitation stops setup;
removing an already granted role still requires the normal staff governance
process. Reverting the app does not revoke existing canonical staff roles.

Hosted checks confirmed the signup hook accepts both approved addresses, rejects
an uninvited synthetic address, remains security invoker, and has the required
Auth role privileges. A hosted operator session cannot impersonate
`supabase_auth_admin` with `SET ROLE`; its actual role execution was tested in
the isolated SQL fixture. Real Google registration and user-held authenticator
setup must still be observed before reporting both administrators as ready.

`20261028213020_repair_verified_runtime_contracts.sql` updates three existing
function bodies. It checks their previous or already-updated body hashes before
making changes, so an unknown deployment is refused. The transaction preserves
existing ownership and execute grants. Its filename was created by the installed
Supabase CLI in an unlinked scratch workspace.

Applied on 4 November 2026 after the live original-body hashes matched all three
guards and isolated SQL regressions passed. Hosted verification returned the
expected repaired hashes and catalogue activation fields. There were zero
evidence artifacts at application time; no customer upload was removed.

Apply and verify the SQL before releasing the matching application: identity
submission now requires the case revision returned by upload completion, and
checkout requires the catalogue's activation limits. Keep previous release
artifacts and a tested backup. These function changes are additive to JSON
responses; the previous app can read them, but reverting the application would
restore its known upload and payment-presentation defects. Prefer a forward fix.

The new `posting-v2.json` is a prepared immutable document.
Publication/activation must respect the existing notice and account-acceptance
requirements. Do not edit `posting-v1.json`, invent acceptance for existing
accounts, or treat this SQL update as approval to activate new terms. Terms
activation is a separate release step, after owner/legal review of applicability
and notice timing.

## Owner dashboard, profile and inbox integration, 3 November 2026

### Notification continuation, 4 November 2026

`20261103231355_owner_notification_dismissals.sql` was applied after isolated
SQL tests passed. A private dismissal record hides a notification without
deleting its delivery-deduplication row; retention removes the dismissal with
its parent. Read and dismissal commands derive ownership from the current live
member session. The existing native list received a hash-guarded filter without
a DTO change. No browser table or anonymous/service command access was granted.
Native HTTP adapters preserve the existing bell's read, mark and clear requests,
and notification refresh uses the shared private owner signal. The focused
SQL/HTTP/bell/realtime suites passed 22 tests; types and lint passed. These
application changes are local and have not been deployed.

### Dashboard and profile updates

`20261103180512_restored_owner_dashboard.sql` adds an authenticated self-only
dashboard snapshot. Counts include all of the caller's original posts, while the
returned lists are bounded to ten recent listings and three enquiries. It
returns actual verification timestamps, canonical location labels and paid plan
labels. Trial and sponsorship grants are not presented as purchased plans. No
browser table grant or caller-selected account parameter was added.

Apply `20261103183017_repair_dashboard_identity_lookup.sql` after that update.
The live SQL-context check caught an incorrect UUID comparison in the original
dashboard artifact: `current_verified_identity` returns a private fingerprint.
The guarded repair resolves only the current account's active identity fact and
returns its review time. It never returns the fingerprint. The regression
fixture now executes the actual helper definition, reproduces the original
failure and verifies the repair and repeat application. Keep the original
applied artifact and this forward repair together; their order is recorded in
`runtime-api-manifest.json`.

`20261103182231_restored_profile_update.sql` composes the native profile and
locality commands in one transaction with an explicit expected revision. It
keeps the subject/profile lock order, verified-name lock and locality review
requirements. A refused locality rolls back the name and bio; a locality-only
change advances the profile revision. The preserved form carries that revision
as request metadata. A stale revision receives HTTP 412 so the old form does not
mislabel it as a duplicate phone number. Phone changes still require the native
OTP proof; a profile form cannot write a verified phone.

All three updates above were applied to the approved London database. Live
SQL-context checks using an existing session row verified the dashboard DTO and
native staff dashboard. The profile command was exercised inside a transaction
that was explicitly rolled back. These are SQL contract checks, not
browser/provider end-to-end tests. The owner subsequently confirmed both Google
registration and authenticator setup; the database contains two active admin
roles and two verified TOTP factors.

The application adapters also reconnect the existing avatar upload, owner inbox
reads/status changes and unread badges to native commands. Avatar uploads use
the media journal and R2, with a revision-fenced profile link. The old Supabase
avatar bucket is not used by the foundation path. Owner inbox realtime uses one
shared private channel per account, sends no buyer data in its signal and
re-reads through the owner API. Stale refreshes and uncertain status writes do
not overwrite newer server data or replay a mutation.

The new runtime APIs have separate reviewed types and a manifest; the immutable
clean-baseline generator artifacts remain unchanged. Application preflight now
checks that these extensions exist and refuse anonymous callers. Exact grants,
authenticated DTOs and provider/browser flows remain separate evidence.

These database updates do not deploy the application. Current Cloudflare traffic
still runs the earlier application release and lacks the required
`FOUNDATION_PHONE_VERIFICATION_ENABLED` binding. The local Worker configuration
sets it, but release remains pending full frontend/backend integration.

## Restored public browsing and contacts

`20261029191349_restore_public_browse_contract.sql` was applied to the approved
London project `gntzjtuncsyefujajmjy` on 3 November 2026, after the isolated
embedded PostgreSQL regression tests passed and the existing function-body
hashes were verified. The latest encrypted database backup had completed
successfully in
[run 41575307023](https://github.com/verifymzansi-VM/verifymzansi-VM/actions/runs/41575307023).

The update preserves function signatures, ownership, execution grants, private
table restrictions and the guarded clean baseline. It adds a nullable business
format, validated owner/revision-controlled writes through the existing context
command, and database-side event/date/price filtering and page offsets. Existing
records retain an unknown format until their owner records one; no format is
inferred or backfilled. A partial index covers recorded formats.

Card requests must explicitly opt into `presentation: true` to receive the new
public business-format and event-window metadata. Requests without that option
retain the prior response shape. The application preflight checks this versioned
contract before release, including empty catalogues. The normal events grid
reads one bounded page without fetching every event's full detail.

Contact availability uses the existing public channel RPC. Phone numbers remain
absent from public pages and cards. The existing contact button obtains a fresh
CAPTCHA before the compatibility reveal route applies origin/CSRF checks, a
fail-closed rate limit, target-kind checks, and the service-only phone command.
That command rechecks publication, the selected channel and the verified phone.
No challenge, rate-limit or private-table access restriction was relaxed.

`src/lib/foundation/public-browse-sql.test.ts` executes the actual SQL update on
isolated embedded PostgreSQL, including repeat application, populated event
pagination, all six formats, revoked visibility, owner/revision checks and
denied browser table access. It is supplementary SQL evidence, not a complete
hosted authentication/provider or recovery rehearsal. Live preflight and role
checks also passed after application; the security advisor's existing
leaked-password protection warning remained unchanged.
