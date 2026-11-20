# Reviewed updates for an already provisioned foundation

These are separately reviewed SQL update artifacts, not the retired root
`supabase/migrations` tree and not a request to remove the clean baseline guard.
Application status is recorded per update; file presence alone does not
establish that a hosted project has received it.

## Safe order for a database change

Code and database must never disagree, so every change follows this order:

1. **Expand in the pull request that needs it.** Write one new file named
   `<UTC timestamp>_<what_it_does>.sql` with full `create or replace`
   definitions; never edit `../candidate.sql` or an applied update. Only add:
   new commands, new optional arguments, new fields. Add its line to the
   [applied register](#applied-register) as `pending` and list it in
   `../fingerprint.json` `productionCheck.pendingApplication`.
2. **Prove it locally and in CI** (`pnpm test:foundation:native`, replay,
   snapshot, contracts and lint; see below). CI also runs
   `scripts/check-foundation-update-order.mjs`, which fails when the register
   misses a file or when the API manifests remove or rename a command or
   argument compared with `main`.
3. **Staging first.** Once a staging project exists, the update is applied there
   before merge; the pull request job `staging-database` then fails when staging
   lacks a command the change expects. Until staging is configured that job is
   skipped. It never runs on `main`, so staging cannot block a deploy.
4. **Apply in the stated order.** The owner approves the update before either
   step, and its pull request states its order: **apply-first** (the default:
   apply in production, then merge) or **website-first** (merge and deploy, then
   apply straight after), used when the live website's strict readers would
   reject what the update adds. Merging deploys automatically, so the order
   matters. The release preflight compares what production answers with what the
   commit expects and warns "database behind by N" or "database ahead by N".
   Afterwards, one pull request records it, changing together:
   - its register line, from `pending` to
     `applied YYYY-MM-DD HH:MM UTC; <how it was applied>`;
   - `../fingerprint.json` `productionCheck`: the owner's read-only fingerprint
     capture moves `capturedOn`, `matchedThroughUpdate` and
     `matchedFingerprints` to this update, and it leaves `pendingApplication`.

   Updates are recorded in filename order: `pendingApplication` must be exactly
   the updates after `matchedThroughUpdate`, so an update applied before an
   earlier pending one stays `pending` until the earlier one is applied too.

5. **Contract in a later pull request.** Removing or renaming a command or
   argument, changing an argument or return type, making an argument required or
   removing an execute grant happens only after the code has switched. That pull
   request adds a new entry to `../contract-steps.json` naming the earlier
   expand update and its pull request number. The expand update must already be
   on `main` and recorded there as applied (the check reads `main`'s register,
   not the pull request's), a replacement must already exist on `main`, and a
   removed command may no longer be named in `src/` or `workers/`. An entry
   authorises only the pull request that adds it; a later change of the same
   kind needs a new entry with its own expand update. Reverting an expand step
   that production never received (its update still `pending` on `main`, or its
   file deleted in the same change) needs no entry.

The manifest comparison sees command names, argument names and types, which
arguments are required, return types and execute grants. It does not see fields
inside `jsonb` results or inputs, or changed argument defaults: review those by
hand and keep them additive.

A code rollback (reverting a pull request) never undoes a database update: the
preflight then reports the database ahead, and a forward fix is preferred.

## How to write a new update

- **Use full definitions.** Every changed function is written out as a complete
  `create or replace function ...` with its whole body, followed by its
  `revoke`/`grant` statements. Do not read a stored body and patch it with
  `replace()` and dynamic SQL: reviewers must be able to read the new rule in
  the file. A guard that checks the current body's hash before replacing it may
  stay, as a precondition only.
- **Add before removing.** Name the file `YYYYMMDDHHMMSS_short_name.sql`; never
  edit `candidate.sql` or an earlier update.
- **Regenerate in the same pull request** and commit the results:
  `pnpm db:foundation:replay -- --write` (fingerprint),
  `pnpm db:foundation:snapshot` (the readable `../current/` folder),
  `pnpm db:foundation:api-check` (update the API manifests and types if it
  fails) and `pnpm db:foundation:lint` (plpgsql_check; no new errors, no more
  warnings than `../lint-baseline.json`). CI runs all four.

## Sign-up mode in the database, and member invitations, 20 November 2026

`20261120040242_signup_mode_member_invitations.sql` is pending (see the applied
register). **Order: apply-first** (the default). The website release from the
same pull request reads the new `api.get_signup_mode` and falls back to
`FOUNDATION_REGISTRATION_INVITE_ONLY` when it cannot, so either order is safe.
It refuses (55000) unless its fifteen objects are all absent or all present and
the two functions it replaces (`internal.acceptance_signup_guard`,
`internal.run_retention`) have their reviewed bodies (or this update's).

- **Sign-up mode.** New one-row table `private.signup_settings`: `invite_only`
  (the default, and what the hook assumes if the row is missing) or `open`. It
  starts as `invite_only`, so nothing changes for visitors when the update is
  applied. Updates are refused unless they come from `internal.set_signup_mode`
  (trigger `signup_settings_guard`); deletes and truncation are refused.
- **Only the database owner changes it.**
  `internal.set_signup_mode(p_mode, p_reason, p_changed_by_email)` is executable
  by no API role (like `internal.bootstrap_first_administrator` and
  `internal.grant_house_slots`): no website, browser or staff session can reach
  it; the owner runs it in the Supabase SQL editor. Refusals: 22023
  `signup_mode_invalid`, `signup_mode_reason_required` (5 to 500 characters of
  plain text); 42501 `signup_mode_changer_invalid` unless the named account is
  confirmed, active, holds an active admin role and has a verified authenticator
  app. Setting the current mode again records nothing.
- **The record.** New append-only table `private.signup_mode_events`: from, to,
  the administrator account named, the reason and the time. No API role has
  access; updates, deletes and truncation are refused.
- **Reading the mode.** `api.get_signup_mode()` (anon and authenticated):
  `{"mode"}` only. The website words its uniform registration reply from it.
- **Member invitations, apart from administrator invitations.** New table
  `private.member_invitations` (address, who invited it or none for the owner's
  SQL editor, when, expiry 30 days later, revocation). A member invitation
  admits one sign-up in either mode and never grants a staff role; only
  `private.owner_admin_invitations` (unchanged, owner only) makes an
  administrator. Staff commands (authenticated, capability `member:invite`,
  admin role only, the 12-hour authenticator rule): `api.invite_member(p_email)`
  (adds, or renews for 30 days; 22023 `member_invitation_email_invalid`; 54000
  `member_invitation_limit` over 200 per staff member in 24 hours),
  `api.revoke_member_invitation(p_email)` (idempotent) and
  `api.list_member_invitations()` (latest 500: address, dates, status `open`,
  `expired` or `revoked`, and whether an account with that address exists; never
  who invited). Until a staff screen exists, the owner can also invite in the
  SQL editor:
  `insert into private.member_invitations(email) values ('person@example.com');`.
- **The sign-up hook** (`internal.acceptance_signup_guard`, same invoker rights
  and the same "Registration is not open yet" refusal) admits an unrevoked
  administrator invitation or an unrevoked, unexpired member invitation in
  either mode. Otherwise `invite_only` refuses as before, and `open` admits
  everyone except an address whose domain is malformed, numeric or an address
  literal, ends in a reserved name (test, example, invalid, localhost, local,
  internal, onion, arpa, lan, home, corp, intranet), is example.com/.net/.org,
  or is (under) a domain in the new table `private.signup_blocked_domains`
  (seeded with 15 well-known disposable-address services; the owner adds rows in
  the SQL editor). Those get "Registration is not available for this email
  address" (403); the website still gives its one uniform reply. The hook may
  read only the mode, the invitation address, expiry and revocation, and the
  blocked domain (column grants and `supabase_auth_admin` select policies).
- **Retention.** `internal.run_retention` also runs
  `internal.purge_member_invitations` (`"member_invitations"`: invitations
  deleted 30 days after they expired or were revoked).

**Opening sign-up at launch (item 60)** is one owner call in the SQL editor,
with the hosted "Before user created" hook left switched on (switching it off
would also drop the domain check):

```sql
select internal.set_signup_mode('open', '<reason>', '<owner admin email>');
```

Before applying, read the preflight's "administrator invitations not yet used":
each of those addresses becomes an administrator when its account enrols an
authenticator app. Revoke any meant for an ordinary member
(`update private.owner_admin_invitations set revoked_at = now() where email = '...';`)
and invite that person as a member instead.

Preflight `../preflight/20261120040242_signup_mode_member_invitations.check.sql`
(summary "signup mode and member invitations: update not applied; administrator
invitations not yet used: N"); rollback
`../rollback/20261120040242_signup_mode_member_invitations.down.sql` (refuses
once a mode change is recorded; member invitations are lost). Behaviour test
`scripts/test-foundation-signup-mode.mjs`.

## Post views and likes, 19 November 2026

`20261119172135_post_views_and_likes.sql` was applied on 20 November 2026 at
00:15 UTC (see the applied register). Roadmap P6. **Order: apply-first** (the
default): the website release from the same pull request names the three new
commands, and the deploy preflight probes every command in
`../runtime-api-manifest.json`, so a deploy without the update stops there. The
website calls them only while its switch `SHOW_ENGAGEMENT_TOTALS`
(`src/lib/hidden-features.ts`) is on; it stays off in production until the owner
approves showing the counters, so applying the update changes nothing anyone
sees. It adds three API commands, four internal functions, six tables and two
cost allowances (the safety valves below), and replaces three functions with
full bodies: the privacy export, the retention job and account erasure. It
refuses (55000) unless its tables and functions are all absent or all present
and the three functions have their reviewed bodies (or this update's).

- **What is stored.** The website gives each browser a random identifier in a
  first-party cookie (`vmz_viewer`, HttpOnly, one year), signed with the Worker
  secret `ENGAGEMENT_COOKIE_SECRET` and issued only after a Turnstile check, so
  only identifiers it issued are counted. It passes the identifier, with the
  GoTrue-verified account or none, to the two service commands. The database
  never stores that identifier, a network address or a user agent:
  - `private.engagement_keys`: one random 32-byte key, made by the update, for
    like hashes;
  - `private.post_view_salts`: one random 32-byte salt per day
    (Africa/Johannesburg), with the day's counted views and net new likes (the
    safety valves);
  - `private.post_view_marks`: `sha256(day salt || browser || post)` and the
    time, one per counted view, never an account;
  - `private.post_view_days`: views per post per day (deleted with the post);
  - `private.post_engagement_totals`: each post's total views and counted likes;
    the public read and the like command read only this row, and it is the lock
    for the post's likes (likes kept by a trigger on `private.post_likes`);
  - `private.post_likes`: the post and either `sha256(like key || browser)` (a
    like made signed out) or the account (a like made signed in), never both,
    the time, and when it starts to count (`waiting` until then). Deleted with
    the post; a signed-in like also by account erasure, and by the Auth user's
    deletion.

  Row level security is on for all six; no API role has table access.

- **Purge.** `internal.run_retention` (daily, `api.run_retention`) now also runs
  `internal.purge_post_engagement()` (`"engagement": {salts, marks}`): marks
  older than 24 hours (the dedupe window), in batches of 10,000 up to 200,000 a
  run, and salts older than yesterday, and it releases waiting likes that are
  due (likes are also released when the post is viewed or liked). A mark is
  therefore gone within 2 days and a salt within 3, whether or not anyone views
  a post. A view request only makes the day's salt (and drops salts older than
  yesterday if the job has not run); it never deletes marks.
- **Views.** `api.record_post_views(p_post_ids, p_device, p_account)` (service
  only): 1 to 5 posts (22023 `views_invalid` otherwise), handled in id order
  (each post's days row, then its totals row, then its like rows; the day's salt
  row once, last), so two requests never deadlock. A post counts at most once
  per browser in 24 hours (today's or yesterday's salt). Never counted: a post
  that is not publicly live (search document visible and
  `private.public_eligible_posts`), the owner's own view (signed in), or any
  view by an account with an active staff role; an account that is not active
  counts as signed out. There is no per-post cap (per-source limits are the
  website's). Storage safety valve: over 300,000 counted views in a day, only
  established viewers keep counting (a browser identifier older than 24 hours,
  `p_device_issued_at`, or a signed-in account older than 7 days); new ones
  count and store nothing until the next day, so storage stays bounded and no
  flood switches counting off for everyone. Staff get the cost alarm
  `post_views_counted` at 70% (warning) and at the valve (critical), each once a
  day. Returns `{"counted": [post ids]}`.
- **Likes.**
  `api.set_post_like(p_post_id, p_device, p_account, p_liked, p_device_issued_at)`
  (service only): sets (null toggles) the like of the signed-in account, or of
  the browser when signed out, and returns `{"liked", "likes", "counted"}`.
  Signed in it acts only on the account's like, signed out only on the
  browser's, so on a shared browser one person never removes another's like. The
  owner's and staff's own likes are never stored (`counted: false`); they may
  remove the like their browser made while signed out. Changes to one post's
  likes happen one at a time (its totals row is locked). A signed-out like from
  a browser identifier issued less than 10 minutes earlier
  (`p_device_issued_at`) is stored but counts only from then; the answer's
  `likes` adds the caller's own waiting like. There is no per-post cap: the
  earlier 600-an-hour cap only delayed counting once waiting likes stopped using
  later hours, so it is dropped and per-source limits do the work. Storage
  safety valve: over 50,000 net new likes in a day (a like taken back the same
  day gives its place back, so liking and unliking never fills it), only
  established likers' likes are stored (as for views); others answer
  `"liked": false, "counted": false`, and unliking always works. Staff get the
  cost alarm `post_likes_new` at 70% and at the valve. An unknown or hidden post
  is PT404 `post_unavailable`; a missing post or browser 22023 `like_invalid`.
- **Totals.** `api.get_post_engagement(p_post_ids)` (anon and authenticated):
  for up to 50 ids (22023 `engagement_invalid` above that), each publicly live
  post as `{"post_id", "views", "likes"}`; a hidden or unknown post is absent,
  so the answer never tells them apart.
- **Privacy export.** `internal.frontend_privacy_export_data` gains the datasets
  `post_likes` (the latest 2,000 likes made signed in) and `post_likes_summary`
  (their number, first and last), so the export never fails because of likes.
  Likes made signed out cannot be tied to an account and are not exported.
- **Account erasure.** `internal.erase_closed_account` also deletes the
  account's likes.
- **Known limits.** A view or like by the owner (or staff) while signed out
  cannot be told apart from anyone else's. One person can have one like signed
  out per browser and one signed in per account on the same post: a signed-out
  like is not moved to the account on sign-in, because on a shared browser it
  may be someone else's.
- **Valve helpers.** `internal.engagement_established(account, issued_at)` and
  `internal.engagement_valve_alarms(metric, valve, before, after)` (no API
  role).
- **Cost allowances.** `post_views_counted` (300,000 a day) and `post_likes_new`
  (50,000 a day), measurement `estimate`, so `internal.check_cost_alarms` never
  checks them; they name the two valves on the staff cost page, and the commands
  raise their alarms.
- **Website limits (not in the database).** Every limiter key is the IPv4
  address or the IPv6 /48. New signed identifiers come only from
  `/api/engagement/viewer` after a Turnstile check for this widget (action
  `engagement_viewer`, this site's hostname), within `engagement:viewer`
  (generous, for carrier-grade NAT), which is read before the check and spent
  only by a successful issue. Views and likes: `engagement:view` (requests),
  `engagement:view:post` (counted views of one post from one address a day),
  `engagement:like` and `engagement:like:post` (new likes of one post from one
  address a day). A view request counts at most 3 posts. Crawlers and headless
  browsers (`isAutomatedUserAgent`), prefetches and requests without a signed
  identifier are not counted; a signed-in like needs no identifier.

Preflight `../preflight/20261119172135_post_views_and_likes.check.sql` (summary
"post views and likes: update not applied; publicly listed posts: N" before,
"post views and likes: already applied; likes: N; view days: N; views: N" after;
a problem row for each replaced function without its reviewed body); rollback
`../rollback/20261119172135_post_views_and_likes.down.sql` (only with the
owner's decision; switch the counters off instead where possible; it refuses
once a like or a counted view is recorded, and puts back the three earlier
function bodies byte for byte). Behaviour test
`scripts/test-foundation-post-views-and-likes.mjs` (part of
`pnpm db:foundation:lifecycle-test`).

## House slots for administrators, 19 November 2026

`20261119082834_house_slots.sql` was applied on 19 November 2026 at 14:04 UTC
(see the applied register). **Order: apply-first** (the default): nothing in the
website uses it. It adds no API command, argument, grant or result field; the
only existing functions it changes are the privacy export and the lifecycle job.
It refuses (55000) unless the three functions it adds are absent (or this
update's), the two it replaces have their reviewed bodies (or this update's) and
its table is absent or has the update's shape.

- **What a house slot is.** A `staff_grant` slot with exactly the shape of a
  paid Individual slot: any posting area, 1 live post, 4 posts going live per 30
  days, 10 photos and 1 video, no add-ons. `granted_by` is the approving
  administrator. It has no payment, so it never appears in revenue, commission,
  refunds or invoices; it is not one of the 4 paid Individual slots
  (`internal.individual_slots_counted` counts paid slots only); it does not use
  the free first post. Posts in it follow every normal rule:
  `internal.submit_post`, `internal.activate_post` and moderation are unchanged.
  "My slots" already lists it as "Slot from VerifyMzansi", with no checkout or
  renewal.
- **Granting (database owner only).**
  `internal.grant_house_slots(p_recipient_email, p_slots, p_days, p_reason, p_approved_by_email)`
  is executable by no API role (like `internal.bootstrap_first_administrator`);
  the owner runs it in the Supabase SQL editor. It makes the recipient hold
  `p_slots` (1 to 15) house slots, each running until `p_days` (7 to 180) days
  from now: current house slots that end earlier are extended to that date
  (never shortened; their posts' search end follows,
  `internal.refresh_slot_chain_documents`), and new ones are added up to
  `p_slots`. Nothing renews by itself. Refusals: 22023
  `house_slots_count_invalid` (a count outside 1 to 15, or below the house slots
  already held), `house_slots_term_invalid`, `house_slots_reason_required` (5 to
  500 characters of plain text); 42501 `house_slots_recipient_invalid`,
  `house_slots_not_admin`, `house_slots_recipient_inactive`,
  `house_slots_identity_required` (accepted ID review),
  `house_slots_mfa_required` (verified authenticator app),
  `house_slots_self_approval` (the approver must be a different account) and
  `house_slots_approver_invalid` (the approver must be a confirmed, active
  account with an active admin role and a verified authenticator app); 55000
  `house_slots_isolation` outside a read committed transaction (the SQL editor's
  default), so two grants at once never exceed 15.
- **Approval needs a second ID-verified person.** The approver's accepted ID
  review must belong to a different person than the recipient's (42501
  `house_slots_approver_identity_required` when the approver has none,
  `house_slots_same_person` when it is the recipient's identity); an identity is
  active on one account only, so two accounts of one person cannot approve each
  other.
- **The record.** New append-only table `private.house_slot_events`: one row per
  slot granted, extended or ended, with the slot's end after it, the approving
  administrator (none for an end) and the written reason. Row level security on,
  no API role has access; updates, deletes and truncation are refused
  (`internal.append_only_guard`), except the retention job's removal of a slot,
  which takes its events with it.
- **Ending.** Trigger `staff_roles_end_house_slots` on `private.staff_roles`
  (after a role is revoked, changed or deleted) runs
  `internal.house_slots_on_staff_role_change`: when the account no longer holds
  an active admin role, `internal.end_house_slot` revokes each current house
  slot (`revoked_reason` `house_slot_ended`), expires its posts (status reason
  "Slot ended"), takes them out of search and records the end ("Admin role
  removed"). Removing a role never fails or waits because of a post: the slot is
  revoked first (the only row waited for, never held for long), which at once
  stops activations and takes its posts out of public view
  (`private.public_eligible_posts` needs an active slot). Slots are revoked in
  the order `internal.activate_post` locks them (end date, then id), so a
  removal and an activation never deadlock. Its posts are then released with FOR
  NO KEY UPDATE SKIP LOCKED (a key-share lock from a row referring to the post
  does not stop it). A post in use at that moment keeps its activation on the
  revoked slot, out of public view, until the next run of the lifecycle job:
  `internal.run_post_lifecycle` has a new first step that runs
  `internal.end_house_slot` again for ended house slots that still have an open
  activation (at most `p_limit` slots per run, counted in `expired`; read
  through the new partial index `entitlements_house_slot_ended_idx`). A slot
  also ends at its end date, as any slot does. Account erasure revokes it like
  any other slot.
- **Privacy export.** `internal.frontend_privacy_export_data` gains the dataset
  `house_slot_events` (slot, action, end date, time; never the approving
  administrator or the reason).

Preflight `../preflight/20261119082834_house_slots.check.sql` (summary "house
slots: update not applied; admins: N; ready to receive: N; staff-granted slots:
0; house slots: none (table absent)"); rollback
`../rollback/20261119082834_house_slots.down.sql` (refuses once a house slot
event is recorded). Behaviour test `scripts/test-foundation-house-slots.mjs`.

## Privacy tightening 2, 19 November 2026

`20261119065758_privacy_tightening_2.sql` was applied on 19 November 2026 at
10:48 UTC (see the applied register). **Order: website-first**: the website
release from the same pull request is merged and deployed first, then the update
is applied. It refuses (55000) unless the thirteen functions it replaces have
their reviewed bodies (or this update's), its helper is absent (or this
update's) and no partner's rate is above 20%. No API command, argument, grant or
return type changes and no field is added to an existing result; the staff
organisation detail loses `public_contacts` (hand-reviewed jsonb). **Revert:**
the website before this pull request requires `public_contacts`, so its staff
organisation page fails once the update is applied: if the website is reverted
after apply, run the rollback SQL first.

- **Communication choices.** `internal.save_my_communication_choices` refuses to
  turn analytics or third-party sharing on (22023 `choice_unavailable`). Turning
  one off, or saving it unchanged, works as before; members who had one on keep
  it (the preflight counts them).
- **ID check counters.** The `kyc` count of `internal.staff_dashboard_overview`
  and the `kyc` figures of `internal.restored_staff_queues` count only what the
  ID check queue lists: open, a current submission at the case's version, an
  active account, not the staff member's own case. The oldest waiting time is
  the submission's. No case is changed.
- **Search depth.** `internal.search_posts` (and `internal.search_post_cards`)
  refuses a page offset above 4,800 (was 500,000), 22023 `invalid page offset`.
  The website stops page links at 100 pages and never sends a deeper offset.
- **Partner rates.** At most 20% (2,000 basis points): the check
  `partners_commission_bps_check` and `internal.staff_save_partner` (22023
  `partner_invalid`). Recorded commissions keep their rate.
- **Short names.** `internal.get_frontend_enforcement`,
  `internal.get_frontend_partner_admin` and `internal.staff_get_organisation`
  name members by `internal.profile_public_name` ("Thandeka D.").
- **Staff organisation page.** `internal.get_frontend_staff_organisation_detail`
  carries no applicant contacts; staff ask for one pending application's contact
  with `api.reveal_organisation_applicant_contact` (logged in the organisation's
  event log), as organisation administrators do.
- **Business checks.** The staff member who decided a CIPC or "seen in person"
  check (or was assigned to the visit) opens its private details without a claim
  only until 90 days after the decision (`internal.get_frontend_cipc_case`,
  `internal.get_frontend_seen_case`, `internal.authorize_frontend_seen_file`,
  through the new `internal.business_check_reread_open`). After that they see
  only what every `queue:view` reader sees (a decided check cannot be claimed).
- **Closing an account.** `internal.account_closing_actor` counts only a
  password or Google sign-in (`amr` methods `password` and `oauth`) from the
  last 15 minutes, never a stamp more than 30 seconds in the future.

Preflight `../preflight/20261119065758_privacy_tightening_2.check.sql` (summary
"privacy tightening 2: update not applied; analytics on: N; third-party sharing
on: N; partners above 20%: 0; open ID checks with nothing to review: N");
rollback `../rollback/20261119065758_privacy_tightening_2.down.sql`. Behaviour
test `scripts/test-foundation-privacy-tightening-2.mjs`.

## Multi-listing package invoices and "Ask for an invoice", 19 November 2026

`20261119025106_package_invoices.sql` was applied on 19 November 2026 at 06:42
UTC (see the applied register). Roadmap P4e; the owner's decisions 5, 6 and 12
of 14 November 2026 (multi-listing gap review) and of 16 November 2026 (an
invoice first at any amount, paid with Pay now up to the online payment limit or
by bank transfer). It needs `20261114154823_slot_packages.sql`,
`20261114041000_customer_invoice_pay_now.sql` and
`20261118044440_bank_transfer_expiry.sql`, and refuses (55000) unless the nine
functions it replaces have their reviewed bodies (or this update's) and the
eighteen it adds are absent (or this update's). It only adds: no API command,
argument or grant is removed or changed, and no field is added to an existing
command's answer. **Nothing can be bought after it is applied**: packages stay
off sale and every new command refuses with PT403 `packages_not_on_sale` until
the owner switches them on.

- **Wider invoice limits.** `private.customer_invoices` and
  `private.invoice_transfers` hold up to 250 slots and R150,000 (250 slots for
  180 days at R600). The Individual commands keep their own limits (1 to 25
  slots, at most R50,000). A payment line holding more than one slot (a package
  line) may be up to R150,000 (`payment_lines_amount_cents_check`); a one-slot
  line stays at most R10,000.
- **"Ask for an invoice" (member).**
  `api.request_package_invoice(p_plan_id, p_slots, p_expected_total_cents, p_cooling_off_consent, p_request_id)`:
  5 to 250 slots of one package term at any amount (22023
  `package_slots_invalid`), priced here from the catalogue (PT428 when the total
  shown differs), with an accepted ID review (PT412) and the box ticked (22023
  `invoice_consent_required`; recorded as `invoice-cooling-off-v1`, the words
  every invoice uses, with the current posting terms). Refused while the account
  has a package that has not ended (PT409 `package_active`) or an unpaid package
  invoice (PT409 `package_invoice_unpaid`). One open request per account (a
  partial unique index): the same request id returns the first answer
  (`repeated: true`, another order with it PT409 `invoice_request_conflict`);
  the same order again keeps the waiting request; another order replaces it
  (`withdrawn`) while no staff member has prepared it, and is refused once one
  has (PT409 `package_invoice_request_open`). At most 10 new requests per
  account in 24 hours (PT429 `package_invoice_requests_limit`).
  `api.get_my_package_invoice_request()` reads the account's latest request
  (never another account's, never staff details).
- **The request record.** New table `private.package_invoice_requests`: the
  account, term, slots, price and total, the consent, the status (`requested`,
  `awaiting_approval`, `issued`, `declined`, `withdrawn`), and what staff did
  (who prepared it with the days to pay and the reason, who approved it, the
  invoice, who declined it and why). What the member asked never changes; staff
  details are written once; it moves on once (trigger
  `package_invoice_requests_guard`, which also checks that an issued request
  names its own invoice of that order). Closing an account withdraws its open
  request (`internal.close_account_evidence`), so it leaves the staff queue;
  erasure withdraws it too and unlinks every request from the account
  (`internal.erase_closed_account`; the guard allows only that change), as its
  invoice and payment are unlinked. The retention job
  (`internal.retention_commerce`, new count `package_invoice_requests`) removes
  declined and withdrawn requests five tax years after they closed, the period
  of declined bank transfers; an issued one goes with its invoice. No API role
  reads it.
- **Staff.** `api.get_staff_package_invoice_requests()` (`payments:view`): the
  open requests, oldest first (at most 100), with the customer's account email,
  public name, whether their ID review is accepted and whether they have a
  package. `api.issue_staff_package_invoice(p_request_id, p_due_days, p_reason)`
  (`payments:refund`, recent second factor) issues the customer invoice at the
  price asked for, with the next `VM-YYYY-NNNNNN` number, the description
  "Multi-listing package: <n> slots × <days> days" and the issuing staff member,
  after checking the account, its ID review, the switch, the price still sold
  (PT409 `invoice_plan_unavailable`), no package (PT409 `package_active`), no
  other unpaid package invoice and the VAT setting again. **Above R50,000** it
  only prepares the invoice (`awaiting_approval`, no number taken);
  `api.approve_staff_package_invoice(p_request_id)`
  (`payments:confirm_transfer`, admin) issues it, never by the preparer or
  another account of their identity (42501 `invoice_approver_same`) and only
  while the preparer still holds `payments:refund` and a current accepted ID
  review of their own (PT409 `invoice_preparer_inactive`); the preparer is the
  invoice's issuer.
  `api.decline_staff_package_invoice_request(p_request_id, p_reason)`
  (`payments:refund`) closes an open request. Every staff command checks the
  staff member's own ID review, never their own identity's account and never a
  customer they referred, again after every lock wait (the customer, then their
  package, then the row); repeats by the same staff member return the first
  answer; a closed request is refused (PT409 `package_invoice_request_closed`,
  PT404 `package_invoice_request_unavailable` for an unknown id). The issued
  invoice notifies the member as every invoice does.
- **Paying a package invoice.** As an Individual invoice, as a package:
  `internal.start_invoice_payment` ("Pay now", only up to the online payment
  limit, so 13 slots for 30 days today) starts one Ozow payment with one line
  holding every slot and the package checkout's snapshot, after checking the
  switch and no package (an unsent package checkout is closed; one open at Ozow
  refuses with PT409 `invoice_checkout_open`); the existing Ozow notice delivers
  it as a package (`internal.customer_invoice_payment_guard` accepts that one
  line as the attempt). `internal.record_staff_invoice_transfer` and
  `internal.confirm_staff_invoice_payment` (two staff members) record and
  deliver a bank transfer to it the same way: one line, the grant that opens the
  package (`internal.issue_slot_line_entitlements`), the invoice record, the
  receipt event and the partner commission; `slots_started` is the package's
  number of slots. Both refuse while packages are off sale (PT403
  `packages_not_on_sale`) or the account has a package (PT409 `package_active`).
  The Individual slot limit and E3 do not apply to a package. Individual
  invoices are unchanged, except that confirming any bank transfer now also
  needs the recorder's own current accepted ID review (PT409
  `transfer_recorder_inactive`). Refunds work on the package line as for a
  package bought online.
- **Online package checkout.** `internal.start_package_checkout` (full body)
  refuses while a package invoice of the account is unpaid (PT409
  `package_invoice_unpaid`): it is paid or voided first.
- **Privacy export.** New dataset `package_invoice_requests` (term, slots,
  amounts, dates, consent, status, invoice number; never the staff member or the
  reasons).
- **Known gap (fix before packages go on sale).** Confirming a bank transfer to
  a package invoice waits while another package payment of the account is open
  at Ozow, but an online package checkout that was started and not yet sent to
  Ozow is neither cancelled nor rechecked. If it is sent and paid afterwards,
  the payment lands in `needs_reconciliation` beside the package (staff refund
  it). The fix belongs in `internal.claim_checkout_request`: refuse to send a
  package checkout while the account has a package or an unpaid package invoice.
  `20261119151152_package_gap_fixes.sql` makes it.

**Order: apply first, then merge.** The website release from the same pull
request calls the new commands and the deploy preflight probes every command in
`../runtime-api-manifest.json`, so a deploy without the update stops there.
Earlier releases do not call them and keep working with the update applied: no
package invoice can exist while packages are off sale, so the earlier invoice
readers (at most 25 slots and R50,000) never meet one. It is recorded after
`20261118182332_refund_follow_ups.sql`.

**Applying.**

1. Run `../preflight/20261119025106_package_invoices.check.sql` unchanged in the
   SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "package invoices: update not applied (apply before the
   website release that uses it is deployed); on sale: no; invoice requests:
   none (table absent); package invoices: 0; package bank transfers: 0".
2. Run the update. It waits at most 5 seconds for any lock (it briefly locks
   `private.customer_invoices`, `private.invoice_transfers` and
   `private.payment_lines` to widen their rules). Run the preflight again: it
   must read "package invoices: already applied; on sale: no; invoice requests:
   0 (open: 0); package invoices: 0; package bank transfers: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.

The reviewed rollback is `../rollback/20261119025106_package_invoices.down.sql`
(only with the owner's decision; prefer a forward fix). Revert and deploy the
website release first: the rollback removes the commands that release calls. It
refuses once a package invoice request, a package invoice, a bank transfer for a
package or a payment line above R10,000 exists; otherwise it puts back the nine
earlier bodies byte for byte and the earlier limits, and drops the added
functions and the table.

`node --import tsx scripts/test-foundation-package-invoices.mjs` (part of
`pnpm db:foundation:lifecycle-test`, 30 checks) proves on the throwaway
database: the preflight before and after, read only; drifted bodies and a
premature rollback refused, changing nothing; apply, rollback and re-apply
return the same fingerprints; the grants; with packages off sale nothing can be
asked for; the term, slot, total, tick and ID review rules; repeats, the same
order and a replacing order; the staff queue for `payments:view` only; issuing
at the price asked for, its repeat, and no second issue or decline; no new
request while an invoice is unpaid or a package runs; Pay now refused above the
online limit; a bank transfer confirmed by a second staff member opens a 25-slot
package (one line, one grant, 100 new posts per 30 days, 90 days, the invoice
paid, receipt event and invoice record); above R50,000 a prepared invoice takes
no number until another admin approves it (never the preparer, a moderator, or
once the preparer lost the role); Pay now within the limit closes an unsent
online checkout, pays the invoice with one line and opens a 5-slot package; a
declined request issues nothing; issuing rechecks the switch, the customer's ID
review and the staff member's identity; a bank transfer is refused while
packages are off sale; the record's guard; a R10,200 bank transfer and the
approved R60,000 invoice paid in full (one line each); confirming and approving
need the recorder's and the preparer's own current ID review; two approvers, and
an approval and a decline, at the same moment (one wins, at most one invoice);
the daily request limit; the online package checkout refused while a package
invoice is unpaid; closure withdraws open requests and erasure unlinks every
request, invoice and payment; retention of declined and withdrawn requests;
Individual invoices unchanged; the privacy export; and the rollback refused once
a request exists.

## Refund follow-ups and Ozow's refund window, 18 November 2026

`20261118182332_refund_follow_ups.sql` was applied on 18 November 2026 at 21:25
UTC with the owner's approval, before the website release from its pull request
(see the applied register). It carries the owner's decisions of 18 November
(plan B) for staff refunds; members see nothing new:

- **New reason "Cancelled before the renewal started"**
  (`renewal_cancelled_before_start`). It fits only a refund whose slots are all
  renewals whose days have not started: the whole payment of a renewal, or one
  renewed slot of it. Otherwise PT409 `renewal_already_started`, also when a
  waiting refund with it is approved after the renewal started, and the server
  does not send such a refund through Ozow then (it fails as `payment_changed`).
- **The renewal is refunded first.** A refund that would end a period whose slot
  has a renewal bought and not started is refused (PT409 `renewal_queued`),
  whether recorded with a reference, sent through Ozow or recorded from the Ozow
  dashboard. Approving a waiting refund checks it again, and so does the server
  before it sends a refund through Ozow (that refund then fails as
  `payment_changed`). Chargebacks are not refused.
- **A declined record's reference is free again.** The unique reference index
  and the repeat lookup leave declined records out. The same reference recorded
  at the same moment for another payment is refused as `ozow_reference_used` or
  `refund_reference_used`, not as a raw unique violation.
- **Ozow refunds only within 13 days of the payment** (Ozow says 14; one day
  less for time zones and Ozow's clock), counted from the payment's `created_at`
  (`internal.ozow_refund_window()`, the one setting). Asking for or approving a
  refund through Ozow after that is refused (PT409 `outside_refund_window`); one
  approved in time but not yet sent fails before anything is sent
  (`failure_reason` `outside_refund_window`, listed under 'Refunds that need
  staff', no payment problem alert). Recording a refund already made in the Ozow
  dashboard is unchanged.
- **After the 13 days, the money is paid back by bank transfer** and recorded
  with the existing reference commands and the bank reference (spaces allowed,
  at least four letters or digits; refusals `refund_reference_*`), also once
  refunds through Ozow have been used. No new command. A refund recorded with a
  reference is refused while a refund through Ozow of the same payment is
  approved or sent (PT409 `refund_in_flight`): Ozow may still pay that one.

Expand only: no API command, argument, grant, return type or result field is
added, removed or changed; no row is written. Records already waiting or
approved are judged by the new rules when they are approved or sent (the
preflight counts them).

**Order: expand website first (done), then this update, then this pull request's
release.**

1. Pull request #267 ("Website reads the refund follow-ups values before the
   database has them") is merged and deployed. It reads the new reason and
   failure reason and words the three new refusals.
2. This pull request is merged and the update is applied (preflight, update,
   preflight, fingerprint, below) before its release is deployed, as usual.
   Check first that the deployed release contains #267.
3. This pull request's release is deployed. It offers the new reason on renewal
   payments, shows until when Ozow refunds a payment, and offers "Paid back by
   bank transfer" next to "Refund through Ozow" (the database decides which is
   possible; the form says before the money is paid when it is).

Every state in between is safe: with the update applied and the #267 release,
staff see the new refusals in plain words but are not yet offered the new reason
or the bank transfer form. This pull request's release with the database before
the update would offer the new reason (refused there with "Choose why the money
is returned") and the bank transfer form (refused there for an Ozow payment once
refunds through Ozow were used), so do not deploy it first.

**Applying.** After this pull request is merged:

1. Run `../preflight/20261118182332_refund_follow_ups.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "refund follow-ups: update not applied; ...". Its
   counts (waiting for approval, approved refunds through Ozow not sent, those
   past Ozow's 13 days, those that would end a period while a renewal waits,
   declined records) are for staff to look at; none stops the update.
2. Run the update. It waits at most 5 seconds for a lock and stops without
   changing anything if the refund table is busy; run it again. Run the
   preflight again: it must read "refund follow-ups: already applied; ...".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.

The reviewed rollback is `../rollback/20261118182332_refund_follow_ups.down.sql`
(only with the owner's decision; prefer a forward fix). It restores the earlier
bodies, lists and unique index and drops the six new helpers; it refuses once a
record names the new reason, a refund failed outside the window, or a declined
reference was recorded again.
`node --import tsx scripts/test-foundation-refund-follow-ups.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; drift and a premature rollback are
refused; apply, rollback and re-apply return the same fingerprints; and each
rule above through the production API commands.

## Staff and organisation screens show less personal data, 18 November 2026

`20261118072601_staff_data_minimisation.sql` was applied on 18 November 2026 at
18:09 UTC with the owner's approval, before the website release from this pull
request (see the applied register). It narrows what staff and organisation
administrators see, and tells the person behind a data request when it moves on:

- **Short names in review queues.** The business review queue, the 'seen in
  person' queue and case, the CIPC case and both ID check queue reads name a
  member by their public short name ('Thando D.', the public seller card's rule)
  instead of the full name, which for a verified member is the full legal name.
  The full legal name is shown only where it already was: a case the staff
  member holds (claim, assignment or decision) with `evidence:view` (a second
  factor from the last 15 minutes, recorded in the evidence access log) and the
  identity context of a claimed ID check. Members see their own name as before.
- **Data requests.** Who may do each step is unchanged: one staff member with
  `dsar:manage` (a second factor from the last 15 minutes) records, checks,
  approves, exports and completes, and every step stays in the request's event
  log. New: when a request is approved and when its export is first made, the
  requester is emailed through the existing privacy notice jobs (kinds
  `approved` and `exported`) and an account named by the request gets a bell
  notice (`privacy_request_approved`, `privacy_export_made`), once each. A
  request staff record by hand is linked to its account at the identity check;
  if it was approved before that, the account gets the approval notice then.
  Export already needs a verified identity, so its notice always finds the
  account.
- **Support inbox.** It lists tickets received in the last 12 months, and older
  ones only while still open (new or in progress). Resolved tickets older than
  that are no longer listed (they are not deleted). Who may read it, and the
  counts of new tickets, are unchanged. Such a ticket can no longer be reopened
  or changed (`support_ticket_archived`, PT409), so its sender is not shown
  again.
- **Organisation dashboard.** It no longer carries applicants' business contacts
  (`public_contacts` leaves its result) and names co-administrators by their
  public short name (the viewer's own name as before). The new
  `api.reveal_organisation_applicant_contact(p_application)` gives the public
  business contact of one pending application (submitted, or more information
  requested) at a time; nothing for decided or withdrawn applications. Every
  reveal, by an organisation administrator or by staff, is recorded in the
  organisation's append-only event log (`private.organisation_events`: who,
  when, which application), which the staff audit trail lists as
  `organisation:applicant_contact_revealed`.

The staff invoice, bank transfer and payment lists are unchanged: the staff rule
(an authenticator code within 12 hours) applies to them as to every staff read.

Expand only: one new command; no command, argument, grant or return type is
removed or changed. A later code-only change can stop reading `public_contacts`.

**Order: expand website first, then this pull request and this update.**

1. Pull request #265 ("Website reads the staff data minimisation shapes before
   the database has them") is merged and deployed. It teaches the live website
   the two new requester email kinds, the two new bell notice kinds and a
   dashboard result without `public_contacts`.
2. This pull request is merged and the update is applied (preflight, update,
   preflight, fingerprint, below) before its release is deployed, as usual.
   Check the deployed release first: nothing in the database refuses the update
   while the website predates step 1, and that website's privacy notice job
   refuses (and retries) the new email kinds and its strict dashboard reader
   refuses the new shape.
3. This pull request's release is deployed.

Every state in between is safe. The expand release with the update applied shows
no applicant contacts on the organisation dashboard until step 3. This pull
request's release with the database before the update behaves as today: the
dashboard shows the contacts it still receives (pending applications only) and
offers 'Show contact' only when the result has no `public_contacts`. If the
expand release is ever reverted, run the rollback first.

**Applying.** After step 1 is live and this pull request is merged:

1. Run `../preflight/20261118072601_staff_data_minimisation.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "staff data minimisation: update not applied; ...". It
   also counts resolved support tickets older than 12 months (no longer listed).
2. Run the update. It locks the privacy notice and notification tables without
   waiting and stops without changing anything if either is busy; run it again.
   Run the preflight again: it must read "staff data minimisation: already
   applied; ...".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.

The reviewed rollback is
`../rollback/20261118072601_staff_data_minimisation.down.sql` (only with the
owner's decision; prefer a forward fix). It restores the earlier bodies and
lists, drops the new command, and deletes the bell notices and requester emails
of the new kinds to do so; the organisation event log keeps its reveal records.
`node --import tsx scripts/test-foundation-staff-data-minimisation.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; drift and a premature rollback are
refused; apply, rollback and re-apply return the same fingerprints; and each
rule above through the production API commands.

## Account events reach the notification bell, 17 November 2026

`20261117140533_member_notices_in_app.sql` was applied on 18 November 2026 at
02:40 UTC with the owner's approval, after the website release that knows the
new kinds was deployed (see the applied register).

Until now the bell listed only what was written to `private.notifications`. Many
account events queued only an email: an accepted ID check (a member who was
verified saw nothing on the website), a confirmed mobile number, payments
received, reversed or under review, the introductory allowance, the post
lifecycle notices and the slot renewal reminder. Post moderation, a staff-issued
invoice and a held post shown again after review told the member nothing at all.
From this update:

- **Email events reach the bell.** A trigger on `private.outbox_events`
  (`internal.notify_member_of_outbox_event`) adds a notice of the same kind for
  the 12 email kinds that had none: `identity_accepted`,
  `verification_phone_confirmed`, `payment_completed`, `payment_reversed`,
  `payment_reconciliation_required`, `trial_started`, `post_expired`,
  `draft_deletion_warning`, `post_deleted`, `post_sold`, `post_kept` and
  `slot_renewal_reminder`. It fires only for a row actually inserted, so the
  outbox's dedupe keys keep the bell free of repeats. It adds no notice about a
  rejected edit's copy (the live post stays), only one for a reversal of several
  lines of one payment, and no "payment received" for a payment that could not
  be applied (its `payment_reconciliation_required` notice says so). A post
  notice links its post and goes with it, except `post_deleted`. An owner
  without an account gets no notice, and the event is never refused.
  `post_expiry_reminder` is not mirrored: nothing queues it any more.
- **Moderation decisions.** A trigger on `private.moderation_log`
  (`internal.notify_post_moderation`) tells the owner of each decision:
  `post_approved`, `post_rejected`, `post_changes_approved` and
  `post_changes_rejected`. No reason is stored in the notice; the owner's posts
  page shows it.
- **Invoices and restored posts.** A trigger on `private.customer_invoices`
  (`internal.notify_invoice_issued`) tells the member when staff issue an
  invoice to their account (`invoice_issued`); one on
  `private.frontend_content_holds` (`internal.notify_content_restored`) tells
  the owner when a held post is shown again after review (`content_restored`).
- **Live refresh.** `internal.notify_frontend_business_check` also signals the
  member's live inbox, like every other notice.
- **Inbox reads.** The enquiry-inbox reads (`internal.list_my_notifications`,
  `internal.list_my_frontend_notifications`) list an allowed set of their eight
  kinds instead of leaving out account notices one by one.
- **Kinds.** The closed notification kind list gains the 18 new kinds. The
  outbox kinds and the mail claim are unchanged.
- Events before the update are not notified afterwards.

**Order: deploy first, then apply.** Apply this update after the website release
from the same pull request is deployed. That release also leaves out any notice
of a kind it does not know, but the website deployed before it cannot read the
new notices: its notifications list would show its error state to a member who
has one. If that release is ever reverted, run the rollback below first.

**Applying.** The website release that knows these kinds must be live, and the
owner must have approved the notices' wording (`FRONTEND-CHANGES.md`, owner
question 31): the notices show only once this update is applied.

1. Run `../preflight/20261117140533_member_notices_in_app.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "update not applied".
2. Run the update. It locks the notification, outbox, moderation log, customer
   invoice and content hold tables without waiting and stops without changing
   anything if any is busy; run it again. Run the preflight again: it must now
   read "already applied".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.

The reviewed rollback is
`../rollback/20261117140533_member_notices_in_app.down.sql` (only with the
owner's decision; prefer a forward fix). It drops the four triggers, restores
the earlier bodies and kind list, and deletes every notice of the 18 new kinds
to do so; queued emails are untouched.
`scripts/test-foundation-member-notices.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves apply, rollback and re-apply and the
notices above; the post lifecycle test checks them through the real moderation
command and lifecycle job.

## Members are told when their ID is sent back, 10 November 2026

`20261110173012_verification_returned_notice.sql` is applied: the coordinator
applied it to production on 12 November 2026 at about 05:20 UTC, with the
owner's approval, after the website release that knows the
`verification_returned` kind (main 3ade4695) was live. Before it, the preflight
read "reviewed bodies, update not applied" with no identity case sent back, no
returned notice and no returned email waiting; the update returned no rows;
afterwards the preflight read "already applied" with the same three counts 0.
Production's fingerprint then matched the replay through this update in every
category (`../fingerprint.json`, `productionCheck`), apart from the known
`schema_grants` item that the Auth hook adds (`knownDifferences`).

It needs `20261110045944_intro_trial_at_first_approval.sql` (it replaces the
mail claim that update changed) and refuses to run without it. It adds no
command and changes no API signature, so the website release that uses it also
works with a database that does not have it: the member then sees the reviewer's
reason on the verification page, but gets no notice or email.

Until now, when staff sent an identity case back, the reviewer's reason was
stored and nothing told the member. From this update:

- **Notice and email.** Sending an identity case back
  (`internal.return_identity_submission`, which the identity review calls
  through `internal.return_frontend_identity_step`) adds a
  `verification_returned` notification for the member and queues a
  `verification_returned` email. Both point at the return request by id only;
  neither holds the reason or any identity detail. The email asks the member to
  sign in and open the verification page, which shows the reason. Business and
  restriction cases are unchanged.
- **Kinds.** The closed notification and outbox kind lists gain
  `verification_returned`. The mail claim
  (`internal.claim_supported_notification_outbox`) accepts it (lists of up to 20
  kinds) and gives no recipient for a closed account, as for the other account
  notices. The enquiry-inbox reads (`internal.list_my_notifications`,
  `internal.list_my_frontend_notifications`) leave it out, as they do the other
  account notices; the notifications page's read
  (`internal.list_my_frontend_notices`) lists it.
- Cases sent back before the update are not notified afterwards.

**Order: deploy first, then apply.** Unlike most updates, apply this one after
the website release from the same pull request is deployed. That release works
without it (its email job asks for the earlier kinds when the database refuses
the new one), whereas the website deployed before it cannot read a
`verification_returned` notice: its notifications list would show its error
state to a member who has one. The release preflight reports the database behind
by this update until it is applied. For the same reason, if that release is ever
reverted, run the rollback below first.

**Applying.** Production has `20261110045944_intro_trial_at_first_approval.sql`
(applied 10 November 2026). The website release that knows the
`verification_returned` kind must be live.

1. Run `../preflight/20261110173012_verification_returned_notice.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "reviewed bodies, update not applied".
2. Run the update. It locks the notification and outbox tables without waiting
   and stops without changing anything if either is busy; run it again. Run the
   preflight again: it must now read "already applied".

## Staff see how each selfie was taken, 11 November 2026

`20261111184619_selfie_capture_method.sql` is applied: the coordinator applied
it to production on 12 November 2026 at about 05:45 UTC, with the owner's
approval, before its website release was merged. Before it, the preflight read
"reviewed bodies, update not applied" with one selfie receipt and none with a
capture method; the update returned no rows; afterwards the preflight read
"already applied" with the same counts. Production's fingerprint then matched
the replay through this update (apart from the known `schema_grants` item).

The verification page sends, with the selfie, how the member's browser says it
was taken (`camera` for the live camera step, `file_upload` for the "Or upload a
photo" fallback) and whether the browser's liveness challenge was completed.
Until now the website dropped both, so the staff identity viewer never showed
its "Uploaded file" warning. From this update:

- **Stored with the selfie's upload receipt.**
  `private.frontend_verification_uploads` gains `capture_method` and
  `browser_liveness_passed`, both nullable. They are what the browser reported,
  not a proof: nothing grants, approves or scores anything from them.
  Constraints keep them consistent (both set or both empty, only on a selfie, a
  passed liveness challenge only with the camera). Receipts recorded before the
  update stay empty ("not recorded").
- **Recording.** New member command
  `api.record_my_selfie_capture(request, method, liveness)`. The website checks
  the two form fields against the closed set and calls it with the member's own
  session after reserving the selfie upload and before completing it. It accepts
  only the member's own selfie receipt while that upload is not completed; after
  completion it changes nothing. Calling it directly gives a member nothing that
  sending the form would not.
- **Staff read.** New
  `api.get_frontend_staff_selfie_capture(case, claim generation, claim nonce)`
  returns, to staff with `evidence:view` holding a live claim on an open
  identity case that is not their own, the current submission, its selfie and
  the recorded answer. It opens no evidence and writes no access log row (a
  deliberate exception: the answer is review context, not identity evidence, and
  the evidence metadata read that the viewer makes first records the access).
  The website turns the answer into the viewer's existing signals: "Uploaded
  file", "Liveness not verified", or "Browser liveness check completed"
  (labelled as not an attestation).
- **Retention.** `internal.scrub_frontend_verification_receipt`, which clears
  the ID number receipt when an evidence file is deleted, also clears the
  answer, so it goes with the selfie file (30 days after the case decision); the
  receipt itself follows the identity history.
- No existing API command changes signature, grant or owner. The upload
  completion is unchanged.

**Order: apply first, then merge.** The website release from the same pull
request calls the two new commands, and the deploy preflight probes every
command in `../runtime-api-manifest.json`, so a deploy without the update stops
there. Earlier website releases do not use the new commands and pass the deploy
preflight with the update applied, so they can still be deployed or redeployed.

**Applying.**

1. Run `../preflight/20261111184619_selfie_capture_method.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "reviewed bodies, update not applied".

## A failed payment start never blocks a member, 11 November 2026

`20261111212320_payment_start_retry.sql` is applied: the coordinator applied it
to production on 12 November 2026 at about 06:35 UTC, with the owner's approval,
before its website release was merged. Before it, the preflight read "reviewed
bodies, update not applied" with no pending payment without an Ozow request and
none for the sweep to expire; the update returned no rows; afterwards the
preflight read "already applied" with both counts 0. Production's fingerprint
then matched the replay through this update (apart from the known
`schema_grants` item).

A checkout is one pending payment per member and product. The website leases it
(`internal.claim_checkout_request`), asks Ozow for a payment request with the
payment's stored expiry time and idempotency key, and attaches the request Ozow
returns. The expiry was set once, at the first lease, and the key never changed.
When the first call to Ozow failed, nothing was attached, the payment stayed
pending, and every later attempt reused it with the same key and, after 30
minutes, an expiry time in the past. Nothing ever closed such a payment. From
this update:

- **A fresh window for every attempt.** A new lease on a pending payment with no
  Ozow request always gets a new 30-minute expiry. After an earlier lease (an
  earlier attempt may have reached Ozow), it also gets a new idempotency key, so
  Ozow never sees a key it already answered with a different expiry. The first
  lease keeps the key the payment was created with. The member never received an
  earlier request's page (the website returns a page only after attaching its
  request), so nobody can pay an abandoned request, and a late answer to an
  earlier lease cannot attach (its claim token is superseded). A payment that
  already has a request is returned unchanged, as before.
- **A sweep.** New service command `api.expire_stale_checkouts(limit)` marks
  expired the pending payments that have no Ozow request, were created more than
  an hour ago and are not leased now, oldest first, at most `limit` (1 to 500)
  per call, and returns how many. It skips rows another transaction holds and
  never touches a payment with a request (the status check handles those).
  Repeating it changes nothing more. The website's payment status job
  (`/api/internal/payments/reconcile`, run every 10 minutes by the
  payment-cleanup Worker) calls it first, with a limit of 100, so such a payment
  closes within about 70 minutes and the member's next checkout starts a new
  one. No new schedule is needed.
- No existing API command changes signature, grant or owner.

The website release in the same pull request also answers a plan whose pending
payment already has an Ozow request with the restored checkout page's 409
`PENDING_PAYMENT_EXISTS` reply (Continue payment, Check status, Cancel pending
payment). Its status check, once Ozow reports the request closed (`Expired` or
`Cancelled`), records a declined or cancelled bank attempt as not paid, as the
notice would; while the request is open it changes nothing, because the member
can still pay on it. A request cancelled other than by the member's Cancel
button is recorded as expired, so a verified late success still delivers the
plan. Neither needs a database change.

Known limits, recorded for later:

- If the sweep expires a payment between the member's quote and the server's
  lease (the member clicked Pay on a payment created over an hour ago, at the
  moment the job ran), that click gets a "Billing could not be completed" 409;
  the next click starts a new payment.
- The Continue link is left out once the stored request's window has passed;
  Cancel then asks Ozow to cancel an expired request. If Ozow refuses that, the
  page says the pending payment could not be cancelled until the next status job
  (at most 10 minutes) records the request as expired.
- Not yet confirmed with Ozow (M3.5, Ozow's test system): that a second payment
  request with the same merchant reference and a new idempotency key is
  accepted, how a cancelled attempt is reported (the code assumes an `Error`
  transaction and a `Cancelled` request), and the request status after a
  cancellation.

**Order: apply first, then merge.** The website release from the same pull
request calls `api.expire_stale_checkouts`, and the deploy preflight probes
every command in `../runtime-api-manifest.json`, so a deploy without the update
stops there. Earlier website releases do not use the new command and pass the
deploy preflight with the update applied, so they can still be deployed or
redeployed.

**Applying.**

1. Run `../preflight/20261111212320_payment_start_retry.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "reviewed bodies, update not applied". It also counts
   the pending payments without an Ozow request and those the first sweep will
   expire (0 today: production has taken no payment).
2. Run the update, then the preflight again: it must now read "already applied".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.

The reviewed rollback is
`../rollback/20261110173012_verification_returned_notice.down.sql` (only with
the owner's decision; prefer a forward fix). It restores the earlier bodies and
kind lists, and deletes every `verification_returned` notification and queued
email to do so; return requests and their reasons are kept.

`../rollback/20261111184619_selfie_capture_method.down.sql` (only with the
owner's decision; prefer a forward fix). Revert and deploy the website release
first: the rollback removes the two commands that release calls. It restores the
receipt scrub byte for byte and drops the two columns with the answers recorded
so far.

`../rollback/20261111212320_payment_start_retry.down.sql` (only with the owner's
decision; prefer a forward fix). Revert and deploy the website release first:
the rollback removes the command that release's payment status job calls. It
restores the checkout lease byte for byte. Payments the sweep already expired
stay expired (none had an Ozow request, so no money was taken).

`node --import tsx scripts/test-foundation-payment-start-retry.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves, on the throwaway database, the
defect before the update; that the preflight is read only and refuses drift, and
a premature rollback is refused; a failed first call retried 31 minutes later on
the same payment with a fresh window and a new key, while the failed lease's
late answer cannot attach; that an attached request is never re-leased; the
sweep (stale, young, leased, attached and settled payments, the limit, repeat
runs, the member's next checkout); who may run it; and that apply, rollback and
re-apply return the same fingerprints.

## Indexes for foreign keys used by deletion, 11 November 2026

`20261111223723_foreign_key_indexes.sql` is applied: the coordinator applied it
to production on 12 November 2026 at about 06:47 UTC, with the owner's approval.
Before it, the preflight read "not applied ... present 0 of 50" (the 31 tables
together 280 kB); the update returned no rows; afterwards the preflight read
"already applied; present 50 of 50". The fingerprint taken after the next update
(which changes no fingerprinted category) matched the replay through both.

It changes no function, grant or API command.

Postgres does not index the referencing side of a foreign key. When a referenced
row is deleted, it looks up the referencing rows of every key that points at it,
and without a usable index each lookup reads the whole referencing table. This
update adds 50 indexes on 31 tables, one per key on a deletion path:

- **37 columns that reference `auth.users`** (owner and staff columns such as
  `payments.owner_id`, `moderation_log.staff_id`, `decisions.proposed_by`).
  Deleting an Auth user (account deletion, or a failed sign-up being undone)
  checks every one of them, even for a member who never had a row there.
- **9 columns whose parent rows the retention sweep deletes**
  (`api.run_retention`): decisions, evidence cases, identity submissions and
  evidence files (`internal.retention_staff_records`,
  `internal.retention_verification`), and activations, entitlements and payments
  (`internal.retention_commerce`).
- **4 keys to posts**, which edits (`internal.apply_post_edit`,
  `internal.discard_post_edit`), deletion (`internal.delete_post`) and the
  lifecycle job (`internal.run_post_lifecycle`) delete, and to the affiliations
  that cascade from them: `organisation_affiliations(post_id, post_kind)`,
  `organisation_sponsorships.affiliation_id`, `post_activations.post_id`,
  `reports.post_id`.

The Supabase performance advisor's "unindexed foreign keys" check (no index
starts with the key's columns) listed 74 keys on the replayed schema; 40 of them
are indexed here. The other 10 indexed keys are ones the advisor counts as
indexed although their lookup reads the table: the only index that starts with
the column is a partial one for some rows (for example `legal_holds_active_idx`,
`where released_at is null`).

A column that may be null gets a partial index (`where <column> is not null`):
the key lookup and every query by value look for a value, and rows without one
stay out of the index.

The other 34 keys the advisor lists stay unindexed on purpose, and it keeps
listing them:

- 12 composite keys that an existing index already serves through a unique or
  selective leading column, for example `(post_id, post_kind)` where the primary
  key is `post_id`, or `(case_id, owner_id)` next to an index on
  `(case_id, id)`; a second index would only add write cost;
- 19 keys to reference tables that no command deletes or re-keys (provinces,
  cities, categories, catalogue and plan versions, event time zones, posting
  terms versions);
- 3 keys to organisation programmes, which no command deletes.

The lists are in `scripts/test-foundation-fk-indexes.mjs` (`SERVED_BY_EXISTING`,
`LEFT_UNINDEXED`, and `SCANNED_ON_PURPOSE` for the 22 keys whose lookup still
reads the table, all with parents no command deletes). Re-run the hosted
advisors after the first month of real traffic; "unused index" notices on an
almost empty database are expected and are not a reason to drop an index.

**Locks.** The update uses plain `create index`, not `concurrently`, because an
update runs in one transaction. Each build takes a share lock on its table until
the commit: reads continue, writes to those 31 tables wait. The tables are tiny
today (the preflight prints their total size), so this takes well under a
second; each lock wait gives up after 5 seconds (`lock_timeout`) rather than
queue behind a long transaction. Apply it at a quiet time: a write that already
holds one of these tables and then needs another could deadlock with it, and
Postgres would then cancel one of the two (possibly the member's request). Index
commands do not fire the event trigger `internal.require_table_rls` (it reacts
to table commands only).

**Order: any time.** No code depends on these indexes, so the update can be
applied before or after any website release. Until it is applied and recorded,
the release preflight lists it as "behind" (a warning; it has no command to
probe). Apply and record updates in filename order: if an update with an earlier
name is still pending, apply that one first.

**Applying.**

1. Run `../preflight/20261111223723_foreign_key_indexes.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "not applied ... present 0 of 50". A problem row names
   a missing column or key, an index that already has one of the update's names
   with another definition or is invalid, or another index that already serves
   the key for every row; the update refuses (55000) in each of these cases.
2. Run the update, then the preflight again: it must now read "already applied;
   present 50 of 50".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication` (only the `indexes` category changes).
   Once production's fingerprint matches, record it (its register line and
   `productionCheck`) as described above.

The reviewed rollback is
`../rollback/20261111223723_foreign_key_indexes.down.sql` (only with the owner's
decision). It drops exactly these 50 indexes, each with a short access exclusive
lock held until the commit, and refuses when an index with one of their names
has another definition. Running it again, or before the update, changes nothing.

`node --import tsx scripts/test-foundation-fk-indexes.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves, on the throwaway database: the 74
keys the advisor lists before and exactly the 34 listed ones after; that the
delete lookup of every foreign key (as a generic plan) uses an index condition
on an index starting with one of the key's columns, except the 22 documented
reference keys, and uses the new index for each of the 50 keys; that the
preflight is read only; that an index already serving a key, a conflicting or
invalid index under one of the names is refused by the update, the preflight and
the rollback; that deleting an Auth user still enforces the keys; that a partly
applied update is reported and completed by running it again; and that apply,
rollback and re-apply return the same fingerprints.

## No default rights in schema public, 11 November 2026

`20261111234521_public_default_privileges.sql` is applied: the coordinator
applied it to production on 12 November 2026 at about 06:49 UTC, with the
owner's approval. Before it, the preflight summary read "not applied; matches
the production capture of 6 November 2026", with no object in `public` outside
extensions and the nine expected `unchanged` rows for supabase_admin's defaults;
the update returned no rows; afterwards the summary read "already applied":
postgres gives `anon`, `authenticated`, `service_role` and PUBLIC nothing on new
tables, sequences or functions in `public`. supabase_admin's defaults remain, as
described below. Production's fingerprint after all five updates of 12 November
matched the replay in every category (`../fingerprint.json`, `productionCheck`),
apart from the known `schema_grants` item that the Auth hook adds
(`knownDifferences`).

It changes no function, table, grant on an existing object or API command.

The foundation keeps nothing in schema `public`, yet Postgres keeps default
privileges there: rights that every new object created by a role in `public`
receives automatically. The read-only catalogue capture of production on 6
November 2026 showed that a table postgres creates in `public` would give
`anon`, `authenticated` and `service_role` TRUNCATE, REFERENCES, TRIGGER and
MAINTAIN, and a new sequence UPDATE. The update withdraws every default
privilege postgres gives these three roles (and PUBLIC) in `public`, on tables,
sequences and functions, whatever the starting state; postgres keeps its own.
`service_role` is included because the server code calls only `api` commands; a
reviewed update that ever puts an object in `public` grants what it needs
explicitly.

What stays, and why:

- **supabase_admin's defaults in `public`** (every privilege on new tables,
  sequences and functions for the three roles). Only supabase_admin or a member
  of it may change them, and the SQL editor runs as postgres, which is neither:
  Postgres answers "permission denied to change default privileges". The
  preflight lists them as `unchanged` rows. No foundation step creates objects
  as supabase_admin; install extensions into schema `extensions` (the dashboard
  default), never into `public`. Changing them would need Supabase support.
- **USAGE on schema `public`.** The three roles have USAGE and no CREATE, and
  PUBLIC has USAGE too, so revoking it from them would change nothing, while
  revoking it from PUBLIC would also reach Supabase's own service roles. USAGE
  gives nothing while `public` holds no objects.
- **Later dashboard or platform changes.** A Data API setting that exposes new
  tables automatically, or a platform upgrade, may write default privileges in
  `public` again. After either, run the preflight: it reads "not applied" if
  rights came back, and the update can simply be run again.

**Order: any time.** Default privileges only affect objects created later, so no
running code notices the change, and the update takes no lock on application
tables. It can be applied before or after any website release. Until it is
applied and recorded, the release preflight lists it as "behind" (a warning; it
has no command to probe). Apply and record updates in filename order: if an
update with an earlier name is still pending, apply that one first.

**Applying.**

1. Run `../preflight/20261111234521_public_default_privileges.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if the summary
   reads "not applied; matches the production capture of 6 November 2026" and
   there is no `problem` row (the nine `unchanged` rows are expected). A
   different starting state is reported as a problem row: the update would still
   apply, but the rollback would not restore that state, so stop and ask.
2. Run the update, then the preflight again: its summary must now read "already
   applied". The roadmap's check, which should now list only supabase_admin:

   ```sql
   select pg_get_userbyid(d.defaclrole) as creating_role, d.defaclobjtype,
     pg_get_userbyid(a.grantee) as grantee, a.privilege_type
   from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclnamespace = 'public'::regnamespace
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole);
   ```

3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`. No
   category changes (default privileges are not part of the fingerprint); once
   it matches `../fingerprint.json`, record the update (its register line and
   `productionCheck`) as described above.

The reviewed rollback is
`../rollback/20261111234521_public_default_privileges.down.sql` (only with the
owner's decision). It gives the three roles back exactly the captured rights
(TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on new tables, UPDATE on new
sequences) and refuses when postgres's defaults for them and PUBLIC are neither
the update's nor exactly that capture (grant options included). Running it
again, or before the update, changes nothing.

`node --import tsx scripts/test-foundation-public-default-privileges.mjs` (part
of `pnpm db:foundation:lifecycle-test`) proves, on the throwaway database with
production's captured rows: that the preflight is read only and recognises that
state; that a table postgres created in `public` before the update gave the
three roles the captured table rights; that the update refuses while global
default privileges would still reach `public`; that afterwards postgres's rows
hold only its own rights, supabase_admin's and every other row are unchanged,
and a table, sequence and function postgres creates in `public` give the three
roles nothing; that rights given to PUBLIC are withdrawn too; that the rollback
restores the captured rows byte for byte and refuses any other state (including
a grant option or a PUBLIC entry); and that apply, rollback and re-apply give
the same rows and fingerprint. A second container started from the same image
with Supabase's own start-up scripts and supautils, where postgres is not a
superuser, runs the preflight, update and rollback as postgres: the update
clears that fresh database's full defaults, the rollback then gives exactly the
captured rows, and postgres may not change supabase_admin's defaults.

## Payment problems are kept and staff are emailed, 12 November 2026

`20261112080000_payment_problem_alerts.sql` is not applied yet. It needs no
earlier pending update and changes no existing function, table, grant or API
command. It refuses (55000) if either of its tables already exists with other
columns.

Until now a signed payment notice or a status-check transaction that could not
be applied was only written to the website's log, and settlement outcomes that
need a person (a second payment, money received for something that could not be
activated) only to the provider journal (`private.provider_events`). Nothing
told staff. From this update:

- **A record of payment problems.** New table `private.payment_problems`: one
  row per payment and reason (one row per reason for notices that name no known
  payment), with where it was first found (`notice` or `status_check`), when it
  was first and last seen and how many times. It holds no personal data: the
  payment id, a reason code from a closed list of 23, an Ozow transaction key,
  times and, once an alert is prepared, the payment's reference, amount,
  statuses and product kind at that moment. Rows go with their payment when the
  retention sweep deletes it (`on delete cascade`).
- **Recording.** New service command
  `api.record_payment_problem(payment, reason, source, alert, transaction)`. The
  website's server calls it when it refuses a signed notice, when the 10-minute
  status check refuses a transaction or finds two successful ones on one
  request, and when settlement reports an outcome that needs staff
  (`conflicting_transaction`, `transaction_reused`,
  `complete_unfulfillable_target`, a later Refunded status on a completed
  payment, and the outcomes the website's own checks normally catch first). A
  repeat only moves the last-seen time and the count. `alert` marks a problem
  that needs a person at once; the website decides it (a wrong amount or
  currency or a second payment the bank reports successful, money received for
  something that could not be activated, money returned after activation). A
  later repeat can raise the mark, never lower it, and the time it was raised is
  kept; a problem with no payment is never marked. After the alert was emailed,
  a marked repeat that names another Ozow transaction (for example a third
  successful payment, or one more transaction in the status check's set) raises
  it again, at most 5 times per problem; the same transaction never does.
- **Alerts.** New service commands `api.claim_payment_alerts(limit)` and
  `api.complete_payment_alerts(claim, sent)`. The email job (every minute) takes
  a five-minute lease on marked problems not yet emailed and raised in the last
  7 days (oldest first, 1 to 50 a call) and stores each payment's state with the
  batch. A batch whose send failed is offered again first, unchanged (same lease
  token, same details), so a retry sends the same email under the same key.
  `sent` records the batch as sent, or gives it back at once (the website does
  that when no staff address is set, so every run fails until one is).
- **Daily summary.** New table `private.payment_problem_digests` and service
  commands `api.claim_payment_digest(from hour, limit)` and
  `api.complete_payment_digest(claim)`. Once per South African calendar day,
  from the given hour (the website passes 7), the email job takes a five-minute
  lease on the day's summary. Its content is computed at the first lease and
  stored, so a retry gets the same summary: the problems seen since the end of
  the previous summary (at most 7 days back), payments still waiting for staff
  (received but not activated; pending with an Ozow request for over 2 hours),
  marked problems raised in the last 7 days and not emailed yet, and the count
  of each provider journal outcome in the same period. Summary records older
  than 400 days are removed when a new one starts.

The website release in the same pull request logs every problem as
`Payment problem` with the payment number, reason code and source, and every
failed status check as `Payment status check failed` with the payment number and
a reason code; the status-check job's reply lists them in `errors`. Recording
never holds up the reply to Ozow by more than three seconds and never changes
what happens to the payment. The email job sends the staff emails after the
members' payment messages. They go to the Worker secret `PAYMENT_ALERT_EMAILS`
(see `docs/RUNBOOK.md`, "Payment alerts"); without it the website logs what it
would have sent, keeps working, and reports `payment_alert:recipients` (every
run while an alert waits) or `payment_summary:recipients` (once a day).

**Order: apply first, then deploy.** The website release from the same pull
request calls the five new commands, and the deploy preflight probes every
command in `../runtime-api-manifest.json`, so a deploy without the update stops
there. If that release ran without the update anyway, payments would still
settle and every other email would go out, but each problem would be logged as
`Payment problem could not be recorded` and the email job would report its
payment alert steps as failed. Earlier website releases do not use the new
commands and pass the deploy preflight with the update applied, so they can
still be deployed or redeployed.

**Applying.**

1. Run `../preflight/20261112080000_payment_problem_alerts.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "update not applied". It also counts the payments the
   first daily summary will list as paid but not activated, and as pending with
   an Ozow request for over 2 hours (0 today: production has taken no payment).
2. Run the update, then the preflight again: it must now read "already applied".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.
4. Before the website release is deployed, set the app Worker secret
   `PAYMENT_ALERT_EMAILS` to one to three staff addresses separated by commas:
   `pnpm exec wrangler secret put PAYMENT_ALERT_EMAILS --env production`
   (`docs/RUNBOOK.md`, "Monitoring and Alerts", owner step 5). The first daily
   summary after 07:00 South African time shows that it works.

The reviewed rollback is
`../rollback/20261112080000_payment_problem_alerts.down.sql` (only with the
owner's decision; prefer a forward fix). Revert and deploy the website release
first: the rollback removes the commands that release calls. It drops the ten
functions and the two tables, and with them every recorded problem and summary
record; payments and the provider journal are untouched.

`node --import tsx scripts/test-foundation-payment-alerts.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves, on the throwaway database: that the
preflight is read only, reads "not applied" before and "already applied" after,
and reports a drifted body; that the update refuses a table of the same name
with other columns; that a premature rollback is refused; one row per payment
and reason, repeats counted with the first source and time kept, the mark raised
but never lowered, and notices with no payment kept once per reason and never
marked; refusal of reasons, sources and transaction keys outside the rules and
of unknown payments; alert leases (once; a failed or given-back batch comes back
byte for byte before any new batch, even after the payment changed; nothing
after it is sent; nothing raised over 7 days ago; the limit); that an alert
raised more than 7 days after the problem was first seen is still emailed; that
another transaction raises an emailed alert again, at most 5 times, and the same
transaction never does; the daily summary (not before the hour, once a day, the
lists and counts, the "not emailed yet" count limited to the last 7 days, a
retry that gets the same content and period byte for byte, the window from the
previous summary capped at 7 days, the 400-day clean-up); that only
`service_role` may run the commands and no API role can read the tables; that a
payment's problems go with it; and that apply, rollback and re-apply return the
same fingerprints.

## The current Terms (posting-v4) and paid plans paused, 12 November 2026

Two updates, applied in this order. Both are pending.

### 1. Publish the Terms text: `20261112122001_publish_posting_terms_v4.sql`

It publishes posting terms version `posting-v4`
(`src/lib/legal/terms-documents/posting-v4.json`, canonical hash
`HnObmeyoZjiuPQSF0z0aUgs_t_st87EUjVQGjDahozg`): it inserts one row into
`private.posting_terms_versions` and changes no function, table, grant,
acceptance or current version. It refuses (55000) when the current version is
not `posting-v3` (or already `posting-v4`), or when `posting-v4` is already
published with another document, and it checks before committing that the
current version did not change. `posting-v1` to `posting-v3` are unchanged.

The site has one set of Terms, shown at `/terms` with no version name (owner
decision of 12 November 2026: there are no members yet). `posting-v4` is only
the database's and catalogue's id for that text. It states Pricing v2 (roadmap
Milestone 11, P1): posting slots priced per slot and per 30-day period with no
discounts; Individual slots at R69 for 30 days, R207 for 90 days or R414 for 180
days in any posting area; 1 to 4 Individual slots per ID-reviewed person, each
with its own end date; slots on sale only while the pricing page offers them; at
most 4 posts going live per paid slot in each 30-day period (a new post or an
ended post brought back; edits do not count); one video per post, at most 2
minutes (events 1 minute); prepaid, no automatic renewal, paid time from the
confirmed payment, renewing early adds the new days after the current end; a
price change applies only to new purchases; orders of R10,000 or less online,
more by an invoice issued first and paid by EFT; no payment fees added; the
cooling-off consent before payment (ECT Act section 42(2)), recorded before an
invoice is paid; not registered for VAT; the refund and cancellation policy
(cancelling by writing to billing@verifymzansi.com); a paid slot ends for a
breach only after written notice and, for an individual, 20 business days to
remedy it; the unchanged expiry, sold and paused rules with the 3-day grace; the
free 7-day first post from its approval; and partner referral links.

### 2. Make it current and pause paid plans: `20261112173841_switch_posting_terms_v4.sql`

Owner decision of 12 November 2026: switch at once, sell nothing at the old
prices, and keep paid plans paused until the R69 checkout (roadmap P2) is built
and tested. In one transaction the update:

- takes every plan version on sale off sale (sets `retired_at`, the only
  catalogue column that may change; rows stay as history, prices are never
  edited) and records each one in the new private table
  `private.plan_sale_pauses` (row level security on, no API role access), so the
  rollback can put exactly those plans back;
- replaces `internal.set_post_media` so that a draft without a slot prepares the
  free first post's media allowance (10 photos, 1 video,
  `internal.grant_intro_trial`'s) when no plan is on sale; before, it took the
  largest allowance of the plans on sale and, with none, refused ("no current
  media allowance available"), so a free post could not add photos;
- makes `posting-v4` current. Every member accepts it once before their next
  submission or edit.

It refuses (55000) unless `posting-v4` is published with the hash above and the
current version is `posting-v3` (or already `posting-v4`). Run again, it changes
nothing and never takes off sale a plan published after the switch (the R69
plans of P2). Entitlements, payments, add-on versions (add-on sales stay paused
by the website) and the free posting paths (free first post, free events,
sponsored places, staff grants) are untouched. A plan payment already pending is
left alone: if it is paid it settles as before.

The website release that goes with it (catalogue `active_version` posting-v4)
reads what is on sale from the database: with no plan on sale the pricing,
billing, Advertise and checkout pages show the R69 prices with "Opens soon" and
"Paid slots open soon", nothing links to checkout, and the checkout route
refuses with `plan_sales_paused` (403) before it creates a payment.
Multi-listing and sponsor prices are hidden (`PACKAGES_ON_SALE`). Former
`/terms/versions/*` addresses redirect to `/terms` (308).

**Order.** The release reads the catalogue on every request, so it is correct on
either side of the switch: before it, it sells the old plans under the
posting-v3 Terms as today; after it, it sells nothing. The website deployed
before this release, however, would show its built-in old prices (R50, R140,
R250) once the database lists no plan. So:

1. merge, then apply `20261112122001_publish_posting_terms_v4.sql` (any time);
2. deploy the release;
3. then apply `20261112173841_switch_posting_terms_v4.sql`.

**Applying.** For each update, run its preflight
(`../preflight/<update>.check.sql`) unchanged in the SQL editor; it is read
only. Continue only if the result is the single "summary" row: for the first,
"current posting-v3; ...; posting-v4 not published (update not applied)"; for
the switch, "current posting-v3 (update not applied); plans on sale: 17; plans
taken off sale by the update: 0; pending plan payments: 0". Run the update (it
waits at most 5 seconds for its rows and stops without changing anything if they
are busy; run it again), then the preflight again: "posting-v4 published (update
already applied)", then "current posting-v4 (update already applied); plans on
sale: 0; plans taken off sale by the update: 17". After the switch, `/terms`
shows the new text and `/pricing` shows "Opens soon".

**Rollback.** `../rollback/20261112173841_switch_posting_terms_v4.down.sql`
restores the previous `internal.set_post_media`, makes `posting-v3` current
again, puts exactly the recorded plans back on sale (switching the catalogue
guard trigger off for that one statement) and drops the record table. It refuses
(55000) once a plan published after the switch is on sale, and when
`internal.set_post_media` is neither the body the switch installed nor the one
before it (md5 of the body): a later update (such as P2's) changed it, so undo
that update first; the rollback never silently reverts it. The switch itself
refuses the same way when the body it replaces is not the reviewed one.

Rollback order: once the switch has run, **never roll back the website alone.**
The earlier website's terms catalogue has no `posting-v4`, so with `posting-v4`
current it refuses the current terms (`assertPublishedPostingTerms` throws),
`/api/foundation/posting-terms` answers 503 and nobody can submit or edit a
post. Roll back in this order:

1. run the switch rollback above (`posting-v3` current, the old plans on sale);
2. then revert this pull request and deploy the earlier website, which sells the
   old plans under `posting-v3`.

The first update's rollback changes nothing (published terms are immutable; the
row then stays unused, like `posting-v2`) and refuses while `posting-v4` is
current. Before the switch has run, the website alone can be reverted at any
time.

**Tests.** `scripts/test-foundation-posting-terms-v4.mjs` and
`scripts/test-foundation-posting-terms-switch.mjs` (both in
`pnpm db:foundation:lifecycle-test`) prove on the throwaway database: the
shipped document's hash is the one inserted; the preflights are read only and
report each state; refusals change nothing; after the first update `posting-v3`
stays current and nobody can accept `posting-v4`; after the switch `posting-v4`
is current, no plan is on sale, the public catalogue lists none, buying an old
plan is refused, a held slot is untouched, the record table is closed to the API
roles, members accept `posting-v4` once, a re-run never retires a later plan,
neither the switch nor its rollback overwrites a later `set_post_media`, and
apply, rollback and re-apply put exactly the same plans back and return the same
schema fingerprint. The other lifecycle checks that still buy a plan after later
updates publish a copy of it first (`planOnSale` in
`scripts/lib/foundation-sql-checks.mjs`); once
`20261113002421_individual_slots_r69.sql` is applied, `planOnSale` returns the
Individual slot of the same length instead, and the browser test copy's checkout
specs buy the Individual slots.

## Staff refunds are sent to Ozow by the server, 13 November 2026

`20261113172356_ozow_api_refunds.sql` was applied on 14 November 2026. It needs
`20261113085340_retire_old_staff_reversal_commands.sql` applied and the staff
payment fixes of `20261113021223_staff_payment_fixes.sql` with their reviewed
bodies, and refuses (55000) otherwise. It only adds: no API command, argument or
grant is removed or changed, and every existing refund record keeps its meaning
(channel `manual`). The website uses the new commands only while the Worker
variable `OZOW_API_REFUNDS_ENABLED` is `"true"` and the Ozow refund key is set
(`src/lib/payments/ozow-refunds.ts`); while it is off, staff record refunds with
Ozow's reference exactly as before.

- **Refund records gain a channel and Ozow's facts.**
  `private.payment_refund_requests` gets `channel` (`manual`, `api`,
  `dashboard`), the Ozow transaction refunded, Ozow's refund id (unique), its
  status and times, and the send bookkeeping. A refund through Ozow goes
  `awaiting_approval` (above R1,000 returned on the payment, as before) ->
  `approved` -> `sent` -> `applied` (Ozow reported it complete), `failed` or
  `returned`. Its reference is `vm-refund-<record id>`, which is also the
  `Idempotency-Key` the server sends, so a retried send of the same record can
  never make a second refund at Ozow. One refund of a payment is in flight at a
  time (a unique index over waiting, approved and sent records), money in flight
  counts towards the R1,000 rule, and nothing else may reverse the payment or a
  slot while it is in flight (`internal.payment_reversal_waiting_guard`, detail
  `refund_in_flight`). The record guard
  (`internal.payment_refund_request_guard`) allows only these transitions and
  only the columns each one sets; the facts of a record (payment, slot, account,
  amount, channel, transaction, reference) never change, Ozow's refund id is set
  once and send attempts only rise.
- **Staff commands** (capability `payments:refund`, admins, recent second
  factor, own accepted ID review, never a payment of their own identity, checked
  again after the lock waits):
  `api.request_staff_ozow_refund(p_payment_id, p_line_id, p_reason_code, p_reason)`
  (a whole Ozow payment, or one open slot; no reference; PT409
  `payment_not_ozow` for a payment without an Ozow transaction id, such as a
  bank transfer, which keeps the reference form), and
  `api.record_staff_dashboard_refund(p_payment_id, p_line_id, p_reason_code, p_reason, p_ozow_refund_id, p_ozow_fact)`
  for a refund an admin already made by hand in the Ozow dashboard (Ozow's
  refund id, used once, PT409 `ozow_refund_id_used`; the same R1,000 rule; it
  takes effect as today's refunds do). `p_ozow_fact` is the refund as the server
  read it from Ozow (null only while the refund key is not set): it must name
  the same id, this payment's Ozow transaction and its amount (PT409
  `ozow_refund_mismatch`) and must not have failed (`refund_ozow_failed`). It
  only refuses: Ozow's status is stored only when the server's follow-up reads
  the refund back. New staff read
  `api.get_staff_refund_context(p_payment_id, p_line_id, p_request_id)`
  (`payments:refund`): a payment's Ozow transaction and refund amount, or a
  refund record's channel, status and whether Ozow's status was read; the
  website calls it before it asks Ozow anything for staff, and before an
  approval (a refund through Ozow is approved only while the switch is on; a
  dashboard refund, when the refund key is set, only once Ozow's status was
  read). `api.approve_staff_payment_refund` now approves a refund through Ozow
  into `approved` (the server then sends it) instead of reversing; for every
  other record it is unchanged. New staff read
  `api.get_staff_ozow_refunds(p_payment_ids)` (`payments:view`): which of up to
  50 payments can be refunded through Ozow, their API and dashboard refund
  records, and up to 20 refunds through Ozow that need staff.
- **Service commands** (`service_role` only):
  `api.claim_ozow_refund_send(p_request_id)` hands an approved record to the
  sender once (`sent`); an unknown send may be handed over again, with the same
  key, at most twice more, 30 minutes apart and within six hours (the server
  then first reads Ozow's refunds of the transaction since the first send,
  `sent_at`, and sends again only when Ozow's complete list has none that could
  be it, so a retry never relies on Ozow keeping the key); a payment that
  changed before the first send fails the record without contacting Ozow.
  `api.list_ozow_refund_sends_due(p_limit)` lists approved records not sent for
  two minutes and unknown sends due a retry (the 10-minute payment job sends up
  to two per run). `api.record_ozow_refund_send(p_request_id, p_result)` stores
  Ozow's answer: accepted (Ozow's refund id, checked against the record's
  transaction and amount), refused (only a first send fails the record; a
  refused retry only stops retries and alerts) or unknown.
  `api.apply_ozow_refund_status(p_event)` applies a refund status the server
  read back from Ozow after a signed `refund.complete` notice: only `Complete`
  reverses the payment (`internal.reverse_payment`) or the slot
  (`internal.reverse_payment_line`, the single-slot reversal without a staff
  session, audited as the approver or requester); `Failed`, `Error`, `Invalid`
  and `Cancelled` fail the record and `Returned` returns it, both with a staff
  alert; the same status twice changes nothing; an Ozow refund with no record,
  or with another transaction or amount, alerts staff.
  `api.reconcile_ozow_refunds(p_refunds)` is the daily check (05:15 UTC, the
  payment-cleanup Worker): it changes no refund and alerts staff for each Ozow
  refund in the last three days with no record, each record that differs, and
  each refund through Ozow approved or sent more than a day ago.
- **Nothing is left waiting forever.** `api.claim_ozow_refund_checks(p_limit)`
  (service) hands the 10-minute job sent refunds with no final answer after ten
  minutes (and each dashboard refund once), at most every 30 minutes each; the
  server reads them back from Ozow (by refund id, or among the transaction's
  refunds for a send whose answer was lost) and applies Ozow's status, or calls
  `api.report_ozow_refund_missing(p_request_id)` when Ozow has no such refund
  (recorded on the record, staff alerted). A lost send links only to a refund
  Ozow says was requested at most ten minutes before it was sent, and never to a
  refund id already recorded in any way (`internal.ozow_refund_link_candidate`).
  A final Ozow status is never replaced by a non-final one. New staff command
  `api.close_staff_ozow_refund(p_request_id, p_reason)` lets a staff member
  other than the requester close a refund that never reached Ozow: approved and
  never sent, or a lost send that Ozow, read more than a day after it was sent,
  does not have (`refund_not_closable` otherwise); the record fails
  (`closed_by_staff`) with the closer and reason.
- **Closing and dashboard records are guarded.** A lost send cannot be closed
  while an unmatched or mismatched Ozow refund of the payment has been seen
  since it was sent (it may be that refund). The server reports "missing" only
  when Ozow's complete list of the transaction's refunds has none requested
  after (or ten minutes before) the send and none without a request time. A
  dashboard refund that Ozow does not have or did not pay is never approved
  (`refund_ozow_failed`), dashboard refunds are read back from Ozow until Ozow
  gives a final status (30 days at most), and the daily check also alerts for a
  refund recorded as made that Ozow lists as failed or returned. One unique
  index keeps an Ozow refund recorded once, whichever way
  (`lower(coalesce(ozow_refund_id::text, ozow_reference))`, and Ozow's refund
  id), leaving out declined records, which took no effect: a dashboard record's
  reference is `<refund id>:<record id>`, so a refund id recorded on the wrong
  payment and declined can be recorded again. A later read that finds the refund
  clears an earlier "missing". A typed reference whose payment is not the one
  Ozow refunded raises `refund_mismatch`. Refunds through Ozow are read back
  before dashboard records; a dashboard record Ozow does not have is read again
  every six hours for seven days, and a waiting dashboard record whose id Ozow
  reports for another transaction or amount is marked missing too (never
  approved). The dashboard record stays available while refunds through Ozow are
  switched off, and the 10-minute follow-up and the daily check keep reading
  refunds back (never sending) whenever the refund key is set; without the key,
  a dashboard record is not read back from Ozow (accepted, noted for the owner).
- **Typed references retire for Ozow refunds.** Once the server has sent any
  refund to Ozow, a refund of an Ozow payment can no longer be recorded with a
  typed reference (PT409 `ozow_reference_retired`); chargebacks and payments
  made outside Ozow keep it, and a typed reference may never be a refund id
  already recorded.
- **Alerts.** `private.payment_problems` and `internal.record_payment_problem`
  accept the reasons `refund_failed`, `refund_returned`, `refund_unmatched`,
  `refund_stuck` and `refund_mismatch` and the sources `refund_notice`,
  `refund_check` and `refund_send`; they reach staff through the existing
  payment alert emails. The website no longer watches for a "Refunded" payment
  status (`refunded_after_completion`), which never fires because Ozow keeps a
  refunded payment "Complete".

**Order: apply, then merge.** Apply after
`20261113085340_retire_old_staff_reversal_commands.sql` and before the pull
request that uses it is merged. The read-only preflight
`../preflight/20261113172356_ozow_api_refunds.check.sql` must read "update not
applied" with no problem row before, and "already applied" after. The rollback
`../rollback/20261113172356_ozow_api_refunds.down.sql` refuses once a refund
through Ozow or from the dashboard was recorded or a refund problem was raised.
`scripts/test-foundation-ozow-api-refunds.mjs`
(`pnpm db:foundation:lifecycle-test`) proves the preflight, the refusal, apply
-> rollback -> apply and the rules above on the replayed schema, standing in for
Ozow.

## Staff fix paid but not delivered, and refunds with Ozow's reference, 13 November 2026

`20261113021223_staff_payment_fixes.sql` is not applied yet. It needs
`20261113002421_individual_slots_r69.sql` with its reviewed bodies and refuses
(55000) without them. It only adds: no existing command, argument, grant or
function body changes (roadmap M3.4, with the receipt read for M3.7).

- **Paid but not delivered, on the staff list.** New staff read
  `api.get_staff_payment_list(p_page, p_filter)` (capability `payments:view`):
  each payment with its delivery status (`fulfillment_status`), product kind,
  merchant reference, slot lines, the refund waiting for approval (and whether
  the caller's identity recorded it) and when staff activated it. The filter
  takes a payment status, `needs_attention` (complete and
  `needs_reconciliation`: the money arrived and nothing was delivered) or
  `awaiting_approval`; both counts come with every page.
  `api.get_frontend_staff_payments` stays for the release before this one.
- **Activate what was paid for.** New staff command
  `api.activate_staff_paid_payment(p_payment_id, p_reason)` (capability
  `payments:refund`, recent second factor): only a complete,
  `needs_reconciliation` payment of an account with current access. A plan: one
  entitlement per open slot line, refused (PT429) when the person would hold
  more Individual slots than their limit; a plan payment without lines: one
  entitlement; an add-on: its window, refused (PT409) unless the post can still
  carry it. The payment becomes fulfilled, a row goes to
  `private.payment_activations` (immutable) and to the staff audit trail, and
  the partner commission the purchase earns is created here
  (`internal.payment_delivery_commission`, the same rule as the commission
  trigger, which fires only on a status change and activation leaves the status
  `complete`). A repeat by the same staff member with the same reason returns
  the result; anything else is refused.
- **Refunds and chargebacks need Ozow's reference and a reason code.** New staff
  commands
  `api.record_staff_payment_refund(p_payment_id, p_kind, p_reason_code, p_reason, p_ozow_reference)`
  (whole payment) and `api.record_staff_slot_refund(p_line_id, ...)` (one slot
  of an order). Without a reference (22023 `ozow_reference_required`), or with
  one that is not 4 to 100 letters, digits or `. _ : / -`, or already recorded
  (PT409; references are compared without letter case), nothing is recorded.
  Reason codes: `billing_error`, `duplicate`, `our_failure_after_fix_offered`,
  `s14_cancellation`, `breach_credit`. The amount is always the payment's or the
  slot's own, and the record names the account that paid (a trigger refuses
  anything else). **When the money returned on the payment would exceed R1,000**
  (100,000 cents: every applied or waiting refund and chargeback record, slots
  reversed earlier, and this one), the record is stored as waiting and changes
  nothing until a second staff member approves it
  (`api.approve_staff_payment_refund(p_request_id)`: never the requester or
  another account of the requester's identity, checked again after the lock
  waits), so a large refund cannot be split slot by slot. Chargebacks follow the
  same rule while `internal.chargebacks_need_approval()` returns true (the safe
  default until the owner decides; one function to change). Any staff member
  with the capability can decline a waiting record with a reason, the requester
  included (`api.decline_staff_payment_refund`). A payment with a refund waiting
  accepts no other refund and cannot be activated, and **nothing else reverses
  it**: new triggers `payments_refund_waiting` and
  `payment_lines_refund_waiting` refuse (PT409 `refund_awaiting_approval`) any
  reversal of that payment or its slots, including the earlier staff commands
  and the service's `api.reverse_payment`. The approval marks the record applied
  before it reverses, in one transaction (a failed reversal leaves it waiting).
  An approval that finds the payment changed (for example after an owner SQL
  fix) refuses with PT409 `refund_payment_changed`; the record can still be
  declined. A refund record needs approval exactly when the total exceeds R1,000
  (a constraint); for chargebacks the constraint only allows approval above that
  amount, because the switch must not live in a constraint. Records are kept in
  `private.payment_refund_requests` (immutable except for the one approval or
  decline) and listed in the staff audit trail. The earlier
  `api.record_frontend_staff_payment_reversal` and
  `api.record_staff_slot_reversal` stay until a later contract step; the website
  release in the same pull request no longer calls them.
- **Staff never act for themselves.** Every new staff command needs a current
  (not ended) accepted ID review of the staff member's own and refuses a payment
  of their own identity, compared over every fingerprint either account has had
  (`internal.assert_staff_payment_actor`), before the lock waits and again after
  the last authority check.
- **Audit trail.** `private.frontend_staff_audit_events` also lists activations
  (`payment:activated`), recorded, approved and declined refunds and every
  single-slot reversal (`payment:slot_refunded`, also those recorded with
  `api.record_staff_slot_reversal`).
- **Receipt read.** New service read `api.get_payment_receipt(p_payment_id)`:
  one payment's amount, currency, completion time, product kind, label, slot
  count, statuses, merchant reference, Ozow transaction id and invoice number,
  description and issue time, with its owner id; null for an unknown payment.
  Only `service_role` may call it (for the receipt email of M3.7).

**Order: apply first, then merge.** The website release from the same pull
request calls the new commands and the deploy preflight probes every command in
`../runtime-api-manifest.json`, so a deploy without the update stops there.
Earlier releases do not use them and keep working with the update applied.

**Applying.**

1. Run `../preflight/20261113021223_staff_payment_fixes.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "staff payment fixes: update not applied (apply before
   the website release that uses it is deployed); paid but not delivered: N;
   refunds waiting for approval: none (table absent)".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "staff payment fixes: already applied; ...; refunds
   waiting for approval: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261113021223_staff_payment_fixes.down.sql` (only with the owner's
decision; prefer a forward fix). Revert and deploy the website release first:
the rollback removes the commands that release calls. It refuses once a payment
was activated or a refund recorded with the new commands (those are audit
records); otherwise it puts back the earlier staff audit view and drops the
update's functions, its triggers (also the two on payments and payment lines)
and two tables.

`node --import tsx scripts/test-foundation-staff-payment-fixes.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals without the reviewed slot
bodies and with a drifted table; apply, rollback and re-apply return the same
fingerprints; a payment completed at the bank after its checkout was cancelled
is listed under "needs attention" and activated by staff (two slots, an audit
row, two commissions matching the trigger's), seen by the member in "My slots";
the refusals (a member, a moderator, staff without their own ID review, staff of
the same identity, over the slot limit, an already delivered payment, an add-on
whose post ended); refunds without a reference, with a bad one, with an unknown
reason code, a reused reference (also in other letter case), staff whose only
review has ended; a R69 refund and a small chargeback at once, a R1,656
chargeback and a R1,656 refund that wait, refused to its requester and to
another account of the requester's identity, approved by a second admin, and a
declined one recorded again; one slot of three refunded alone and the whole
order refused after it; a refund split slot by slot (the third R414 slot waits
after two went through); the earlier whole-payment and slot commands and the
service reversal refused while a refund waits, an approval after the payment
changed refused with `refund_payment_changed` and the record still declined;
activation refused while a refund waits; an approval racing the earlier commands
(the money goes back once); a table with this update's columns but not its
constraints refused; the account and amount rule; the receipt read against the
invoice (a two-slot order and an add-on) and its service-only grant; the grants;
and that the rollback refuses once the commands were used.

## Earlier staff reversal commands retired, 13 November 2026

`20261113085340_retire_old_staff_reversal_commands.sql` is not applied yet. It
is the contract step of `20261113021223_staff_payment_fixes.sql` (applied 13
November 2026, pull request 213), recorded in `../contract-steps.json`, and
refuses (55000) unless that update's replacement commands are present with their
reviewed bodies.

- **Removed.** The earlier staff commands
  `api.record_frontend_staff_payment_reversal(p_id, p_kind, p_reason)`,
  `api.record_staff_slot_reversal(p_line_id, p_kind, p_reason)` and
  `api.get_frontend_staff_payments(p_page, p_status)` are dropped. They could
  still reverse a whole payment or one slot without Ozow's reference or a reason
  code whenever no refund was waiting for approval. The website has called only
  the replacements since pull request 213: `api.record_staff_payment_refund`,
  `api.record_staff_slot_refund`, `api.get_staff_payment_list`,
  `api.approve_staff_payment_refund`, `api.decline_staff_payment_refund` and
  `api.activate_staff_paid_payment`. Every API command keeps exactly one
  audience (`../runtime-api-manifest.json` and the native access matrix require
  it), so a command nobody may call is removed rather than left without a grant.
- **Closed.** The internal functions behind them
  (`internal.record_frontend_staff_payment_reversal`,
  `internal.get_frontend_staff_payments` and
  `internal.record_staff_slot_reversal`) lose their execute grant to
  `authenticated`. The single-slot step stays: the slot refund and the approval
  call it through internal functions that run as their owner. No function body
  and no data change; the service's `api.reverse_payment` is unchanged.

**Order: merge, then apply.** No website release calls the three commands, and
the release from this pull request no longer lists them in its runtime manifest.
Applied before the merge, the deploy preflight of any other release in between
would find them missing.

**Applying.**

1. Run
   `../preflight/20261113085340_retire_old_staff_reversal_commands.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "retire old staff reversal commands: update
   not applied; refunds waiting for approval: N".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "retire old staff reversal commands: already applied;
   refunds waiting for approval: N" with the same N.
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261113085340_retire_old_staff_reversal_commands.down.sql` (only
with the owner's decision; prefer a forward fix). It puts back the three
commands exactly as they were and the internal grants, and changes no data.

`node --import tsx scripts/test-foundation-retire-old-staff-reversals.mjs` (part
of `pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusal without the replacement
commands' reviewed bodies and with a changed earlier wrapper, changing nothing;
that afterwards staff cannot call the three commands or the internal functions
behind them, while a slot refund and an approved refund still reverse one slot
through the retained internal step; and that apply, rollback and re-apply return
the same fingerprints.

## Communication choices and Terms accepted at sign-up, 13 November 2026

`20261113134500_communication_choices_and_signup_terms.sql` was applied on 13
November 2026 (roadmap M1.7, finding SEC-09). It needs the reviewed member check
`internal.price_draft_actor()` and refuses (55000) without it. It only adds: no
existing command, argument, grant, table or function body changes.

- **Communication choices are saved, with their history.** New table
  `private.communication_choice_events`: one row each time a member turns an
  optional choice on or off (`marketing_email`, `marketing_sms`, `analytics`,
  `third_party_sharing`), with the version of the switch wording the member saw
  (`wording_version`, set by the website: `communication-2026-11`) and the time.
  Rows never change and are deleted only with the Auth user or by the retention
  job (`vm.retention`), never one by one (trigger
  `communication_choice_events_immutable`). The current choice is the latest row
  of its purpose; with none it is off, so everything optional starts off
  (opt-in) and turning a choice off is as easy as turning it on.
- **Member commands.** `api.get_my_communication_choices()` and
  `api.save_my_communication_choices(p_wording, p_marketing_email, p_marketing_sms, p_analytics, p_third_party_sharing)`
  (a null choice stays as it is; at least one is needed, 22023
  `choice_invalid`). Only a real change adds a row, so repeating a save adds
  nothing. Reading and turning a choice off need only a signed-in, confirmed,
  not deleted account with a live session (new `internal.consent_actor()`), so a
  restricted member can still withdraw, and withdrawals are never limited.
  Turning a choice on also needs an active account
  (`internal.price_draft_actor()`) and is limited to 20 a day per account (PT429
  `choice_limit`). Each account only ever reaches its own choices.
- **Email history.** `api.list_my_email_history(p_limit)` (1 to 50, default 20):
  the caller's own finished account emails from `private.outbox_events`, sent,
  or failed for good after the email job's 8 attempts, with the message kind and
  time; never the address, the record it was about or the provider's error. New
  index `outbox_owner_history_idx` (owner, newest first).
- **Terms accepted at sign-up.** New table `private.signup_terms_acceptances`
  (one row per account, never changed): the version and document hash of the
  current Terms (`private.posting_terms_current`, the single set shown at
  `/terms`), how (`email_form` or `google`) and when. New trigger
  `record_signup_terms` on `auth.users` fills it as the Auth user is created:
  `email_form` when the website's sign-up form, whose Terms box must be ticked,
  sent the sign-up detail `terms_accepted: true`; `google` for a Google sign-up,
  whose button says that continuing accepts the Terms. The version is always
  read in the database, never taken from the sign-up details. Anonymous users,
  other sign-ups and accounts created before the update get no row; the trigger
  never refuses a sign-up. `email_form` means the sign-up said the box was
  ticked: someone signing up straight at Auth can claim it for their own new
  account only. A repeated sign-up of an address Auth already holds (not yet
  confirmed) creates no user, so it keeps the first sign-up's record, or none.
  The acceptance asked for before a first post
  (`private.posting_terms_acceptances`) is separate and unchanged.

Both tables are closed to every API role. Not yet included (needed before public
sign-up): the privacy export (`internal.frontend_privacy_export_data`, whose
dataset count the website checks), a staff read of a member's recorded Terms,
and the closed-account retention sweep; both tables are kept, like the profile,
until the Auth user is deleted. An email the job finished without a recipient
(an unconfirmed address at the time) also shows as sent.

**Order: apply first, then merge.** The website release from the same pull
request calls the three new commands and the deploy preflight probes every
command in `../runtime-api-manifest.json`, so a deploy without the update stops
there. Earlier releases do not use them and keep working with the update
applied; sign-ups through them record their Terms too (the form already sends
the ticked box only from that release on, so earlier releases record Google
sign-ups only).

**Applying.**

1. Run
   `../preflight/20261113134500_communication_choices_and_signup_terms.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "communication choices and signup terms:
   update not applied; current terms: posting-v4".
2. Run the update. It waits at most 5 seconds for any lock (it adds a trigger to
   `auth.users` and an index to `private.outbox_events`). Run the preflight
   again: it must read "communication choices and signup terms: already applied;
   current terms: posting-v4; choice changes recorded: 0; sign-up acceptances
   recorded: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261113134500_communication_choices_and_signup_terms.down.sql`
(only with the owner's decision; prefer a forward fix). Revert and deploy the
website release first: the rollback removes the commands that release calls. It
deletes both tables, which are the record of what members agreed to: export them
first, as the file says.

`node --import tsx scripts/test-foundation-communication-choices.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; refusals for a drifted command, member
check or table, and a premature rollback, changing nothing; accounts made before
the update get no acceptance; the website form and Google sign-ups record the
current version (never one named in the sign-up details); no row without the
ticked box (also `"true"` as text) or for anonymous users; rows never change,
are not deleted one by one and go with the Auth user (or the retention job); no
API role reads or writes either table; choices start off, save only for the
caller, add a row only on a change, record the wording version, and the latest
row decides; invalid saves record nothing; the limit of 20 choices turned on a
day (also two with one place left), while turning off stays possible at the
limit; a restricted member reads and withdraws but cannot opt in, and a deleted
one is refused; anon, `service_role`, an ended session, an anonymous claim and
an unconfirmed email are refused; the email history lists only the caller's sent
and failed emails (not a last attempt still running or of unknown outcome), with
exactly id, kind, status and time; the grants and owners; and that apply,
rollback and re-apply return the same fingerprints.

## Staff record a cleared bank transfer; a second staff member confirms it, 13 November 2026

`20261113162457_staff_invoice_payments.sql` was applied on 13 November 2026. It
needs `20261113021223_staff_payment_fixes.sql` and the Individual slot rules
with their reviewed bodies and refuses (55000) without them, or when the payment
rules, its new table or the new capability differ from the reviewed ones
(roadmap P2b, first slice; the manual fallback to the Ozow payment link that a
later slice puts on each invoice). It only adds: no API command, argument or
grant is removed or changed.

- **A payment can be a bank transfer.** `private.payments` accepts the provider
  `invoice` besides `ozow`. A complete invoice payment has no Ozow transaction
  id (`payments_check1` changed for that case only), and the new constraint
  `payments_invoice_without_ozow` refuses Ozow's request, transaction and
  checkout fields on it. Ozow payments meet every rule unchanged.
- **Record (first person).** New staff command
  `api.record_staff_invoice_payment(p_account_email, p_term_days, p_slots, p_amount_cents, p_bank_reference, p_cleared_on, p_cooling_off_waiver, p_reason)`
  (capability `payments:refund`, recent second factor), used only after the
  money has cleared. It needs a confirmed account with current access and an
  accepted ID review (PT404 `invoice_account_unavailable`, PT409
  `payment_account_unavailable`, PT412 `invoice_buyer_unverified`), the
  Individual slot on sale for 30, 90 or 180 days (PT409
  `invoice_plan_unavailable`), 1 to 25 slots within the person's slot limit
  (PT429 `slot_limit_reached`), the amount received equal to the order total
  (PT428 `invoice_amount_mismatch`) and at most R50,000 (PT413
  `invoice_amount_above_limit`), a date the money cleared from 90 days ago to
  today (`cleared_date_invalid`), the staff member's confirmation that the
  customer agreed in writing to the cooling-off waiver
  (`cooling_off_waiver_required`), a bank reference of 4 to 60 letters, digits,
  spaces or `. _ : / -` and an audit reason. It stores a row in the new table
  `private.invoice_transfers` as `awaiting_confirmation`. **Nothing else
  happens**: no payment, slot, invoice, receipt email or commission.
- **Confirm (second person).** New capability `payments:confirm_transfer` (admin
  only, recent second factor) and staff command
  `api.confirm_staff_invoice_payment(p_transfer_id)`. Never the recorder or
  another account of the recorder's identity (42501 `transfer_confirmer_same`),
  never the customer or a partner who referred the customer
  (`staff_referred_customer`), with the staff member's own current accepted ID
  review; every check runs again after the lock waits (bank reference, then the
  person, then the row). It refuses when the recorder no longer holds
  `payments:refund` (PT409 `transfer_recorder_inactive`) or has since come to
  refer the customer, and rechecks the customer's access, ID review and slot
  limit, counting checkouts still open at Ozow. Only then it records a complete,
  fulfilled payment with provider `invoice` on the recorded plan version, one
  line and one slot per slot starting now, its invoice, the `payment_completed`
  outbox event (the receipt email of M3.7) and the partner commission
  (`internal.payment_delivery_commission`, the rule of the commission trigger),
  exactly as a confirmed Ozow payment of the same order, and marks the record
  `confirmed`.
- **Decline.** `api.decline_staff_invoice_payment(p_transfer_id, p_reason)`
  (same capability and checks; the recorder may withdraw their own record) marks
  a waiting record `declined` with the reason. Nothing is paid.
- **One record per bank reference, ever.** References are compared on their
  letters and digits only, whatever the case, spaces or punctuation (a unique
  index), across waiting, confirmed and declined records: the safest rule, so a
  declined reference can never be recorded again (a transfer recorded with wrong
  details is declined, and the owner decides how to correct it; see the pull
  request). The command serialises on the reference before reading it. The same
  request again by the same staff member returns the first record with
  `repeated: true` (and its status); anything else with that reference is
  refused (PT409 `bank_reference_used`). A declined record cannot be confirmed
  and a confirmed one cannot be declined (PT409 `transfer_not_waiting`); the
  same confirmer or decliner repeating returns the result.
- **The record.** `private.invoice_transfers` keeps the customer, plan version,
  slots, amount, bank reference, date cleared, the waiver confirmation, the
  reason, who recorded it and when, then who confirmed or declined it and when
  (and the payment, or the decline reason). Rows are never removed and change
  only once, from waiting to confirmed (naming its own complete invoice payment:
  that account, amount, plan, slots and record) or to declined (trigger); the
  recorder is never the customer and the confirmer never the recorder or the
  customer (constraints).
- **Reads.** `api.get_staff_invoice_customer(p_account_email)`
  (`payments:refund`) shows whose account an email names before recording
  (public name, ID review, slots held, limit).
  `api.get_staff_invoice_transfers()` (`payments:view`) lists the waiting
  records with the customer's account email (to match the bank statement) and
  how many other waiting or confirmed records name the same customer, amount and
  date (a possible duplicate under another reference).
  `api.get_staff_invoice_payments(p_payment_ids)` (`payments:view`) gives the
  bank transfer details of listed payments, so `api.get_staff_payment_list`
  stays unchanged. The staff audit trail lists `payment:invoice_recorded`,
  `payment:invoice_confirmed` and `payment:invoice_declined`.
- **Receipt read.** `api.get_payment_receipt` also returns `payment_method`
  (`ozow` or `invoice`) and, for a bank transfer, `bank_reference`, which the
  receipt email shows instead of the Ozow reference.
- **Refunds.** The existing staff refund commands work on a confirmed invoice
  payment unchanged: whole payment, one slot, a second approver above R1,000,
  the commission reversed. The reference they need is that of the transfer back
  to the customer.
- **Dates.** The payment, its invoice and the receipt carry the confirmation
  time; the date the money cleared is kept in the record and in the payment
  snapshot (`cleared_on`).

**Order: apply first, then merge.** The website release from the same pull
request calls the new commands and the deploy preflight probes every command in
`../runtime-api-manifest.json`, so a deploy without the update stops there.
Earlier releases do not call them and keep working with the update applied
(`api.get_staff_payment_list` is unchanged; the receipt read only gains fields).
It is recorded after
`20261113134500_communication_choices_and_signup_terms.sql`.

**Applying.**

1. Run `../preflight/20261113162457_staff_invoice_payments.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "staff invoice payments: update not applied (apply
   before the website release that uses it is deployed); bank transfers waiting
   for confirmation: none (table absent); payments confirmed from a bank
   transfer: 0".
2. Run the update. It waits at most 5 seconds for any lock (it briefly locks
   `private.payments` to change its rules). Run the preflight again: it must
   read "staff invoice payments: already applied; bank transfers waiting for
   confirmation: 0; payments confirmed from a bank transfer: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261113162457_staff_invoice_payments.down.sql` (only with the
owner's decision; prefer a forward fix). Revert and deploy the website release
first: the rollback removes the commands that release calls. It refuses once a
bank transfer was recorded (waiting, confirmed or declined: payment and audit
records); otherwise it puts back the receipt read, the staff audit view and the
payment rules of `20261113021223_staff_payment_fixes.sql`, removes the
capability and drops the update's functions and table.

`node --import tsx scripts/test-foundation-staff-invoice-payments.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals without the reviewed bodies,
with a drifted table, payment rule or capability, changing nothing; apply,
rollback and re-apply return the same fingerprints; a recorded transfer waits
and starts nothing (no payment, slot, commission or receipt event); the
recorder, another account of the recorder's identity, a moderator, the customer
and staff without their own ID review cannot confirm it; another admin's
confirmation gives the same lines, slots, invoice, receipt event and partner
commissions as an Ozow payment of the same order, with both audit rows; repeats
of the record (also with the reference written differently) and of the
confirmation return the first result, while another staff member, order,
customer, date or reason with that reference is refused; a declined record
cannot be confirmed, its decline repeats, its reference is never recorded again,
and a recorder may withdraw; a confirmed record cannot be declined; the reads
and the receipt (also for an Ozow payment); every refusal records nothing; the
slot limit at recording and again at confirmation (an open Ozow checkout
counts); a recorder who lost the role or came to refer the customer blocks
confirmation; a possible duplicate under another reference is flagged; staff who
referred the customer can neither record nor confirm; two staff recording the
same transfer at once give one record, and a decline racing a confirmation is
refused; the refund commands on a confirmed payment (one slot, a whole order, a
second approver above R1,000); the record and payment rules; the grants; and
that the rollback refuses once a transfer was recorded.

The bank reference rule, the refund reference of a bank transfer, the receipt
date and the privacy export were changed afterwards by
`20261113223806_bank_transfer_and_consent_fixes.sql` (next section).

## Bank transfer and consent fixes, 13 November 2026

`20261113223806_bank_transfer_and_consent_fixes.sql` was applied on 14 November
2026 at 02:35 UTC with the owner's approval. It fixes review findings in
`20261113162457_staff_invoice_payments.sql` and
`20261113134500_communication_choices_and_signup_terms.sql`, needs both (and the
refund commands of `20261113085340`) with their reviewed bodies and refuses
(55000) otherwise. It does not depend on `20261113172356_ozow_api_refunds.sql`
(pull request #221) and changes nothing that update changes. No API command,
argument, return type or grant changes.

- **A bank credit is recorded once; a declined record frees it.** Before, a bank
  reference was used once across every record, declined ones included, so a
  reference declined by mistake could never be recorded again (although staff
  are told to "decline it and record it again"), and two customers using a
  common reference ("VerifyMzansi", a name) could not both be recorded. Now one
  bank credit is its reference (letters and digits, whatever the case, spaces or
  punctuation), the amount and the date it cleared: among the waiting and
  confirmed records that combination is unique (the partial unique index
  `invoice_transfers_open_reference_idx` replaces
  `invoice_transfers_reference_idx`). The same credit can never wait or be
  confirmed twice, for any customer; a declined record's reference can be
  recorded again; the same reference may be recorded for another amount or day.
  Two genuine transfers with the same reference, amount and day are refused
  (PT409 `bank_reference_used`), the safe side. The one case the index no longer
  stops is the same credit recorded again with a wrongly typed date, so the
  confirmer's "Possible duplicate" count (`similar_records`) now counts the
  other waiting or confirmed records with the same reference and amount (any
  customer or date), besides those of the same customer, amount and date under
  another reference. Two-person confirmation and the repeat of the same request
  by the same staff member are unchanged. Owner's choice: the stricter
  alternative is the reference alone unique among waiting and confirmed records
  (no wrong date can pass, but a common reference is refused for every second
  customer).
- **Bank refund references may have spaces.** For a payment made by bank
  transfer, the refund (or chargeback) reference may hold single spaces (4 to
  100 letters, digits, spaces or `. _ : / -`, at least four letters or digits;
  runs of spaces are stored as one); its refusals are
  `refund_reference_required`, `refund_reference_invalid` and
  `refund_reference_used` and never mention Ozow. Ozow references keep exactly
  their rules and messages. The check
  `payment_refund_requests_ozow_reference_check` accepts single inner spaces and
  the new trigger `payment_refund_requests_reference_rule` refuses a reference
  with a space unless the payment was made by bank transfer.
- **Receipt date.** `api.get_payment_receipt` also returns `cleared_on` for a
  bank transfer; the receipt email shows it as "Date paid" instead of the time
  of the second staff member's confirmation. The payment's `completed_at`, its
  slots and invoice are unchanged.
- **Privacy export.** It also holds `communication_choices` (each change, with
  its wording version and time), `signup_terms` (version, document hash, method,
  time) and `bank_transfers` (the member's own records: amount, slots, term,
  reference, dates, the waiver confirmation and the outcome; never which staff
  member handled it, nor staff notes, as for the other payment records).
- **Retention (lawyer to confirm).** The retention job now deletes the sign-up
  Terms acceptance and the communication choice history of a closed account 30
  days after closure, with its posting-terms acceptances and under the same
  legal-hold exception, so the three consent records are kept and deleted alike.
  Before, the two newer ones stayed until the Auth user was deleted. Each batch
  now takes only closed accounts that still hold such rows (also for the home
  area and posting-terms deletes), so the sweep cannot stall behind accounts it
  already cleared. Recorded bank transfers are payment records and are never
  purged. If the owner's lawyer wants consent proof kept longer, change all
  three in one later update.
- **Email history.** `api.list_my_email_history` needs only a signed-in,
  confirmed account with a live session (`internal.consent_actor`), like reading
  and withdrawing communication choices, so a restricted member can read it.

**Order: apply first, then deploy.** The website release from the same pull
request works with or without it (before it, a bank refund reference with a
space is refused as before and the receipt shows the confirmation date). Record
it after `20261113172356_ozow_api_refunds.sql` if that is applied first.

**Applying.**

1. Run `../preflight/20261113223806_bank_transfer_and_consent_fixes.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row starting "bank transfer and consent fixes: update
   not applied".
2. Run the update. It waits at most 5 seconds for any lock (it briefly locks
   `private.invoice_transfers` and `private.payment_refund_requests`). Run the
   preflight again: it must start "bank transfer and consent fixes: already
   applied".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261113223806_bank_transfer_and_consent_fixes.down.sql` (only with
the owner's decision; prefer a forward fix). It refuses once a bank reference is
recorded more than once or a refund reference holds a space (the preflight
counts both), because the earlier rules would refuse those records; otherwise it
puts back every earlier body, index and check and drops what the update added.
Consent records the retention job deleted stay deleted.

`node --import tsx scripts/test-foundation-bank-transfer-consent-fixes.mjs`
(part of `pnpm db:foundation:lifecycle-test`) proves on the throwaway database:
the preflight before and after, read only; the refusals with a drifted body or
index, changing nothing; apply, rollback and re-apply return the same
fingerprints; a declined reference can be recorded again, while a waiting or
confirmed one cannot (also written differently, by another staff member or for
another customer); a common reference is recorded for two customers with
different amounts or days and the confirmer sees the same reference and amount;
two staff recording the same credit at once give one record; a bank refund
reference with spaces is accepted and an Ozow one is refused with the Ozow
message; the receipt read's cleared date, and a refunded payment reads as
refunded; the privacy export holds the three new datasets of the member only;
the retention job deletes the three consent records 30 days after closure and
keeps them under a legal hold or before; a restricted member reads their email
history; and that the rollback refuses once the new rules were used.

## Renew early and renewal reminders, 14 November 2026

`20261114093742_renew_slots_early.sql` was applied on 14 November 2026 at 14:35
UTC with the owner's approval (roadmap P3, with the owner's renewal rule of 14
November 2026). It needs `20261114041000_customer_invoice_pay_now.sql` and the
slot, payment, post and mail bodies it builds on with their reviewed bodies, and
refuses (55000) otherwise (the two post funding views it replaces are checked by
an md5 of each whole definition, so a view changed in any other way is refused,
not overwritten). It only adds: no API command, argument or grant is removed or
changed.

- **A renewal is a new grant of the same slot.** `private.payment_lines` gains
  `renews_entitlement_id` (the slot a line renews, chosen at checkout).
  `private.entitlements` gains `renews_entitlement_id` (the grant a renewal
  follows) and `slot_id` (the slot's first grant), with foreign keys, the check
  `entitlements_renewal_link` and a unique index so that at most one active
  renewal follows a grant. Issued grants are never edited.
- **Renewing.** New member command
  `api.start_slot_renewal_checkout(p_entitlement_ids, p_plan_id, p_expected_total_cents, p_cooling_off_consent)`:
  one payment with one line per slot ("Renew all": up to 25 slots, each once,
  22023 otherwise) for 30, 90 or 180 days. Only the member's own Individual
  slots that are still held can be renewed; another account's slot, an ended
  slot, a free first post, a staff grant or a sponsored place reads as not found
  (PT404 `slot_unavailable`). Renewing opens 14 days before the slot ends
  (`internal.slot_renewal_window()`, the one setting; earlier: PT409
  `renewal_not_open`). It needs an accepted ID review (PT412), the renewal's own
  consent (22023; never the new-slot "starts now" wording: the payment's
  snapshot keeps the wording `renewal-cooling-off-v1`, its time and each slot's
  start date), the total the member was shown (PT428) and at most R10,000 for
  the total (PT413, larger by invoice). A renewal never adds a slot, but the
  slots renewed ahead (queued renewals and renewals in payments still open at
  Ozow) may not exceed the person's limit (PT429), so a person over their limit
  after a staff-raised limit ended renews at most as many slots as the limit,
  and while a raised limit runs at most the standard limit (4) of renewals may
  start at or after it ends (`internal.individual_renewals_allowed`, rechecked
  at delivery). Only one order per term can be pending
  (`payments_one_pending_idx`): a renewal of the same slots for the same term is
  continued; another order for that term or another renewal naming the same
  slots is cancelled when it was never sent to Ozow and otherwise returned with
  `renewal` (continue, check or cancel it). `api.start_slot_checkout` (full
  body) never reuses a renewal as an order of new slots.
- **Delivery.** `internal.apply_provider_event` (full body, from
  `20261114041000` with its invoice condition) and
  `internal.activate_staff_paid_payment` (full body) issue lines through the new
  `internal.issue_slot_line_entitlements`: a new slot starts at payment; a
  renewal starts exactly when the slot's last active period ends (at payment if
  that has already passed). `internal.individual_slots_counted` (full body)
  counts each slot once over all its periods; open payments count only lines
  that would add a slot; a renewal of a held slot is delivered even to a person
  now over their limit, as long as the slots renewed ahead stay within it; a
  renewal whose slot ended or was refunded meanwhile counts as a new slot.
- **Posts stay live across the boundary, decided at read time.** A paid post is
  funded while its own period runs or, once that has ended, while a period of
  the same slot that follows on from it without a break runs
  (`internal.slot_grant_usable` over `internal.slot_chain_end`). The public view
  `private.public_eligible_posts` (search, post page, phone reveal, enquiries),
  `private.frontend_restorable_posts` (hold release), `internal.post_funding`
  (edits, moderation, reactivation), `internal.entitlement_for_post_eligible`
  (the activation a post keeps) and `internal.set_post_media` (full bodies) use
  it, so a renewed post stays public, reachable and editable before any job
  runs; an event keeps its own end date. Confirming a renewal writes no post (so
  no post check can stop a payment): it moves only the slot's search documents
  to the end of the renewal (`internal.refresh_slot_chain_documents`, locking
  grants then documents as a reversal does); a renewal revoked by a refund or
  chargeback moves them back (trigger `entitlements_slot_chain_revoked`).
  `internal.run_post_lifecycle` (full body) does not expire a post whose end
  date passed while its slot runs on (its end date catches up) and expires one
  whose slot run ended early; `internal.release_frontend_content_hold` (full
  body) first brings a held post's end date up to its slot's run, so a post held
  across the boundary is restored with its days. The 3-day grace after expiry
  therefore starts only when the last renewal ends. The new service sweep
  `api.run_slot_renewals(p_limit)` (in the website's operation job, every
  minute) only tidies up: it moves posts that can move into the next period (the
  old activation released as `entitlement_ended`, the new one marked `continued`
  in the new column `private.post_activations.continued`), and picks only those,
  so posts that cannot move never crowd them out. `internal.activate_post` (full
  body) counts a slot's posts over all its periods (a post waiting to move still
  fills the slot) and the 4 posts going live per rolling 30 days over the slot's
  whole renewal chain (a renewal does not restart the count; a continued
  activation is not a post going live); so do `internal.my_posting_capacity`,
  `internal.get_my_frontend_posting_allowance_v2` and
  `internal.get_my_frontend_post_manager` (full bodies, through the new
  `internal.slot_posts_held` and `internal.slot_posts_started`), so a place is
  never shown free while a post waits to move into it.
- **Every end date a post shows is the end of its slot's run**
  (`internal.post_shown_until`, the same `internal.slot_chain_end` as its
  funding; an event keeps its own end date): the search document
  (`internal.write_post_projection`, full body, so an edit approved, moderation
  or any other rewrite before the boundary keeps the renewed end), the post page
  (`internal.get_public_post`), My posts (`internal.list_my_posts`), the owner's
  post (`internal.frontend_owner_post`) and the dashboard
  (`internal.restored_owner_dashboard`, active and ending-soon listings), full
  bodies.
- **Cost.** The funding views compare the period's own dates first and follow
  the slot only once the period has ended. The lifecycle job reads by date only:
  posts whose own end date has passed (new partial index
  `posts_paid_run_due_idx`) and visible search documents whose end has passed
  (`post_search_documents_due_idx`; a revoked renewal moves it back before the
  post's own end date). The sweep reads the renewals that have not ended
  (`entitlements_renewals_current_idx`) and the reminders the grants ending
  within 3 days (`entitlements_active_ends_idx`). Measured on 20,000 live posts
  in the pull request.
- **Refunds.** A member who asks to cancel a renewal before it starts gets a
  full refund: staff record the one-slot refund with the existing commands (the
  full line amount), which withdraws the queued grant, reverses that line's
  commission and moves the slot's search documents back. A chargeback or refund
  of the current period leaves a queued renewal with the dates it was sold for
  (the slot then has a gap until the renewal starts).
- **Reminders.** The sweep queues one email (new outbox kind
  `slot_renewal_reminder`, keyed by the ending grant, so at most one per slot
  end however often the job runs) for each ending grant the member can renew
  (`internal.slot_renewal_due`: today Individual slots, interim ones included;
  Multi-listing packages are added there later, G5) that ends within 3 days with
  no renewal following it, while the account can still buy.
  `internal.claim_supported_notification_outbox` (full body) gives it a
  recipient only for a confirmed, non-anonymous address and only while the slot
  still ends unrenewed (otherwise the message is finished without a send), with
  `slot_ends_at`, `renewal_kind` and `slot_renew_all` (more than one slot ends
  unrenewed within 7 days, so the email links to "Renew all"). The claim takes
  up to 21 kinds, each once (a repeated kind is refused, as a list that was too
  long was before). It is a service notice about the member's own paid slot: the
  optional marketing choices do not apply. The job never starts a payment.
- **My slots.** New member read `api.get_my_slots_v2()`: `api.get_my_slots`
  plus, per slot, `renewable` and `renew_opens_at`, `renewed_until` and the
  queued `renewals`; a period that ended because the next one followed on is not
  listed again, a renewal waiting to start is listed (state `upcoming`) when its
  slot has no current period, and `individual.renewed_ahead`. `api.get_my_slots`
  is unchanged.
- **Retention.** `internal.retention_commerce` (full body) keeps a grant while a
  later renewal or a payment line still names it, so a slot's periods are
  removed newest first.
- **Privacy export.** `internal.frontend_privacy_export_data` (full body) gives
  each payment its cooling-off consent (new-slot or renewal), its renewal start
  dates and its lines with the slots they renew, each grant its renewal links
  and each activation whether it was moved on (no new dataset).

**Order: apply first, then merge.** The website release from the same pull
request calls the new commands and the deploy preflight probes every command in
`../runtime-api-manifest.json`, so a deploy without the update stops there.
Earlier releases do not call them and keep working with the update applied (the
renewal checkout is reached only from the new release). It is recorded after
`20261114041000_customer_invoice_pay_now.sql`. Merge the pull request right
after applying.

**Applying.**

1. Run `../preflight/20261114093742_renew_slots_early.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "slot renewals: update not applied (apply before the
   website release that uses it is deployed); renewal payment lines: none
   (column absent); renewals issued: none (column absent); reminders queued: 0".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "slot renewals: already applied; renewal payment lines:
   0; renewals issued: 0; reminders queued: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261114093742_renew_slots_early.down.sql`
(only with the owner's decision; prefer a forward fix). Revert and deploy the
website release first: the rollback removes the commands that release calls. It
refuses once a slot was renewed, an activation was moved into a renewed period
or a reminder was queued, or when a body or a funding view (by an md5 of its
whole definition) is not the update's; otherwise it puts back the twenty-one
earlier bodies, the two post funding views and the outbox kinds and drops the
update's functions, trigger, indexes, constraints and columns.

`node --import tsx scripts/test-foundation-slot-renewals.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted body, a
drifted column or a funding view changed in any way, changing nothing; apply,
rollback and re-apply return the same fingerprints; renewing opens 14 days
before the end; an early renewal starts exactly at the old end, with the
renewal's consent and start date in the snapshot, one payment and the slot
counted once; confirming writes no post (its search document moves at once);
after the boundary and before any job runs the public view, the restorable view,
the post page, search, phone reveal, an enquiry, post funding and the owner's
kept activation all serve the post; the lifecycle job does not expire it but
moves its end date on; it still fills the slot while it waits to move, moves
once into the next period, the moved activation is not a post going live, and
the 3-day grace starts only when the last renewal ends; an edit approved by a
moderator before the boundary keeps the renewed end in the search document, the
post page, My posts, the owner's post and the dashboard show the renewed end
before and after the boundary with no job run (and the post is not ending soon),
it stays in search and on its page, the capacity, allowance and post manager
count it while it waits to move, and a chargeback of the renewal after its end
date caught up moves the document's end back and the lifecycle job expires it;
renewing twice queues one period after the other, also from the old period's id;
an overlapping renewal checkout returns the open one, one never sent to Ozow is
replaced, and the new-slot checkout never takes a renewal (one order per term);
"Renew all" for three slots with different ends makes one payment, each slot
ends exactly its own period later, refunding one queued line (full amount)
withdraws only that slot and moves its post back, and the slot can be renewed
again; a chargeback of the current period keeps the queued renewal's dates; the
R10,000 limit on the total and the shown total; a person over their limit renews
at most the limit; consent, ID review, duplicates, retired plans; another
account, anonymous callers, staff grants and ended slots; a renewal paid after
the slot ended starts at payment; staff deliver a renewal sent to reconciliation
after the slot's last period; one reminder per slot end when the job runs twice,
only within 3 days, never for a staff grant, "Renew all" only when another slot
ends within 7 days, no payment started by the job; no recipient for an
unconfirmed address or a slot renewed after queueing; the mail claim with every
earlier kind; retention removes a renewed slot's periods newest first; the sweep
moves a post that can move although 101 posts of owners who lost access ended
earlier; a post held by staff across the boundary is restored with its renewed
days and not expired; the 4 posts going live per 30 days count over a slot's
renewals; a staff-raised limit never carries more than 4 renewals past its end;
the privacy export holds renewal links and each payment's consent; the grants;
and that the rollback refuses once a slot was renewed.

## Multi-listing packages, part one (sales off), 14 November 2026

`20261114154823_slot_packages.sql` was applied on 16 November 2026 at 21:43 UTC
with the owner's approval (roadmap P4a; the owner's decisions of 14 November
2026 on the multi-listing gap review). It needs
`20261114093742_renew_slots_early.sql` and the bodies and post funding views it
builds on with their reviewed bodies and definitions, and refuses (55000)
otherwise. It only adds: no API command, argument or grant is removed or
changed. **Nothing can be bought after it is applied**: the sales switch is off.

- **The sales switch.** `private.slot_package_sales` holds one row, `on_sale`
  false. No command changes it; the owner switches it on with a reviewed SQL
  step when business tools P5-P7 pass (G1). The three package terms
  (`slot_package_30d`, `_90d`, `_180d`: R100, R300 and R600 per slot, 4 posts
  going live per slot per 30 days, the Individual slot's photo and video limits)
  are in the catalogue but not public, so `api.billing_catalogue` and the
  Individual checkout never offer them.
- **The package record (decision 5).** `private.slot_packages`: one row per
  package (owner, term, number of slots bought), which never changes (trigger
  `slot_packages_immutable`). Its places, start and end are read from its grants
  (`internal.slot_package_now`): `private.entitlements.package_id` links each
  grant to its package, and one purchase line is one grant carrying every slot
  it was sold with (`private.payment_lines.slot_count`; an Individual line keeps
  1). Later parts add to this without changing it: slots added part-way (P4b)
  are further grants of the package ending with it, renewals and a change of
  count (P4d) are grants that start at its end, the team (P4c) is keyed by the
  package, and package invoices (P4e) are payment lines like any other. At most
  one package per account has not ended.
- **Buying.** New member command
  `api.start_package_checkout(p_plan_id, p_slots, p_expected_total_cents, p_cooling_off_consent)`:
  a typed number of slots, 5 to 100 online (fewer, or more than 250: 22023
  `package_slots_invalid`; 101 to 250, and any total above R10,000: PT413
  `package_invoice_required`), R100 per slot per 30 days, so online means at
  most 100 slots for 30 days, 33 for 90 days and 16 for 180 days. It needs the
  switch on (PT403 `packages_not_on_sale`), an accepted ID review (PT412,
  decision 12), the "my slots start now" consent (22023; kept in the payment's
  snapshot as `package-starts-now-v1`), the total the member was shown (PT428)
  and no package of the account that has not ended (PT409 `package_active`). One
  payment with one line; one package order open at a time (the same order is
  continued, another one cancelled when it was never sent to Ozow, and otherwise
  returned to continue, check or cancel).
- **Delivery.** `internal.apply_provider_event` and
  `internal.activate_staff_paid_payment` (full bodies) deliver a package only
  while the account has no other package that has not ended, packages are on
  sale and the member's ID review is accepted (otherwise a payment goes to
  reconciliation and staff activation is refused: PT409 `package_active`, PT403
  `packages_not_on_sale`, PT412); the Individual slot limit does not apply to
  it. `internal.claim_checkout_request` (full body) opens no Ozow page for a
  package while sales are off (PT403) or the ID review is not accepted (PT412).
  `internal.issue_slot_line_entitlements` (full body) opens the package and
  issues its grant (all its slots, 4 posts going live per slot per 30 days, from
  payment to exactly the term later). The partner commission follows the line as
  before: 20% of the package, once. A refund or chargeback of the line (the
  existing one-line and whole-payment reversals) revokes the grant, ends the
  posts in it and reverses the commission.
- **Posts in package places.** `internal.activate_post` (full body) tries the
  package's places first (an Individual slot beside it is often about to end);
  in the package's last 7 days Individual slots come first (decision 11). A
  package's capacity is its places; the posts in it and the posts of the owner's
  ended Individual slots it takes fill them; the 4 posts going live per place
  per rolling 30 days count over every grant of the package (decision 10; a post
  moved in does not count); one activation at a time per package (its grants and
  its row are locked). `internal.slot_posts_held` and
  `internal.slot_posts_started` (full bodies) count the same way, so the posting
  capacity, allowance and post manager show it.
- **E3: Individual slots beside a package.** While a package of the person (any
  account of the same ID) runs and has more than 7 days left, no Individual slot
  can be bought, renewed or delivered, whatever the way (PT409
  `package_active`): the checkouts (`internal.start_slot_checkout`,
  `internal.start_slot_renewal_checkout`), delivery (a slot or renewal paid
  after a package started, for example from an Ozow page left open, goes to
  reconciliation in `internal.apply_provider_event`; staff activation refuses
  it) and the invoices (`internal.issue_staff_invoice`,
  `internal.start_invoice_payment`, `internal.record_staff_invoice_payment`,
  `internal.record_staff_invoice_transfer`,
  `internal.confirm_staff_invoice_payment`), full bodies. In its last 7 days
  they can be again (decision 11). An Individual slot runs to its own end. When
  its paid run ends, the package takes its post if it has a free place, decided
  at read time: `internal.slot_chain_end` (full body; its earlier body is now
  `internal.slot_chain_paid_end`) returns the package's end for that slot
  (`internal.slot_package_takeover_end`), so the public view, the restorable
  view, post funding, the kept activation and the shown end date keep the post
  at the boundary before any job runs. Posts waiting take free places in the
  order their slots ended (`internal.slot_package_waiting`).
- **Search documents only for posts the package takes.** The sweep moves the
  search document of a post to the package's end only when the package takes it,
  or will take it when its slot ends in the next 2 minutes (before the next
  sweep), so it stays in search and on its page at the boundary
  (`internal.refresh_package_documents`). The documents of posts no package
  takes any more (it filled up, was refunded or charged back) go back to their
  own end dates (`internal.slot_package_release_dates`, run by the sweep and,
  inside a refund or chargeback, by the new trigger
  `entitlements_package_revoked`), so the lifecycle job ends them on their real
  date, never on a package's end.
- **No post row is written for a package by a payment, a reversal or the
  sweep**, so no post check (a post saved under rules that have since changed,
  for example) can stop money being recorded or the sweep running. Delivery
  touches no post at all; the revocation trigger writes search documents only,
  skips a document another transaction holds and never stops the reversal; a
  post's own end date is left to the lifecycle job, which brings it up to the
  post's funding or expires the post.
- **The sweep.** `api.run_slot_renewals` (full body, four new counts in its
  reply) moves posts the package takes into it (the old activation released as
  `entitlement_ended`, the new one `continued`, the search document moved to the
  package's end). It reads from the packages that have not reached their end
  (refunded ones too, `entitlements_package_ends_idx`) whose owner still holds a
  post in a paid Individual slot that has ended, however long ago, or ends in
  the next 2 minutes (`post_activations_owner_held_idx`); the most recent slot
  end first, at most `p_limit` packages a run. Each post moves in its own
  subtransaction: a post that cannot move is counted (`package_skipped`), keeps
  its place in the order and is tried again on the next run, and the others go
  on. A post the package cannot take follows the normal 3-day grace. The free
  first post, staff grants and sponsored places are not moved.
- **Locks.** The sweep never waits for a lock it takes: the owner's fence is
  tried, posts are skipped when busy, and slots, a package's grants and row and
  search documents are taken without waiting (the loop that moves posts into a
  renewed period now also takes the period without waiting); whatever is busy is
  left to the next run. The revocation trigger does not wait either. A
  transaction that never waits cannot be part of a deadlock, so the sweep and a
  reversal cannot deadlock with `api.activate_post` (post, then slots, then the
  package) or the lifecycle job (post, then search document).
- **Going below 5 (decision 11).** In a package's last 7 days the same sweep
  moves its posts into free places of the same owner's Individual slots whose
  run lasts beyond the package's end (`internal.individual_free_places`), the
  most recently approved first (`internal.slot_package_leaving`), as continued
  activations (not a post going live), so at the package's end they are in their
  Individual slots, not the grace. A post one slot cannot carry (another area,
  more photos) tries the owner's other slots, the longest-running first, at
  most 20. An Individual slot bought in the package's very last minute may miss
  the sweep; its posts then follow the grace.
- **Team.** `internal.manage_plan_member` (full body) never adds a member to a
  package's grant, and `internal.get_my_frontend_post_manager` (full body) does
  not list a package grant among the plans with administrators: the team belongs
  to the package (P4c).
- **Reads.** `api.get_slot_package_offer()` (the website's server only): whether
  packages are on sale and the fixed rules; the terms only while on sale.
  `api.get_my_slot_package()` (member): the account's latest package that runs
  or ended in the last 3 days, its places, end, posts (and the posts of ended
  Individual slots it takes, `moving`), the new posts allowed and started in the
  rolling 30 days, whether the account could buy one now, and until when its
  Individual slots stay closed.
- **Retention and privacy.** `internal.retention_commerce` (full body) removes a
  package with the last of its grants (five tax years after its payments); the
  privacy export (`internal.frontend_privacy_export_data`, full body) gives the
  account's packages (new dataset `slot_packages`), each grant's package and
  each payment line's number of slots.
- **Not in this part.** Package reminders (G5), slots added part-way (P4b), the
  team (P4c), renewals, changing the count and choosing the posts that stay
  (P4d), package invoices and "Ask for an invoice" (P4e), and Terms v5 (needed
  before the switch goes on).
- **Cost.** The package reads go from the owner (the posts they hold, through
  the new partial index `post_activations_owner_held_idx`) or the package
  (`entitlements_package_idx`); the sweep reads the packages by end date
  (`entitlements_package_ends_idx`) and their owners' posts
  (`post_activations_owner_held_idx`). The public view and search do no package
  work for a post whose own period still runs, so they cost what they did; a
  post whose Individual slot has just ended costs about 1 ms more until the
  sweep moves it in. The helpers read on every such post are PL/pgSQL
  (`internal.slot_package_now`, `internal.slot_package_waiting`,
  `internal.slot_package_takeover_end`), so their plans are kept between calls.
  Measured on 20,000 live posts in the pull request.

**Order: apply first, then merge.** The website release from the same pull
request calls the new commands (behind the switch) and the deploy preflight
probes every command in `../runtime-api-manifest.json`, so a deploy without the
update stops there. Earlier releases do not call them and keep working with the
update applied. It is recorded after `20261114093742_renew_slots_early.sql`.

**Applying.**

1. Run `../preflight/20261114154823_slot_packages.check.sql` unchanged in the
   SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "slot packages: update not applied (apply before the
   website release that uses it is deployed); on sale: no (switch absent);
   packages: none (table absent); package payments: 0".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "slot packages: already applied; on sale: no; packages:
   0; package payments: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261114154823_slot_packages.down.sql`
(only with the owner's decision; prefer a forward fix). Revert and deploy the
website release first: the rollback removes the commands that release calls. It
refuses once a package exists, a package payment was started or the switch is
on, or when a body is not the update's; otherwise it puts back the twenty
earlier bodies and drops the update's functions, trigger, indexes, constraints,
columns and tables (the package terms stay in the catalogue, not public).

`node --import tsx scripts/test-foundation-slot-packages.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted body, a
drifted funding view or a drifted column, changing nothing; apply, rollback and
re-apply return the same fingerprints; the grants (members buy and read their
own package, only the website's server reads the offer, no API role reads the
new tables); with the switch off nothing can be bought, the offer lists no terms
and the slot catalogue and the Individual checkout never sell a package term;
the typed number (4 and 251 refused, 101 and the R10,000 limit by invoice, 5,
100, 33 x 90 days and 16 x 180 days bought online), the shown total and the
consent; an accepted ID review; a paid package is one payment with one line and
one package whose grant carries every slot and ends exactly its term after the
payment; an Ozow notice with another amount or replayed changes nothing; one
package per account (checkout, a late second payment sent to reconciliation,
staff activation refused); posts use the package's places, at most its number of
slots, also when two activations race for the last place; the 4 posts going live
per slot per 30 days count over the package; E3 (no Individual slot bought or
renewed while a package runs, both open again in its last 7 days; when an
Individual slot ends the package takes its post at once in the public view, the
restorable view, search, the post page and funding, the sweep moves it in once
without it counting as a new post, the lifecycle job keeps it live with the
package's end; a full package leaves the post to the 3-day grace); another
account cannot see or use the package and no team member joins its grant;
partner commission is 20% of the package once and a refund reverses it and ends
the package and its posts; a chargeback ends them too; Individual slots work as
before without a package. Review fixes: a new slot and a renewal left open at
Ozow and paid after a package started go to reconciliation and staff cannot
activate them; no Individual invoice is issued, paid, recorded or confirmed
while a package runs; a package reaches Ozow and is delivered only while on sale
and with an accepted ID review; a full package leaves an Individual post's
search document alone; a refunded package gives back the post it took, which
expires on its real date; in a package's last 7 days a new post goes into an
Individual slot and the sweep moves the most recently approved package post into
the free place (continued), which stays live after the package ends while the
others follow the grace; retention removes a package with its last grant and the
privacy export lists packages; the post manager lists no package grant among
plans with administrators. Second review: with a post saved under rules that
have since changed, a package refund, an Ozow settle of a package and its
chargeback all go through, writing no post row (the documents go back, the
lifecycle job then expires the posts); the sweep moves such a post, goes on when
another post's move fails (and moves it on the next run), finds a waiting post
whose slot ended 8 days earlier, and tries the owner's next Individual slot when
the first cannot carry the post; while another transaction holds a package's row
the sweep does not wait and leaves it to the next run, and while another holds a
post's search document a refund does not wait and the sweep corrects the
document afterwards. And the rollback refuses once a package was bought.

## Close and erase an account, 16 November 2026

`20261116175757_close_and_erase_account.sql` was applied on 17 November 2026 at
03:50 UTC with the owner's approval (roadmap M1.6b; owner decision OD-10: close
at once; delete the profile, posts, enquiries and media after 30 days; keep
payment records for 5 years, no longer linked to the person; keep the
identity-ban fingerprint as the privacy notice says; owner decisions of 16
November 2026 on the review: a deletion request is due 7 days after the grace
period; staff finish a cancellation refund within the 30 days; enquiries the
person sent are deleted from other owners' inboxes; verification history stays 5
years after closure). It needs `20261114093742_renew_slots_early.sql`, the
bodies it replaces with their reviewed bodies and the five it builds on
(`internal.close_account_evidence`, `internal.lock_evidence_subject`,
`internal.staff_actor`, `internal.media_object_in_use`,
`internal.release_sponsorship_entitlement`) and
`20261114154823_slot_packages.sql`, and refuses (55000) otherwise. It only adds:
no API command, argument or grant is removed or changed. Nothing calls the new
commands from the website yet; the "Delete account" button and the staff privacy
screen move to them in M1.6c.

- **Kept payment records lose their person.** The person's column becomes
  nullable in `private.payments` (`owner_id`), `private.customer_invoices`,
  `private.invoice_transfers`, `private.payment_refund_requests` (`account_id`),
  `private.entitlements`, `private.post_activations` (`owner_id`),
  `private.partner_commissions` (`referred_account_id`) and
  `private.individual_slot_limits` (`account_id`). The record guards of these
  tables (full bodies) allow one more change, through
  `internal.erasure_unlinks`: that column going from the erased account to null
  while its erasure runs (transaction setting `vm.erasure`); every other column
  still never changes.
- **Kept records stay usable.** The staff refund, chargeback, approval, Ozow
  refund, slot reversal and invoice void commands (full bodies) tell "not found"
  apart from "no account" and lock a record with no account by its own id
  (`internal.lock_kept_record_subject`); a chargeback still reverses the partner
  commission. A refund or chargeback of a payment with no account always waits
  for a second staff member, whatever the amount (the check
  `payment_refund_requests_approval_rule` allows it). The trigger
  `outbox_events_unlinked` drops a payment email (`payment_*` kinds) for nobody,
  so a late Ozow payment of an erased account is accepted (and can be refunded)
  on every retry; any other email without a person is still an error.
- **Erasure records.** `private.account_erasures` holds one row per closed
  account, with no foreign key so it outlives the Auth user: closed when and by
  whom, `erase_after` (exactly 30 days later), the end of the paid time it still
  had, when it was erased and counts of what was erased, when the Auth user was
  removed, and why it waits (`blocked_reason`, with the error code
  `blocked_detail` for a failure). `private.account_erasure_requests` links
  deletion privacy requests to it.
- **Closing (member).** `api.close_my_account()`: the caller's own live
  confirmed session that signed in (any method but anonymous, the JWT `amr`
  time) in the last 15 minutes (42501 `recent_sign_in_required`), never a staff
  account (42501 `staff_account`). At once: the existing closure record (posts
  leave every public read, identity facts and phone proofs revoked, open
  identity cases closed, evidence files scheduled, trial fingerprint detached);
  sign-in blocked (Auth `banned_until` 100 years on); every session and refresh
  token ended (refused if the ban or the session clean-up does not take); a
  partner record suspended, with a partner event; the erasure scheduled; a
  deletion privacy request recorded (identity checked by the session, due 7 days
  after the grace period) with its "received" notice. A second call is refused:
  the session has ended.
- **Ordering (staff).** `api.fulfil_account_deletion(p_request, p_revision)`:
  `dsar:manage` with a recent authenticator code. It calls
  `internal.order_account_erasure` (no API role may call it; the runbook's owner
  SQL session uses it until the staff screen exists): a verified deletion
  request in progress, a staff member with the privacy role who is not the
  requester and did not verify the identity (42501 `second_person_required`),
  never a staff account (PT409 `staff_account`). It closes the account if still
  open, links the request, records the order on the request (event
  `erasure_ordered`, a new allowed action), sets its deadline to 7 days after
  the grace period, and erases at once when the 30 days have passed.
  `api.get_account_erasure(p_request)` reads the state (dates, status, the
  reason it waits, the error code, counts), no personal data.
- **Erasure.** `internal.erase_closed_account`, 30 days after closure. It waits
  (and records why; the sweep tries again an hour later) while a legal hold,
  open fraud hold, unreleased staff content hold, open report about the person
  or their posts, staff role, rejected deletion request, pending payment, paid
  order still to be delivered, open refund, bank transfer waiting for
  confirmation, unpaid invoice or unpaid commission owed to the person as a
  partner applies. It deletes posts (edit copies, contacts, media links, search
  documents, received enquiries), sponsored places, event submissions, the
  enquiries it sent (and the other owner's notice and email), notifications,
  profile, drafts, organisation roles and applications, team memberships, post
  commands and receipts, the acquisition record, consent and terms records, home
  area and emails; queues every photo and video it uploaded that nothing kept
  still uses for deletion from storage; revokes its paid time and unlinks every
  kept payment record; removes the sign-in (sessions, refresh tokens,
  authenticator factors, linked sign-in providers, one-time tokens, sign-in
  flows, the Auth audit entries since the account was created in one bounded
  batch; email, phone, password, metadata and pending changes cleared; banned
  and marked deleted). The Auth user is deleted as soon as nothing kept names it
  (`internal.remove_erased_auth_user`); until then it is an empty row (kept
  verification history, an identity ban, a report, a released legal hold, a
  partner record or a staff history keep it until their own retention ends). A
  failure deleting it is recorded and never undoes the erasure.
- **Privacy requests.** `internal.process_frontend_privacy_request` (full body):
  a deletion request linked to an account is completed only after the erasure
  (PT409 `erasure_pending`); one naming an account only after the erasure was
  ordered (PT409 `erasure_required`). `internal.claim_frontend_privacy_notice`
  (full body) sends the notices of a request linked to an erasure to the address
  stored with the request (the Auth user may be gone), never those of a
  minimised request. `private.privacy_requests` gains `minimised_at`: once a
  completed or rejected request's last notice was sent (or 30 days after it
  closed), its address is replaced by the marker `removed` (nothing needs to
  match a later request) and its phone and description cleared; it is deleted 5
  years after it closed, never while it is linked to an erasure that has not run
  (`internal.retention_privacy_requests`; provisional periods, the lawyer
  confirms). Rejecting a deletion request linked to an account not yet erased
  (`internal.reject_account_erasure`, under the account lock; PT409
  `account_erased` if the erasure already ran) records `rejected_at` on the
  erasure and places a legal hold "Deletion request rejected; review by <date>"
  (12 months on), so neither the purge of the request record nor anything else
  lets the sweep erase it; a later ordered request clears `rejected_at` (the
  hold is released by staff).
- **Sweep.** `internal.run_retention` (full body) runs
  `internal.run_account_erasures(least(p_limit, 20))` (key `accounts`) and
  `internal.retention_privacy_requests` (key `privacy_requests`). Each account
  runs on its own: a failure is recorded with its error code and the job carries
  on. `accounts.stuck` counts erasures recorded as failed; the retention job
  (`src/lib/foundation/retention-jobs.ts`) logs the alert
  `account_erasure_errors` while any remain.
- **Preflight.** Besides the bodies, it checks that the role owning the
  functions may make every Auth change the erasure needs (on each Auth table
  present) and names any it may not, and that row level security on those tables
  cannot hide rows from that role (or that it bypasses it). The Auth sign-in log
  has no index on the actor: the erasure clears it in one bounded batch (entries
  since the account was created, up to 10,000).
- **Multi-listing packages.** `private.slot_packages.owner_id` (from
  `20261114154823_slot_packages.sql`, which this update needs) becomes nullable
  and `internal.slot_package_guard` (full body) allows only the erasure unlink;
  the erasure keeps an erased owner's package, unlinked, with its revoked
  grants.
- **Not in this update.** Sponsored places of the erased person are deleted (the
  earlier design deletes them with the Auth user), not unlinked. A staff-only
  reopen during the grace period is a later slice. The older service command
  `api.close_account_evidence` still closes without scheduling an erasure;
  nothing calls it.

Behaviour test: `scripts/test-foundation-account-erasure.mjs` (in
`pnpm db:foundation:lifecycle-test`) checks the preflight (including a missing
Auth privilege) and refusals, apply -> rollback -> apply, the grants, closing,
nothing erased before 30 days, the second-person rule, each hold in turn (legal
hold, content hold, report, unpaid invoice, partner commission, rejected
request), the content deleted (edit copy, sponsored place, event submission,
business check, organisation role, enquiries) and payments, the grant, invoices,
the bank transfer and a partner commission kept with no person, the sign-in
removed, the guards still refusing any other change, a chargeback (reversing the
commission), an approved refund and a late Ozow payment refunded after the
erasure, an erased partner keeping an empty Auth row, an unverified account's
Auth user deleted after the media cleanup, the completed notice sent to the
stored address and the request then minimised, a failing account recorded
without stopping the job (and a failed Auth delete not undoing the erasure), the
identity-ban fingerprint kept, the runbook's interim command, replays, and that
the rollback refuses once an account was closed. Second review: a rejected
request places a legal hold and its account is not erased even after the request
record is purged; a refund or chargeback of a payment with no account waits for
a second staff member; only payment emails may lose their person; a closed
partner gets a partner event; the preflight names row level security on an Auth
table. Final review: rejecting a request whose account was already erased is
refused (PT409 `account_erased`); an erased owner's Multi-listing package is
kept, unlinked.

## Customer invoices with an Ozow "Pay now" link, 14 November 2026

`20261114041000_customer_invoice_pay_now.sql` was applied on 14 November 2026 at
08:40 UTC with the owner's approval (roadmap P2b, second slice). It needs
`20261113223806_bank_transfer_and_consent_fixes.sql` and the payment, checkout
and slot bodies it builds on with their reviewed bodies, and refuses (55000)
otherwise. It only adds: no API command, argument or grant is removed or
changed.

- **Invoice numbers.** `VM-YYYY-NNNNNN`, one sequence per South African calendar
  year (`VM-2026-000001`, `VM-2026-000002`, ... and again from `000001` in
  2027). The number is taken in the transaction that issues the invoice, under
  the row lock of the year's counter in the new table
  `private.customer_invoice_numbers`, so a refused or failed issue takes no
  number and two staff issuing at once get consecutive numbers. The counter
  starts at 1 and only moves up by one (trigger), every invoice takes the
  counter's current value (trigger) and at commit a year's invoices are exactly
  1 to its counter (deferred constraint trigger). Invoices are never removed
  (only the retention job, five tax years later); a cancelled invoice stays as
  `void` with its number.
- **The invoice.** New table `private.customer_invoices`: number, customer
  account, the Individual slot plan version, slots (1 to 25), price per slot and
  total (at most R50,000; today 25 x 180 days is R10,350), the description ("3 ×
  Individual slot — 90 days"), issue date, due date (1 to 30 days), who issued
  it and why, the seller (Verifymzansi (Pty) Ltd, 2026/155305/07, not registered
  for VAT; issuing refuses with PT409 `invoice_vat_status_changed` unless the
  merchant VAT setting `private.invoice_merchant_config` says not registered),
  the buyer's billing details, the cooling-off consent (time and wording version
  `invoice-cooling-off-v1`) and its status. Issued facts never change; billing
  details change only while it is issued (each change a new revision); the
  consent is recorded once; it becomes `paid` (naming its complete Ozow payment
  of that account and amount) or `void` once (trigger). The seller's street
  address and the bank account are not stored: the website shows them from
  server-side settings, and leaves them out when they are not set.
- **Issue and void (staff).**
  `api.issue_staff_invoice(p_account_email, p_term_days, p_slots, p_due_days, p_reason, p_request_id)`
  and `api.void_staff_invoice(p_invoice_id, p_reason)`: capability
  `payments:refund` with a recent second factor, the staff member's own current
  accepted ID review, never for an account of their own identity (and, to issue,
  never for a customer a partner account of their identity referred). Issuing
  needs a confirmed account with current access and an accepted ID review (PT404
  `invoice_account_unavailable`, PT409 `payment_account_unavailable`, PT412
  `invoice_buyer_unverified`), the Individual slot on sale for 30, 90 or 180
  days (PT409 `invoice_plan_unavailable`) and room within the person's slot
  limit (PT429 `slot_limit_reached`); the same request id again by the same
  staff member returns the first invoice (`repeated: true`), with other details
  PT409 `invoice_request_conflict`. Voiding refuses a paid invoice (PT409
  `invoice_paid`: refund the payment instead) and one with a payment attempt
  that could still be paid (PT409 `invoice_payment_open`); an attempt never sent
  to Ozow is cancelled with it.
- **Reads.** Staff (`payments:view`): `api.get_staff_invoices()` (latest 50, and
  the number unpaid) and `api.get_staff_invoice(p_invoice_number)`. The
  customer: `api.get_my_invoices()` and `api.get_my_invoice(p_invoice_number)`,
  only for the signed-in account's own invoices; another account's number, or a
  malformed one, reads as not found (PT404 `invoice_unavailable`), so a guessed
  number shows nothing.
- **Billing details.**
  `api.save_my_invoice_billing(p_invoice_number, p_revision, p_buyer_name, p_buyer_address, p_buyer_registration_number)`:
  the owner of an issued invoice saves the business or buyer name (2 to 160
  characters), the address (5 to 300, lines allowed) and an optional
  registration number (letters, digits, spaces, `/ . -`), at the current
  revision (PT409 `invoice_revision_changed`); the same details again change
  nothing.
- **Pay now.**
  `api.start_invoice_payment(p_invoice_number, p_expected_total_cents, p_cooling_off_consent)`:
  the owner of an issued invoice with billing details (PT409
  `invoice_billing_required`), the box ticked (22023
  `invoice_consent_required`), the total shown equal to the invoice total (PT428
  `invoice_amount_mismatch`), the plan version still on sale at the invoice
  price (PT409 `invoice_plan_unavailable`), an accepted ID review and room
  within the slot limit counting open checkouts. It returns the attempt whose
  Ozow page is still open (`reused: true`), or one never sent to Ozow; refuses
  while an attempt is still being checked (PT409 `invoice_payment_checking`:
  pending after its Ozow window, being sent, or failed while Ozow's page may
  take another try) or another payment for the same slot term is open at Ozow
  (PT409 `invoice_checkout_open`; one never sent to Ozow is cancelled instead);
  and otherwise starts an ordinary pending Ozow payment of the invoice total
  with one line per slot, linked in the new table
  `private.customer_invoice_payments`. The first attempt's reference is the
  invoice number; a later attempt (after an earlier one expired, failed or was
  cancelled) is `<number>-<attempt>`, which Ozow shows on the bank statement as
  the invoice number (its payer reference holds 14 characters). At most 20
  attempts (PT429 `invoice_attempts_exhausted`). The website opens the Ozow
  request with the existing service commands; online orders above R10,000 are
  allowed here (the R10,000 limit is the ordinary checkout's).
- **Paid.** The attempt is settled by the existing Ozow notice and status check
  (`internal.apply_provider_event`): the same amount check, idempotency, slots
  (one per line, starting at payment), invoice record, receipt event and partner
  commission as any Ozow checkout. The new trigger
  `payments_customer_invoice_paid` then marks the invoice paid with that payment
  and its completion time.
- **Late money for a paid or void invoice.** An earlier attempt that settles
  after another payment paid the invoice, or after it was voided, is never
  refused but nothing is delivered for it: `internal.apply_provider_event` (full
  body; one added condition, `internal.customer_invoice_settled_elsewhere`)
  records it complete and `needs_reconciliation` (no slots, no commission, the
  member's "payment review" email), its outcome `complete_unfulfillable_target`
  is recorded by the website as a payment problem from the notice or the status
  check that saw it (staff alert), the staff invoice read lists it under
  `extra_payments`, and staff refund it. `internal.activate_staff_paid_payment`
  (full body; one added check) refuses to deliver it (PT409
  `invoice_paid_elsewhere`).
- **Bank transfer to an invoice.** `private.invoice_transfers` gains
  `customer_invoice_id` (one waiting or confirmed transfer per invoice, a
  partial unique index; a trigger checks that a transfer naming an invoice is
  exactly that issued invoice's account, slot term, slots and total). New staff
  command
  `api.record_staff_invoice_transfer(p_invoice_number, p_bank_reference, p_cleared_on, p_cooling_off_waiver, p_reason)`
  (`payments:refund`, the bank transfer rules of `20261113223806`, the reason
  stored as "Invoice <number>: <reason>") records it against an issued invoice
  (PT409 `invoice_paid`, `invoice_void`) with no payment attempt that could
  still be paid (PT409 `invoice_payment_open`) and no other transfer waiting
  (PT409 `invoice_transfer_waiting`); an attempt never sent to Ozow is cancelled
  with it. While it waits, Pay now and voiding are refused (PT409
  `invoice_transfer_waiting`). The second staff member's confirmation
  (`internal.confirm_staff_invoice_payment`, full body; its answer unchanged)
  rechecks the invoice (paid or void: PT409, decline the transfer and return the
  money; an attempt open at Ozow: PT409 `invoice_payment_open`), cancels an
  attempt never sent to Ozow before it checks the slot limit (so the slot
  checkout cannot continue it, and it does not count as open), and marks the
  invoice paid with the bank transfer payment, whose slots, receipt and
  commission are those of 20261113162457. A declined transfer leaves the invoice
  unpaid. Recording a transfer without the invoice for the total of one of the
  customer's unpaid invoices (any order of that total) is refused with that
  invoice's number (PT409 `invoice_transfer_required`;
  `internal.record_staff_invoice_payment`, full body), so a bank transfer to an
  invoice always pays it.
- **Refunds.** The existing staff refund commands (whole payment, one slot,
  through Ozow or recorded) work on the payment unchanged; the invoice stays
  paid and its read shows the payment's status (for example `refunded`).
- **Privacy export and retention.** The privacy export holds the member's
  invoices (`customer_invoices`: number, status, slots, amounts, dates, billing
  details, consent, payment and attempts; never the staff member or the
  reasons). The retention job (`internal.retention_commerce`, full body) removes
  invoices and their attempt links five tax years after they were paid, voided
  or (if neither) issued, and recorded bank transfers (`bank_transfers` in its
  answer) five tax years after they were confirmed, declined or (if neither)
  recorded, and always with the invoice they name (declined ones too), before
  the payment. This replaces "rows are never removed" of 20261113162457: the
  guard `internal.invoice_transfer_guard` (full body) allows a delete only
  within the retention job, as the other payment records. The job no longer
  stops on a payment that an invoice or a recorded bank transfer still names (it
  skips it; before, such a payment would have made the delete fail).
- **Audit.** The staff audit trail lists `payment:customer_invoice_issued` and
  `payment:customer_invoice_voided`.

**Order: apply first, then merge.** The website release from the same pull
request calls the new commands and the deploy preflight probes every command in
`../runtime-api-manifest.json`, so a deploy without the update stops there.
Earlier releases do not call them and keep working with the update applied. It
is recorded after `20261113223806_bank_transfer_and_consent_fixes.sql`. Merge
the pull request right after applying (another merge in between fails the
deploy's API exposure check).

**Applying.**

1. Run `../preflight/20261114041000_customer_invoice_pay_now.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "customer invoices: update not applied
   (apply before the website release that uses it is deployed); invoices issued:
   none (table absent); payment attempts: none (table absent)".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "customer invoices: already applied; invoices issued: 0
   (unpaid: 0); payment attempts: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261114041000_customer_invoice_pay_now.down.sql` (only with the
owner's decision; prefer a forward fix). Revert and deploy the website release
first: the rollback removes the commands that release calls. It refuses once an
invoice was issued (numbered financial records); otherwise it puts back the
retention job, the privacy export, the bank transfer guard and the staff audit
view and drops the update's functions, tables and triggers.

`node --import tsx scripts/test-foundation-customer-invoices.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted body or
table, changing nothing; apply, rollback and re-apply return the same
fingerprints; issuing and its refusals (wrong staff, own identity, no ID review
of their own, a referred customer, unknown, unreviewed or blocked customer, slot
limit, term, due days, request id, VAT setting), none of which takes a number; a
repeated request; five staff issuing at once and an issue rolled back give
consecutive numbers, and the counter cannot skip, step back or lose an invoice;
another account (and a malformed number) reads nothing and cannot change or pay
the invoice, staff read with `payments:view` only; billing details (normalised,
revision-fenced, repeat-safe) and the consent before payment; Pay now binds the
total, the lines and the invoice number; the same attempt while open or unsent;
a wrong amount is refused, the payment pays the invoice once and a repeated or
second notice changes nothing; the paid invoice delivered exactly what an Ozow
checkout of the same order delivered (slots, invoice record, receipt event,
partner commissions); a paid invoice cannot be paid, changed or voided; attempts
being checked, later attempts (`-2`, `-3`) and a late earlier attempt (money
kept but not delivered, staff cannot deliver it, listed as an extra payment);
another open checkout, the slot limit, the ID review and the catalogue at
payment; voiding (and its refusals, the unsent attempt cancelled); late money on
a void invoice (kept, not delivered); two Pay now requests at once give one
attempt; the South African year boundary (23:59:59 on 31 December and 00:00 on 1
January); the slot checkout and an invoice attempt (another number of slots
closes the unsent attempt, the same order continues it and pays the invoice
once); a bank transfer recorded on the invoice (the same order, and another
order of the same total, without the invoice refused, a repeat, Pay now, voiding
and a second transfer refused while it waits, the recorder cannot confirm,
another admin's confirmation pays the invoice with its slots, receipt event and
commissions, then Pay now and another transfer refused); an open Ozow payment
refuses a transfer, a declined transfer frees the invoice, a late Ozow payment
while a transfer waits pays the invoice and the transfer cannot be confirmed, a
void invoice takes no transfer, a transfer row of another order is refused;
recording and confirming a transfer close an unsent invoice attempt
(confirmation also at the slot limit, and the slot checkout cannot continue it);
refunds of one slot and of a whole payment; the record rules; the privacy
export; the retention job keeps a payment an invoice names and removes the
invoice five tax years on, and an invoice paid by bank transfer with its
transfers (a declined one too) and payment, a transfer without an invoice five
tax years after confirmation, keeps a recent transfer, and no delete works
outside the job; the audit trail; the grants; and that the rollback refuses once
an invoice was issued.

## A ban also blocks the person's phone numbers, 17 November 2026

`20261117064820_ban_blocks_phone_numbers.sql` was applied on 17 November 2026 at
07:24 UTC with the owner's approval.

Owner decision of 17 November 2026: a banned person must not be able to make us
send (and pay for) SMS codes by entering their number again on a new account.
Until now a ban stored only the identity fingerprint
(`private.banned_identities`, 5 years), which stops the person at the ID step,
after the SMS; their number stayed blocked only while their banned account held
it.

From this update:

- **The numbers a ban blocks** are kept in the new table
  `private.banned_phone_numbers` (identity fingerprint and number), tied to the
  ban's row in `private.banned_identities` (on delete cascade). So a number is
  blocked exactly as long as the ban: released at once when the ban is lifted,
  and after its 5 years (a ban whose time has passed blocks nothing even before
  `internal.purge_expired_identity_bans` removes it). A replacement decision
  that keeps the ban keeps its numbers. No API role can read it.
- **Which numbers:** every number verified (active or revoked, while the proof
  is still on record) by any account whose accepted identity has the banned
  fingerprint, except a number another person currently holds as an active
  proof, so a re-issued number already verified by someone else is never blocked
  under them. The trigger `ban_identity_phone_numbers` copies them when a ban is
  recorded, so they stay blocked after the proofs are deleted. Bans recorded
  before the update are filled in once by the update.
- **No SMS:** `internal.create_verification_phone_challenge` refuses a blocked
  number with PT409 and the reason `phone_banned` before it stores a challenge
  (after the member's own number and the two change rules, before
  `phone_in_use`), and `internal.finalize_verification_phone` refuses it too,
  for a code sent just before the ban.
- **What the member sees:** "This phone number can't be used on VerifyMzansi.
  Contact support if you think this is a mistake." (owner's choice), never that
  a ban exists: networks re-issue numbers, and a ban is personal information
  about the number's earlier owner. The website answers 403 and records it as a
  refused request.

No API command changes, so the order does not matter: a website release without
the matching code shows its generic refusal for the new reason (still with no
SMS), and the release with it works without the update (a banned person's number
is then blocked only while their banned account holds it, as before).

**Applying.**

1. Run `../preflight/20261117064820_ban_blocks_phone_numbers.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "ban blocks phone numbers: update not
   applied; running bans: N; numbers to block: M" (any counts).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "ban blocks phone numbers: already applied; running bans:
   N; numbers blocked: M; numbers to block: M", with the two number counts
   equal.
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261117064820_ban_blocks_phone_numbers.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses unless the update is
applied, puts back the two phone functions byte for byte and drops the trigger,
the two helper functions and the table with its numbers. The identity bans are
unchanged.

`node --import tsx scripts/test-foundation-ban-blocks-phone-numbers.mjs` (part
of `pnpm db:foundation:lifecycle-test`) proves on the throwaway database: before
the update a banned person's older number gets a code; the preflight before and
after, read only; the refusals with a drifted body of either function and a
premature rollback, changing nothing; apply, rollback and re-apply return the
same fingerprints; a ban recorded before the update blocks the person's current
and older numbers, and a returning account gets `phone_banned` for both with no
challenge stored while a free number still gets a code; a re-issued number
someone else holds is not blocked; a ban recorded after the update blocks at
once, and a code sent before it is refused at the last step; a replacement
decision keeps the numbers and lifting the ban releases them; a ban whose 5
years have passed blocks nothing and the purge removes its numbers; no API role
can read the table or run the helpers; and account and number validation still
come first.

## A phone code is sent only when the number can be verified, 16 November 2026

`20261116194000_phone_in_use_before_sms.sql` was applied on 17 November 2026 at
05:36 UTC with the owner's approval.

Until now the website paid for an SMS code that could never be used: a member
who entered a number another account had already verified, or who changed their
number less than 15 days after the last change or without a current verified
identity, typed the code in and was only then refused by
`internal.finalize_verification_phone`. A member could also ask for a code to
the number already verified on their own account, which proves nothing new.

From this update, `internal.create_verification_phone_challenge` (same
signature, grants and owner) refuses each of these with PT409 and a listed
reason, before it stores a challenge or expires the member's open code, so the
website sends no SMS and tells the member at once, in the site's existing words:

| Reason (`detail`)                | The member is told                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `phone_already_verified`         | "This phone number is already verified on your account."                            |
| `phone_change_cooldown`          | "You can change your phone number again after {date}." (the `hint` is the UTC time) |
| `phone_change_identity_required` | "You must complete identity re-verification before changing your phone number."     |
| `phone_in_use`                   | "This phone number is already linked to another account."                           |

The two change rules are the ones finalization already applies, checked the same
way, and they come before `phone_in_use`, so a member who may not change their
number learns nothing about anyone else's. Finalization keeps every check and
stays the authority: two accounts that start on a free number at the same moment
can still each get a code, and its unique index accepts only one.

`phone_in_use` tells a signed-in member with a confirmed email whether a number
is verified on some other account (never which one) without holding the phone;
before, only someone who received the code learned it. That is the price of not
paying for an SMS that can never succeed, and the source backend answered the
same way. Every send request, refused or not, counts against the SMS limits (per
account 5 an hour and 10 a day, per network 10 an hour and 30 a day), which
bounds probing.

No API command changes, so the order does not matter: the website release before
this update shows its generic refusal for the new PT409 (still with no SMS), and
the release with it works without the update (these numbers are then refused at
the last step, as before).

**Applying.**

1. Run `../preflight/20261116194000_phone_in_use_before_sms.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "phone in use before sms: update not applied; active
   phone proofs: N; open codes for a number in use: M" (any counts; open codes
   expire within five minutes and are not changed).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "phone in use before sms: already applied; ...".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261116194000_phone_in_use_before_sms.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses unless the update's body is
present, and puts back the earlier body byte for byte.

`node --import tsx scripts/test-foundation-phone-in-use-before-sms.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: before
the update a held number, the member's own number and a change within 15 days
each get a code; the preflight before and after, read only; the refusals with a
drifted body and a premature rollback, changing nothing; apply, rollback and
re-apply return the same fingerprints; afterwards each of the four reasons is
raised before a challenge is stored (with the cooldown's end as the hint, and
the change rules before `phone_in_use`), and the member's open code stays
usable; a free number, and a number its holder released, still work; account and
number validation still come first; the grants, owner and settings are
unchanged; and an allowed change of number still gets a code, is verified and
starts a new 15 days.

## Online payments up to Ozow's maximum, invoices at any amount, and posting-v5, 16 November 2026

Two updates, applied in this order, **after**
`20261116175757_close_and_erase_account.sql` (pull request #230),
`20261116194000_phone_in_use_before_sms.sql` (pull request #232) and
`20261117064820_ban_blocks_phone_numbers.sql` (pull request #237), which are
applied first; these updates do not depend on them. Both were applied on 17
November 2026 with the owner's approval: the first at 11:40 UTC, just before
pull request #234 was merged, and the second at 12:11 UTC, after its deploy.
Owner's decisions of 16 November 2026: remove the R10,000 online limit; checkout
offers Ozow and, below it, an invoice first at every amount; the only online
limit left is the most Ozow accepts in one payment on our site (its "Maximum
Transaction Amount", R1,300 for site VER-VER-020 today; the owner has asked Ozow
to raise it), held in one setting; the Terms say so.

### 1. The limit and posting-v5 published: `20261117082020_online_payment_limit.sql`

It needs `20261114154823_slot_packages.sql`. The five function bodies it
replaces (with that update's package checks) are checked by md5, and it refuses
with 55000 otherwise. It only adds: no API command, argument or grant is removed
or changed.

- **One setting.** `internal.online_payment_max_cents()` returns 130000 cents
  (R1,300). It is STABLE, not IMMUTABLE, so a changed value reaches pooled
  connections at once. When Ozow changes our site's maximum, a new reviewed
  update replaces only this function; every check below and the website follow.
- **Checkout and renewal.** `internal.start_slot_checkout` and
  `internal.start_slot_renewal_checkout` (full bodies) refuse a total above the
  setting with PT413, detail `online_payment_above_limit` (before: above
  1,000,000 cents, R10,000, without a detail). A total exactly at the setting is
  accepted. A renewal cannot be invoiced, so above the setting the member renews
  fewer slots in each payment.
- **Multi-listing packages.** `internal.start_package_checkout` (full body) uses
  the same setting instead of R10,000: a package above it is bought by invoice
  (PT413 `package_invoice_required`, as before), and more than 100 slots stays
  by invoice. With R1,300, at most 13 slots for 30 days are paid online, and
  every 90- or 180-day package goes by invoice. Package invoices cannot be
  issued yet (slice P4e); packages stay off sale until then.
- **Invoice "Pay now".** `internal.start_invoice_payment` (full body) refuses an
  invoice whose total is above the setting with the same PT413
  `online_payment_above_limit`. The check comes after the "already paid" check
  and before anything is written, so such an invoice is paid by bank transfer
  only (staff record it and a second staff member confirms it). Staff can still
  issue invoices up to R50,000.
- **Final guard.** `internal.claim_checkout_request` (full body), the server's
  lease before it asks Ozow for a payment page, never creates a new Ozow request
  above the setting (same PT413). An Ozow page already open is unaffected.
- **New public read** `api.get_payment_limits()` (anon and authenticated, like
  the price catalogue; no account data): `{"online_max_cents"}`. The checkout,
  the package checkout, the price pages and the invoice pages use it.
- **posting-v5 published, not current.** It inserts the `posting-v5` row
  (`src/lib/legal/terms-documents/posting-v5.json`, canonical hash
  `LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc`) and checks that the current
  version did not change. posting-v5 is posting-v4 with "Paying, VAT & invoices"
  rewritten and one refund sentence changed ("by EFT for a payment made by
  EFT"). The new paying text says:
  - online payment at any amount up to the payment provider's maximum;
  - an invoice first on request at any amount, paid with Pay now or by EFT;
  - above the maximum, an invoice paid by EFT;
  - a renewal is not invoiced and is split into more than one payment;
  - the cooling-off box before invoice Pay now, and for EFT the confirmation
    given when asking for the invoice. The prefilled invoice email carries that
    confirmation in the database's own wording.

**Order.** Apply it **before merging** the pull request: merging deploys the
website. The website deployed before it shows the R10,000 rule. With the update
applied, that website:

- refuses orders above R1,300 with its old "paid by invoice" message (Ozow
  refuses those amounts today anyway);
- never calls the new read.

**Applying.** Run `../preflight/20261117082020_online_payment_limit.check.sql`
unchanged in the SQL editor; it is read only. Continue only if the result is the
single summary row starting "online payment limit: update not applied". It also
counts payments pending at Ozow and unpaid invoices above R1,300. Then run the
update. It waits at most 5 seconds for locks and stops without changing anything
if they are busy; run it again. Run the preflight again; it should read "already
applied; current posting terms: posting-v4; posting-v5 published".

**Rollback.** `../rollback/20261117082020_online_payment_limit.down.sql`:

- restores the four earlier function bodies and the lease, so five bodies in
  all;
- drops the three new functions;
- checks at the end that all five bodies are the earlier ones and that the
  setting is gone.

The posting-v5 row stays (published terms are immutable). The rollback refuses
while posting-v5 is current, and when a replaced body is neither this update's
nor the earlier one. Revert the website release first: it calls the new read.

### 2. Make posting-v5 current: `20261117082021_switch_posting_terms_v5.sql`

It changes only `private.posting_terms_current` (posting-v4 to posting-v5). It
refuses (55000) unless posting-v5 is published with the hash above and
posting-v4 or posting-v5 is current. Every member then accepts posting-v5 once
before their next submission or edit, and new payments record posting-v5 with
their cooling-off consent. Run again, it changes nothing.

**Order.** Apply it **after** the website release that contains
`posting-v5.json` is deployed. That release serves posting-v4 or posting-v5,
whichever is current. The earlier website knows no posting-v5 and would refuse
the current terms, so no post could be submitted or edited. The full order:

1. apply update 1;
2. merge, which deploys;
3. apply update 2.

Preflight: `../preflight/20261117082021_switch_posting_terms_v5.check.sql`. It
should read "current posting-v4 (update not applied); posting-v5 published"
before, and "current posting-v5 (update already applied)" after. Open `/terms`:
"Paying, VAT & invoices" shows the new text.

**Rollback.** `../rollback/20261117082021_switch_posting_terms_v5.down.sql`
makes posting-v4 current again; acceptances of posting-v5 stay as history. The
website release can stay deployed.

**Never revert the website alone while posting-v5 is current.** The earlier
website does not know posting-v5, so nobody could post or edit. Roll back the
switch first, then revert the website.

**Tests.** `scripts/test-foundation-online-payment-limit.mjs` (in
`pnpm db:foundation:lifecycle-test`, 17 checks) proves on the throwaway
database:

- the preflights are read only and report each state;
- the update refuses a changed body or a current version other than posting-v4;
- apply, rollback (with its final check) and re-apply return the same
  fingerprint;
- members and visitors read the limit, `service_role` cannot, and nobody calls
  the setting directly;
- a total exactly at the setting is accepted and one cent more is refused;
- a raised setting reaches a long-lived session that already ran the checkout;
- the server's lease refuses a payment above the setting;
- renewals and packages above the setting are refused (a 13-slot 30-day package
  at R1,300 is accepted);
- invoice Pay now above the limit writes nothing;
- the switch makes posting-v5 current and members accept it once;
- both rollbacks work.

When another update merges first, regenerate this pull request's
`fingerprint.json`, the applied register, the manifests, `error-reasons.ts` and
`package.json`.

## Sample post hide-list removed, 18 November 2026

`20261118033538_remove_sample_post_hide_list.sql` was applied on 18 November
2026 at 05:46 UTC with the owner's approval, after the website release from this
pull request was deployed (see the applied register). It is the contract step of
`20261117144001_sample_post_hide_list.sql` (applied 18 November 2026, pull
request 105), recorded in `../contract-steps.json`. The display-only sample
posts were removed from the website in the same pull request (catalogue,
`/sample/<slug>` pages, the staff page and the showroom cards), so no release
calls the hide-list any more.

- **Removed.** `api.set_sample_post_hidden(p_slug, p_hidden)`,
  `api.get_hidden_sample_posts()`, the internal functions behind them and the
  table `private.hidden_sample_posts` with any rows it holds (catalogue slugs
  staff had removed; nothing else refers to them). No other object changes.
- **Refusal.** It refuses (55000) when only part of the hide-list exists.
  Running it again once everything is gone changes nothing.

**Order: merge, then apply.** The release from this pull request no longer lists
the two commands in its runtime manifest. The deploy preflight probes only the
commands a release lists and its update-order report only warns, so the release
deploys while production still has them (reported as "database behind by 1").
Applied before the merge, the deploy preflight of any other release in between
would find `api.get_hidden_sample_posts` missing and fail.

**Applying.** After the pull request is merged and its website release is
deployed:

1. Run `../preflight/20261118033538_remove_sample_post_hide_list.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "remove sample post hide list: update not
   applied; hidden samples: N".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "remove sample post hide list: already applied".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261118033538_remove_sample_post_hide_list.down.sql` (only with
the owner's decision; prefer a forward fix). It puts back the empty hide-list
and both commands exactly as the earlier update created them; the deleted rows
are not restored.

`node --import tsx scripts/test-foundation-remove-sample-post-hide-list.mjs`
(part of `pnpm db:foundation:lifecycle-test`) proves on the throwaway database:
the preflight before and after, read only; a partial state and a premature
rollback are refused, changing nothing; apply, rollback and re-apply return the
same fingerprints; and afterwards signed-out visitors and members cannot call
either command.

## Staff remove and restore display-only sample posts, 17 November 2026

`20261117144001_sample_post_hide_list.sql` was applied on 18 November 2026 at
00:47 UTC (production Postgres log; see the applied register). The website
feature it served was removed later, and its contract step
`20261118033538_remove_sample_post_hide_list.sql` removes it (section above).
The files named below that belonged to the website, and its behaviour test, are
no longer in the repository; the update, preflight and rollback stay as history.

The website can show a few display-only sample posts (labelled "Sample post ·
for display only") after the real posts in the showrooms, while
`SAMPLE_POSTS_ENABLED` is on. Their text and media are a static catalogue in the
website (`src/lib/sample-posts/catalogue.ts`), not database rows. This update
lets staff remove one sample, and restore it, without a code change:

- **Hide-list.** `private.hidden_sample_posts` holds one row per removed sample:
  the catalogue slug, the staff account that removed it (set to null if that
  account is ever deleted) and when. Row level security is on and no API role
  has a grant; at most 500 rows.
- **Staff command.** `api.set_sample_post_hidden(p_slug, p_hidden)`
  (authenticated) runs `internal.staff_actor('post:moderate')`: the content
  moderation capability (moderator, governor, admin) with its recent
  authenticator code rule. `true` adds the slug (one already hidden keeps its
  first who and when), `false` removes it; both are idempotent and return
  `{"slug","hidden","hidden_at"}`. A malformed slug is refused with 22023, a
  501st hidden slug with 54000.
- **Public read.** `api.get_hidden_sample_posts()` (anon and authenticated, like
  the price catalogue) returns `{"slugs":[...]}`, sorted: slugs only, never who
  or when.

Expand only: a new table and two new commands; nothing existing changes. The
website release from the same pull request leaves out every hidden sample from
the showrooms and answers `/sample/<slug>` for one with a real 404. When it
cannot read the hide-list it shows no sample at all (fail closed), so apply this
update before that release is deployed with samples switched on. With samples
off (the default) the release never reads it.

**Applying.** After the pull request is merged and before its website release is
deployed:

1. Run `../preflight/20261117144001_sample_post_hide_list.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "sample post hide list: update not applied".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "sample post hide list: already applied; hidden samples:
   0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261117144001_sample_post_hide_list.down.sql` (only with the
owner's decision; prefer a forward fix). Switch samples off first: it drops both
commands and the hide-list, and the website then shows no sample.

`node --import tsx scripts/test-foundation-sample-post-hide-list.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; a partial state and a premature rollback
are refused, changing nothing; apply, rollback and re-apply return the same
fingerprints; staff with `post:moderate` and a recent authenticator code hide
and restore a slug, idempotently, keeping the first who and when; members,
signed-out visitors, staff without a recent code and staff without the
capability are refused, changing nothing; malformed slugs and a 501st slug are
refused; the public read returns sorted slugs only, to signed-out visitors and
members; and the grants, owners and settings are as listed.

## A skipped email is no longer listed as sent, 17 November 2026

`20261117123240_skipped_email_status.sql` was applied on 17 November 2026 at
13:58 UTC with the owner's approval.

The email job finishes a queued message without sending it when there is nothing
to send: the account has no confirmed address (or is anonymous, or is closed for
a notice closed accounts do not get), or a payment was refunded or charged back
before its "Payment received" email went out. It then called
`api.complete_notification_outbox` with `p_ok=true`, which cleared
`delivery_error`, and `internal.list_my_email_history` lists every finished
message as "sent", so the member's communication page showed an email that was
never sent.

From this update (same signatures, grants and owners):

- **The outbox keeps the reason.** `internal.complete_notification_outbox`
  accepts, with `p_ok=true`, no reason (sent) or `'skipped'` (nothing sent), and
  stores it in `delivery_error`. Any other reason with `p_ok=true`, and
  `'skipped'` with `p_ok=false`, is refused with 22023 `invalid outcome`. A
  failed attempt is recorded exactly as before.
- **The history leaves it out.** `internal.list_my_email_history` skips a
  message whose `delivery_error` is `'skipped'`, whatever its attempts. The
  history keeps its two states, "sent" and "failed", so the restored
  communication page needs no new label and shows no change apart from the
  missing row.

The website release from the same pull request passes `p_error: "skipped"` when
it finishes a message without sending it. Safe in either order: a database
before this update accepts that reason with `p_ok=true` and clears it (the email
is still listed as sent, as today), and the earlier website passes no reason, so
with the update applied its skipped emails are still listed as sent until the
release is deployed. The history's JSON shape is unchanged. Emails skipped
before both are in place carry no reason and stay listed as sent until retention
removes them (30 days after they were finished).

**Applying.**

1. Run `../preflight/20261117123240_skipped_email_status.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "skipped email status: update not applied; finished
   emails: N; marked skipped: 0".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "skipped email status: already applied; finished emails:
   N; marked skipped: M" (M counts emails skipped since the update).
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261117123240_skipped_email_status.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses unless both functions have
this update's bodies, and puts back the earlier bodies byte for byte. Emails
already stored as skipped keep the reason (the earlier history lists them as
sent again).

`node --import tsx scripts/test-foundation-skipped-email-status.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: before
the update a skipped email is listed as sent and the reason `'skipped'` is
accepted and cleared; the preflight before and after, read only; the refusals
with a drifted body of either function and a premature rollback, changing
nothing; apply, rollback and re-apply return the same fingerprints; afterwards a
skipped email keeps its reason and leaves the history (also under a limit of one
and with eight attempts), a sent one is listed as sent, an email skipped before
the update stays listed as sent, failed and outcome-unknown attempts are
recorded and listed as before, mismatched reasons and a stale lease change
nothing, and the grants, owners and settings are unchanged.

## Waiting bank transfers expire after 14 days, 17 November 2026

`20261118044440_bank_transfer_expiry.sql` was applied on 18 November 2026 at
07:40 UTC with the owner's approval, before the website release from this pull
request (see the applied register).

Owner's decision of 16 November 2026: a bank transfer staff recorded (slice P2b,
with or without a customer invoice) that is still waiting for a second staff
member 14 days after it was recorded expires. Until now it could wait for ever,
and while it waited its invoice could not be paid online, voided or given
another transfer, and the account could not be erased.

Expand only (no API command, argument or grant is removed or changed; no row is
written):

- **One rule.** `internal.invoice_transfer_expired(t)`: a transfer has expired
  when it is marked `expired`, or when it still waits and was recorded 14 days
  ago or longer (`internal.invoice_transfer_expires_after()`, the one setting).
  `internal.invoice_transfer_waiting(t)` is "waiting and not expired". Every
  command and read uses them, so nothing depends on the sweep having run:
  confirming and declining refuse an expired transfer (PT409
  `transfer_not_waiting`; the record guard refuses it too); Pay now, voiding an
  invoice, recording a transfer to an invoice and the account erasure hold wait
  only for a transfer that is still waiting; the staff waiting list, the
  invoice's `transfer_waiting` flag (staff and member), the "Possible duplicate"
  count and the two new reads count an expired transfer as expired.
- **A fourth state.** `private.invoice_transfers` gains `expired_at` and the
  status `'expired'` (constraint `invoice_transfers_expired`: expired exactly
  when `expired_at` is set). `internal.invoice_transfer_guard` lets a waiting
  record change once to expired, only 14 days or more after it was recorded,
  with nothing else changed; an expired record never changes again and nothing
  is deleted.
- **The sweep records it.** `api.expire_waiting_bank_transfers(p_limit)`
  (service role only, `p_limit` 1 to 50, so the subtransactions stay within the
  per-transaction cache) marks every transfer that has waited 14 days (status
  and time), oldest first, each row in its own subtransaction: a row that cannot
  be changed is returned in `failures` with its transfer id and SQLSTATE (the
  job logs them), tried again next run, and never stops the others; every
  command, read and the audit trail already treat it as expired. Records a staff
  member holds at that moment are skipped. The website's operation job
  (`src/lib/foundation/operation-jobs.ts`, run every minute by the ops-jobs
  worker, like `run_post_lifecycle` and `run_slot_renewals`) calls it with
  `p_limit` 50 and logs a warning naming the failed rows; until this update is
  applied it logs "Sweep command missing" at most once an hour per worker
  instance (Workers logs, context `FoundationOperationJobs`) instead of failing
  the run.
- **Recording the money again.** Both record commands first mark expired any
  waiting record of the same bank credit (or, for an invoice, to the same
  invoice) that has waited 14 days, so the unique indexes (which, like the
  commands, leave out declined and expired records) still allow exactly one open
  record of a credit and of an invoice: the money is never counted twice. A
  credit that cleared more than 90 days ago is accepted only when it is exactly
  the credit (bank reference, amount, date cleared) of an expired transfer of
  the same account, and of the same invoice when that transfer named one. The
  "Possible duplicate" count includes expired records of the same money, so the
  second staff member is warned. A waiting transfer holds no slots or payment
  (an invoice attempt never sent to Ozow was already closed when the transfer
  was recorded), so nothing else is released.
- **History and records.** The staff audit trail lists each expiry as
  `payment:invoice_expired`, with no staff member, the transfer as its target
  and "Bank transfer <reference> expired: not confirmed within 14 days of being
  recorded", the way it lists a decline (at the recorded expiry, or while the
  sweep has not marked it at the moment it passed 14 days), and each resolution
  as `payment:invoice_expired_resolved` with the staff member. Retention counts
  an expired record's five tax years from its expiry. The privacy export gives
  each bank transfer's `expired_at` next to `confirmed_at` and `declined_at`.
- **Staff follow-up.**
  `api.resolve_expired_invoice_transfer(p_transfer_id, p_resolution, p_reason)`
  (payments:confirm_transfer, as confirming) records once, with an audited
  reason, that the money of an expired transfer was returned outside
  VerifyMzansi (`returned`) or never arrived (`never_arrived`): new columns
  `resolution`, `resolution_reason`, `resolved_by`, `resolved_at`, set only on
  an expired transfer and never changed after; never by the staff member who
  recorded it (42501 `transfer_resolver_same`, as for confirming). Money so
  resolved cannot use the old-money exception, and the account erasure hold
  (`transfer_waiting`) also waits for an expired transfer not yet followed up
  (`internal.invoice_transfer_follow_up_open`).
- **Two reads.** `api.get_staff_expired_invoice_transfers()` (payments:view:
  every expired transfer still to be followed up, that is neither resolved nor
  with the same money recorded again and confirmed; a paid or voided invoice or
  a declined new record is not a follow-up; oldest first, at most 200, with the
  count) and `api.get_my_invoice_transfer_expiry(p_invoice_number)` (the
  member's own invoice: when its latest transfer expired while the invoice is
  unpaid, else null; a declined transfer is still not shown). No existing read
  changes shape, so the strict website adapters of either release keep working.

The website release from the same pull request lists the expired transfers still
to be followed up on the staff payments page with an "Expired" badge, tells the
member on the invoice page that the transfer expired and the invoice can be paid
again, and runs the sweep. No email is sent. Safe in either order: with the
database first, the earlier website never runs the sweep or the reads, but
transfers that have waited 14 days count as expired at once (their invoices can
be paid again) and confirming one shows its "no longer waiting" message; with
the website first, the release skips the missing sweep (with the warning above)
and reads (no expiry shown) until the update is applied.

**Applying.** From the moment the update is applied, a transfer that has waited
14 days or more can never be confirmed. Confirm the genuine ones first.

1. Run `../preflight/20261118044440_bank_transfer_expiry.check.sql` unchanged in
   the SQL editor. It is read only. Its summary reads "bank transfer expiry:
   update not applied; waiting: N; waiting 14 days or more: M; expired: 0", and
   it adds one "problem" row for each of the M transfers ("bank transfer <id>
   (<reference>, <amount> cents) recorded <date> has waited 14 days or more:
   confirm or decline it before applying the update").
2. Staff (two people, as always) confirm each of those whose money is in the
   bank account and decline the others. Run the preflight again. Continue only
   when the summary is the only row.
3. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "bank transfer expiry: already applied; waiting: N;
   waiting 14 days or more: 0; expired: 0" (a transfer that reached 14 days in
   between is counted, not listed).
4. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261118044440_bank_transfer_expiry.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses once any transfer has been
marked expired (the earlier schema cannot hold that state) and unless the
thirteen functions have this update's bodies; otherwise it drops the sweep, the
reads and the resolution command, puts back the earlier bodies, view, indexes
and status rule byte for byte, drops the rule and the setting, and drops
`expired_at` and the resolution columns.

`node --import tsx scripts/test-foundation-bank-transfer-expiry.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
read-only preflight with its overdue rows, refusals with a drifted body and a
premature rollback; apply, rollback and re-apply return the same fingerprints;
the one rule before the sweep (no confirm or decline, also through the guard;
the staff lists, the member read, Pay now, voiding and the erasure hold follow
it); 13 days 23 hours 59 minutes still waits; the sweep marks 14 days or more,
reruns change nothing, the limit holds and a row that cannot be changed does not
stop the others; the record guard; recording the money again, once, also when it
cleared more than 90 days ago (only the exact credit of an expired transfer);
the invoice takes a new transfer and shows the expiry only to its member; old
money for another account or invoice is refused; the duplicate count flags
expired records of the same money; staff resolve an expired transfer once,
audited; staff see each expired transfer until it is followed up; the audit
trail; the privacy export; the grants; and the rollback refusal.
`scripts/test-foundation-access-matrix.mjs` gives another member an invoice
whose transfer expired, and checks that only the service role runs the sweep and
only that member reads the expiry.

## Individual slots at R69, 12 November 2026

`20261113002421_individual_slots_r69.sql` is not applied yet. It was first
reviewed as `20261112174600_individual_slots_r69.sql` and renamed when
`20261112181954_google_name_at_signup.sql` was applied before it, so the
register stays in filename order. Apply it after the website release of
`20261112173841_switch_posting_terms_v4.sql` is live and that update is applied
(it refuses with 55000 unless `posting-v4` is current and nothing else is on
sale), and before the pull request that uses it is merged: a merge into `main`
is deployed, and that release calls the new commands. It ends the pause on paid
slots that the switch started: the slots `posting-v4` describes go on sale
(roadmap Milestone 11, P2, with M3.8).

What it changes:

- **Catalogue.** Three new plan versions, the only plans on sale: one Individual
  slot for any posting area (`area` null) for 30, 90 or 180 days at 6,900,
  20,700 and 41,400 cents (R69 per slot per 30 days, no discounts), one slot
  each, at most 4 posts going live per slot per 30 days, 10 photos and 1 video
  per post. Their ids are fixed in the file (`d6ca48e5-…` 30 days, `6a449457-…`
  90 days, `ce4ef578-…` 180 days), so the browser test copy and production use
  the same ones. Earlier plans stay retired, as history.
- **One payment, one line per slot.** New table `private.payment_lines`. An
  order is one payment (one Ozow payment for the total); each slot is a line
  with its own price, its own entitlement once the payment is confirmed
  (`private.entitlements.payment_line_id`) and its own partner commission
  (`private.partner_commissions.payment_line_id`). The one-entitlement and
  one-commission-per-payment unique constraints become partial unique indexes
  for payments without lines; lines are immutable except for being reversed once
  (trigger `payment_lines_immutable`).
- **The slot checkout.** New member command
  `api.start_slot_checkout(p_plan_id, p_slots, p_expected_total_cents, p_cooling_off_consent)`.
  The server computes slot price × slots (the plan's price already covers its
  30-day periods) and refuses: without the cooling-off consent (22023; the
  consent, its time, the wording and the posting terms version are kept in the
  payment's snapshot); before the member's ID review is accepted (PT412, M3.8);
  an order above R10,000, which is paid by invoice (PT413; R10,000 exactly stays
  online); a total other than the one the member was shown (PT428); and more
  Individual slots than the person's limit (PT429). The limit is 4 at once per
  ID-reviewed person: it counts every account that has had an accepted ID review
  with the same identity fingerprint (ended reviews too), and slots in payments
  still open at Ozow. Only an account that lost access for good (closed,
  deleted, or under an approved permanent ban that was not lifted) stops
  counting, so an impostor's banned account never blocks the person; an account
  blocked for a while (an Auth ban with an end, a suspension, an emergency
  restriction) keeps counting, because its slots come back when the block ends.
  The free first post, staff grants and sponsored places are not Individual
  slots and never count. `api.start_checkout` now refuses plans (it still sells
  add-ons).
- **Confirmation.** `api.apply_provider_event` gives each open line of a
  confirmed payment its own entitlement, unless the person would then hold more
  Individual slots than their limit (for example a late success of an expired
  checkout): the money is recorded and the payment goes to staff
  (`complete_unfulfillable_target`, alerted by the payment problem job).
- **One slot refunded alone.** New staff command
  `api.record_staff_slot_reversal(p_line_id, p_kind, p_reason)` (capability
  `payments:refund`, never by the buyer's own identity): revokes that slot, ends
  the posts it paid for as a whole-payment reversal does, and reverses only that
  slot's commission. When the last open slot of a payment is reversed, the
  payment becomes refunded or charged back. `api.reverse_payment` marks every
  open line reversed, and refuses once one slot was reversed. No Ozow partial
  refund call is made: staff refund the money themselves (Ozow partial refunds
  are unconfirmed) and record it here.
- **Staff-raised limit.** New table `private.individual_slot_limits` and staff
  command
  `api.staff_set_individual_slot_limit(p_account_id, p_slot_limit, p_ends_at, p_reason)`
  (new capability `slots:raise_limit`, administrators, recent second factor): 5
  to 25 Individual slots for one ID-reviewed person until an end date at most
  366 days away, only when that account has a checked business (a live business
  profile or an approved business check); 4 ends the raise, also after the
  person's review lapsed. Rows are an audit trail: a raise is only ever ended.
  No staff screen calls it yet.
- **Staff never act for themselves.** Staff need an accepted ID review of their
  own to raise a limit or record a slot or whole-payment reversal (also
  `api.record_frontend_staff_payment_reversal`, for every payment), and
  `internal.same_identity` compares every fingerprint two accounts have had:
  staff may not act on an account of their own identity. Both are checked before
  the lock waits and again after the last authority check (42501).
- **Commission only for a delivered purchase.** The commission trigger creates
  commission (per slot line) only when the payment is fulfilled: money sent to
  staff for reconciliation earns none. The trigger fires only on a status
  change, so a later command that delivers a payment without changing its status
  must create the commission itself.
- **One line per payment.** The entitlement's and the commission's line must
  belong to the payment they name (composite foreign keys).
- **My slots.** New member read `api.get_my_slots()`: every slot the member
  holds and every slot that ended in the last 3 days, with the posts in it, the
  sponsor's name for a sponsored place, and the member's Individual slot count,
  open-payment slots and limit.
- **Fair use.** `api.activate_post` no longer counts a submission that review
  rejected: each paid slot takes at most 4 posts going live per 30 days (a new
  post and an ended post brought back each count; editing a live post never
  does).

No existing API command changes its arguments or reply shape, so the release
before it (paid slots paused) keeps working.

**Applying** (after the switch release is live and `20261112173841` is applied,
before this pull request is merged):

1. Run `../preflight/20261113002421_individual_slots_r69.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "individual slots: update not applied (apply before the
   website release that uses it is deployed); current posting terms: posting-v4;
   on sale: nothing; plan payments pending: 0; slot payment lines: none (table
   absent)".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "individual slots: already applied; current posting
   terms: posting-v4; on sale: individual_30d@1 6900 cents, individual_90d@1
   20700 cents, individual_180d@1 41400 cents; plan payments pending: 0; slot
   payment lines: 0".
3. Merge the pull request (its release deploys). `/pricing` shows R69, R207 and
   R414 with their checkout links.

The reviewed rollback is
`../rollback/20261113002421_individual_slots_r69.down.sql`. It works only before
anyone ordered a slot (it refuses once a payment line or a raised limit exists):
it takes the three plans off sale, restores the seven earlier function bodies
and removes everything the update added, back to the paused state of
`20261112173841`. Applying the update again after it is refused while the
retired plan rows exist: a new update must publish new plan versions. Once slots
were ordered, stop sales with a new reviewed update that retires the three
plans, and fix forward.

Rollback order: **run the rollback first, then revert this pull request.** With
the slots off sale, this release shows paid slots as paused (the checkout page
and route refuse with the paused message, and My slots says the slots cannot be
shown right now). Reverting the website alone while the slots are on sale would
leave `/pricing` linking to slots that the earlier checkout cannot sell
(`api.start_checkout` refuses them). Roll back `20261112173841` only after this
rollback.

`node --import tsx scripts/test-foundation-individual-slots.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after; the refusals without `posting-v4` and with another
plan on sale; apply, rollback and re-apply return the same fingerprints; the
catalogue; price = 6,900 cents × 30-day periods × slots with one line per slot
and the consent in the snapshot; a total other than the one shown is refused;
retired plans and `api.start_checkout` cannot sell a plan; no checkout before an
accepted ID review or without the consent; a fifth Individual slot is refused,
also from a second account of the same person and while slots wait in an open
payment; a pending payment for another number of slots is replaced or returned;
only administrators raise a limit, only for a checked business, up to 25, with
an end date, and the audit rows cannot be changed; 25 × 180 days (R10,350) is
refused online, 24 × 180 days and R10,000 exactly stay online; one slot
activates a Market, a Business and a Tourism post and its fifth post going live
in 30 days is refused, a rejected submission not counting; refunding one slot of
a three-slot order revokes only that slot, ends only its post and reverses only
its commission, the last slot reversing the payment; a late payment above the
limit is recorded and sent to staff; `api.get_my_slots`; staff never raising a
limit for, or reversing a payment of, their own identity (a second account of
the same fingerprint); staff without an accepted ID review of their own refused,
and a review that makes staff the same person while they wait seen after the
wait; no commission for a payment that delivered nothing; a temporary block (an
Auth ban with an end, an emergency suspension) keeping an account's slots
counting and a closed account's slots no longer counting; ending a raise after
the review lapsed; the grants; and that the rollback refuses once a slot was
ordered.

## Google sign-ups start with their name, 12 November 2026

`20261112181954_google_name_at_signup.sql` is not applied yet. It needs no
earlier pending update and changes no table, grant or API command.

When an Auth user is created, the trigger `create_account_profile` on
`auth.users` (`internal.create_account_profile`) creates the member's profile.
It read only the sign-up detail `display_name`, which the website's email
sign-up form sends. Google sign-up stores the name as `full_name` and `name`
(sometimes also `given_name` and `family_name`), so every Google account started
with no display name: its profile page and public name ("Thando D.") stayed
empty until the member typed one. From this update:

- **A name from the sign-up details.** New
  `internal.signup_display_name(details)` returns the first of `display_name`,
  `full_name`, `name`, and `given_name` + space + `family_name` (only when both
  are non-empty strings) that, trimmed and NFC-normalised, passes the person
  name rule (`internal.person_name_valid`) and is not reserved
  (`internal.person_name_reserved`); otherwise nothing. Sign-up details are
  written by the member or the sign-in provider, so they give only a display
  name the member could also have typed: never a legal name, a name lock, a role
  or a verification. No API role can run it.
- **New profiles.** `internal.create_account_profile` uses it. Anonymous users
  are still skipped and an existing profile is left as it is.
- **Existing profiles, once.** A profile with no display name and no locked
  legal name, of a non-anonymous Auth user that is not deleted, gets the name
  from that user's sign-up details, with its revision raised by one as an
  ordinary profile save does: a page that still holds the earlier revision is
  refused ("profile changed; reload it") and reloads. Profiles the details give
  no valid name stay without one. Running the update again names nobody twice.

**Order: any time.** No website release depends on it. Until it is applied and
recorded, the release preflight lists it as "behind" (a warning; it has no
command to probe). Apply and record updates in filename order: if an update with
an earlier name is still pending, apply that one first.

**Applying.**

1. Run `../preflight/20261112181954_google_name_at_signup.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "reviewed body, update not applied". It also counts the
   profiles without a name and those the update will name.
2. Run the update, then the preflight again: it must now read "already applied"
   with "of which the update names: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.

The reviewed rollback is
`../rollback/20261112181954_google_name_at_signup.down.sql` (only with the
owner's decision; prefer a forward fix). It restores the profile trigger byte
for byte and drops the helper. Names the update gave stay: each passes the
person name rule, and the member can change it.

`node --import tsx scripts/test-foundation-google-signup-name.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves, on the throwaway database: that
Google sign-ups got no name before; that the preflight is read only, counts the
profiles the update will name, and reports a drifted trigger or a helper with
another body, which the update refuses, as it refuses a premature rollback; that
the one-time fill names unnamed profiles from `full_name`, `name` or
`given_name` and `family_name` and leaves named, locked, anonymous, deleted,
invalid and reserved ones untouched; that a save holding the earlier revision is
refused; the order of the candidates, fallback past an invalid or reserved one,
trimming and NFC, and the names refused; that sign-up details set no legal name,
lock or role; who may run the helper; and that apply, a repeated apply, rollback
and re-apply return the same fingerprints.

## The free week starts at the first approved post, 10 November 2026

`20261110045944_intro_trial_at_first_approval.sql` is applied: the coordinator
applied it to production on 10 November 2026 at about 11:30 UTC. Before it, the
preflight returned the single summary row "reviewed live bodies, update not
applied" with every count 0 (no earlier trials to restart or keep, no member
with an unfunded post in review); the update returned no rows; afterwards the
preflight read "already applied; trials to restart: 0". Production's fingerprint
then matched the replay through this update in every category
(`../fingerprint.json`, `productionCheck`), apart from the known `schema_grants`
item that the Auth hook adds (`knownDifferences`).

It needs `20261109104020_post_expiry_rules.sql` and refuses to run without it.
The website release that reads `api.get_my_intro_trial` also works with a
database that does not have the update: the trial card stays hidden and the
trial email has no date.

Until now the every-minute job (`internal.reconcile_intro_trials`) gave every
fully verified member a 7-day introductory trial as soon as verification
completed, and recorded the member's identity as used. Drafting and review time
came out of the 7 days, approval was refused once they had run out, and a member
who did not post within the week lost the free post for good. From this update:

- **Verification creates no trial.** The job's command keeps its signature and
  grants nothing.
- **Submitting without a plan.** A new Market or Business post submitted without
  a plan, by a member whose free week is unused (no trial or sponsored place
  holds the identity, and it is not banned), goes to review waiting for the free
  week (`private.intro_trial_requests`, added by `internal.queue_intro_trial`,
  which `internal.submit_post` calls where it used to refuse with PT402). It
  holds no slot and nothing is granted. One post at a time can wait; another one
  is refused like a full slot (PT409 "all posting capacity is in use").
  `internal.consume_frontend_post_command` no longer grants a trial at
  submission.
- **Approval.** When staff approve that post (`internal.moderate_post`,
  `internal.start_intro_trial`), a free slot the member already has (a plan
  bought while the post waited, a sponsored place, a trial granted by staff)
  that runs at least 7 more days and allows the post's photos and videos pays
  for it and the free week stays unused (owner decision). Otherwise the member's
  7-day trial is granted from that moment, through the unchanged
  `internal.grant_intro_trial` (which records the identity and queues the
  `trial_started` email), and the post is shown until the trial ends. Review
  time no longer shortens it. If the week was used meanwhile (or the identity is
  banned), any free slot that allows the post's media pays for it; with none,
  approval is refused and staff are told to reject the post or ask the member to
  choose a plan. `internal.moderate_post` now takes the owner's subject lock
  before the post rows, as owner commands do.
- **Rejection does not use it.** The request is removed; resubmitting the post,
  or another post, waits for the free week again.
- **Reads.** The posting allowance reads report the offer as unavailable while a
  post waits for it, and the 30-day choice as unavailable (same fields; the
  posting form then shows its 30-day option disabled). New
  `api.get_my_intro_trial()` (members) gives the free week's status (`running`
  with its start and end, else `used`, `unavailable` for a banned identity,
  `awaiting_approval`, or `available`); the dashboard's trial card shows the
  end. The mail claim adds `trial_ends_at` and `trial_funds_post` (whether the
  trial pays for a live post) to `trial_started` notices, so the email states
  the end date: for a trial that pays for the approved post, that the post is
  live until then; for a staff or service grant that pays for no post yet, only
  that the allowance runs until then. The website deployed before this update
  keeps working with all of these.
- **Trials granted under the earlier rule.** The update withdraws every active
  introductory trial that never paid for a published post (status `revoked`,
  reason `intro_trial_restarts_at_first_approval`), removes its unconverted post
  claims and its identity record, and drops its unsent `trial_started` email, so
  the member gets the full week from their first approved post. That includes a
  long lapsed trial the member never used: they get a new week. A trial counts
  as used, and is kept unchanged, when a post it funds is live, paused or sold;
  a post expired, was sold or was archived in it; staff approved a post while it
  held the post's slot; or a post it funded was deleted. A post awaiting review
  in a withdrawn trial's slot leaves the slot and waits for the free week. A
  sponsored member's trial that still runs is kept (the sponsorship pays only
  for business posts); once it has lapsed, the member's identity record moves to
  the sponsorship instead of being removed (a sponsorship binds the identity,
  and the trial's record kept the sponsorship from writing its own), so they
  still get no later trial. This step runs on every application, but only for
  trials granted before the first application plus one minute
  (`private.intro_trial_rule`): running the update again catches a trial the
  earlier job granted while it ran, and leaves later staff or service grants
  alone.
- **Posts in review with no funding.** A new Market or Business post awaiting
  review that no current slot pays for (its plan ended during review) cannot be
  approved today. The update lets the oldest such post of each member wait for
  the member's free week, when that week is unused.

The free week is 7 days (OD-08 b). Staff and service grants through
`api.grant_verified_intro_trial` still start at once. A member who reactivates
an unchanged, earlier-approved post without a plan is asked for a plan, as
before; resubmitting a changed post uses the free week.

Known limits, recorded for later:

- Between applying the update and deploying the website release, the deployed
  website shows staff its generic "reload the queue" refusal in the rare case
  that approval finds no plan or free week (PT402); the release words it.
- The privacy export does not include `private.intro_trial_requests` (a post's
  link to the free week while it waits). The deployed website requires exactly
  33 export datasets, so adding a 34th from the database would break exports
  between apply and deploy. Follow-up, expand then contract: the website accepts
  33 or 34 datasets first, then the database adds this one.

`pnpm db:foundation:lifecycle-test` proves, on the throwaway database, that
before the update the job starts the trial at verification; that the preflight
is read only and counts the earlier trials; that the update and the rollback
refuse unexpected bodies; the conversion of the earlier trials, including two
that look used (a post rejected in the trial and later published under a plan; a
post published earlier under a plan and back in review in the trial's slot), one
used without a review (an unchanged post reactivated in it, then archived; kept)
and two of sponsored members (a running one kept; a lapsed one withdrawn with
its record moved to the sponsorship, no later week); that apply, rollback (which
gives a waiting post its own slot, a free slot of the member or a trial from
that moment) and re-apply return the same fingerprints and a repeated run
changes nothing; that a repeated run lets the oldest unfunded post in review of
a member with an unused week wait for it, and leaves a staff or service grant
made after the first application alone; that verification creates no trial and
the 30-day choice is unavailable; that a post submitted without a plan, through
the API or the form (whatever length it picked), waits without a slot or a
grant, and only one at a time; that its approval after 10 days in review starts
exactly 7 days from the approval and the post ends with it; the mail claim's
trial end and whether the trial pays for a live post; that a rejected post
leaves the free week unused and its resubmission waits again; that a plan bought
while the post waited pays for it and leaves the week unused, while a plan
ending within the week or one that does not allow the post's photos does not;
that a week taken while the post waited makes approval use the member's running
trial, and refuses a banned member with no slot (whose card no longer says the
week awaits approval); that a waiting post which got its own slot leaves the
week unused; that no free week is left after it ends or for a banned identity;
that another member can neither read nor decide it; and that concurrent
submissions, two moderators approving at once, and submissions racing the first
approval never grant a second trial.

**Applying.** Production has every earlier update. Apply it at a quiet time:
creating the table's foreign keys holds a lock on `auth.users` and
`private.posts` until the update commits, which holds up sign-ups and post
changes for its duration (about a second at today's size), and step 7 takes the
subject lock of each member with an active trial or a post in review.

1. Run `../preflight/20261110045944_intro_trial_at_first_approval.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "reviewed live bodies, update not applied";
   it also counts the earlier trials the update restarts (sponsored members
   among them) or keeps, and the members with an unfunded post in review.
2. Run the update. It waits at most 5 seconds for anything it needs and stops
   without changing anything if it cannot (or if Postgres reports a deadlock
   with a member's command); run it again. Run the preflight again: it must now
   read "already applied; trials to restart: 0". If a member was verified while
   the update ran, it shows 1 or more; run the update again.
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   record it (its register line and `productionCheck`) as described above.
4. Then merge and deploy the website release.

The reviewed rollback is
`../rollback/20261110045944_intro_trial_at_first_approval.down.sql` (only with
the owner's decision, after reverting and deploying the website release; prefer
a forward fix). It restores the earlier bodies, so verification starts a trial
again. A post still waiting for the free week first gets funding: the slot it
already has, a free slot of the member, or a trial from that moment. Trials the
update withdrew stay withdrawn and their members get a new one from the job.
Dropping the tables takes a brief exclusive lock on them.

## Post commands with a target post, 9 November 2026

`20261109224337_fix_post_command_target.sql` is applied: the owner applied it to
production on 10 November 2026, after the Posting Terms v3 update and after its
preflight returned only the summary row. Production's fingerprint then matched
the replay through this update in every category (`../fingerprint.json`,
`productionCheck`), apart from the known `schema_grants` item that the Auth hook
adds (`knownDifferences`).

It fixes saving an edit of an existing event.
`internal.consume_frontend_post_command` (from
`20261104002445_restored_post_commands.sql`) built the edited event window with
`input->'detail'-'contact_channels'`; `-` binds tighter than `->`, so PostgreSQL
read `input->('detail'-'contact_channels')` and every command that reached that
line failed with 42725 ("operator is not unique"). That line runs only for an
event command with a `target_id`, which the website sends when a member saves an
edit of an existing event (`PUT /api/promotions/<id>`), in any state the edit
flow allows: draft, rejected, paused, expired or live (a live event's edit
becomes a review copy). Creating an event and editing a listing or business
never reach it. The SQL lint gate found it (`../lint-baseline.json` recorded it
as its only known error until this update).

The update replaces that function with the same body and one change, the
parentheses: `(input->'detail')-'contact_channels'` (the event's start, end and
time zone). No table, grant, owner or API signature changes, and no data is
touched. It refuses to run unless the live body is the reviewed one or already
the fixed one, so a repeated run changes nothing.

`pnpm db:foundation:lifecycle-test` proves, on the throwaway database, that
draft, rejected, paused and live event edits fail with 42725 before the update
and save the new window after it (draft, rejected and paused edits also save a
new contact choice; a live event's edit becomes a review copy and the public
event is unchanged), that an expired event's edit saves the new window and keeps
its status and deletion date, that another member's edit (42501) and an edit of
an event awaiting review (PT409) are refused and change nothing, that an edit
staged before the update and sent again is saved once, that the preflight is
read only and reports a body it does not expect, that the update and the
rollback refuse an unexpected body, and that apply, rollback and re-apply return
the same fingerprints.

**Applying.** Production already has every earlier update (the last,
`20261109173012_posting_terms_v3.sql`, was applied on 9 November 2026), and no
website release depends on this one:

1. Run `../preflight/20261109224337_fix_post_command_target.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "reviewed live body, fix not applied" (it also counts
   unexpired event edits that were staged without a result; a member who sends
   the unchanged form again from the same page before it expires has it saved
   after the update).
2. Run the update. It waits at most 5 seconds for anything it needs and stops
   without changing anything if it cannot; run it again.
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`, which lists this update under
   `productionCheck.pendingApplication`. Once production's fingerprint matches,
   move `matchedThroughUpdate` and `matchedFingerprints` forward.

The reviewed rollback is
`../rollback/20261109224337_fix_post_command_target.down.sql` (only with the
owner's decision; it brings the failure back, so prefer a forward fix).

## Posting Terms v3, 9 November 2026

`20261109173012_posting_terms_v3.sql` is applied: the owner applied it to
production on 9 November 2026, after the post expiry rules update and after its
preflight returned only the summary row. Production's current posting terms are
now `posting-v3` with the hash below, and its fingerprint matches the replay
through this update (`../fingerprint.json`, `productionCheck`). It needs
`20261109104020_post_expiry_rules.sql` first and refuses to run without it. It
publishes posting terms version `posting-v3`
(`src/lib/legal/terms-documents/posting-v3.json`, canonical hash
`p2X2YRoaYDOwYDtYhTiFcznVghgyGzRmTJ6BexfhkQE`) and makes it current. It changes
no function or table.

`posting-v3` is `posting-v1` with three paragraphs changed to state the rules of
the post expiry rules update: a slot is reused once its post is deleted and a
new post in it runs for the plan's remaining days; when a plan ends (or a refund
or chargeback withdraws it) its posts are hidden, the owner is emailed and has 3
days to buy a plan and reactivate, then the post and its media are deleted (up
to 24 hours more while a payment is being confirmed; a confirmed payment keeps
the post for 3 days after it); a sold post is deleted 3 days after it was marked
sold, keeps its slot until then and can be undone within the 3 days; a paused
post keeps its slot and its plan's period keeps running; an event is deleted
when it ends; the records linked to a post are deleted with it. `posting-v2`
(seeded by the baseline, never current, absent from production) is untouched.

Members accept `posting-v3` once before their next submission or edit (the
submission guard and the edit-consent check compare with the current version);
`/post/create` shows the acceptance step. `posting-v1` promises at least 14
days' notice of a material change; the owner decided on 9 November 2026 to start
now (there are no member posts yet), with a legal review of `posting-v3` to
follow.

`pnpm check:foundation-api` (run by every build) checks that the published
version files recorded in `../assembly.json` are unchanged, that every later
version in `catalogue.json` is inserted by an update with its hash, and that the
catalogue's active version is the one the last update makes current.
`pnpm db:foundation:lifecycle-test` applies this update after the expiry rules,
runs its preflight, rolls it back and applies it twice more.

**Applying.** After the post expiry rules update, and with or after the website
release that contains `posting-v3.json` (that release serves either version, so
deploy it first):

1. Run `../preflight/20261109173012_posting_terms_v3.check.sql` unchanged in the
   SQL editor. Continue only if its result is the single "summary" row.
2. Run the update. It waits at most 5 seconds for the posting terms row and
   stops without changing anything if it is busy; run it again.
3. Open `/terms`: it shows "Posting terms · posting-v3".

The reviewed rollback is `../rollback/20261109173012_posting_terms_v3.down.sql`
(only with the owner's decision, and only together with the post expiry rules
rollback; prefer a new version).

## Post expiry rules, 9 November 2026

`20261109104020_post_expiry_rules.sql` is applied: the owner applied it to
production on 9 November 2026, after the post lifecycle guards update and after
its preflight returned only the summary row. Production's fingerprint then
matched the replay through this update (`../fingerprint.json`,
`productionCheck`). It needs `20261109073519_post_lifecycle_guards.sql` first
and refuses to run without it. It sets the deletion rules decided on 9 November
2026:

- **Market and Business posts** hold a plan slot. When a post's paid run ends
  (its `visible_until`, or a refund, chargeback or sponsorship end of the plan
  that funds it), the post expires, releases the slot and its owner gets
  `post_expired`. The post stays hidden for 3 days (`deletes_at` = `ended_at` +
  3 days), during which its owner can buy a plan and reactivate it; then the
  lifecycle job deletes it with its media. The 7- and 21-day reminders are no
  longer queued.
- **Sold.** A sold post keeps its slot until it is deleted, 3 days after it was
  marked sold; its owner gets `post_sold` (once per sale and slot: neither a
  refund that later frees the slot nor undoing and redoing "sold" repeats it),
  can delete it earlier to reuse the slot, or reactivate it within the 3 days
  (it then runs for the slot's remaining days while that slot is still valid,
  with no new activation). `api.release_post` no longer frees the slot of a
  paused or sold post.
- **Archived.** Archiving is not offered by the website (only by
  `api.set_post_state`) and is not part of the decided rules. It keeps its
  earlier behaviour of releasing the slot at once, and the post is deleted 3
  days later like other ended posts, without a notice: the owner chose to take
  it down, and the deletion date is in the owner reads.
- **Events.** An event is deleted when it ends (`event_details.ends_at`,
  followed through edits by the `event_deletion_clock` trigger), whatever its
  state (draft, under review, rejected, live or paused), with no grace period
  and no expiry notice (an event already over at the update keeps its 3 days
  through later changes of state). An event's end can only be set or moved to a
  time still ahead (`create_core_draft`, `save_business_event_context`;
  approving an edit already refuses an ended window). Its place in the limit of
  10 free events per 30 days returns only when its owner deletes it before it
  ends; deletion by the job never returns it. The owner-delete release is one
  statement in `internal.delete_post`, kept as decided (DEC-32) and easy to
  remove if that decision changes.
- **Paused.** Pausing keeps the slot and does not stop the run's clock: a paused
  post that holds a slot expires like a live one, and reactivating it spends no
  further activation. Such a post is not deleted as idle. Paused posts without a
  slot (paused before this update, or held by staff when their plan was
  reversed) keep the 45/60-day idle rule.
- **Late payment** (`internal.ended_post_decision`,
  `private.post_deletion_extensions`), for an expired Market or Business post
  only (a sold or archived post goes at its date). Plan payments count when they
  were started from 24 hours before the post expired (a last-minute renewal)
  until its deletion date, the extension included. One still being confirmed
  when the 3 days end (a confirmed payment still being reconciled counts) moves
  the deletion date once, by 24 hours. Once such a payment is confirmed, the
  post is kept until 3 days after that payment and the owner gets `post_kept`,
  so a member who has paid always has time to reactivate. The 24 hours are
  always waited out: a failed, cancelled or expired payment can still be
  confirmed late by the provider, and a member may retry. A payment confirmed
  only after the post was deleted is a refund case for staff.
- **Open reports.** A post with an open report (not yet handled by staff) is
  kept until the report is handled, for at most 7 days after the date it would
  otherwise be deleted (`internal.post_report_deferred`); staff can place a hold
  to keep it longer.
- **Notices.** The mail claim now returns each post's deletion date and whether
  it still holds a slot, so the expiry, sold and kept emails give the date. A
  post already due for deletion gets the deletion notice instead of a late
  expiry notice (for example when its date passed during a legal hold; it is
  deleted at the first run after the hold is released). Member actions cannot
  flood the queue: the expiry notice is once per run, the sold notice once per
  sale and slot, the kept notice once per run, the idle warning once per idle
  period and the deletion notice once per post.
- **Cutover.** Nothing that has already ended is deleted sooner than 3 days
  after the update: expired, sold and archived posts get the later of now + 3
  days and `ended_at` + 3 days, and their owners get the new notice once
  (expired events and archived posts excepted). Events that have not ended their
  run get their end, or now + 3 days when it has already passed.
- **Owner reads.** `api.get_my_frontend_post_v2` and
  `api.list_my_frontend_posts_v2` return the original owner post data plus
  `deletes_at`. The original reads are unchanged.
- Recent edit copies no longer keep an ended post or an ended event from being
  deleted (they can never be approved); they still keep idle drafts, rejected
  and paused posts, as before.
- Deleting a post also deletes what is linked to it: its enquiries and their
  notifications, business check requests, organisation applications and
  affiliations, offline review records, trial claims and queue claims. Reports
  and CIPC reviews are kept with the link cleared.

Staff content holds and legal holds keep protecting posts as before: a held post
neither expires nor is deleted. There is no dispute state: to keep a refunded or
charged-back post during a dispute, staff place a legal hold.

**Website compatibility.** The website release with this update works with the
database before or after it: the owner reads fall back to the original reads
when the `_v2` reads are missing, and the mail job claims the earlier list of
kinds when the database refuses the new ones. The release before it keeps
working once the update is applied (the original reads are unchanged and the
earlier list of kinds is still accepted).

`pnpm db:foundation:lifecycle-test` covers both lifecycle updates: for this one
it runs the preflight (including rows it must report), applies the update, rolls
it back and applies it again, checks the cutover dates and notices, and then
each rule through the production API commands: the 3-day edges, deletion and
reactivation during the grace period, sold and paused slots, slots lost by a
refund or sponsorship end, the late-payment window, extension and keeping
(including a payment retried during the extension), open reports, events in
every state at their end and their places, past event ends refused, held posts,
the owner reads, the mail claim, and races between the job and a new post or an
undo of "sold".

**Applying.** After the post lifecycle guards update. Deploy the website first
(recommended: the expiry and sold notices queued at the lifecycle job's first
run are then sent with their dates), then:

1. Run `../preflight/20261109104020_post_expiry_rules.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row; the summary says how many posts get a new deletion date and
   how many will change state at the lifecycle job's first run.
2. At a quiet time, run the update. It first takes its table locks without
   waiting: `private.posts` (exclusive: reads go on, writes wait),
   `private.event_details`, `private.payments` and `private.reports` (no writes
   until it commits) and `private.outbox_events` (exclusive). If any is busy it
   stops at once and changes nothing; run it again.
3. Run `../fingerprint.sql` and compare with `../fingerprint.json` (this update
   is listed under `productionCheck.pendingApplication`).

The reviewed rollback is `../rollback/20261109104020_post_expiry_rules.down.sql`
(only with the owner's decision; prefer a forward fix). Its header lists what a
rollback changes.

## Post lifecycle guards, 9 November 2026

`20261109073519_post_lifecycle_guards.sql` is applied: the owner applied it to
production on 9 November 2026, after its preflight returned only the summary
row. It changes no member-facing rule and adds no new deletion; it prepares the
deletion rules that follow it.

- **Staff content holds block deletion.** While a hold from the Hide action is
  open, the lifecycle job neither deletes the post nor sends a deletion warning,
  the owner cannot mark it sold, archive it or delete it (the same
  `PT423 staff_visibility_hold` refusal as for resubmission; the website now
  says "This post is hidden while our team reviews it. You can't republish, sell
  or delete it until the review is finished."), and a trigger refuses any other
  delete of the post row. The media the post showed when it was hidden are
  recorded against the hold, so media cleanup leaves them alone until that hold
  is released. After the last release, an idle post's 45/60-day clock counts
  from the release. Legal holds behave as before.
- **A stable deletion clock.** `posts.ended_at` records when a post's public run
  ended (expired, sold or archived) and `posts.deletes_at` when the lifecycle
  job may delete it (today `ended_at` + 30 days). Publication or a new
  submission for review clears both. The edit flow passes an ended post through
  `paused` inside one transaction; that no longer moves the deletion date or
  re-sends `post_expired` and its reminders, whose keys now use `ended_at`.
  Existing ended posts are backfilled from `status_changed_at`, so their dates
  and notice keys do not change. Approval digests leave both columns out.
- **Kept free-event submissions.** `private.event_submissions` records each
  submission of an original free event. The limit of 10 per rolling 30 days
  counts distinct events from it, so an event removed by the lifecycle job or
  any other path keeps its place. As decided by the owner, deleting one's own
  event still returns the place; the five-active limit is unchanged. The table
  is append-only apart from that one release; rows leave it only once they are
  older than the window (purged by the lifecycle job) or with their erased
  account. The backfill copies each original event's latest submission from the
  last 31 days. The rows are part of the member's privacy export (dataset
  `event_submissions`; the export route requires all 33 datasets).

`pnpm db:foundation:lifecycle-test` (CI step in `foundation-sql-lint`) replays
this folder into the throwaway Postgres 17 container, runs the read-only
preflight (including rows it must report), seeds synthetic members and posts
before the update, applies it, rolls it back with the rollback file and applies
it again (the schema fingerprint returns to the same values each time), and then
checks the backfills, each guard through the production API commands, and races
between a hide and an owner delete, mark-sold, the lifecycle job, and two event
submissions at the limit. The Hide action and most releases are mirrored in SQL
with the same rows and lock order; one release runs the real staff command, with
a synthetic staff session, and restores a hidden event. The only stand-in is
`internal.current_verified_identity`, so free events reach the fair-use check.

**Applying.** Apply it before any application release that depends on it:

1. Run `../preflight/20261109073519_post_lifecycle_guards.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row; any other row is a post the backfill would refuse, or an open
   staff hold on an ended post to review first.
2. At a quiet time, run the update. It first takes every table lock it needs, in
   one fixed order and without waiting: `private.posts` (exclusive), then
   `private.frontend_content_holds`, `private.media_objects` and `auth.users`
   (no writes, including sign-in bookkeeping, until it commits, which takes well
   under a second). If any of them is busy it stops at once with a lock error
   and changes nothing; run it again.
3. Run `../fingerprint.sql` and compare with `../fingerprint.json`, which lists
   this update under `productionCheck.pendingApplication`. Once production's
   fingerprint matches again, move `matchedThroughUpdate` and
   `matchedFingerprints` forward (`scripts/foundation-replay.test.mjs` checks
   them).

The reviewed rollback is
`../rollback/20261109073519_post_lifecycle_guards.down.sql` (only with the
owner's decision; prefer a forward fix). Its header lists what a rollback loses,
including possible repeat expiry emails for posts edited while the update was in
place.

## Staff content holds, 5 November 2026

`20261105043010_native_report_content_holds.sql` is applied. The selected Hide
action carries the report and target revisions plus the current claim. Only an
independent reviewer with the assigned hide capability and recent authenticator
proof can apply it. The report closure, receipt, paused post and independent
distribution hold commit together. Core publication and owner
reactivation/resubmission cannot bypass an active hold. The owner's existing
status display distinguishes a staff hold from an owner deactivation.

The versioned report reader preserves the old DTO and adds target revision only
to the holder's private fence. Each complaint can keep a separate hold. A
different authorized reviewer must release a hold; another active hold keeps the
post hidden. Last release restores unchanged, eligible content using its
existing approval/funding and current identity/time checks. It does not extend
the paid window. Later owner edits remain unpublished until explicit
resubmission and review, even when a second hold was placed after the edit.

Native GoTrue/TOTP fixtures verify stale target and moderator refusal, exact
hide/release retries, public search exclusion, owner/core publication refusal,
two independent holds, and changed-content resubmission. The latter uses a
separate verified fixture member: deleting the first member's trial post does
not grant another introductory activation. A posting-gate projection gap for
spent activation periods is tracked separately. Focused route/client tests,
types, lint and duplication checks passed. Hosted SQL verified RPC audiences,
new capability assignments, private RLS and the active public guard; no real
holds were created. Release is available at the native command boundary; the
selected appeal/enforcement workflows, hide notices and account suspension/ban
still need their remaining integration.

## Account warning notices and delivery, 5 November 2026

`20261105035413_native_report_warning_delivery.sql` is applied. The represented
report command now records an informational warning, resolves the reviewed
report, and writes one owner-only notice and one durable delivery event in the
same transaction. It does not change identity, posting allowance or account
access. The actual review reason is available to the owner through the selected
notification interface and is included, escaped, in the operational email. Exact
receipt retries do not repeat either notice.

The versioned notice reader keeps the old DTO compatible. The mail consumer
declares its supported kinds, and the old worker claim cannot consume a new
warning event or exhaust its attempts during rollout. Delivery and completion
remain bound to one current lease, with the existing durable provider key.
Missing warning details fail before sending; removed recipients are completed
without mail. Closed warning subjects do not receive queued warning email.
Receipt effects are included in the protected staff audit view.

The native GoTrue/TOTP fixture verifies notice ownership, real reason, duplicate
prevention, legacy reader/worker compatibility, supported-kind mail context,
wrong-lease refusal and audit visibility. HTTP, inbox, worker and template tests
verify the selected interface, missing-detail refusal, complete escaped reasons
and delivery keys. Types, lint, import, dead-code and duplication checks passed.
Hosted SQL verified audiences, warning RLS and no browser table access, with
zero real warning records/jobs created. All local mail delivery was mocked;
genuine provider delivery and the remaining hide/suspend/ban integration remain
separate outstanding work.

## Represented report dismissal, 5 November 2026

`20261104231625_restored_report_actions.sql` is applied for dismissal. The
selected action dialog passes the report revision and exact claim tuple. Native
conflict, current reviewer/MFA and resolution checks still run in one
transaction. A private receipt binds the actor, reason, claim and outcome; an
exact retry acknowledges the original closure only within its original lease. A
different reason, lost claim, stale revision or contradictory reply cannot
become a successful dismissal. Receipts follow the parent report's retention,
and have RLS with no browser/service table access.

Immediate duplicate clicks send one request. A delayed response can refresh the
queue but cannot close or overwrite a newer report dialog. Existing layout,
controls and status filters are retained. Native warn/hide/suspend/ban effects
remain outstanding and explicitly fail without a successful acknowledgement;
this partial mutation integration must not be described as a completed report
enforcement workflow or released as complete.

Native GoTrue/TOTP fixtures verify closure, revision/claim refusal and one exact
receipt under retry. HTTP and client regressions cover scope, CSRF, MFA, reply
validation, double clicks and late responses. Focused native/source checks,
types, lint and duplication checks passed. Hosted SQL verified API audiences,
receipt RLS, no browser receipt access and no seed receipts. The provisioned
runtime preflight passed; real-account browser acceptance remains separate.

## Report queues and program activity, 5 November 2026

`20261104224230_restored_staff_report_queue.sql` is applied for reads. The
selected report/status filters and Market, Business and Tourism & Events panels
now receive native independent summaries, actual waiting counts and claim
metadata. A report body and action fence are returned only through the current
holder's native review check. Foreign nonces, reporter identity and abuse
fingerprints are excluded. Claimed reports remain in waiting totals. Own held
items remain reachable beyond the ordinary page limits. Report revisions and the
original program are derived on database writes, including invalidation when an
underlying record changes.

Program activity and South African daily counts now use native moderation and
report-resolution facts. These minimal summaries contain no reviewer rationale,
report body or evidence payload. Unknown/deleted content is not assigned a
guessed program. Required authenticator confirmation leaves the combined area
read before its partial/unavailable rendering; it is not swallowed as an empty
section. Existing layouts, status controls and error states are retained.

The local GoTrue/TOTP fixture verifies claimant-only bodies, foreign lease
secrecy, revision/program derivation, complete descriptions, actual action
counts and the runtime DTOs. Focused source/native service, page and count
tests, types, lint and duplication checks passed. The three outdated
dashboard/profile fixtures from the broad unit run now supply the required
identity-state DTO; their focused regressions pass. Hosted SQL verified exact
API audiences, RLS, no browser table read and an enabled record guard, with no
seeded reports. Report enforcement actions are still a separate outstanding
integration; this read update does not claim that those mutations or the full
release are ready.

## Report submission transport, 5 November 2026

`20261104222400_restored_report_workflow.sql` is applied for submission. The
selected report dialog sends its existing fields. The trusted command validates
the represented post kind under its lock, keeps the selected reason separately
from the native category, and stores the complete validated description. The
previous adapter's reason prefix and truncation are removed. Native publication,
self-report, active-reporter and duplicate-report checks remain authoritative.
Old records keep an unknown frontend reason; nothing is guessed or backfilled.

The route keeps origin/CSRF, CAPTCHA, blocking rate limits, optional verified
reporter identity and the keyed anonymous fingerprint. Unexpected caller
authority or unsupported fields are refused. It validates the actual native
acknowledgement and does not replay a submission after an uncertain response.
Duplicate reports now have a clear response. This update does not complete the
staff report/enforcement screens; their native integration remains outstanding.

The native fixture verifies target-kind mismatch, self-report refusal, the exact
2000-character description and reason, duplicate refusal and service-only
execution. Native/source HTTP tests verify the real route delegation, anonymous
versus unavailable Auth, CAPTCHA/CSRF/rate-limit fences and malformed replies.
Types, lint and dead-code checks passed. Hosted SQL verified execute audiences,
RLS, no browser insert grant and no seeded reports. No real report, notification
or external message was submitted during these checks.

## Preserved audit history, 5 November 2026

`20261104221219_restored_staff_audit_page.sql` is applied. The selected search
form, cards, numbered pagination and unavailable/empty states use a private,
closed native event projection. The existing native cursor reader is unchanged.
The restored page also includes recorded governance rationales, feature-setting
changes and evidence handoffs. Action names use the selected underscore naming;
action prefixes, target types, actors, target IDs and reason searches are
literal selectors. Calendar-day filters use South African boundaries. Exact
totals and page rows come from one database statement; a
failed/foreign/inconsistent read is unavailable rather than empty history. No
raw proposal payload, document key or identity-number field is selected. Indexes
cover the identity-step audit's artifact and reviewer foreign keys.

The native GoTrue/TOTP fixture records 61 synthetic setting changes and verifies
both pages, duplicate-free IDs, filters, day boundaries, inaccessible private
views and moderator refusal. The same runtime adapter validates actual SQL JSON.
Service/page tests cover name mapping, unavailable reads, invalid selectors and
the return to audit filters after authenticator confirmation. All fixture data
rolls back. Hosted checks verified exact API audiences, no browser/service view
access, both indexes and the unchanged native reader body. Complete application
deployment and authenticated browser acceptance remain separate work.

## Supported runtime controls and oversight, 5 November 2026

`20261104220316_restored_runtime_controls.sql` is applied. The existing flag
screen manages the supported optional evidence-desk display, starting off. The
old source-only orchestration and security switches are not imported: native
staff MFA and verification rules are unconditional database authority. Display
configuration is a service-only read without account or audit data. Admin reads
and writes require the assigned native capability and recent authenticator
proof; settings writes carry the displayed revision and record one reasoned
event atomically. An exact retry acknowledges the same revision; a stale or
different update is refused.

The selected toggle/canary controls use the returned native state and
timestamps. Staff context reaches percent/role evaluation, and account changes
remount the settings/evidence client. Navigation receives actual assigned
capabilities. Governance oversight totals now count retained native decisions,
actual rejected proposals and approved overrides, using the decision-review
capability. These reads direct staff back to authenticator confirmation when
required.

The real local GoTrue/TOTP fixture verifies defaults, revision fencing, retry
audit deduplication, admin/governor separation, refusal to configure MFA as a
display flag and exact metric DTOs. Focused native/source service, HTTP,
navigation and page tests passed, along with types, lint and dependency rules.
Hosted SQL verified API audiences, the unchanged off default, the assigned admin
capability, no browser table access and no seeded audit events. Application
deployment and full restored-page/browser acceptance remain outstanding.

## Preserved governance decisions, 5 November 2026

`20261104214932_restored_governance_decisions.sql` is applied. The existing
escalation list, decision detail, rationale, approval, rejection, withdrawal and
escalation controls now use caller-bound native decision records. Their layouts
and controls are preserved. The extra private events record the rationale and
escalation; proposal payloads and private evidence keys are not returned.

Approvals keep the canonical transactional effects, independent actor checks,
snapshot binding and recent authenticator requirements. Identity approval also
requires the second reviewer's current evidence claim and a recent context
inspection of the represented pair. Rejection closes the proposal using native
withdrawal audit fields; it does not apply a proposed restriction or grant an
identity. The proposal's author uses the existing native withdrawal command. An
exact same-actor acknowledgement retry cannot repeat an effect or change its
recorded rationale. Stale versions, self-review and moderator governance calls
are refused. The application never calls the retired application-side effect
executor on this path.

The real local GoTrue/TOTP fixture exercises these commands and validates the
actual JSON using the same strict page adapter, including approval, rejection,
escalation and authored withdrawal. HTTP tests verify represented scope, CSRF,
MFA refusal and contradictory acknowledgements. Existing governance source
fixtures still pass. Hosted checks verified the two API audiences, RLS, no
browser access to event rows and no seeded events. These are not complete
authenticated browser or deployment acceptance. The remaining restored pages
must be integrated before the main deployment is released.

## Preserved identity review, 4 November 2026

`20261104162910_preserved_identity_review_workflow.sql` and its follow-up
`20261104214751_preserve_reviewed_identity_status.sql` are applied. Separate ID
and selfie approvals now bind the represented native pair, version, independent
reviewer and current claim; both are required before native acceptance.
High-risk acceptance still requires a second independent reviewer. Rejected or
returned receipts cannot reappear as completed uploads after resubmission.

The owner status projection uses the canonical reviewed-evidence predicate after
acceptance, preserving verification through scheduled file retirement. New
reviews still require clean, unexpired uploads. Native fixture checks cover
retention claims, fenced deletion acknowledgements and explicit identity
revocation: retention preserves acceptance; revocation removes it. SQL and all
fixture data roll back, with no real objects written or deleted. Exact hosted
API audiences, private-table isolation and the additive runtime preflight passed
after application. See the staff integration document for HTTP/viewer coverage
and remaining browser/deployment limitations.

## Preserved staff moderation and claims, 4 November 2026

`20261104111941_restored_staff_moderation_queue.sql` and
`20261104155022_restored_staff_claim_controls.sql` are applied. The selected
moderation page receives bounded independent waiting summaries, exact totals and
the holder's own review data. A submitted body, private presentation or review
fence is returned only after the existing native claim-scoped read checks. All
native reviewers require a claim before deciding. The original controls, preview
panels and layouts remain in place.

Claim, keep, release and governance handoff controls use caller-bound native
commands. Foreign claim generations and nonces remain private. Keep/release-all
is one transaction over the current holder's exact leases; a refusal rolls back
the batch. Evidence handoffs require the native reassignment capability and
recent authenticator proof, reject the subject as operator or replacement, and
rotate the lease on assignment. Their private audit rows follow case-history
retention/holds and anonymize deleted staff references. Content/report leases
remain 15 minutes and evidence leases 30; the selected text reports that fact.

Decisions carry the reviewed revision and claim tuple, preserve native
independence, funding and edit-budget checks, and accept the actual original or
merged-edit acknowledgements. An uncertain reply is not replayed. Immediate
double clicks send one request, and an old response cannot close a newly opened
review. The native fixture uses real local moderator and governor TOTP sessions
to exercise mixed claims, foreign lease secrecy, atomic renewal/release, audited
handoffs, self-assignment refusal and lease invalidation. All fixture changes
roll back and local Auth accounts are removed. Focused HTTP/hook tests passed;
hosted checks confirmed exact execute audiences, private audit RLS and no audit
seed rows. These are contract checks, not real-account browser acceptance.

The new staff adapters are local until the complete integration is released. The
remaining staff and owner screens still require their own migration and
acceptance checks; this update does not claim all pages are integrated.

## Owner post controls, 4 November 2026

`20261104110442_restored_posting_allowance.sql` is applied. The selected posting
gate now reads actual self-only native capacity, active use, media limits and
trial eligibility without querying retired profile/entitlement tables. Eligible
trial choices remain hints; only the existing native command grants a trial
after verified identity and atomic claim checks. An active shared or trial
allowance does not advertise another free grant. There is no native launch
campaign quota, so its availability text reports one trial per verified identity
without inventing remaining spaces. Retail cards use unambiguous current
catalogue prices and features. Auth changes and cross-account replies invalidate
the form read; unavailable reads show the existing failure state. The native
fixture verifies before/after grant DTOs and exact read audiences.

`20261104101932_restored_owner_post_actions.sql` is applied. Delete, resubmit,
deactivate, sold and reactivate commands bind the represented revision, kind and
program to a live owner and an action receipt. A lost deletion reply can be
resolved without touching another record or repeating the deletion. Held content
remains protected, and receipt retention respects subject holds.

The existing Reactivate control publishes unchanged, previously approved content
after current native verification, consent and funding validation. Approval
snapshots are captured from actual native moderation logs; changed content goes
through review. Neither an owner-provided flag nor a guessed public media URL
can create an approval. The native fixture exercises direct reactivation,
duplicate receipts, stale revisions, foreign-owner refusal, deletion retry and
changed-content review gating. Hidden command props add no rendered controls or
styling to the selected buttons.

`20261104105223_preserve_nonlive_edit_flow.sql` and
`20261104105449_enforce_nonlive_review_budget.sql` are also applied. Non-live
edits save without consuming a trial or implicitly submitting; the existing
Resubmit/Reactivate controls perform submission. Pending expiry reflects current
funding. Actual approvals of changed non-live originals count against the same
edit allowance as live review copies. Listing price-only changes retain their
separate daily limit. Native transaction tests cover save-then-resubmit,
exhausted edit-budget refusal, and a permitted price-only approval without
consuming another structural edit. Hosted checks confirmed both repairs.

## Retry-safe public media, 4 November 2026

`20261104052154_repeatable_frontend_media_uploads.sql` is applied. An inspected
content digest resolves an owner's existing intent/ready object, so the selected
forms' automatic retry does not consume storage twice. Completion acknowledges
the same immutable metadata after an interrupted reply. Conditional R2 writes
preserve the winning bytes; uncertain transfers keep their journal intent. The
byte path uses native bindings and avoids additional Blob copies for large
uploads. Pixel re-encoding and video metadata scrubbing remain mandatory.

The self-only resolver binds public media keys to their independent database
object IDs. Posting uses the resolved IDs under the native ownership/state
checks, and an owner-only avatar lookup redirects to the actual public key. URLs
never grant ownership. Video crop/layout hints remain bounded owner assertions
and do not replace inspected image dimensions. The retired direct
presign/completion endpoints return 410 in foundation mode; the selected video
uploader uses its existing validated-upload fallback.

The native fixture now exercises real key-to-ID binding, avatar resolution,
repeat reservation and repeat completion alongside posting/moderation and
retention. Focused upload, storage and ownership tests cover a lost completion
reply and an uncertain transfer without replaying storage/attestation. These are
local/native contract checks; production upload/browser acceptance remains a
separate deployment check.

## Preserved posting forms and management reads, 4 November 2026

The following updates are applied to the approved project:

- `20261104002445_restored_post_commands.sql`: a service-only validator stage
  and authenticated owner consumer compose existing content, attribute, media,
  terms, funding and moderation commands in one transaction. Request receipts
  protect explicit retries. Failed submission leaves no partial post or trial.
  Separate owned image references preserve logos, video posters and venue
  photos; their foreign keys participate in the native retention guard. Edit
  copies preserve these fields, approval merges them, and presentation changes
  count against edit allowances. Public fields require a separate
  `frontend_presentation: true` opt-in; the existing card contract is unchanged.
- `20261104042501_preserve_existing_edit_consent.sql`: existing edit forms reuse
  explicit acceptance already recorded for the current policy. They do not
  create a new acceptance. Creation requires the form's checkbox and the
  version/hash loaded for that form. Policy changes refuse stale consent.
- `20261104043441_restored_post_manager.sql`: current owner slot usage,
  activations, plan members, sponsorship and paid add-on facts serve the
  existing management cards. Pending posts use their actual funding/event end
  time instead of a guessed visibility period.
- `20261104044439_preserve_post_contact_privacy.sql`: private sellers' street
  addresses remain owner-only. The selected frontend's chosen business contact
  channels remain public for businesses, while listing/event phone reveal
  retains its separate boundary. No account phone or verification proof is
  inferred from these business assertions.
- `20261104045254_align_frontend_receipt_retention.sql`: transport receipts
  cascade with their canonical evidence/case/submission parents, so they cannot
  block the native verification-history purge. Supplemental image unlinking
  records the same cleanup grace period as ordinary post media.

`scripts/test-restored-post-commands.mjs` (run by `pnpm test:foundation:native`
and the `foundation-native` CI job) checks these updates on the isolated native
PostgreSQL fixture, with real local GoTrue owner/reviewer sessions and a
verified local authenticator. It exercises listing, business and event form
commands; moderation and edit merges; ownership, duplicate-request, funding and
consent boundaries; actual owner DTO parsing; private-address/public-visibility
rules; exact execute audiences; and expired payload scrubbing under legal holds.
Scanner/provider receipts are explicitly synthetic. No real document, external
SMS, payment or R2 write is used. All application DDL/data are rolled back and
the local Auth test accounts removed. This is native database contract evidence,
not a browser or payment-provider end-to-end claim.

The six preserved create/edit pages now send hidden receipt/policy/revision
fields to native APIs. Their controls, layout and styling are unchanged. The My
posts page loads canonical owner records and plan facts. Remaining owner
actions, billing and staff integration must be completed before deployment.

## Verification transport and full administrator role, 4 November 2026

`20261104000046_restored_verification_transport.sql` and
`20261104001222_restore_full_admin_capabilities.sql` are applied to the approved
project. The selected verification wizard still sends ID and selfie separately.
Private receipts now bind each request to its owner, session, content digest,
native case revision and artifact. Only the server may complete inspected,
encrypted uploads. The selfie completion registers the actual pair once, using
the persisted request receipt, with no automatic approval. Redundant encrypted
number material is cleared after registration and on artifact deletion. A
hash-guarded repair also stops the status function casting an identity
fingerprint to UUID.

The administrator matrix now includes the six routine capabilities already
available to moderators and governors. Existing live-session, authenticator,
case-claim, self-review and independent-decision requirements remain in their
native commands. There are two active administrators and zero missing routine
permissions relative to the lower staff roles.

Isolated SQL and HTTP tests cover separate upload steps, duplicate receipts,
revoked sessions, changed cases, malformed encrypted metadata, cross-owner
access and anonymous/service execute boundaries. A hosted transaction exercised
both steps and a repeated completion, confirmed exactly one pending submission
and no approval, then rolled back completely. Subsequent counts confirmed zero
test evidence and transport receipts remained. This is database contract proof,
not a real-document or browser end-to-end attestation. The application adapter
is local until the complete integration is released.

The retired object inventory contained 506 public `media/<old-area>/...` objects
and seven private `kyc/...` objects, all last modified before October 2026.
Neither canonical posts/media/evidence records nor tracked frontend sources
referenced those keys; no legal holds were present. The owner-authorized cleanup
deleted exactly these 513 inventoried keys and verified their absence. Both
buckets remain available for the new system. Private inventory and deletion
receipts are under ignored `tmp/backend-reconciliation/`; no customer documents
were downloaded or used as fixtures. After the token refused direct purge, its
authorized token-management capability created a five-minute credential
restricted to zone read and cache purge for this one zone. Cloudflare accepted
the purge of 16 retired-media prefixes, and all 506 old public asset URLs then
returned 404. Both temporary purge credentials were revoked; no secret value was
persisted and the original local credential was unchanged. Ignored cache purge
and HEAD-verification receipts record the provider results separately.

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

## Native report suspensions and bans

`20261105050356_native_report_account_restrictions.sql` extends the existing
claimed report action and native governance decision commands. A moderator can
propose a suspension of 1–30 days or a ban without restricting the account. An
administrator or governor with fresh TOTP may apply 72 hours of emergency
containment pending independent review. Rejection ends containment and requeues
the report; expiration stops containment and prevents approval of the expired
proposal. The restriction and report resolution are applied together on
approval.

The restriction affects account access and public eligibility without changing
the post's workflow status or rewriting GoTrue credentials. A separate reviewer
can lift a represented restriction; another active restriction still applies.
Report retention does not remove the original reporter conflict. Lifting a ban
preserves any other active identity ban, and replay cannot restore the lifted
one. The approved native decision, not editable Auth metadata, is authoritative.

The isolated native fixture exercises real local staff TOTP sessions, rejection,
expiry, independent approval and lift, and an overlapping identity ban. It
creates no production accounts, reports or restrictions. The update provides the
backend controls; the preserved restriction, appeal and privacy screens need
their own access and data adapters before the application is released.

`20261105052337_restored_enforcement_views.sql` reconnects the existing
enforcement list and lift form. Staff see exact active totals, the latest
restrictions and enforcement history, and whether they can review each item. The
response does not include the reporter's identity. A member with a valid session
can read their own restriction status and suspension end to reach the existing
ban page or suspension notice. They still cannot use active member commands.
Appeal and privacy commands require their own authorization.

`20261105053049_restored_creation_allowance.sql` adds a versioned allowance
read. It keeps the actual occupied and total slot counts and calculates how many
new posts can be funded across individual entitlements. Releasing a post frees
its slot; its activation still counts when the entitlement has a period limit.
The existing once-per-identity trial grant and uncapped slot within that trial
remain unchanged. The posting form distinguishes an exhausted activation
allowance from occupied slots.

`20261105053509_restored_member_appeals.sql` reconnects the member and staff
appeal screens. A restricted member can submit one appeal on their own finalized
moderation decision. A fresh, independent staff reviewer can affirm or reverse
it, or shorten an active suspension. Each resolution binds the represented
effect version and changes only the effect under review. Active content holds
survive the retention of the originating report. Generic owner notices and an
email job are recorded in the same transaction as each effect or resolution.
Neither the email nor the owner list discloses the reporter.

`20261105085900_restored_privacy_requests.sql` reconnects the existing data
request and staff forms. Website intake is bound to a live confirmed account and
stores only the supplied ID suffix. Manual requests start unverified. Current
staff with fresh TOTP can assign, review, extend and complete cases against the
represented revision, with subject conflicts denied. An access export requires
verified identity and a started or completed case; it reads the fixed dataset
registry in one snapshot and refuses an oversized export without returning a
partial file. No raw evidence, credentials, storage keys or counterpart contact
fields are returned. Deletion requests require a recorded staff attestation and
never trigger automatic deletion.

The existing response targets are preserved. The access rule references the
[private-body PAIA provisions](https://www.justice.gov.za/legislation/acts/2000-002.pdf).
Submission and outcome notices use a private claim queue, and an extension
records its notification time only after provider acceptance. The fixture uses
synthetic notice acknowledgements and performs no actual delivery.

`20261105091725_restored_support_inbox.sql` backs the existing contact form and
staff inbox with native tickets. Submission is service-only after CAPTCHA and
rate checks, with a short exact-retry window. Staff see recorded provider
acceptance, which does not imply inbox delivery. A moderator or administrator
can change the represented status; a governor can read the inbox. The ticket and
status event use one transaction, and staff dashboard counts come from the same
tickets.

`20261105092547_restored_partner_workflows.sql` supplies the selected partner
administration panel from canonical partner, attribution, commission and payment
records. The existing partner commands still enforce identity, independence from
self, eligibility and exact amounts. Staff notes and the change are committed
together. The verified signup callback passes the existing first-touch cookie to
the native attribution command, and the operations job runs the existing
due-commission sweep. The local fixture uses synthetic provider settlement
without charging a payment.

`20261105093342_restored_staff_role_review.sql` reconnects the existing staff
roster and role review. The canonical assignment stays unchanged until
independent approval, except for permitted administrator removals. Full
administrator eligibility comes from the owner's existing claimed invitations.
Every command checks live authority and recent authenticator proof. A new
assignment also requires authenticator proof after its grant, so an older
session cannot acquire the new capabilities. Existing active assignments are
preserved. The native fixture verifies these rules without changing any
production account.

`20261105094316_restored_business_seen_requests.sql` reconnects the existing
Seen workflow. Only the current business owner with a reviewed ID may request a
check, and screenshot consent is required. Staff work through the native
evidence claim, with the assigned verifier recording the visit or call and a
different reviewer deciding it. A successful report and approval require three
distinct clean photos. Owners can reply with a private attachment; staff file
access is authorized and logged before serving verified encrypted evidence. The
public card reads only a current approved sticker, date, method and canonical
city. Addresses, coordinates and evidence stay private.

The native fixture covers owner and staff boundaries, real claim selection,
synthetic photo and attachment receipts, independent approval, revocation and
generic owner notices. It does not create production cases, upload real files or
send real mail. CIPC registration review uses the separate evidence described
below.

`20261105150107_restored_cipc_review.sql` reconnects the CIPC preview, owner
upload, independent official copy, representative code and callback,
registration decisions, renewal, linked profiles and office visibility. The
official copy must match the registration and show the company as In Business. A
separate senior reviewer can confirm a unique verified legal name when the
official copy omits the ID; this does not waive registry status. Active
registrations for a different owner prevent approval.

Native evidence serving rechecks the reviewer and stored bytes and records
access before serving the file. Public responses use only current eligible
registrations. The street and postal code stay private until the owner chooses
to show them. The isolated fixture checks the official-copy boundary, matched
director, case queue, private/public office, and representative code and
callback with synthetic evidence and no actual provider email or uploads.

`20261105153628_restored_affiliation_workspace.sql` reconnects the owner
affiliations and organisation dashboard to native business posts, applications,
memberships and sponsorships. The owner sees their own requests and
affiliations. Organisation administrators see their own dashboard and contact
fields already published by an eligible business. The existing invitation is
redeemed through the native verified account flow.

The action dispatcher binds each application, affiliation and sponsorship to the
represented organisation and preserves the submitted funding type. The isolated
fixture checks that a funding mismatch rolls back, that outsiders and other
organisations cannot decide a request, and that approved and revoked
affiliations appear correctly. The London migration was recorded as
`20261105200230`; no production organisations, affiliations or sponsorships were
seeded.

`20261105200401_restored_staff_organisation_workspace.sql` reconnects the
existing staff organisation list, record and profile forms. Staff see native
counts, masked invitations, memberships, applications and public business
contacts. Profile creation is atomic and private by default. Edits require the
displayed revision; a rejected slug or invalid field rolls back the entire edit.
Existing native commands handle invitations, programme entries, showrooms and
supported administration actions. Funded pilot activation, paid conversions and
engagement reporting still require their own adapters.

The isolated fixture verifies staff authority, live counts, private profile
creation, invalid-field rollback, slug collisions and stale edits. London
recorded this migration as `20261105201428`. No organisation or invite was
created in production by this validation.

`20261105201822_restored_staff_payments.sql` connects the selected payments
screen to the native ledger. Staff see only the payment status, amount and
display fields needed by the page. The existing record-refund and
record-chargeback controls require a current admin and recent authenticator
proof. They record a provider action already handled separately, revoke the
native funding and partner commission, and write one audit receipt. Exact
retries return the saved result. This path does not submit an Ozow refund.

The fixture checks access, stale authenticator proof, funding and commission
revocation, exact retry and the audit entry with synthetic settlement data.
London recorded the migration as `20261105202246`; no payment or reversal was
created in production.

`20261105202617_restored_form_autosave.sql` restores cross-device autosaves for
the existing listing, business and tourism/event forms. Only the current account
can read or update its drafts. The client also identifies the account that
loaded the form so a session switch cannot save that form to the new account.
Discard and account closure remove saved form data. Unused drafts expire after
14 days and the retention job removes them in bounded batches.

The native fixture verifies owner-only access, session-switch refusal, expiry,
discard and closure cleanup. London recorded the migration as `20261105203132`;
no production drafts were created by this validation.

`20261105203431_restored_public_affiliation_badges.sql` reconnects the existing
business card badges and business detail section. It returns active affiliations
of public businesses and listed organisations. The logo requires recorded
permission, and a founding place does not appear as organisation-funded support.
The isolated fixture checks both funding types and revocation. London recorded
this migration as `20261105203919` and the empty anonymous probe passed.

## Applied register

One line per file in this folder, in filename order, with when production
received it. CI (`scripts/check-foundation-update-order.mjs`) fails when a file
has no line, a line names a missing file, or a line disagrees with
`../fingerprint.json` `productionCheck`. Each line reads
``- `<file>`: <status>; <evidence>``, where the status is one of:

- `pending`: not yet applied to production (also listed in
  `pendingApplication`).
- `applied YYYY-MM-DD HH:MM UTC`: the recorded application time. Required for
  every update after `20261109224337_fix_post_command_target.sql`.
- `applied YYYY-MM-DD (SAST date, time not recorded)`: older updates only; the
  day is recorded, the time is not.
- `applied before YYYY-MM-DD HH:MM UTC (exact time not recorded)`: older updates
  only, whose application time was not written down; the time is that of the
  commit that first recorded them as applied, or of the first production
  fingerprint match.

Dates and times must be real (CI rejects, for example, `2026-02-30`).

<!-- applied-register:start -->

- `20261028213020_repair_verified_runtime_contracts.sql`: applied 2026-11-04
  (SAST date, time not recorded); section Owner admin setup and signup hook,
  recorded in c6610937
- `20261029191349_restore_public_browse_contract.sql`: applied 2026-11-03 (SAST
  date, time not recorded); section Restored public browsing and contacts,
  recorded in ace0e249
- `20261103152035_owner_admin_setup.sql`: applied before 2026-11-03 23:32 UTC
  (exact time not recorded); recorded as applied in c6610937
- `20261103152812_restored_staff_dashboard.sql`: applied before 2026-11-03 23:32
  UTC (exact time not recorded); recorded as applied in c6610937
- `20261103154538_owner_signup_access.sql`: applied before 2026-11-03 23:32 UTC
  (exact time not recorded); recorded as applied in c6610937
- `20261103180512_restored_owner_dashboard.sql`: applied before 2026-11-03 23:32
  UTC (exact time not recorded); recorded as applied in c6610937
- `20261103182231_restored_profile_update.sql`: applied before 2026-11-03 23:32
  UTC (exact time not recorded); recorded as applied in c6610937
- `20261103183017_repair_dashboard_identity_lookup.sql`: applied before
  2026-11-03 23:32 UTC (exact time not recorded); recorded as applied in
  c6610937
- `20261103192835_restored_enquiry_post_area.sql`: applied before 2026-11-07
  05:06 UTC (exact time not recorded); production fingerprint matched on
  2026-11-06 (aafa2de3)
- `20261103231355_owner_notification_dismissals.sql`: applied before 2026-11-03
  23:32 UTC (exact time not recorded); recorded as applied in c6610937
- `20261104000046_restored_verification_transport.sql`: applied before
  2026-11-04 00:22 UTC (exact time not recorded); recorded as applied in
  63531466
- `20261104001222_restore_full_admin_capabilities.sql`: applied before
  2026-11-04 00:22 UTC (exact time not recorded); recorded as applied in
  63531466
- `20261104002445_restored_post_commands.sql`: applied before 2026-11-04 05:00
  UTC (exact time not recorded); recorded as applied in 0dba79fa
- `20261104042501_preserve_existing_edit_consent.sql`: applied before 2026-11-04
  05:00 UTC (exact time not recorded); recorded as applied in 0dba79fa
- `20261104043441_restored_post_manager.sql`: applied before 2026-11-04 05:00
  UTC (exact time not recorded); recorded as applied in 0dba79fa
- `20261104044439_preserve_post_contact_privacy.sql`: applied before 2026-11-04
  05:00 UTC (exact time not recorded); recorded as applied in 0dba79fa
- `20261104045254_align_frontend_receipt_retention.sql`: applied before
  2026-11-04 05:00 UTC (exact time not recorded); recorded as applied in
  0dba79fa
- `20261104052154_repeatable_frontend_media_uploads.sql`: applied before
  2026-11-04 10:10 UTC (exact time not recorded); recorded as applied in
  d951a763
- `20261104101932_restored_owner_post_actions.sql`: applied before 2026-11-04
  11:02 UTC (exact time not recorded); recorded as applied in 7fdcdb9b
- `20261104105223_preserve_nonlive_edit_flow.sql`: applied before 2026-11-04
  11:02 UTC (exact time not recorded); recorded as applied in 7fdcdb9b
- `20261104105449_enforce_nonlive_review_budget.sql`: applied before 2026-11-04
  11:02 UTC (exact time not recorded); recorded as applied in 7fdcdb9b
- `20261104110442_restored_posting_allowance.sql`: applied before 2026-11-04
  11:19 UTC (exact time not recorded); recorded as applied in 9b2e76f3
- `20261104111941_restored_staff_moderation_queue.sql`: applied before
  2026-11-04 16:16 UTC (exact time not recorded); recorded as applied in
  23ee4a4a
- `20261104155022_restored_staff_claim_controls.sql`: applied before 2026-11-04
  16:16 UTC (exact time not recorded); recorded as applied in 23ee4a4a
- `20261104162910_preserved_identity_review_workflow.sql`: applied before
  2026-11-04 21:50 UTC (exact time not recorded); recorded as applied in
  8d6be9c2
- `20261104214751_preserve_reviewed_identity_status.sql`: applied before
  2026-11-04 21:50 UTC (exact time not recorded); recorded as applied in
  8d6be9c2
- `20261104214932_restored_governance_decisions.sql`: applied before 2026-11-04
  22:02 UTC (exact time not recorded); recorded as applied in 212ae0ae
- `20261104220316_restored_runtime_controls.sql`: applied before 2026-11-04
  22:15 UTC (exact time not recorded); recorded as applied in 3e7f18aa
- `20261104221219_restored_staff_audit_page.sql`: applied before 2026-11-04
  22:28 UTC (exact time not recorded); recorded as applied in f31fb7f4
- `20261104222400_restored_report_workflow.sql`: applied before 2026-11-04 22:41
  UTC (exact time not recorded); recorded as applied in 5a5b9592
- `20261104224230_restored_staff_report_queue.sql`: applied before 2026-11-04
  23:14 UTC (exact time not recorded); recorded as applied in 8415c852
- `20261104231625_restored_report_actions.sql`: applied before 2026-11-04 23:33
  UTC (exact time not recorded); recorded as applied in 48f56f49
- `20261105035413_native_report_warning_delivery.sql`: applied before 2026-11-05
  04:20 UTC (exact time not recorded); recorded as applied in 7b0d8132
- `20261105043010_native_report_content_holds.sql`: applied before 2026-11-05
  05:00 UTC (exact time not recorded); recorded as applied in bf39e228
- `20261105050356_native_report_account_restrictions.sql`: applied before
  2026-11-07 05:06 UTC (exact time not recorded); production fingerprint matched
  on 2026-11-06 (aafa2de3)
- `20261105052337_restored_enforcement_views.sql`: applied before 2026-11-07
  05:06 UTC (exact time not recorded); production fingerprint matched on
  2026-11-06 (aafa2de3)
- `20261105053049_restored_creation_allowance.sql`: applied before 2026-11-07
  05:06 UTC (exact time not recorded); production fingerprint matched on
  2026-11-06 (aafa2de3)
- `20261105053509_restored_member_appeals.sql`: applied before 2026-11-07 05:06
  UTC (exact time not recorded); production fingerprint matched on 2026-11-06
  (aafa2de3)
- `20261105085900_restored_privacy_requests.sql`: applied before 2026-11-07
  05:06 UTC (exact time not recorded); production fingerprint matched on
  2026-11-06 (aafa2de3)
- `20261105091725_restored_support_inbox.sql`: applied before 2026-11-07 05:06
  UTC (exact time not recorded); production fingerprint matched on 2026-11-06
  (aafa2de3)
- `20261105092547_restored_partner_workflows.sql`: applied before 2026-11-07
  05:06 UTC (exact time not recorded); production fingerprint matched on
  2026-11-06 (aafa2de3)
- `20261105093342_restored_staff_role_review.sql`: applied before 2026-11-07
  05:06 UTC (exact time not recorded); production fingerprint matched on
  2026-11-06 (aafa2de3)
- `20261105094316_restored_business_seen_requests.sql`: applied before
  2026-11-07 05:06 UTC (exact time not recorded); production fingerprint matched
  on 2026-11-06 (aafa2de3)
- `20261105150107_restored_cipc_review.sql`: applied before 2026-11-07 05:06 UTC
  (exact time not recorded); production fingerprint matched on 2026-11-06
  (aafa2de3)
- `20261105153628_restored_affiliation_workspace.sql`: applied 2026-11-05 20:02
  UTC; London migration version 20261105200230
- `20261105200401_restored_staff_organisation_workspace.sql`: applied 2026-11-05
  20:14 UTC; London migration version 20261105201428
- `20261105201822_restored_staff_payments.sql`: applied 2026-11-05 20:22 UTC;
  London migration version 20261105202246
- `20261105202617_restored_form_autosave.sql`: applied 2026-11-05 20:31 UTC;
  London migration version 20261105203132
- `20261105203431_restored_public_affiliation_badges.sql`: applied 2026-11-05
  20:39 UTC; London migration version 20261105203919
- `20261109073519_post_lifecycle_guards.sql`: applied 2026-11-09 (SAST date,
  time not recorded); recorded in 38e1ce41
- `20261109104020_post_expiry_rules.sql`: applied 2026-11-09 (SAST date, time
  not recorded); recorded in 38e1ce41
- `20261109173012_posting_terms_v3.sql`: applied 2026-11-09 (SAST date, time not
  recorded); recorded in b7de37ee
- `20261109224337_fix_post_command_target.sql`: applied 2026-11-10 (SAST date,
  time not recorded); recorded in febb1aa2
- `20261110045944_intro_trial_at_first_approval.sql`: applied 2026-11-10 11:30
  UTC; time approximate, applied by the coordinator in the Supabase dashboard
  SQL editor, preflight before "reviewed live bodies, update not applied" with
  every count 0, after "already applied, trials to restart: 0", production
  fingerprint then matched the replay (section The free week starts at the first
  approved post)
- `20261110173012_verification_returned_notice.sql`: applied 2026-11-12 05:20
  UTC; time approximate, applied by the coordinator with the owner's approval
  through the Supabase dashboard's query API, from the reviewed file, after the
  website release that knows the kind (main 3ade4695) was live; preflight before
  "reviewed bodies, update not applied" with identity cases sent back, returned
  notices and returned emails not yet sent all 0, after "already applied" with
  the same counts 0; production fingerprint then matched the replay (section
  Members are told when their ID is sent back)
- `20261111184619_selfie_capture_method.sql`: applied 2026-11-12 05:45 UTC; time
  approximate, applied by the coordinator with the owner's approval through the
  Supabase dashboard's query API, from the reviewed file, before its website
  release was merged; preflight before "reviewed bodies, update not applied"
  with selfie receipts 1 and with a capture method 0, after "already applied"
  with the same counts; production fingerprint then matched the replay (section
  Staff see how each selfie was taken)
- `20261111212320_payment_start_retry.sql`: applied 2026-11-12 06:35 UTC; time
  approximate, applied by the coordinator with the owner's approval through the
  Supabase dashboard's query API, from the reviewed file, before its website
  release was merged; preflight before "reviewed bodies, update not applied"
  with pending payments without an Ozow request 0 and to expire 0, after
  "already applied" with both counts 0; production fingerprint then matched the
  replay (section A failed payment start never blocks a member)
- `20261111223723_foreign_key_indexes.sql`: applied 2026-11-12 06:47 UTC; time
  approximate, applied by the coordinator with the owner's approval through the
  Supabase dashboard's query API, from the reviewed file; preflight before "not
  applied" with present 0 of 50, after "already applied; present 50 of 50"
  (section Indexes for foreign keys used by deletion)
- `20261111234521_public_default_privileges.sql`: applied 2026-11-12 06:49 UTC;
  time approximate, applied by the coordinator with the owner's approval through
  the Supabase dashboard's query API, from the reviewed file; preflight before
  "not applied; matches the production capture of 6 November 2026" with 0
  relations and 0 functions in public and the nine expected unchanged
  supabase_admin rows, after "already applied"; production fingerprint after all
  five updates matched the replay (section No default rights in schema public)
- `20261112080000_payment_problem_alerts.sql`: applied 2026-11-12 12:20 UTC;
  time approximate, applied by the coordinator with the owner's approval through
  the Supabase query API, from the reviewed file; preflight before "update not
  applied" with no paid-but-not-activated and no stale pending payment, after
  "already applied" with all ten bodies matching; production fingerprint after
  it matched the replay (section Payment problem alerts)
- `20261112122001_publish_posting_terms_v4.sql`: applied 2026-11-12 22:00 UTC;
  time approximate, applied by the coordinator with the owner's approval through
  the Supabase query API, from the reviewed file, before the release; preflight
  before "current posting-v3; accounts that accepted it: 0; posting-v4 not
  published", after "posting-v4 published (update already applied)" with
  posting-v3 still current
- `20261112173841_switch_posting_terms_v4.sql`: applied 2026-11-12 23:13 UTC;
  applied by the coordinator with the owner's approval through the Supabase
  query API, from the reviewed file, after the release of pull request 200 was
  live; preflight before "current posting-v3 (update not applied); plans on
  sale: 17; plans taken off sale by the update: 0; pending plan payments: 0",
  after "current posting-v4 (update already applied); plans on sale: 0; plans
  taken off sale by the update: 17; pending plan payments: 0", with
  internal.set_post_media at the reviewed body (md5 3ff7aba4); production
  fingerprint after it matched the replay through this update
- `20261112181954_google_name_at_signup.sql`: applied 2026-11-13 00:20 UTC; time
  approximate, applied by the coordinator with the owner's approval through the
  Supabase query API, from the reviewed file; preflight before "reviewed body,
  update not applied; profiles without a name: 2; of which the update names: 2",
  after the two bodies matched the update's and no profile was left without a
  name; production fingerprint after it matched the full replay
- `20261113002421_individual_slots_r69.sql`: applied 2026-11-13 01:30 UTC; time
  approximate, applied by the coordinator with the owner's approval through the
  Supabase query API, from the reviewed file, before the pull request was
  merged; preflight before "update not applied; current posting terms:
  posting-v4; on sale: nothing; plan payments pending: 0", after all 24 function
  bodies matched the update's and exactly individual_30d, individual_90d and
  individual_180d were on sale at 6900, 20700 and 41400 cents; production
  fingerprint after it matched the full replay
- `20261113021223_staff_payment_fixes.sql`: applied 2026-11-13 07:15 UTC; time
  approximate, applied by the coordinator with the owner's approval through the
  Supabase query API, from the reviewed file, before the pull request was
  merged; preflight before "update not applied; paid but not delivered: 0;
  refunds waiting for approval: none (table absent)", after "already applied"
  (all 24 function bodies matched the update's, both new tables, the audit view
  and both waiting triggers present; no problem rows); production fingerprint
  after it matched the full replay
- `20261113085340_retire_old_staff_reversal_commands.sql`: applied 2026-11-13
  14:37 UTC; applied with the owner's approval, from the reviewed file, after
  the pull request was merged; preflight before "update not applied; refunds
  waiting for approval: 0", after "already applied" (no problem rows);
  production fingerprint after it matched the full replay
- `20261113134500_communication_choices_and_signup_terms.sql`: applied
  2026-11-13 15:54 UTC; applied with the owner's approval, from the reviewed
  file, before the pull request was merged; preflight before "update not
  applied; current terms: posting-v4", after "already applied; current terms:
  posting-v4; choice changes recorded: 0; sign-up acceptances recorded: 0";
  production fingerprint after it matched the full replay
- `20261113162457_staff_invoice_payments.sql`: applied 2026-11-13 19:05 UTC;
  applied with the owner's approval, from the reviewed file, before the pull
  request was merged; preflight before "update not applied (apply before the
  website release that uses it is deployed); bank transfers waiting for
  confirmation: none (table absent); payments confirmed from a bank transfer:
  0", after "already applied; bank transfers waiting for confirmation: 0;
  payments confirmed from a bank transfer: 0"; production fingerprint after it
  matched the full replay
- `20261113172356_ozow_api_refunds.sql`: applied 2026-11-14 00:25 UTC; applied
  with the owner's approval, from the reviewed file (sha256 starting
  d0595c11cd8bd9bb), before the pull request was merged; preflight before
  "update not applied", after "already applied; refunds waiting for approval: 0;
  refunds through Ozow not settled: 0"; production fingerprint after it matched
  the full replay (except the known schema grant difference); refunds through
  Ozow stay switched off (`OZOW_API_REFUNDS_ENABLED`)
- `20261113223806_bank_transfer_and_consent_fixes.sql`: applied 2026-11-14 02:35
  UTC; applied with the owner's approval, from the reviewed file (sha256
  starting 8d025150d48e7dcd), before the pull request was merged; preflight
  before "update not applied; declined bank transfers: 0; bank references
  recorded more than once: 0; refund references with a space: 0", after "already
  applied" with the same three counts 0; production fingerprint after it matched
  the full replay (except the known schema grant difference)
- `20261114041000_customer_invoice_pay_now.sql`: applied 2026-11-14 08:40 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file (sha256 starting d376dfa3250c2235) before the
  pull request was merged; preflight before "update not applied", after
  "customer invoices: already applied; invoices issued: 0 (unpaid: 0); payment
  attempts: 0"; production fingerprint after it matched the full replay (except
  the known schema grant difference)
- `20261114093742_renew_slots_early.sql`: applied 2026-11-14 14:35 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file (sha256 starting 8cb30b16b330f1fe, files from
  raw GitHub at 0f4fcd28) before the pull request was merged; preflight before
  "update not applied", after "slot renewals: already applied; renewal payment
  lines: 0; renewals issued: 0; reminders queued: 0"; production fingerprint
  after it matched the full replay (except the known schema grant difference)
- `20261114154823_slot_packages.sql`: applied 2026-11-16 21:43 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file (sha256 starting f4976af048638d5c, files from
  raw GitHub at 6b072673) before the pull request was merged; preflight before
  "update not applied", after "slot packages: already applied; on sale: no;
  packages: 0; package payments: 0"; production fingerprint after it matched the
  full replay (except the known schema grant difference); sales stay switched
  off
- `20261116175757_close_and_erase_account.sql`: applied 2026-11-17 03:50 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file (sha256 starting 8d39dcd6550b1ec7, files from
  raw GitHub at d755e130) before the pull request was merged; preflight before
  "update not applied" with no problem rows (Auth table privilege and row
  security checks included), after "close and erase accounts: already applied;
  accounts closed: 0; erased: 0; waiting with a hold: 0"; production fingerprint
  after it matched the full replay (except the known schema grant difference)
  (roadmap M1.6b)
- `20261116194000_phone_in_use_before_sms.sql`: applied 2026-11-17 05:36 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file (sha256 starting ce981e4b9ae4adb2, files from
  raw GitHub at 5a36e5fb) before the pull request was merged; preflight before
  "phone in use before sms: update not applied; active phone proofs: 1; open
  codes for a number in use: 0" with no problem rows, after "already applied"
  with the same counts; production fingerprint after it matched the full replay
  (except the known schema grant difference)
- `20261117064820_ban_blocks_phone_numbers.sql`: applied 2026-11-17 07:24 UTC;
  time approximate, owner-approved, Supabase SQL editor (browser), preflight +
  fingerprint checked; from the reviewed file (sha256 starting 7b36540cb91f0766,
  files from raw GitHub at bb84c2e0) before the pull request was merged;
  preflight before "ban blocks phone numbers: update not applied; running bans:
  0; numbers to block: 0" with no problem rows, after "already applied; running
  bans: 0; numbers blocked: 0; numbers to block: 0"; production fingerprint
  after it matched the full replay (except the known schema grant difference)
- `20261117082020_online_payment_limit.sql`: applied 2026-11-17 11:40 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file (sha256 starting 96a026e368629c6f, files from
  raw GitHub at bbf65bd3) before the pull request was merged (#234 merged
  11:40:48 UTC, deploy da99bc33 succeeded 12:09 UTC); preflight before "online
  payment limit: update not applied (apply before the website release that uses
  it is deployed)" (1 row, no problem rows), after "already applied; current
  posting terms: posting-v4; posting-v5 published; payments pending at Ozow
  above R1,300: 0; unpaid invoices above R1,300: 0"; production fingerprint
  after it matched the full replay (except the known schema grant difference)
- `20261117082021_switch_posting_terms_v5.sql`: applied 2026-11-17 12:11 UTC;
  owner-approved, Supabase SQL editor (browser), preflight checked; from the
  reviewed file (sha256 starting bd338d34da916b72, files from raw GitHub at
  da99bc33) after the deploy of pull request #234; preflight before "current
  posting-v4 (update not applied); posting-v5 published; accounts that accepted
  posting-v5: 0", after "current posting-v5 (update already applied)"; data
  only, the production fingerprint rechecked unchanged; the live /terms page
  shows the new "Paying, VAT & invoices" text
- `20261117123240_skipped_email_status.sql`: applied 2026-11-17 13:58 UTC; time
  approximate, owner-approved, Supabase SQL editor (browser), preflight +
  fingerprint checked; from the reviewed file (sha256 starting 1b4b387bfa4f1816,
  files from raw GitHub at ce8616a9) before pull request #245 was merged
  (14:00:25 UTC, 64d58596); preflight before "skipped email status: update not
  applied; finished emails: 2; marked skipped: 0", after "already applied;
  finished emails: 2; marked skipped: 0"; production fingerprint after it
  matched the full replay (except the known schema grant difference)
- `20261117140533_member_notices_in_app.sql`: applied 2026-11-18 02:40 UTC;
  owner-approved in the Claude Code session that wrote it (the owner chose to
  apply it from that session, overriding the AGENTS.md rule for this update
  only), Supabase connector (`execute_sql`), preflight + fingerprint checked;
  the update's statement is in the production Postgres log at 02:40:27 UTC; from
  the reviewed file on `main` (sha256 starting 9618f8c4d8772ea7) after the
  website release of pull requests #249 and #252 was deployed (d87bed25, then
  41148cc8); preflight before "member notices in app: update not applied
  (reviewed bodies; ...); new-kind notices: 0" (1 row, no problem rows), after
  "already applied; new-kind notices: 0", all four triggers enabled
- `20261117144001_sample_post_hide_list.sql`: applied 2026-11-18 00:47 UTC; the
  update's statement is in the production Postgres log at 00:47:48 UTC, before
  pull request #105 was merged (00:48:09 UTC, 41148cc8); how it was applied was
  not recorded; the deploy of 41148cc8 (01:27 UTC) reported only
  20261117140533_member_notices_in_app.sql missing; found applied (its table and
  both commands exist) and recorded from the Claude Code session on 2026-11-18;
  production fingerprint after both updates matched the full replay (except the
  known schema grant difference)
- `20261118033538_remove_sample_post_hide_list.sql`: applied 2026-11-18 05:46
  UTC; owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; the update's statement is in the production Postgres log at 05:46:14
  UTC; from the reviewed file at a0576863 (pull request #258, sha256 starting
  16aacf5f8668154e) after the website release containing it was deployed
  (5b4a4b08, 05:38 UTC); preflight (sha256 starting cbccf780) before "remove
  sample post hide list: update not applied; hidden samples: 0", after "remove
  sample post hide list: already applied" (no problem rows); production
  fingerprint after it matched the full replay (except the known schema grant
  difference)
- `20261118044440_bank_transfer_expiry.sql`: applied 2026-11-18 07:40 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file at c81018cf (pull request #248, sha256
  starting 4b69a8fd98fcf666) before the website release containing it was
  deployed; preflight (sha256 starting 62b861fc) before "bank transfer expiry:
  update not applied; waiting: 0; waiting 14 days or more: 0; expired: 0", after
  (07:41:14 UTC) "bank transfer expiry: already applied; waiting: 0; waiting 14
  days or more: 0; expired: 0" (no problem rows); production fingerprint after
  it (fingerprint.sql at 93e69753) matched the full replay (except the known
  schema grant difference)
- `20261118072601_staff_data_minimisation.sql`: applied 2026-11-18 18:09 UTC;
  owner-approved, Supabase SQL editor (browser), preflight + fingerprint
  checked; from the reviewed file at cbbeb26c (pull request #264, sha256
  starting 8e258de44214f5ac) after the expand release (#265) was deployed and
  before the website release containing it was deployed (#264 merged 18:11 UTC
  as eb281cf1); preflight (sha256 starting 9d7ffdab) before "staff data
  minimisation: update not applied; resolved support tickets older than 12
  months: 0", after "staff data minimisation: already applied; resolved support
  tickets older than 12 months: 0" (no problem rows); production fingerprint
  after it (fingerprint.sql at eb281cf1, captured 18:13 UTC) matched the full
  replay (except the known schema grant difference)
- `20261118182332_refund_follow_ups.sql`: applied 2026-11-18 21:25 UTC;
  owner-approved ("Yes, apply and merge"), Supabase SQL editor (browser),
  preflight + fingerprint checked; from the reviewed file at 5fe2178e (pull
  request #275, sha256 starting cdb2d9971f492ecd) before the website release
  containing it was deployed (#275 merged 21:27 UTC as 07418a73); preflight
  (sha256 starting 2932b94e) before "refund follow-ups: update not applied;
  waiting for approval: 0; through Ozow not sent: 0; past Ozow's 13 days: 0;
  while a renewal waits: 0; declined references: 0", after "refund follow-ups:
  already applied; waiting for approval: 0; through Ozow not sent: 0; past
  Ozow's 13 days: 0; while a renewal waits: 0; declined references: 0" (no
  problem rows); production fingerprint after it (fingerprint.sql at 07418a73,
  captured about 21:29 UTC) matched the full replay (except the known schema
  grant difference)
- `20261119025106_package_invoices.sql`: applied 2026-11-19 06:42 UTC;
  owner-approved ("Yes, apply and merge"), Supabase SQL editor (browser),
  preflight + fingerprint checked; from the reviewed file at ca11da3a (raw
  GitHub; pull request #277, sha256 starting 23a41e0dc2fdfa86, merged as
  88248654); preflight (sha256 starting 0031e9a5) before "package invoices:
  update not applied; on sale: no; invoice requests: none (table absent);
  package invoices: 0; package bank transfers: 0", after "package invoices:
  already applied; on sale: no; invoice requests: 0 (open: 0); package invoices:
  0; package bank transfers: 0"; production fingerprint after it
  (fingerprint.sql at ca11da3a, captured about 06:45 UTC) matched the full
  replay (except the known schema grant difference)
- `20261119065758_privacy_tightening_2.sql`: applied 2026-11-19 10:48 UTC;
  owner-approved, website-first (after the website release of pull request #282,
  merged as d24f1d65); preflight after "privacy tightening 2: already applied;
  analytics on: 0; third-party sharing on: 0; partners above 20%: 0; open ID
  checks with nothing to review: 0"; production fingerprint after it (captured
  about 10:50 UTC) matched the full replay at 772f770e (except the known schema
  grant difference)
- `20261119082834_house_slots.sql`: applied 2026-11-19 14:04 UTC;
  owner-approved, apply-first, Supabase SQL editor (browser, the owner's
  signed-in session), preflight + fingerprint checked; update, preflight and
  fingerprint.sql loaded from the reviewed files at 2d761c47 (raw GitHub; pull
  request #286, merged as 9742737f) and checked in the browser before running;
  update sha256 starting 11e3f464d93da230; preflight (sha256 starting b816bc6e)
  before "house slots: update not applied; admins: 2; ready to receive: 1;
  staff-granted slots: 0; house slots: none (table absent)", after "house slots:
  already applied; admins: 2; ready to receive: 1; staff-granted slots: 0; house
  slots: 0 (events: 0)"; production fingerprint after it (fingerprint.sql at
  2d761c47, captured about 14:04 UTC) matched the full replay (except the known
  schema grant difference)
- `20261119151152_package_gap_fixes.sql`: applied 2026-11-19 18:34 UTC;
  owner-approved, apply-first, Supabase SQL editor (browser, the owner's
  signed-in session), preflight + fingerprint checked; update, preflight and
  fingerprint.sql loaded from the reviewed files at c1a8c0e3 (raw GitHub; pull
  request #297, merged as 76c59c99) and checked in the browser before running;
  update sha256 starting ade1f659e7260a07; preflight (sha256 starting 25b94aa9)
  before "package gap fixes: update not applied; on sale: no; packages: 0;
  paused posts to put back: 0; unsent package checkouts to refuse: 0; unpaid
  Individual invoices issued before a package: 0; move record: none (table
  absent)", after "package gap fixes: already applied; on sale: no; packages: 0;
  paused posts to put back: 0; unsent package checkouts to refuse: 0; unpaid
  Individual invoices issued before a package: 0; move record: 0"; production
  fingerprint after it (fingerprint.sql at c1a8c0e3) matched the full replay
  (except the known schema grant difference)
- `20261119172135_post_views_and_likes.sql`: applied 2026-11-20 00:15 UTC;
  owner-approved, apply-first, Supabase SQL editor (browser, the owner's
  signed-in session), preflight + fingerprint checked; update, preflight and
  fingerprint.sql loaded from the reviewed files at a71f9a5c (raw GitHub; pull
  request #296, merged as 3f27fa11) and checked in the browser before running;
  update sha256 starting 3f25cd6e; preflight (sha256 starting 30e654e9) before
  "post views and likes: update not applied; publicly listed posts: 0", after
  "post views and likes: already applied; likes: 0; view days: 0; views: 0";
  production fingerprint after it (fingerprint.sql at a71f9a5c) matched the full
  replay (except the known schema grant difference)
- `20261120040242_signup_mode_member_invitations.sql`: pending

<!-- applied-register:end -->
