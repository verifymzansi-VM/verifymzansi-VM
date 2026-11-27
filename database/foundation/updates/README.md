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

## Business numbers through the click-to-view route, 27 November 2026

`20261127055550_reveal_business_contacts.sql` is pending (see the applied
register).

- **Business numbers on request.** `internal.reveal_post_phone` (behind the
  service-only `api.reveal_post_phone`, which the website's "Show number" route
  `/api/contact/reveal` calls after its Turnstile and per-visitor checks) now
  answers for a publicly live business (Business and Tourism) with the number
  the business chose on its form (`post_presentations.contacts`): `phone` for
  call, `whatsapp` for whatsapp, normalised to `+27` and nine digits. Call
  accepts any South African number, landline or mobile; WhatsApp only a mobile
  (06, 07, 08). Spaces, brackets and dashes are ignored; any other value gives
  null.
- **Listings and events unchanged**: the owner's verified number, only for a
  channel the owner chose.
- **Guard.** The update refuses with 55000 unless `internal.reveal_post_phone`
  has its reviewed body (md5 `98baceb9be415a5ba2150793263e58e1`) or this
  update's (`3c71cc40436dfcc792ecea4ed0d0db3f`).

Expand only: one replaced body; no command, argument, grant or table changes.
ORDER: **apply-first** (apply, then merge): the current website never asks for a
business number, so nothing changes until the website that shows business
numbers behind "Show number" is deployed. Read-only preflight (counts only):
`../preflight/20261127055550_reveal_business_contacts.check.sql`; rollback:
`../rollback/20261127055550_reveal_business_contacts.down.sql` (puts the earlier
body back). Behaviour checks:
`scripts/test-foundation-reveal-business-contacts.mjs`.

## Public post presentation limited to display fields, 27 November 2026

`20261127044054_public_presentation_display_fields.sql` is pending (see the
applied register).

- **Display fields only.** The public card read (`api.search_post_cards` with
  `frontend_presentation`, open to `anon` and `authenticated`) returns each
  post's presentation through `internal.frontend_post_presentation`. Its `data`
  now goes through `internal.public_post_presentation_data` (new): an allow-list
  of the top-level keys the public pages render (`presentedFormFields` and
  `presentedVideoLayout`, `restoredPublicRow`, the business and tourism layouts,
  `public-enquiry.ts`), with `business_details`, `category_details` (and its
  `customer_access` and `business_profile`) and `event_details` limited to their
  listed inner keys. `source_attributes`, the Market form's attribute set
  (unknown keys stripped by the form schema), is kept as it is. `email`,
  `phone`, `whatsapp` and every other key are not returned. `media` and
  `business_contacts` are unchanged.
- **Addresses.** A Market listing never returns `location_address`. A business
  (Business and Tourism) whose `category_details.customer_access` exists without
  `publishAddress: true` returns no `location_address`, `store_number`,
  `map_directions`, `business_details.street_address` or
  `business_details.suite_or_unit`, the forms' own rule. A business saved before
  customer access existed keeps its address; an event keeps its venue.
- **Owner reads unchanged.** `internal.frontend_owner_post` (the owner's edit
  forms and dashboard, staff review) replaces `data` with the full stored
  presentation.
- **One-off cleanup.** Every stored presentation loses its `email` key (the
  forms no longer collect one). An approval snapshot of a changed post that
  matched it before the cleanup is moved to the post after it, so the cleanup
  never counts as an unreviewed edit. The rollback does not restore removed
  emails.
- **Guard.** The update refuses with 55000 unless
  `internal.frontend_post_presentation` has its reviewed body (md5
  `d57885ae409a1a91b5bc9a71d2a94730`) or this update's
  (`9f279565fc4eca46f6b355313a2271a3`).

Expand only: two new internal functions
(`internal.public_post_presentation_data`, `internal.json_object_keys_only`, no
grants) and one replaced body; no command, argument, grant or table changes.
ORDER: **apply-first** (apply, then merge): the website asks nothing new and
accepts any `data` record, so public pages stop receiving keys they discard or
do not show. A website that still saves an email keeps it in the owner's view
only. Read-only preflight (counts only):
`../preflight/20261127044054_public_presentation_display_fields.check.sql`;
rollback:
`../rollback/20261127044054_public_presentation_display_fields.down.sql` (puts
the earlier body back and drops the two functions). Behaviour checks:
`scripts/test-foundation-public-presentation-fields.mjs`.

## Package running in the posting allowance, 26 November 2026

`20261126202833_allowance_says_package_running.sql` is pending (see the applied
register). Launch checklist item 80.

- **One key added.** `api.get_my_frontend_posting_allowance_v2`, which every
  post form already reads, also answers `package_running` (boolean): true while
  the caller's own Multi-listing package runs, by the same rule as
  `api.list_my_post_templates` (`internal.slot_package_now`). The answer is the
  same in every posting area, and the rest of the answer is unchanged.
- **One request fewer.** Save as template on the Edit listing page reads this
  from the allowance the page already loads, instead of its own
  `GET /api/post-templates`.

Expand only: one replaced body
(`internal.get_my_frontend_posting_allowance_v2(text)`); no command, argument or
grant changes. ORDER: **website-first** (merge and deploy, then apply): the
website's allowance parser is strict, so the release that accepts the key (as
optional) must be live first. Until the update is applied, the new website reads
a missing key as no package and does not show Save as template on Edit listing.
Read-only preflight:
`../preflight/20261126202833_allowance_says_package_running.check.sql`;
rollback: `../rollback/20261126202833_allowance_says_package_running.down.sql`
(puts the earlier body back). Behaviour checks:
`scripts/test-foundation-allowance-package-running.mjs`.

## Catalogue filters run in the database, 26 November 2026

`20261126062428_catalogue_filters_in_database.sql` was applied on 26 November
2026 at 23:48 UTC (see the applied register). Launch checklist item 29. No
table, column, index, trigger, command, argument or grant is added or removed;
two existing function bodies are replaced. Three public lists filtered, merged
or paged in the website after reading far more cards than they showed: an
organisation's supported businesses (`/organisation/<slug>` and
`/mzansi-business?org=`, which missed any business past position 4,800), a text
search under Businesses without a category (two reads merged in the website, up
to 480 results) and Video mode (four pages of 50 full cards per section, only to
use their ids).

- **`internal.search_posts`** (full body; behind `api.search_posts` and
  `internal.search_post_cards`) gains five optional request keys, so each list
  is one filtered, ordered, counted and paged call: `organisation` (a slug of a
  listed organisation; an unknown or unlisted slug matches nothing), `programme`
  (a uuid, needs `organisation`), `sponsored` (true or false, needs
  `organisation`; only posts with a sponsorship by that organisation running
  now), `kind` (listing, business or event; business without an area is the
  Business area plus the tourism businesses) and `ids_only` (true or false:
  `items` is then a list of post ids in the same order, and a page may hold 1 to
  200 instead of 1 to 48). Filters, order, totals, offsets (at most 4,800),
  cursors and replies to requests without the new keys are unchanged.
- **`internal.search_post_cards`** (full body) refuses `ids_only` (22023), so a
  card page stays at most 48 cards.
- **Guards.** The update refuses with 55000 unless both functions have a
  reviewed body (or this update's), by md5 of the body with line ends
  normalised: `internal.search_posts` `590ffdf23439ddbf6772f70afd199740` becomes
  `3084bc16bb1a0fe19ed94f19a3e23089`; `internal.search_post_cards`
  `6bb60ea1828671af6f73e785d217c8ba` becomes `4d8eb454d3e5650e8bf9f553ae0c0b50`.

ORDER: **apply-first** (apply, then merge). The website release from the same
pull request sends the new keys, which the earlier body refuses as unknown; the
earlier website never sends them and gets the same replies as before. Read-only
preflight: `../preflight/20261126062428_catalogue_filters_in_database.check.sql`
(expect "update not applied" as the only row; run it again after the update,
expecting "already applied"); rollback:
`../rollback/20261126062428_catalogue_filters_in_database.down.sql` (puts the
earlier bodies back byte for byte; undo the website release first, and it
refuses with 55000 when a later update changed either function).

## Invoice payment link, 26 November 2026

`20261126053701_invoice_pay_link.sql` was applied on 26 November 2026 at 20:30
UTC (see the applied register). Launch checklist items 38 and 34 (inventory
A28): a customer invoice is emailed with a link that lets its payer see and pay
it without signing in, and the receipt names the invoice it paid.

- **The link.** `private.customer_invoices.pay_link_hash` keeps the SHA-256
  (hex) of the invoice's current link, unique where set. The website's email job
  makes the link (32 random bytes) just before it sends, and stores its hash
  with the new service command `api.prepare_invoice_email` (only while the
  invoice is unpaid); each sending replaces the hash, so the latest email holds
  the live link.
- **The email.** `internal.notify_invoice_issued` (full body) also queues an
  outbox row of the new kind `invoice_issued`, one per invoice, for every way
  staff issue an invoice; `internal.claim_supported_notification_outbox` (full
  body) accepts the kind and gives no recipient once the account is closed.
- **Paying by link.** New service commands `api.get_invoice_by_link`,
  `api.save_invoice_billing_by_link` and `api.start_invoice_payment_by_link`
  (the website's server only). They reach the same functions as the member's
  commands: `internal.get_my_invoice`, `internal.save_my_invoice_billing` and
  `internal.start_invoice_payment` gain `p_link_hash` (old signatures dropped;
  the member's `api` commands keep their arguments and grants and pass null).
  With a hash (service role only, else 42501), new
  `internal.customer_invoice_for_caller` finds the invoice whose link it is, of
  an account that can still use the site, until 30 days after the invoice's due
  date (anything else is not found), and that account acts with every rule of
  the member's Pay now. The read is the member's read; Pay now also answers
  `owner_id` for the server's Ozow request.
- **The receipt.** `internal.get_payment_receipt` (full body) adds
  `customer_invoice_number` (from the payment's snapshot), null for a checkout.

ORDER: **apply-first** (apply, then merge): the release calls the new commands
and the deploy gate checks them. The live website leaves the new outbox kind
unclaimed until the release is deployed, and its receipt reader ignores the
extra field. Read-only preflight:
`../preflight/20261126053701_invoice_pay_link.check.sql` (expect "invoice
payment link: update not applied"); rollback:
`../rollback/20261126053701_invoice_pay_link.down.sql` (refused once an invoice
email was queued; deploy a website without the payment link first).

## Keep-for periods for the newer personal-data tables, 26 November 2026

`20261126053631_keep_for_periods.sql` was applied on 26 November 2026 at 20:15
UTC (see the applied register). Launch checklist item 51 (roadmap M7.4). No
table, column, trigger, command or grant changes; six existing function bodies
are replaced, all used by the daily retention sweep (`api.run_retention`,
service only).

- **Payment records: 7 years.** `internal.retention_tax_year_due` keeps payment,
  invoice and payout records 7 years (was 5) from the end of the tax year (1
  March to the end of February). Everything `internal.retention_commerce` dates
  by it follows. The cooling-off tick and the Terms version are stored in each
  payment's snapshot, so they are kept with it.
- **Privacy request proofs: 3 years** after the request closed (was 5;
  `internal.retention_privacy_requests`).
- **`internal.retention_operations`**: contact-form messages 12 months after
  they were resolved (open ones are kept); owner administrator invitations 12
  months after they were revoked, or 12 months after the claimant's account was
  erased (a claimed invitation is the owner's approval the staff role commands
  require); runtime switch and sign-up mode change logs 5 years.
- **`internal.retention_staff_records`**: decided appeals 2 years after the
  decision, once the decision appealed is gone (while it stands, its appeal
  stops a second one); released content holds 2 years after release, never while
  an appeal against them waits; staff role change proposals 5 years after they
  were decided or expired; evidence case claim events 2 years; raised slot
  limits 2 years after they ended (`internal.individual_slot_limit_guard` now
  lets the sweep delete them). A closed report (2 years, unchanged) is not
  deleted while an appeal against a warning it gave waits.
- **`internal.retention_verification`**: reasons for returning an ID 12 months
  after the return, unless a legal hold or fraud hold keeps them. The five-year
  sweep of closed accounts also deletes them by case: a kept return used to stop
  that sweep from deleting its case (the foreign key restricts) and failed the
  whole retention run.

Not changed here: account closures (they date the identity periods; deleted with
the Auth user), suspensions and bans, business check notes and partner records
(separate checklist items). ORDER: apply first, then merge (safe either way:
nothing is old enough to be deleted yet). The website release states 7 years for
payment records, 3 years for privacy request records and 12 months for
contact-form messages. Read-only preflight:
`../preflight/20261126053631_keep_for_periods.check.sql` (expect one summary row
reading "update not applied" with every count 0); rollback:
`../rollback/20261126053631_keep_for_periods.down.sql` (deleted records stay
deleted). Behaviour test: `scripts/test-foundation-keep-for-periods.mjs`.

## Video length checked by the database, 26 November 2026

`20261126001956_video_length_checked.sql` was applied on 26 November 2026 at
18:31 UTC (see the applied register). Launch checklist item 39 (roadmap M4.4
part B). One new column, two new commands, one new trigger and one replaced
trigger body; no command, argument, result or grant changes.

- **The length is stored.** `private.media_objects.duration_ms` holds a video's
  length in whole milliseconds, as the upload server read it from the file (null
  for pictures and for videos stored before this update). Once set it never
  changes (`internal.media_object_transition_guard`).
- **`api.complete_frontend_video_upload`** (service_role only) completes a
  content-bound video upload like `api.complete_frontend_media_upload` and
  stores the length. It refuses a length of 121 s or more, no length, or a
  picture. Called again for a ready video it is an idempotent replay.
- **Checked at submit.** `internal.guard_video_length_submission`, a trigger on
  `private.posts` like the posting terms guard, refuses every move into
  `pending_moderation` (submit, resubmit, reactivation, an edit's submission)
  while the post has a video whose stored length is longer than its kind allows
  (events 60 s, everything else 120 s; whole seconds decide) with 22023
  `video_too_long` (hint `<seconds>/<limit>`). A video with no stored length
  passes: videos stored before this update are not checked. Approval and the
  rest of the lifecycle are unchanged.
- **Staff see it.** `api.get_frontend_staff_video_lengths` (staff with
  `queue:view`) returns the stored length of each video of up to 50 posts
  waiting for review whose review claim the caller holds, the same rule as the
  queue's review data.
- **Storage** already grows with paid slots (`internal.media_storage_allowance`:
  (2 x package slots + 10) x 100 MB); the behaviour test proves that 100 slots
  hold 100 two-minute videos. Unchanged.

ORDER: apply first, then merge. The live website calls neither new command and
parses nothing this adds. Until the new website is deployed, a video it uploads
has no stored length and is not checked. Posts already waiting for review when
the update is applied are not checked either: staff check the preflight's
"events: N" posts by hand (an event's video at most 1 minute). It refuses with
55000 unless the guard has its reviewed body (or this update's). Read-only
preflight: `../preflight/20261126001956_video_length_checked.check.sql` (expect
one summary row reading "update not applied"); rollback:
`../rollback/20261126001956_video_length_checked.down.sql` (undo the website
first; the stored lengths are lost). Behaviour test:
`scripts/test-foundation-video-length.mjs`.

## Staff access follow-ups, 26 November 2026

`20261126001811_staff_access_follow_ups.sql` was applied on 26 November 2026 at
16:50 UTC (see the applied register). Launch checklist item 56, batch F.

- **An invitation for someone who already has an authenticator app.** An owner
  admin invitation was claimed only when an authenticator app was added or
  verified (the trigger on `auth.mfa_factors`), so a person invited after
  setting one up never became an admin. Both paths now use one helper,
  `internal.claim_owner_admin_invitation_for(uuid)` (no API role may run it),
  and a new trigger on `private.owner_admin_invitations` runs it when the owner
  adds an invitation: the person becomes an admin at once when their account
  already has a verified authenticator app. The checks are unchanged: a
  confirmed account that can sign in, an unclaimed and unrevoked invitation for
  its email (only the account that signed up with it, once one has), and no
  earlier staff role, which an invitation never reactivates.
- **A new two-step check after every claim.** A claimed role sets
  `frontend_mfa_not_before` to the moment of the claim, as every other role
  grant does (`internal.apply_frontend_staff_role`), on both paths: the person's
  sessions pass no staff command until they check their authenticator app again
  (this covers an older session when a second app is enrolled).
- **The update claims no waiting invitation itself**: making someone an admin is
  the owner's step. The preflight counts waiting invitations whose account
  already has an authenticator app. If that is above 0 at apply time, ask the
  owner. For each one the owner approves, add it again in the owner's SQL
  session, which fires the new trigger, keeping who signed up with it:

  ```sql
  with d as (delete from private.owner_admin_invitations where lower(email)=lower('<email>') and claimed_at is null and revoked_at is null returning email, signed_up_at, signed_up_by) insert into private.owner_admin_invitations(email, signed_up_at, signed_up_by) select email, signed_up_at, signed_up_by from d returning email;
  ```

  Revoke each one the owner does not approve (both snippets compare addresses
  ignoring capitals and show the address they changed; none shown means no
  match):
  `update private.owner_admin_invitations set revoked_at = now() where lower(email) = lower('<email>') and claimed_at is null and revoked_at is null returning email;`.

- **An invitation refused while the person was restricted** (banned, suspended,
  closed or unable to sign in when it was added or their app was checked) stays
  waiting. Once the restriction ends, add it again the same way.
- **Claims take the per-person lock.** The helper first takes
  `internal.lock_evidence_subject` (the lock of ban approval, account closure,
  erasure orders and staff role changes), then reads whether the account can
  sign in, then locks the staff roles table, in the order staff role changes
  use. An invitation claimed at the moment a ban is approved, the account is
  closed or an erasure is ordered waits and then sees it.
  `internal.order_account_erasure` already took that lock before its staff check
  and is unchanged. That this never leaves a banned admin also relies on
  `20261125174942_end_admin_role_before_restriction.sql` (pull request #377,
  applied before this update): when the claim comes first, the ban approval
  waits for it and then refuses to restrict the new admin.
- **No closure of a staff account through the service command.**
  `internal.close_account_evidence` (behind the service-only
  `api.close_account_evidence`, which nothing in the website or workers calls,
  and `internal.close_account_now`) refuses an account with an active staff
  role: PT409 "end the staff roles of this account first" (detail
  `staff_account`), the check `internal.order_account_erasure` makes, under the
  same lock. Members closing their own account and staff erasure orders already
  refused such accounts.

Expand only: two replaced bodies (`internal.claim_owner_admin_invitation()`,
`internal.close_account_evidence(uuid)`), one new helper, one new trigger
function (`internal.claim_new_owner_admin_invitation()`) and its trigger; no
command, argument, result or grant changes. ORDER: **apply-first** (apply, then
merge); no website code depends on it. The same pull request adds
`/api/foundation/staff` to the proxy's staff check (`src/proxy-handler.ts`,
`src/lib/foundation/page-access.ts`), as for `/api/admin`. Read-only preflight:
`../preflight/20261126001811_staff_access_follow_ups.check.sql`; rollback:
`../rollback/20261126001811_staff_access_follow_ups.down.sql` (removes the
trigger, its function and the helper, and puts the two earlier bodies back).
Behaviour checks: `scripts/test-foundation-staff-access-follow-ups.mjs`.

## Lifecycle rule follow-ups, 25 November 2026

`20261125225855_lifecycle_rule_follow_ups.sql` was applied on 26 November 2026
at 05:59 UTC (see the applied register). Launch checklist item 56, batch D: the
Low findings of the reviews of `20261125150215_small_lifecycle_rules.sql` (item
40). Full definitions of two internal functions; no API command, argument,
result or grant changes.

- **A report holds deletion for a limited time.** `internal.delete_post` refuses
  (PT409, detail `post_report_open`) only while an open report from the public
  exists and either that report is less than 7 days old or
  `internal.post_report_deferred` holds, the scheduled clean-up's own rule: it
  stops waiting 7 days after the post would otherwise be deleted (67 days after
  its last change when it has no deletion date). So an owner can delete a
  reported post only once the report is 7 days old and the clean-up's waiting
  time has passed. The 7 days from the report matter for a post that has not
  changed for months (the clean-up's clock reads the post itself, not its edit
  copy), so staff always have time to look. Before, any open report refused with
  no end, so a report nobody looked at could keep a paid slot or a free event
  place taken. A staff duplicate-event flag no longer stops the owner's deletion
  (it names a pair of posts, and the website says someone reported the post).
  The scheduled clean-up is unchanged: it still waits for any open report, staff
  flags included.
- **The sticker reminder needs a reviewed ID.**
  `internal.sticker_renewal_reminder_key` also requires
  `internal.frontend_business_identity_reviewed(owner)`, which renewing needs.
  The email job compares the queued key with the current one, so a reminder
  queued before the review lapsed is finished as skipped without a send, and it
  is not sent again for that sticker end (its key is already used), even if the
  review is accepted again before the end. Its 30 days stay the period
  `internal.queue_sticker_renewal_reminders` uses to pick candidates; the
  behaviour test checks both read the same interval.

ORDER: apply first, then merge (either order is safe: the website part only adds
the "Events can start at most 12 months ahead." message and shows the business
verification dates in South African time). Read-only preflight:
`../preflight/20261125225855_lifecycle_rule_follow_ups.check.sql` (expect
"update not applied"; it counts posts with an open report, those whose owner may
delete them after the update, and unsent sticker reminders whose owner's ID is
not reviewed); rollback:
`../rollback/20261125225855_lifecycle_rule_follow_ups.down.sql` (puts item 40's
two bodies back; nothing is deleted, and a reminder skipped meanwhile for a
missing ID review is not sent again for the same sticker end). Behaviour test:
`scripts/test-foundation-lifecycle-rule-follow-ups.mjs`.

## Release one blocked phone number, 25 November 2026

`20261125213005_release_one_phone_number.sql` was applied on 26 November 2026 at
05:55 UTC (see the applied register). Launch checklist item 21. A ban blocks
every phone number the banned person verified
(`20261117064820_ban_blocks_phone_numbers.sql`), and until now a number was
freed only with the whole ban. Networks re-issue numbers, and a number can be
blocked by mistake, so staff can now free one number for other people while the
ID ban stays.

- **A mark, never a delete.** `private.banned_phone_numbers` gets
  `release_reason`, `release_proposed_by`, `release_proposed_at` (a request,
  waiting 7 days) and `released_by`, `released_at` (the approval).
  `internal.phone_number_banned` (full body) ignores released rows. The trigger
  that copies a ban's numbers re-runs "insert ... on conflict do nothing" when
  the ban row changes (a replacement decision, a later ban of the same person),
  which keeps the mark. The marks go with the ban row (lifted, or purged after 5
  years), like the numbers.
- **Never for the banned person.** The new
  `internal.phone_number_banned_for(owner, phone)` also blocks any account that
  shares an accepted identity (revoked included) with a running ban listing the
  number, released or not. `internal.create_verification_phone_challenge` and
  `internal.finalize_verification_phone` (full bodies, otherwise unchanged) ask
  it, so the banned person's other accounts can never take a released number
  back (PT409 `phone_banned`, as before).
- **Two staff members.** `api.propose_phone_number_release(p_phone, p_reason)`
  asks to free a number a running ban blocks now (PT404 `phone_not_blocked`
  otherwise; one waiting request per number, PT409 `phone_release_pending`; the
  same request sent again answers `reused`; a request that no longer covers
  every ban row of the number, or has expired, is replaced).
  `api.review_phone_number_release(p_phone, p_proposed_at, p_approve)` decides
  the request the staff member saw (`p_proposed_at` is its time, otherwise PT409
  `phone_release_not_pending`). Rejection: anyone with the capability, the
  proposer included. Approval: only a staff member who proposed none of its rows
  (42501 `phone_release_same_staff`), while the request is under 7 days old,
  covers every ban row of the number and its proposer still holds the capability
  (PT409 `phone_release_changed`). It marks that request's rows released and
  revokes the active phone proof of that number still held by an account of the
  banned person (only that one, locked first), so whoever else holds the number
  now can verify it. Nobody may propose or decide a release of a number that
  they, or any account sharing an accepted identity with them, verified, or that
  a ban of such an identity lists (42501 `phone_release_conflict`). Capability
  `account:restore` (admins and governors, an authenticator code from the last
  15 minutes), as for lifting a whole ban.
- **The staff list.** `api.get_phone_number_releases()` returns the requests
  that can be decided (one waiting request covering every ban row of the number;
  a partial one is asked again) and the latest 50 releases with the full
  numbers, for the Restrictions page. Only numbers someone asked to release are
  listed, never the whole blocked list.
- **Members** are told nothing (no SMS, email or notice); the banned person's ID
  ban is unchanged.

Expand only: three new API commands, five new columns, two new helpers and three
replaced bodies. ORDER: **apply first, then merge** (the Deploy gate probes
every command in the runtime manifest). Read-only preflight:
`../preflight/20261125213005_release_one_phone_number.check.sql`; rollback:
`../rollback/20261125213005_release_one_phone_number.down.sql` (drops the
commands, helpers and columns and puts the three earlier bodies back; numbers
released meanwhile are blocked again while their ban runs).

## Lost-email alert and staff deadline email follow-ups, 25 November 2026

`20261125212548_email_alert_follow_ups.sql` was applied on 26 November 2026 at
05:52 UTC (see the applied register). Launch checklist item 56, batch B: the Low
findings of the reviews of
`20261125131322_lost_email_alert_staff_deadlines.sql`. Full definitions of three
internal functions and one new column; no API command, argument or grant
changes.

- **Old alerts.** `internal.claim_lost_email_alert` deletes alerts sent over 400
  days ago on every run, also while nothing is lost (before, only when a new
  alert was made).
- **Payment count.** New column `private.lost_email_alerts.payments`: how many
  of all the lost emails an alert reports are payment emails, listed or not. The
  claim returns it as `payments` (the same number when the alert is offered
  again; null for an alert made before this update). The email's subject counts
  payments from it; the website falls back to the listed ones without it.
- **Authenticator app.** Staff without a verified authenticator app (who cannot
  open any staff page) get no deadline email: the trigger leaves them out and
  `internal.staff_email_due`, the email job's check before each send, skips
  them.
- **Appeals.** An appeal is not emailed to whoever took, approved or reported
  the decision appealed against (they may not decide it), at queuing and before
  each send.
- **The cap.** Privacy requests have a legal deadline, so they are outside the
  cap and do not count: each is emailed to staff who can act on it (a verified
  authenticator app), except that only a member's first request in any 24 hours
  is emailed (a member may file 5 an hour; later ones are only in the staff
  queue). A request staff recorded for someone without an account is always
  emailed. Appeals and reports keep the shared cap of 30 in any 24 hours, now
  counting only themselves. At repeatable read or serializable the count could
  pass the cap, so an appeal or report then queues no email (every website and
  job call runs at read committed).

Not changed: giving an alert back
(`api.complete_lost_email_alert(p_claim, false)`) does not check who holds it.
The alert's id is both the claim and the email's key and stays the same when the
alert is offered again, so holders cannot be told apart without a new token in
the API. It is safe: the hold lasts 5 minutes while a run ends within a minute,
and the email key stops a second delivery. Privacy notices that can never be
sent (their address changed) are already counted on the staff operations page
("can never be sent", last 30 days).

ORDER: apply first, then merge. Read-only preflight:
`../preflight/20261125212548_email_alert_follow_ups.check.sql` (expect "update
not applied"; it counts lost emails only once their lease has ended, alerts due
for deletion, staff without an authenticator app and today's staff emails);
rollback: `../rollback/20261125212548_email_alert_follow_ups.down.sql` (puts the
three earlier bodies back and drops the column; queued emails and alerts stay;
afterwards privacy request emails count towards the cap again, so appeals and
reports can go without email for up to 24 hours).

Notes on the applied `20261125131322` files, which cannot be edited:

- Its preflight counts an email at its 8th attempt that is still within its
  lease as lost; the alert reports it only once the lease has ended. The
  preflight above uses the alert's rule.
- Its rollback deletes the staff deadline emails before it drops the three
  triggers, so a privacy request, appeal or report submitted in between queues
  emails that stay. Run it while no submissions are expected (or check for staff
  emails afterwards and delete them by hand).
- Its check for unsent alerts takes no lock, so an email job run can make a new
  alert just after the check. Pause the operations jobs Worker's schedule before
  running it.

## Staff refund follow-ups, 25 November 2026

`20261125194727_part_refund_follow_ups.sql` was applied on 26 November 2026 at
05:32 UTC (see the applied register). Launch checklist item 56, batch A: the Low
findings of the reviews of `20261125133916_staff_part_refunds.sql`. Full
definitions of four internal functions; no API command, argument, grant or table
changes.

- **What was refunded.** `internal.payment_refunded_before_cents` counts a
  reversed slot unless an applied refund record that ended the paid days covers
  it, so a slot reversed after a keep-running part refund is no longer
  under-reported.
- **Repeats.** In `internal.record_staff_refund`, "everything left"
  (`p_amount_cents` null) never returns an earlier part refund that kept the
  slot running as a repeat (by request id or by reference); and the same request
  id with a corrected bank reference or Ozow refund id is refused (PT409
  `refund_request_reused`) instead of returning the old record.
- **Activate first.** A part refund that keeps the slot running is refused while
  the payment waits for "Activate what was paid for" (PT409
  `refund_activate_first`), so activation never creates the partner commission
  after the money went back. If it cannot be activated, staff record a refund
  that ends the slot.
- **The staff list read.** `api.get_staff_refunds_left` gives 0 left at payment
  level once a slot was reversed (a whole-payment refund is refused then), and
  adds `notice_ends_on` (the end of 20 South African business days' notice given
  today) and, per slot, `paid_days` (the plan's own term; null for slots added
  to a package, which are priced for the days left, so the website uses the
  grant's dates) and `lost_days` (free lost days added while the slot ran; a
  waiting renewal that was only moved gained none). The section 14 hint counts
  unused paid days from the notice end, and the forms warn when lost days or
  money were already given for a failure. `api.get_lost_days_preview` adds
  `refunded_cents` per term (applied keep-running part refunds of the slot, or
  of a whole payment that paid for that slot only). Warnings only: nothing is
  refused for giving both.

ORDER: **website-first** (merge and deploy, then apply): the website before this
pull request reads both staff reads with a strict parser and would refuse the
new fields; this pull request's website reads them as optional. Read-only
preflight: `../preflight/20261125194727_part_refund_follow_ups.check.sql`
(expect "update not applied" and "of them on payments not activated: 0");
rollback: `../rollback/20261125194727_part_refund_follow_ups.down.sql` (the
update writes no rows; the rollback can run at any time). Roll the database back
**before** reverting the website: the website before this pull request refuses
the new result fields. The rollback brings back the under-count of
`internal.payment_refunded_before_cents` (a slot reversed after a keep-running
part refund is not counted as refunded) and the other gaps this update closed.

Notes on the rollback of `20261125133916_staff_part_refunds.sql` (that file is
applied and is not edited): its header does not mention the `request_id` column
and index it drops; and it counts part refunds before it locks
`private.payment_refund_requests`, so a part refund recorded at that moment
could slip past its refusal. A later rollback that needs it must lock the table
first (`lock table private.payment_refund_requests in share mode`), then count.

## No account restriction for an admin, 25 November 2026

`20261125174942_end_admin_role_before_restriction.sql` was applied on 26
November 2026 at 03:46 UTC (see the applied register). Launch checklist item 20,
part 3. Until now two governors could ban an admin (an identity ban, or a report
ban a moderator proposed and a governor approved), and one governor alone could
put an admin under 72-hour emergency containment, again and again. A restriction
removes account access, so `internal.staff_actor` then refused the admin, even
the last one: the last-admin guard watches only staff roles.

- **The rule.** A ban, suspension or emergency containment is refused with PT409
  "End this person's admin role first" (detail `subject_is_admin`) while the
  person holds an active admin role (`private.staff_roles` role `admin`,
  `revoked_at` null). Removing an admin goes through the existing role change
  (with `20261125150338_admin_removal_needs_approval.sql`, a different admin
  approves it); then the person can be restricted like anyone else. Erasure
  already refuses staff accounts (`internal.order_account_erasure`).
- **Every path is covered** by three full bodies (api wrappers, arguments,
  results and grants unchanged): `internal.propose_decision`
  (`api.propose_decision` with `restrict_account`, and
  `api.propose_verified_identity_ban`, which calls it);
  `internal.propose_frontend_report_restriction`
  (`api.execute_frontend_report_action_v2` `suspend` and `ban`, including the
  emergency containment it applies at once); and `internal.approve_decision`
  (`api.approve_decision` and `api.decide_frontend_governance`), checked again
  in case the person became an admin after the proposal. Approval is the only
  way a proposal takes effect (`internal.frontend_report_restriction_effect`,
  `internal.bind_native_restriction_for_review` and
  `internal.verification_decision_effect` run on it). Each check runs after the
  subject's lock, which staff role changes also take.
- **Governors and moderators are not protected**: a moderator can still be
  contained at once, and a governor's or moderator's role can be ended at once
  by an admin. Restrictions already in place are unchanged; the preflight counts
  admins who cannot sign in and restriction proposals about an admin (approving
  one is refused from the update on).
- **Trade-off.** A hacked admin can now only be stopped by two other admins or
  the owner's SQL session (owner accepted 26 Nov).

Expand only: no command, argument or grant changes. ORDER: either order is safe
(the website words the new refusal); released apply-first on 26 November 2026.
Read-only preflight:
`../preflight/20261125174942_end_admin_role_before_restriction.check.sql`;
rollback:
`../rollback/20261125174942_end_admin_role_before_restriction.down.sql` (puts
the three earlier bodies back).

## Members change their verified place, 25 November 2026

`20261125161326_change_verified_place.sql` was applied on 26 November 2026 at
02:01 UTC (see the applied register). Launch checklist item 20, part 2.

- New table `private.verification_locality_changes` (from and to province and
  city, and the time), row level security on, no grants. It belongs to the
  member's place row (on delete cascade), so account erasure and the retention
  sweep, which delete that row, delete its history too.
- `internal.confirm_verification_locality` (full body): a different valid place
  replaces the member's place and is recorded, at most once every 15 days (PT409
  `location_change_cooldown`, the next allowed time as the hint). The same place
  answers "reused" as before; the first place is not a change.
- `internal.frontend_privacy_export_data` (full body) adds the dataset
  `locality_changes`.
- A verified phone number already changes through a new SMS code at most every
  15 days, with an accepted ID review (`create_verification_phone_challenge`,
  `finalize_verification_phone`); this update does not change that. The website
  now offers it from My profile.

Expand only; no command, argument or grant is removed. ORDER: apply first, then
merge. Read-only preflight:
`../preflight/20261125161326_change_verified_place.check.sql` (expect "update
not applied" and the number of members with a place); rollback:
`../rollback/20261125161326_change_verified_place.down.sql` (refused once any
member changed their place). Behaviour test:
`scripts/test-foundation-change-verified-place.mjs`.

## Removing an admin needs another admin's approval, 25 November 2026

`20261125150338_admin_removal_needs_approval.sql` was applied on 25 November
2026 at 19:45 UTC (see the applied register). Launch checklist item 20.

- `internal.propose_frontend_staff_role` (full body) still applies a lowering at
  once when the person is a moderator or a governor. Lowering an admin (to
  governor, moderator or member) is now a proposal that waits up to 7 days for a
  different admin to approve or reject it on the Staff roles page
  (`api.review_frontend_staff_role`): never the proposer, never the admin it is
  about, and only while the proposer is still an admin. The proposer may
  withdraw it. No command, argument, result or grant changes.
- **Emergency path.** With only two admins, a removal waits for an approver who
  does not exist. If an admin account must lose its role at once (for example it
  was taken over), the owner does it in a reviewed SQL editor session, as for
  the first administrator: set `revoked_at` and `revoked_by` on that person's
  current `private.staff_roles` row, insert a matching
  `private.frontend_staff_role_changes` row (status `applied`, `direct_removal`
  true, the reason) so the Staff roles history shows it, and record the session
  in the implementation log. The last active admin can never be removed.

Replaced body only. ORDER: apply first, then merge (the live roles route already
accepts "proposed"). Read-only preflight:
`../preflight/20261125150338_admin_removal_needs_approval.check.sql` (expect
"update not applied", the number of active admins and the role changes waiting);
rollback: `../rollback/20261125150338_admin_removal_needs_approval.down.sql`
(puts the earlier body back; proposals made meanwhile stay and can still be
decided). Behaviour test:
`scripts/test-foundation-admin-removal-needs-approval.mjs`.

## Small lifecycle rules, 25 November 2026

`20261125150215_small_lifecycle_rules.sql` was applied on 25 November 2026 at
18:21 UTC (see the applied register). Launch checklist item 40.

- **Free events at most 12 months ahead.** A new trigger on
  `private.event_details` refuses an inserted or changed start more than 365
  days after now (22023, detail `event_too_far_ahead`), the rule the website
  form already applies. Unchanged starts are not checked again.
- **Sticker renewal reminder.** New outbox kind `sticker_renewal_reminder`: one
  email 30 days before an approved CIPC or Seen check ends, while it is still
  its business's latest decision of that kind, no check of that kind waits for
  review, the business is in any state except archived or sold (draft, under
  review, rejected, live or paused) and its owner can sign in
  (`internal.sticker_renewal_reminder_key`, queued by
  `internal.queue_sticker_renewal_reminders` from `api.run_slot_renewals`). The
  key names the end, so a renewed sticker gets its own reminder. Linked CIPC
  stickers renew with their main profile and get none.
  `internal.claim_supported_notification_outbox` (full body) accepts 27 kinds,
  re-checks the key at claim and adds the sticker's kind, end and business.
- **A reported post waits for staff.** `internal.delete_post` (full body)
  refuses while any report on the post is open (PT409, detail
  `post_report_open`), the rule the scheduled clean-up already follows. The
  owner can still hide the post.

No API command or argument is added or removed. ORDER: apply first, then merge.
Read-only preflight:
`../preflight/20261125150215_small_lifecycle_rules.check.sql` (expect "update
not applied" and "events starting over 365 days ahead: 0"); rollback:
`../rollback/20261125150215_small_lifecycle_rules.down.sql` (deletes the sticker
reminders, which are notifications only).

`20261125225855_lifecycle_rule_follow_ups.sql` (below) later limits the deletion
rule to public reports within the clean-up's waiting time and asks the reminder
for a reviewed ID. Notes on the applied `20261125150215` files, which cannot be
edited:

- **During the apply.** Its check for events starting more than 365 days ahead
  runs before the trigger exists and takes no lock on `private.event_details`,
  so an event saved in that moment with a start that far ahead can slip in. The
  website form refuses such a start, so only a direct call could do it; the
  preflight run after the update shows the count (expect 0).
- **Rolling back and re-applying.** Its rollback deletes the sticker reminders,
  sent or not. Applying the update again queues a fresh reminder for every
  sticker then ending within 30 days, so owners already reminded get a second
  email. And while it is rolled back nothing stops an event starting more than
  365 days ahead; one saved meanwhile makes the re-apply refuse (55000, "events
  start more than 365 days ahead") until that event is moved or removed.
- **Rollback header.** It says the `internal.delete_post` body it puts back is
  from `20261104101932_restored_owner_post_actions.sql`; that body was last set
  by `20261109104020_post_expiry_rules.sql`. The bytes it restores are the right
  ones (its precondition and the behaviour test check them); only the name in
  the comment is wrong.

## Staff refunds: the first purchase and part refunds, 25 November 2026

`20261125133916_staff_part_refunds.sql` was applied on 25 November 2026 at 16:28
UTC (see the applied register). Launch checklist item 77. The posting terms
(posting-v6) promise a first purchase cancelled within 5 business days, refunded
in full, and refunds of part of a payment (unused whole days less the R50
cancellation fee, or a reasonable part for days we failed to provide). Until
this update every refund was a whole payment or a whole slot.

- **One refund command.**
  `api.record_staff_refund(p_payment_id, p_line_id, p_channel, p_amount_cents, p_reason_code, p_reason, p_reference, p_ozow_fact, p_asked_on, p_request_id)`
  (capability `payments:refund`, an authenticator code from the last 15 minutes,
  the staff rule of money actions). Channels: `ozow` (the server sends it, only
  in Ozow's 13-day window), `dashboard` (already refunded by hand in the Ozow
  dashboard: `p_reference` is Ozow's refund id; Ozow's amount must be the amount
  recorded) and `reference` (a bank transfer back, or Ozow's reference, under
  the existing reference rules). Refunds only; chargebacks stay whole, on the
  existing commands. `p_request_id` (new column `request_id`, unique) names one
  request: sent again with the same input it returns the first record
  (`repeated`), whatever its state; with other input it is refused (PT409
  `refund_request_reused`).
- **The amount.** `p_amount_cents`, or null for everything left: more than 0 and
  at most what the slot and the payment have left (`internal.refund_left_cents`:
  paid, less refunds applied, waiting or on their way through Ozow; PT409
  `refund_more_than_left`). The insert guard of
  `private.payment_refund_requests` now holds every refund to what the other
  refund records leave instead of requiring the full amount, so the existing
  whole-refund commands can never pay back more than is left. A chargeback is
  still the full amount. Several part refunds of one payment are allowed, one at
  a time.
- **The slot.** New column `ends_paid_days`, fixed when recorded: a part refund
  for 'Our failure, after a fix was offered' or 'Billing error' keeps the slot
  running (or it has already ended: item 75's ended slot gets money instead of
  days); every other refund, and any refund of everything left, ends the paid
  days as before (grant revoked, posts hidden, commission reversed). A part
  refund that keeps the slot running also reverses the partner commission of
  that slot (or of the payment), as a slot reversal does. The member gets the
  neutral 'Payment update' email either way. 'Duplicate payment' and 'Cancelled
  before the renewal started' refund everything left (PT409
  `refund_whole_only`). A waiting renewal blocks only a refund that ends the
  paid days, also when approving and sending.
- **The first purchase.** Reason `first_purchase_cancelled` (new column
  `customer_asked_on`, required with it and only with it), accepted only by the
  new command: the account's first purchase (no payment of the same account
  confirmed earlier, whatever happened to it later), the whole payment with
  nothing refunded before, for a written request made on `p_asked_on`
  (YYYY-MM-DD): not before the payment was confirmed, not in the future, and no
  later than the 5th business day after the day it was confirmed (South African
  time; PT409 `first_purchase_too_late`). Business days are Monday to Friday
  except the public holidays of the Public Holidays Act
  (`internal.za_public_holiday`: the fixed dates, the Monday after one on a
  Sunday, Good Friday and Family Day from the Easter date, and 27 December when
  Christmas is on a Sunday). Known limit: holidays declared for one year only
  (for example an election day) are not counted, so such a day shortens the
  window by one day; a forward update can add one when it is declared.
- **Two staff members above R1 000** is unchanged: the total returned on one
  payment, this refund included, so splitting a refund does not avoid it.
- **The staff list read.** `api.get_staff_refunds_left(p_payment_ids)`
  (capability `payments:view`): for up to 50 payments, what was refunded and
  what is left (per payment and per slot), each slot's paid dates, until when
  Ozow refunds it, and whether it is the account's first purchase with the last
  day to ask.
- **What a payment brought in.** `internal.payment_net_cents` (staff sales and
  the VAT registration count) is the amount less the refunds applied (and less
  reversed slots no refund record covers); nothing once refunded or charged back
  without such a record, as before.

Not included: credit notes (the business is not registered for VAT; whole
refunds have none either), part chargebacks, a database-calculated section 14
credit (the screen suggests one), a first purchase per person rather than per
account, showing refund amounts to members, and ending a slot when the credit is
R0.

Expand only. ORDER: **apply-first** (apply in production, then merge): the
Deploy gate probes every command of `../runtime-api-manifest.json`, and the live
website reads nothing new. Read-only preflight:
`../preflight/20261125133916_staff_part_refunds.check.sql`; rollback:
`../rollback/20261125133916_staff_part_refunds.down.sql`, which refuses once a
first-purchase or part refund was recorded (fix forward).

## Lost-email alert and staff deadline emails, 25 November 2026

`20261125131322_lost_email_alert_staff_deadlines.sql` was applied on 25 November
2026 at 14:30 UTC (see the applied register). Launch checklist item 28.

- **Lost-email alert, kept in the database.** A queued email (outbox) or a
  privacy request notice still unsent after its 8th attempt, once its lease has
  ended, is lost. New table `private.lost_email_alerts` (one row per alert
  email, holding the list it sends) and a new column `lost_alert_id` on
  `private.outbox_events` and `private.privacy_notice_jobs` (the alert that
  reported the row). New service-only commands
  `api.claim_lost_email_alert(p_limit)` and
  `api.complete_lost_email_alert(p_claim, p_sent)`: an alert whose send failed
  is offered again unchanged (same id and list, so the email key is the same);
  otherwise, unless an alert is being sent or one was sent in the last 15
  minutes, every lost row not yet reported goes into one new alert that lists
  the oldest 1 to 50 and counts them all. Lists hold queue ids, kinds, attempts,
  times and error codes, never an address or the content. Sent alerts are
  deleted after 400 days.
- **Staff deadline emails.** New outbox kinds `staff_privacy_request`,
  `staff_appeal` and `staff_report`. A trigger on each new privacy request,
  appeal and public report queues one email per staff member whose role holds
  `dsar:manage`, `appeal:decide` or `report:resolve` and who has a confirmed
  address, except whoever submitted it and the person a report is about. At most
  30 staff deadline emails are queued in any 24 hours, all staff and kinds
  together, so the email provider's 100 a day keep room for members' emails (an
  advisory lock makes overlapping submissions queue one at a time); items past
  the cap are still in the staff queues.
  `internal.claim_supported_notification_outbox` (full body) accepts 26 kinds
  and hands a staff email out only while the staff member can sign in, still
  holds the capability and the item is still open, and never for a report about
  or by that staff member (otherwise it is finished as skipped). It adds the
  type, the report's severity, the received time and the deadline: the privacy
  request's effective due date, an appeal 3 and a report 2 business days after
  receipt (weekends are skipped, public holidays are not, so the date is never
  later than the real one).

New API commands; no command, argument or grant is removed. ORDER: apply first,
then merge (the deploy gate needs the two new commands). Read-only preflight:
`../preflight/20261125131322_lost_email_alert_staff_deadlines.check.sql` (expect
"update not applied" and "staff emails queued: 0"; it also counts the lost
emails the first alert will list); rollback:
`../rollback/20261125131322_lost_email_alert_staff_deadlines.down.sql` (deletes
the staff deadline emails, which are notifications only, and the sent alerts;
refused while an alert is not sent yet).

## Add lost days to paid slots and packages, 25 November 2026

`20261125113433_add_lost_days.sql` was applied on 25 November 2026 at 13:05 UTC
(see the applied register). Launch checklist item 75. The posting terms
(posting-v6) promise that when we fail to provide what a member paid for, or a
suspension is overturned, we first add the days they lost, and that a package's
slots still end together. Until this update no command could move a paid end
date.

- **The preview.** `api.get_lost_days_preview(p_email)` (capability
  `payments:view`) lists the running paid terms of the active account with this
  email: one item per Individual slot (its first grant, slots, queued renewals,
  paid end) and one per Multi-listing package (its slots and end). It records
  nothing, so staff never add days blind.
- **The change.** `api.add_lost_days(p_email, p_days, p_reason, p_request_id)`
  (capability `payments:refund`, an authenticator code from the last 15 minutes)
  adds 1 to 30 days, with a reason of 5 to 500 characters, to every running paid
  grant of the member (`retail_paid`, active, complete payment, end still in the
  future). A running grant ends later; a queued renewal starts and ends later,
  so the slot's chain stays unbroken; every grant of a package ends later, so
  its slots still end together. Ended, refunded, charged-back and pending
  grants, free credits, house slots, free trials and sponsorships never move.
  The search end of the slots' posts follows at once; each post's own end
  follows when the lifecycle job reaches it. Nothing is charged, invoiced or
  emailed.
- **Safety.** Both commands follow the staff rule of money actions
  (`internal.assert_staff_payment_actor`). One change at a time per member: the
  advisory lock package deliveries take, then the grants locked in id order, the
  staff member checked again after the wait and the grants read again (PT409
  `lost_days_busy` when a delivery changed them meanwhile). A repeated request
  id with the same input returns the first answer and adds nothing; with other
  input it is refused (PT409 `lost_days_request_reused`).
- **At most 30 days per slot.** A change is refused (PT409 `lost_days_limit`)
  when, for any grant it would move, the days already added to that grant plus
  the new days exceed 30. Beyond that, staff refund instead.
- **The record.** New append-only `private.lost_day_additions`: one row per
  grant moved (request, grant, staff member, days, start and end before and
  after, reason, time); deleted only with its grant (commerce retention).
- **Privacy export.** `internal.frontend_privacy_export_data` (full body) adds
  the dataset `lost_day_additions` (never the staff member). The staff export
  reader accepts more datasets than its minimum (42), so the live website reads
  the export unchanged.
- **Adding slots to a package.** `internal.slot_package_add_quote` (full body)
  counts at most term_days - 1 whole days left (179 for a 180-day package), so a
  package with added days keeps every existing bound (the added-slots request
  check, the website's add offer and the staff queue) and an added slot never
  costs more than a full term; the member keeps the extra days free.

Owner decisions (delegated to the coordinator): only running slots get days, an
ended slot gets a refund instead; no all-accounts version; no automatic member
email.

Expand only. ORDER: **apply-first** (apply in production, then merge): the
Deploy gate probes every command of `../runtime-api-manifest.json`, and the live
website reads nothing new. Read-only preflight:
`../preflight/20261125113433_add_lost_days.check.sql`; rollback:
`../rollback/20261125113433_add_lost_days.down.sql`, which refuses once any days
were added (the days and their record stay: write a forward update).

## Paid add-ons retired, 25 November 2026

`20261125044115_retire_paid_addons.sql` was applied on 25 November 2026 at 10:17
UTC (see the applied register). Launch checklist item 37: Urgent, Boost and
Featured are no longer sold. The website stopped offering them in pull request
#358, and its readers accept the add-on fields as missing since that release.
This update is the database step.

- **Versions retired.** The three add-on versions (`private.addon_versions`,
  boost, featured and urgent, version 1) get `retired_at`. Catalogue versions
  are immutable, so this is final; selling an add-on again needs a new version
  in a new update.
- **`api.start_checkout` stays, inert.** Since
  `20261113002421_individual_slots_r69.sql` it sells only add-ons, and it reads
  only versions that are not retired, so it now refuses every product with 22023
  "product not available" and creates no payment. It is a baseline command
  (`../candidate.sql`, `../api-manifest.json`) that nothing in `src/` or
  `workers/` calls; keeping it needs no contract step and no change to the
  baseline contracts.
- **Replies without add-on fields** (full bodies; every other field unchanged):
  `internal.billing_catalogue` (no `addons` list, no plan `addon_capabilities`),
  `internal.get_my_billing` (no slot `addon_capabilities`) and
  `internal.get_my_frontend_post_manager` (no `addons` dates).
- **Kept.** The add-on tables and columns (history, checks, foreign keys and
  immutability guards) and the settlement, staff activation and refund paths for
  add-on payments, so an add-on payment already on record is still shown and can
  still be refunded. Pending add-on payments expire within the hour as before.

No API command, argument, return type or grant changes. ORDER: apply first, then
merge. Read-only preflight:
`../preflight/20261125044115_retire_paid_addons.check.sql` (expect "update not
applied", 3 add-on versions on sale, no complete, refunded or charged-back
add-on payment and 0 add-on windows running); rollback:
`../rollback/20261125044115_retire_paid_addons.down.sql` (puts the three read
bodies back; the versions stay retired).

## The member's consent to the automatic ID check, 25 November 2026

`20261124235920_identity_check_consent.sql` is pending (see the applied
register). Launch checklist item 61, part 7a (Didit plan sections 3 and 6): the
member's consent to the independent verification partner is recorded on each
automatic ID check before the setting may leave Manual, and staff see each
case's check status in the queue (picture 11).

- **The consent.** `private.identity_checks` gains `consent_version` and
  `consented_at`. The trigger `identity_check_consent_required` (before insert)
  refuses a new check unless `consent_version` is the current version and
  `consented_at` is set (PT409, detail `identity_check_consent_required`).
  Checks made before the update keep empty values and carry on unchanged.
- **One place for the version.** `internal.identity_check_consent_version()`
  returns `identity-check-consent-v1`, the website's
  `IDENTITY_CHECK_CONSENT_VERSION` (the consent words of part 7). Change both
  together when the words change.
- **The start.** `api.start_my_identity_check` gains the optional argument
  `p_consent_version` (internal twin `internal.start_my_identity_check(text)`;
  the no-argument versions are dropped, so a call without the argument reaches
  the new one). It stores the version and the start time on the new check.
  Everything else is the live body: an unfinished check is returned whatever the
  argument (it carries its own recorded consent), and every earlier refusal (a
  person checking, verified phone, legal name, accepted case, limit, pause,
  setting) comes first. A call without the argument therefore gets the same
  answers as before, except that it can no longer create a check.
- **Staff reads.** `api.get_identity_check_for_case` adds `consent_version` and
  `consented_at` to the check. `api.get_frontend_staff_verification_queue` adds
  `identity_check` to each case: `{status}` of the case's latest check other
  than `unavailable` (the check the case read shows), or null. The reason codes
  stay only in the case read (held claim, recent second factor, logged access),
  as the staff data-minimisation rule asks; the queue shows no reasons, names or
  sessions. The website's queue reader accepts the field with or without this
  update.

Expand only: the command keeps its name, every existing call still works and the
new argument is optional; a later contract step (`require-argument`) makes it
required once the website sends it. ORDER: **website-first** (merge and deploy,
then apply): the live queue reader is strict and would refuse the new
`identity_check` field until this pull request's reader is deployed, and the
Deploy gate's anonymous probe (`probeFoundationRuntimeApi`) leaves optional
arguments out, so it passes on either side of the update. The website that sends
`p_consent_version` (part 7) must deploy only after this update is applied.

**Apply only while the setting is Manual; keep it Manual until part 7 (#360) is
deployed.** On Staff final or Automatic a start without the argument is refused
and the photo routes refuse while the route is automatic, so members could not
verify. The update refuses unless the setting is Manual, and the preflight lists
any other setting as a problem.

Read-only preflight:
`../preflight/20261124235920_identity_check_consent.check.sql`; rollback:
`../rollback/20261124235920_identity_check_consent.down.sql`. The rollback
refuses unless the setting is Manual, and once any check has recorded a member's
consent (that evidence is kept: write a forward update instead).

## Posting terms posting-v6: the package rules, 22 November 2026

`20261123225900_posting_terms_v6.sql` (launch checklist item 27) publishes
posting terms `posting-v6` (`src/lib/legal/terms-documents/posting-v6.json`,
canonical hash `8N4U5nl2ACRgTqQ2MgpeLbk3wxrDrhiqLRy-PIIBcDw`, also in
`catalogue.json`) and makes it current, in one transaction. posting-v6 is
posting-v5 plus:

- a section "Multi-listing packages" with the rules as built: 5 to 250 slots,
  R100 per slot per 30 days, terms of 30, 90 or 180 days, all slots starting on
  payment and ending together, 4 posts going live per slot per 30 days counted
  across the package, 10 photos and 1 video per post, one package per account,
  ID review first, Individual slots closed while a package runs except in its
  last 7 days, adding slots online (7 or more whole days left) or by invoice (10
  or more), the added-slots invoice due date, no renewal, posts when a package
  ends, and no transfers;
- packages of more than 100 slots paid by invoice at the same price; no interest
  or late fee on an invoice;
- the email about 60 business days before a slot or package of 180 days or more
  ends (`20261122111209_term_ending_notice.sql`, which this update requires);
- the settled legal answers that belong in the Terms: cancelling a package (one
  R50 fee per package), the first purchase refundable in full within 5 business
  days, refunds to the original method or an account in the member's own name,
  lost days added back after an overturned suspension, the content licence and
  ownership promise, the children rule, restricted goods and licence numbers,
  two more prohibited kinds, how to report a post (Report, or
  abuse@verifymzansi.com with the post's link, what is wrong and how to contact
  you; 2 business days; every report recorded), and removal of a post and
  restriction of its account on a credible complaint.

It changes only `private.posting_terms_versions` (one new row) and
`private.posting_terms_current`: no function, table, grant, plan, price or
acceptance, so the fingerprint does not change. Packages stay off sale
(`private.slot_package_sales` is not touched). It refuses (55000) unless
posting-v5 (or posting-v6) is current, posting-v6 is absent or has the hash
above, and the term-ending notice update is applied. Every member then accepts
posting-v6 once before their next submission or edit, and new payments record
posting-v6 with their cooling-off consent. Run again, it changes nothing.

**Order: website-first.** Apply it straight **after** the website release that
contains `posting-v6.json` is deployed. That release serves posting-v5 or
posting-v6, whichever is current. The earlier website knows no posting-v6 and
would refuse the current terms, so no post could be submitted or edited. The
full order (`20261122111209_term_ending_notice.sql` is already applied):

1. merge, which deploys;
2. apply this update.

Preflight: `../preflight/20261123225900_posting_terms_v6.check.sql`. It should
read "current posting-v5 (update not applied); posting-v6 not published" before,
and "current posting-v6 (update already applied); posting-v6 published" after.
Open `/terms`: "Multi-listing packages" shows, and the reporting rules appear
once, under "Prohibited content".

**Rollback.** `../rollback/20261123225900_posting_terms_v6.down.sql` makes
posting-v5 current again. The posting-v6 row and acceptances of it stay as
history (published terms are immutable). The website release can stay deployed.

**Never revert the website alone while posting-v6 is current.** The earlier
website does not know posting-v6, so nobody could post or edit. Roll back this
update first, then revert the website.

**Tests.** `scripts/test-foundation-posting-terms-v6.mjs` (in
`pnpm db:foundation:lifecycle-test`, 6 checks) proves on the throwaway database:
the preflight is read only and reports each state; the update refuses a
different posting-v6 document, a current version other than posting-v5 and a
database without the term-ending notice; it publishes and switches without
changing the schema; members accept posting-v6 once (a posting-v5 acceptance
does not carry over); a new payment records posting-v6; the rollback, a refused
second rollback and two re-applies. `src/lib/legal/posting-v6.test.ts` checks
that the package prices and rules the site uses
(`src/lib/billing/slot-packages.ts`) are the ones posting-v6 states and the
database catalogue charges. Paid add-ons are not offered, so posting-v6 does not
mention them.

## A reminder 3 days before a free credit ends, 22 November 2026

`20261122182304_free_credit_reminder.sql` is pending (see the applied register).
Launch checklist item 70b: the member is told once, 3 days before a free credit
(`20261122130744_free_credits.sql`) ends, through the reminder path the renewal
reminder and the term-ending notice already use. No new job, table or worker.

- **When.** `internal.queue_free_credit_reminders(p_limit)`, run by
  `api.run_slot_renewals` (full body, the minute job; its result gains
  `free_credit_reminders`), queues one email (outbox kind
  `free_credit_reminder`) per key of
  `internal.free_credit_reminder_key(gift, owner)` (no API role can run it):
  `free_credit_reminder:<gift id>:<end in whole seconds since 1970>`, returned
  only while the gift is active (not ended early), its end is at most 3 days
  away and the account can sign in now (`private.current_account_access`: not
  banned, suspended or closed, the check behind `term_has_access`). The key
  names the end, so each end gets one email whatever the retries, and a gift
  extended after its reminder gets a new one 3 days before its new end. A gift
  of 3 days or less is reminded at once. Nothing is charged.
- **The email.** `internal.claim_supported_notification_outbox` (full body, 23
  kinds) gives the confirmed address only while the outbox row's key is still
  the gift's current key (otherwise the job finishes it as skipped: the gift
  ended early, was extended, or the member was banned, suspended or closed
  since), with `credit_ends_at`. The website words it
  (`src/lib/services/email.ts`, `free_credit_reminder`): the end in South
  African time, that the posts it pays for are then hidden and, unless
  reactivated in another slot, deleted 3 days later with their photos and
  videos, and a button to My slots. No in-app notice.

Expand only. ORDER: apply first, then merge (a website release before the update
drops the refused kind until it is applied: `laterKinds` in
`src/lib/foundation/operation-jobs.ts`). Read-only preflight:
`../preflight/20261122182304_free_credit_reminder.check.sql`; rollback:
`../rollback/20261122182304_free_credit_reminder.down.sql` (refused once a
reminder was queued).

## Free credits for businesses VerifyMzansi recruits, 22 November 2026

`20261122130744_free_credits.sql` was applied on 22 November 2026 at 17:35 UTC
(see the applied register). Launch checklist item 70, the owner's design of 22
November 2026: an admin gives an ID-verified member free posts for a short time
and may extend the gift.

- **The gift.** An entitlement (`private.entitlements`) with the new source
  `free_credit`: every section (area null), 1 to 6 posts (slot capacity), the
  fair use and media of a paid Individual slot per post (4 posts going live per
  post per 30 days, 10 photos, 1 video), no add-ons, no payment, from now for 1
  to 30 days. New constraint `entitlements_free_credit_check`: the admin who
  gave it is named, and it has no payment, area or add-ons. It funds posts
  through the existing posting, activation and media commands, which already
  accept every source other than `retail_paid` without a payment. It never
  renews and is never charged: renewals, renewal reminders, the 4 Individual
  slots, sales figures, the VAT total and invoices read only `retail_paid`
  entitlements and payments. It is not a house slot (`staff_grant` with
  `private.house_slot_events`) and not the free first post (`intro_trial`);
  giving one touches neither.
- **Commands** (admins; internal twins security definer, `api` wrappers security
  invoker, authenticated only):
  - `api.give_free_credit(email, posts, days, reason)` (capability
    `free_credit:give`, an authenticator code from the last 15 minutes) finds
    the member by email (an active, confirmed account) and refuses: no such
    account (PT409, `free_credit_member_not_found`), no current accepted ID
    review (`free_credit_identity_required`), a member who already has a running
    gift (`free_credit_active`: extend that one instead), posts outside 1 to 6
    (22023, `free_credit_posts_invalid`), days outside 1 to 30
    (`free_credit_days_invalid`), a reason that is not 5 to 200 characters of
    plain text on one line (`free_credit_reason_required`).
  - `api.extend_free_credit(gift, days, reason)` (`free_credit:give`, the same
    fresh code) adds 1 to 30 days from the gift's current end while it runs,
    otherwise from now, as often as needed; the member must still be active and
    ID-verified; an unknown gift is refused (22023, `free_credit_not_found`),
    one whose account was erased too (PT409, `free_credit_closed`). The search
    end of its live posts follows (`internal.refresh_slot_chain_documents`).
  - Both follow the rule of staff money actions
    (`internal.assert_staff_payment_actor`): the admin needs a current accepted
    ID review of their own (42501, `staff_review_required`) and never acts for
    their own account or an account ever reviewed as the same person, past
    reviews included (42501, `staff_same_identity`).
  - `api.list_free_credits()` (`free_credit:view`, the 12-hour rule): the latest
    500 gifts, newest first: the member's masked email, posts, start, end,
    active or ended, and the all-time views of the posts each funded.
- **Record.** `private.free_credit_events` (append-only, row level security, no
  grants) keeps each gift (`given`) and extension (`extended`): the admin, the
  time, the gift (its entitlement names the member), posts, days, the end it set
  and the reason. It goes only with its entitlement (commerce retention, five
  tax years after the gift ended).
- **Member reads.** `internal.get_my_frontend_post_manager` (full body; the slot
  list on My posts) names the source `FREE_CREDIT`; the member's My slots list
  (`api.get_my_slots_v2`) and billing read already return every source.

Expand only. ORDER: apply first, then merge. Until an admin gives the first gift
no entitlement has the new source, so the website before this release reads
nothing new.

**Applying.**

1. Run `../preflight/20261122130744_free_credits.check.sql` unchanged in the SQL
   editor. It is read only. Continue only if its result is the single "summary"
   row reading "free credits: update not applied; entitlements: N".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "free credits: already applied; entitlements: N; gifts: 0
   (active: 0); events: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261122130744_free_credits.down.sql`
(only with the owner's decision; prefer a forward fix; deploy a website without
the Free credits page first). It refuses (55000) unless every piece has the
update's body, and once any gift was given; otherwise it puts back
`internal.get_my_frontend_post_manager` byte for byte and drops what the update
added.

`node --import tsx scripts/test-foundation-free-credits.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; a drifted body and a premature rollback
refused; apply, rollback and re-apply return the same fingerprints; the grants;
a gift's shape and record; each refusal (unverified member, own account, 0 or 7
posts, 0 or 31 days, a missing reason, no such account, a moderator, a stale
authenticator code); an admin without an accepted ID review of their own, and an
admin whose ended review matches the member's current one, refused for giving
and extending, while that admin can still give to another member; a second gift
refused while the first runs and allowed once it ended; extending a running and
an ended gift; posting with the gift (the free first post untouched); the sales
figures and VAT total unchanged; the list; and the append-only record.

## Fair showroom for every post, 21 November 2026

`20261122023000_fair_showroom.sql` was applied on 22 November 2026 at 15:45 UTC
(see the applied register). Launch checklist item 66 (design approved by the
owner on 21 November 2026). It adds one public read,
`api.showroom_feed(p_request)` (visitors and members, security invoker over a
security definer `internal` twin), which the home showroom and each area
showroom use, and replaces `internal.record_post_activity` so a showroom
appearance counts at most once per browser, post and showroom a day.

- **Request:** `showroom` (`home`, `business`, `market` or `tourism`; `home`
  when omitted), `province` (a province id) and `city` (a city id of that
  province, only with it). Strings only, at most 1,024 bytes; anything else is
  refused (22023). The website sends the visitor's rough area from Cloudflare's
  request data for that page only; the database never stores it.
- **Answer:** `{"items": [...]}`, at most 15 cards for home and 7 for an area,
  in showroom order. Each card has the public search card fields (no `score`),
  its `preview` (as `api.search_post_cards`) and `is_new`. Only publicly live
  posts, as public search shows them.
- **Turns:** the posts seen least go first. A post's score is
  `(fair share - its appearances) / fair share` over the last 7 days of
  `private.post_activity_days` for that showroom, where the fair share is the
  one the Performance page shows (the showroom's appearances in the last 7 days
  divided by its posts now, at least 1). One turn is one fair share. A post's
  appearances count up to 3 fair shares, so a flood of them cannot bury it more
  than 2 turns behind.
- **New:** for 72 hours after a post first went live it is `is_new` and gets one
  extra turn that fades evenly to nothing. A post approved again after it was
  live before (an earlier approval of the post itself in
  `private.moderation_log`) is not new again; an unchanged reactivation keeps
  its first `published_at`.
- **Nudges** (all together under one turn, so none carries a post past one a
  whole turn ahead): 0.15 of a turn for a ready video; likes per view (the
  post's lifetime totals in `private.post_engagement_totals`), smoothed as 1
  like in 20 views, at most 0.15 (reached at 1 like in 5 views); up to 0.3 of
  randomness. The video and likes nudges grow with the showroom's appearances in
  the last 7 days: none while it has had none (every post is then level, and
  randomness shares the places; this is the case while the website does not
  record appearances), in full once its posts average one appearance each.
- **Area:** of every 7 places, 1, 4 and 6 go to the visitor's city, 2 and 5 to
  the rest of the province, 3 and 7 to the rest of South Africa (home's 15: 7, 4
  and 4). A group that runs out passes its places to the next one (city,
  province, rest, then the city again). A post shown more than twice the fair
  share this week loses its city and province places. Without a province every
  place comes from one all-South-Africa queue.
- **Recording** (`internal.record_post_activity`, full body; it was
  `20261121100028_post_performance_stats.sql`'s): a showroom appearance
  (`showroom_home`, `_business`, `_market`, `_tourism`, `_programme`) counts at
  most once per browser, post and showroom a day, through a mark under the day's
  salt in `private.post_view_marks`, as views use (the engagement clean-up
  deletes it after 24 hours). Marks are stored only for posts that would count
  (publicly live, not the viewer's own; `showroom_business`, `_market` and
  `_tourism` only for a post of that area), never without a browser
  (`p_device`). They add to the views' daily count (once per request and last,
  like views), and stop at 200,000 of it, so showroom traffic alone never closes
  the views' 300,000 storage valve. The website sends the browser's signed
  `vmz_viewer` identifier for showroom appearances only, and only when it is at
  least a day old; it drops them otherwise. They have their own per-post daily
  limit (`engagement:activity:showroom`), and the carousel sends each card's
  appearance once per page load. Every other counter, the arguments and the
  answer are unchanged.

**Cost.** Each call reads the showroom's live posts, 7 days of activity rows
(for 2,000 live posts about 14,000 small rows), one view and like totals row per
post, and the last 72 hours' approvals through one partial index,
`private.moderation_log_post_approvals_idx` (`post_id`, a post's own approvals
only). On a seed of 2,000 live posts, a year of view days (730,000 rows) and
20,000 likes, a call takes about 23 ms in the throwaway Postgres 17 container
(about 75 ms when likes and views were read from the day rows). The website
remembers each order for 60 seconds per showroom and area on each server copy,
so the database sees at most one call a minute per showroom and area per copy.
No table is added. Recording adds one 32-byte mark per browser, post and
showroom a day to `private.post_view_marks` (deleted after 24 hours), within the
existing per-address and per-post limits.

New command and index, and one replaced function body (expand). ORDER: apply
first, then merge: the deploy check probes every command in
`../runtime-api-manifest.json`, and the website falls back to the newest posts
if the read fails.

**Applying.**

1. Run `../preflight/20261122023000_fair_showroom.check.sql` unchanged in the
   SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "fair showroom: update not applied; showroom posts: N"
   (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "fair showroom: already applied; showroom posts: N".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261122023000_fair_showroom.down.sql`
(only with the owner's decision; prefer a forward fix). It refuses (55000)
unless all four parts are the update's, then drops the new function, the read
and the index and puts back `internal.record_post_activity` byte for byte; the
showroom then shows the newest posts. No data is removed (the showroom marks
already stored go with the engagement clean-up within 24 hours).

`node --import tsx scripts/test-foundation-fair-showroom.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; a premature rollback, a half-present
update and a drifted recording body refused; apply, rollback and re-apply return
the same fingerprints; the grants (visitors and members, never the server key;
the api wrapper security invoker); the request rules and the 1,024-byte bound;
15 and 7 places; only publicly live posts with card fields only; the 3 / 2 / 2
mix and each group running out; deficit order with an unknown area; the
busy-city cap at and above twice the fair share; the New tag at 1, 71 and 73
hours and never again after an earlier approval; the likes cap and the video
nudge (each first about 80% and 87% of the time on level turns); with no
appearances yet, no video or likes nudge (photo posts first about half the time
against video posts); all nudges together under one turn (a post a turn behind
with a video and farmed likes never first); the index; a showroom appearance
recorded once per browser, post and showroom, and never without a browser;
appearances counted up to 3 fair shares (two flooded posts level); no mark for
random ids, a draft or an own post; the marks under the views' daily valve; and
that reads write nothing.

## Identity keep-for periods, 22 November 2026

`20261122022323_identity_keep_for.sql` was applied on 22 November 2026 at 15:44
UTC (see the applied register). Didit plan C1 (checklist item 61, part 3): how
long identity check data is kept, and the last database rules before automatic
ID checks may leave `manual`. **Order: apply-first** (the default). No command
is added or removed; the website shows the new `decline_reason` only once the
screens part ships, and its reader of the member's check accepts extra fields.
Nothing changes for members or staff until an admin changes the setting, except
the keep-for periods below.

- **The setting:** `api.set_identity_check_mode` accepts `manual`, `staff_final`
  and `automatic` (it refused all but `manual` with PT409
  `identity_check_retention_pending`).
- **Accepted identities:** the selfie and the encrypted ID number are kept while
  the identity is current (the account is open), during the 90 days after the
  account closes, while a report on the account or its posts is open (as account
  erasure waits for one) and while its ID number is banned (5 years from the
  ban, so a ban approved within the 90 days keeps them). They went 30 days after
  the decision before. `internal.identity_record_kept(submission)` decides it
  for the file clean-up (`internal.claim_evidence_cleanup`) and the ID number
  erasure (`internal.retention_verification`, which now follows the selfie
  instead of the ID photo). The ID photo still goes 30 days after the decision,
  and the partner's copy of an accepted check is due 30 days after the
  acceptance.
- **Closed in good standing:** the selfie and the ID number go when the 90 days
  after closure end (unless a ban or an open report keeps them). The blocking
  code (the submission's fingerprint), the legal names and the verified phone
  stay until the five-year history sweep: the phone numbers an account with an
  accepted identity had verified when it closed are no longer deleted 30 days
  after closure. Without an accepted identity, and for a number replaced before
  closure, the phone still goes 30 days after it was revoked.
- **Failed or not accepted attempts keep only the fingerprint:** an automatic
  decline's files are due 5 days after the decline ("ask a person" keeps them
  until a person decides); when staff send a submission back, the case's files
  are due 5 days later (90 before); a submission replaced by a newer one (a
  resubmission, or a new automatic result while an earlier one waited for staff)
  has its files due 5 days later (trigger `identity_submission_replaced` on
  `private.verification_current_submissions`); the partner's copy of a check
  sent back, or whose case closed without an acceptance, is due 5 days after
  (`internal.claim_identity_check_deletions` schedules it). The ID number is
  erased when the selfie goes, then the submission's names snapshot. The check
  row, with its "ask a person" reason, goes 7 days after it finished once the
  partner's copy is deleted and no person is still to decide it. A closed
  account's "ask a person" reasons go 90 days after closure.
- **The check row:** its start context (typed names at start, network hash,
  device kind) is cleared when it leaves `started` (trigger
  `identity_check_clear_start`, two constraints). The five-year sweep skips an
  account while a partner copy of one of its checks is not yet deleted. The
  retention result's `verification.overdue_partner_deletions` counts overdue
  partner deletions (holds excepted) from dates the deletion job does not move
  (each claim pushes the due date 5 minutes ahead): a day after the 30 days from
  an acceptance, otherwise 32 days after the check finished, while the deletion
  is due. So a stalled or failing deletion job shows. A check waiting for a
  person is not counted.
- **Results:** `session_moved` always goes to the staff queue, on `automatic`
  too. A result whose names at start differ from the submission's names gets
  `names_differ` (staff on `manual` and `staff_final`, a decline on
  `automatic`). The start inserts exactly one row (`strict`). The member's view
  of a declined check carries `decline_reason`: `id_unreadable`, `names_differ`,
  `under_18`, `photo_not_matched` or `not_confirmed` (a ban, a duplicate or a
  high risk score is never named).
- **Logs:** authority-request logs (`private.identity_disclosures` with their
  events) are kept while a named account exists and 5 years after it closed, a
  search that named nobody 5 years from the search, and every log at least 5
  years from the search; an open legal hold on a named account keeps them. An
  account whose Auth user and erasure record are both gone counts as gone, so a
  request made after an erasure is deleted 5 years after the request. The
  setting's change log is kept 5 years. Both are deleted by
  `internal.retention_verification` under `api.run_retention`.
- **Staff operations health:** `internal.get_staff_operations_health` counts an
  evidence file as overdue only when the clean-up claim would take it, so a
  selfie kept with its identity record is not reported as past its purge date.
- **The clean-up and the case version:** on an open identity case, deleting a
  file that no current submission uses no longer changes the case version
  (`internal.evidence_artifact_submission_guard`), so deleting a sent-back
  attempt's files cannot make the newer submission stale. A second review
  already proposed can still be refused as changed when an earlier attempt's
  file goes during it; nothing is accepted wrongly, and staff propose again.
- **Not in this update:** the privacy export does not yet list the member's
  checks; it waits for the pending updates that also replace
  `internal.frontend_privacy_export_data`.

Holds keep everything, as before (an open legal hold on the account, a fraud
hold on the case).

**If the partner is dropped:** the five-year sweep waits for every partner copy
of an account's checks to be recorded as deleted, so those accounts' records
stay until then (the overdue count grows). Before ending the contract, let the
deletion job empty its queue (`api.claim_identity_check_deletions`); for copies
the partner confirms it deleted in bulk (for example under its data processing
agreement at termination), the website's server records each with
`api.mark_identity_check_provider_deleted`. Never mark a copy deleted without
that confirmation.

**Before the setting leaves `manual`:** recorded ID consent (the screens part),
the privacy notice (checklist item 41) and the privacy export follow-up.

**Applying.**

1. Run `../preflight/20261122022323_identity_keep_for.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "identity keep-for: update not applied; mode: manual;
   checks: N; finished: M; accepted identities: K" (any counts).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "identity keep-for: already applied; ...".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261122022323_identity_keep_for.down.sql`
(only with the owner's decision; prefer a forward fix). It refuses (55000)
unless every function has the update's body, the setting is `manual` and no
check has finished since the update; then it puts back the 12 bodies byte for
byte, drops the two helpers and the two triggers and restores the check row's
constraints. Data the retention job already deleted stays deleted.

`node --import tsx scripts/test-foundation-identity-keep-for.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; drifted bodies and a premature rollback
refused; apply, rollback and re-apply return the same fingerprints; the three
settings; `session_moved` and names at start on each setting; the cleared start
context; each decline category; the ID photo at day 29 and 31, the selfie and ID
number kept for an open account (also after 5 years); the partner's copy at day
29 and 31 after an acceptance, and a deletion that keeps failing counted from
day 31 and a half (a declined check's from 32 and a half days after it finished,
a check waiting for a person never); good-standing closure (selfie and number
kept at day 89 and gone at day 91, code, names and phone kept, a ban approved at
day 60 and an open report keeping them, the 90-day cap for unreviewed files, a
replaced number and a number without an accepted identity still deleted); a
replaced submission's files at 5 days; the five-year sweep waiting for the
partner's copy (4 years 364 days, then 5 years 1 day); a ban keeping the selfie
and number 5 years from the ban; an automatic decline's files at 4 days 23 hours
and 5 days 1 hour, then only the fingerprint, and the check row at 6 and 8 days;
"ask a person" answered by a return (5 days) and by an acceptance (30 days, the
reason cleared 91 days after closure, not 89); a sent-back attempt's files
deleted without making the newer submission stale; the authority-request logs
and the change log at their 5-year edges, and a request made 70 days after a
closure whose account was erased and removed from Auth at day 31, deleted 5
years and 40 days after the request (kept at 4 years 364 days, as is one about
an existing account); staff operations health showing no overdue file for three
accepted members at day 40 and counting a declined attempt's two files at day 7;
a legal hold keeping a failed attempt.

## Authority requests under rule D9, 22 November 2026

`20261122013616_authority_request_types.sql` was applied on 22 November 2026 at
13:00 UTC (see the applied register). Launch checklist item 69, owner decision
D9 of 21 November ("Keep both"): staff may disclose a member's kept identity
record to an authority only on a subpoena (Criminal Procedure Act s205, issued
by a magistrate or judge), a court order or a search warrant, each checked with
the issuing court or the named prosecutor on an official number; or on an urgent
written request from SAPS where a life is at risk, checked by calling the
station. An urgent request gives only the minimum, never the selfie.

- **The request types:** `subpoena`, `court_order`, `search_warrant` and
  `urgent_life_risk`. The earlier `warrant`, `police_case` and `regulator` rows
  stay as they are and read as before; no row is rewritten.
- **The confirmation:** `private.identity_disclosures` gains `issued_by` (the
  court or prosecutor's office, or the SAPS station; 3 to 120 characters),
  `confirmed_number` (the official number that was called; 5 to 20 digits with
  single spaces between them, an optional leading +) and `confirmed_by` (who
  confirmed it on that call; 3 to 120 characters). The reference (3 to 100) is
  the subpoena, warrant or case number. The reference, issuer and confirmer each
  need at least one letter or digit. A table check makes every `search_warrant`
  and `urgent_life_risk` row carry all three; the command, the table's only
  writer, checks the rest.
- **Opening:** the new
  `api.open_authority_request(type, reference, issued_by, confirmed_number, confirmed_by, reason, lookup kind, lookup value, attested)`
  refuses each missing part with 22023 and its own detail
  (`disclosure_issued_by_required`, `disclosure_confirmed_number_required`,
  `disclosure_confirmed_by_required`, and the existing ones); the staff rule,
  the search and log-before-show are unchanged. `api.open_identity_disclosure`
  keeps its signature but now runs the same rule with no confirmation, so it is
  always refused; a later contract step removes it.
- **Urgent requests, in the database:** the record leaves out the selfie and the
  ID photo and lists only the current verified phone numbers, never removed ones
  (names, ID number state, current phones and dates only); reading the selfie is
  refused with `disclosure_selfie_withheld` before anything is logged; the
  server material never carries the selfie's stored object (the encrypted ID
  number still). An urgent search by phone finds only the number's current
  holder (never someone whose proof of it was removed), and an urgent search by
  ID number never falls back to numbers that were only tried.
- **Reading:** `api.read_identity_disclosure` adds `issued_by`,
  `confirmed_number` and `confirmed_by` only when the row has them, so the live
  website still reads every earlier row.

One new command; no command or argument removed (expand). ORDER: apply first,
then merge. Between the two, the live website cannot open a new record (its form
has no confirmation fields and the earlier command is refused); records opened
before read as they did.

**Applying.**

1. Run `../preflight/20261122013616_authority_request_types.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "authority request types: update not applied;
   disclosures: N" (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "authority request types: already applied; disclosures:
   N; under rule D9: 0; urgent: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261122013616_authority_request_types.down.sql` (only with the
owner's decision; prefer a forward fix). It first locks the disclosure log
against new openings, refuses unless the update is applied, and refuses while
any record opened under rule D9 is kept. Otherwise it puts back the four
functions byte for byte, drops the new command and removes the three columns and
the check.

`node --import tsx scripts/test-foundation-identity-record-disclosure.mjs` (part
of `pnpm db:foundation:lifecycle-test`) now also runs
`scripts/lib/foundation-authority-request-types.mjs` on the throwaway database:
the preflight before and after, read only; drifted bodies and a premature
rollback refused; apply, rollback and re-apply return the same fingerprints; the
new command's grants; records opened under the first rule (subpoena, warrant,
police case) read as they did and stay listed; the earlier command always
refused, logging nothing; the three earlier and any other types refused; for
each of the four types, each missing or malformed reference, issuer, number,
confirmer, reason and confirmation refused with its own detail and nothing
logged; each type opening with its trimmed reference and confirmation on the row
and the record; text of only spaces or invisible marks refused; the table check
refusing a new-type row without its confirmation; an urgent request showing
names, ID number state and only the current phone without the selfie or ID photo
(view and print), its selfie read refused before logging and its server material
without the selfie; a court order still showing the selfie and the earlier phone
numbers; an urgent phone search finding no removed holder, only a number's
current holder, while a court order still finds both; an urgent ID number search
never giving attempts; and the rollback refused while a D9 record is kept.

## Copy a post, 21 November 2026

`20261121150309_copy_a_post.sql` was applied on 22 November 2026 at 11:40 UTC
(see the applied register). Launch checklist item 17b, business tools plan
section 3 (owner-approved 20 November 2026 with all 10 recommendations): a
member whose Multi-listing package runs makes a new Market listing from one of
their own.

- **The copy:** `api.copy_my_post(post, request)` (members) copies one of the
  caller's own Market listings that was submitted at least once (not a draft,
  not held by staff: PT423) into a new draft, only while the caller's package
  runs (`internal.slot_package_now`; PT402, detail `package_required`). The
  draft is made by `internal.create_core_draft`, so its category rules and draft
  allowance (5 plus the package's places, PT429) apply. It gets the category,
  title, description, area, price, details, which contact buttons to show (never
  a number), the presentation fields, the photos and the listing logo; never the
  video or its cover. A repeated request returns the same copy.
- **Photos:** the copy links the same stored files. A file is deleted only when
  no post uses it (`internal.claim_media_cleanup` checks every link), so
  deleting either post never removes the other's photos; post edits already
  share files the same way.
- **New photo:** trigger `copy_new_photo_required` refuses moving a copy of a
  vehicle or property into review (22023, detail `copy_new_photo_required`)
  unless one of its photos has bytes (sha256) not among the source's photos when
  it was copied (owner decision, question 5). The copy keeps that list
  (`source_photo_sha256`), so deleting or re-photographing the source changes
  nothing. Copying a draft or a business is refused with detail
  `copy_source_invalid`.
- **Reviewers:** `api.get_frontend_staff_copy_facts(posts)` (staff with
  `queue:view`) returns, only for copies under review the caller has claimed (at
  most 25 per call), the post each was copied from (status `deleted` and no
  title once it is gone).
- **Unfinished copies:** `private.post_copies` records the source (a plain id,
  kept after the source is deleted), its photo bytes and the request.
  `api.list_my_copy_drafts()` (members) lists the caller's unfinished copies and
  when each will be deleted, for the Drafts tab on My posts.
  `internal.purge_copy_drafts`, run by `internal.run_retention` (which now also
  returns `copy_drafts`), deletes a copy still in draft 14 days after its last
  change, never during a legal hold. Drafts that are not copies are untouched.
- **Privacy export:** the `posts` rows gain `copied_from` (no new dataset).

Expand only: three new commands, a table and a trigger; `run_retention` returns
one more count and the export's posts rows one more field, both read without a
strict field list. ORDER: apply first, then merge; the website offers Copy only
while `SHOW_POST_COPY` is on (off until launch switch-on).

**Applying.**

1. Run `../preflight/20261121150309_copy_a_post.check.sql` unchanged in the SQL
   editor. It is read only. Continue only if its result is the single "summary"
   row reading "copy a post: update not applied; draft posts: N" (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "copy a post: already applied; draft posts: N; copies: 0;
   unfinished copies: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261121150309_copy_a_post.down.sql` (only
with the owner's decision; prefer a forward fix; switch `SHOW_POST_COPY` off
first). It refuses (55000) unless every piece of the update has the update's
body; then it puts back `internal.run_retention` and
`internal.frontend_privacy_export_data` byte for byte and drops the trigger, the
eight functions and `private.post_copies`. Copies already made stay as ordinary
posts and drafts; only the record of their source goes.

`node --import tsx scripts/test-foundation-copy-a-post.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; drifted bodies and a premature rollback
refused; apply, rollback and re-apply return the same fingerprints; the grants
(members only, wrappers security invoker, helpers for nobody, no table access);
a copy's fields, buttons, photos (same files, focal point kept) and logo,
without the video, its cover, contact numbers or video layout; replay of a
request; refusals for another member, a visitor, a draft, a business, a held
post, no package and the draft allowance; the new-photo rule for vehicles and
property against the photos at copy time (the same bytes again do not count; a
deleted or re-photographed source still needs one; the source later taking the
copy's photo does not block it; other categories and posts that are not copies
are not checked); photos kept when either post is deleted; the reviewer read
only for claimed posts, refused to members, visitors, above 25 posts and with a
stale authenticator code, and a deleted source shown as deleted; the member's
list of unfinished copies; the 14-day deletion (and its bounds, the legal hold,
other drafts and submitted copies kept); and `copied_from` in the privacy
export.

## A written notice before a long paid term ends, 22 November 2026

`20261122111209_term_ending_notice.sql` was applied on 22 November 2026 at 17:33
UTC (see the applied register). Launch checklist item 68b. The Consumer
Protection Act, s14(2)(c), asks for a written notice 40 to 80 business days
before a fixed-term agreement ends. The owner's rule: a paid term of 180 days or
more gets one written notice about 60 business days before it ends; nothing ever
renews automatically.

- **Which terms.** A paid grant (`private.entitlements`, source `retail_paid`)
  that runs 180 days or more from its own start to its own end: an Individual
  slot of 180 days, each renewal of one (its own term), a Multi-listing package
  of 180 days (its opening grant; slots added part-way run less than 180 days),
  and any earlier 180-day plan still running. Free trials, sponsorships, staff
  grants and house slots are not purchases and are left out. The grant must be
  active, its payment complete and its line not refunded or charged back, and
  the account must not be closed (`internal.term_ending_notice_due`; no API role
  can run it). A banned or suspended member still gets the notice.
- **When.** `internal.queue_term_ending_notices(p_limit)`, run by
  `api.run_slot_renewals` (full body, the minute job; its result gains
  `term_ending_notices`), queues one email (outbox kind `term_ending_notice`,
  dedupe key `term_ending_notice:<grant id>`) once the term's end is 63 to 84
  calendar days away. 84 days is 12 weeks, 60 weekdays, so about 60 business
  days; 63 days still leaves at least 40 business days after public holidays.
  The window also stops a second notice after retention removes the sent email
  30 days after sending. A term already under 63 days from its end when the
  update is applied gets no notice. Nothing is charged.
- **The email.** `internal.claim_supported_notification_outbox` (full body, 22
  kinds) gives the address only while the term still qualifies and the address
  is confirmed (otherwise the job finishes it as skipped), with `term_ends_at`,
  `term_kind` (`individual`, `package` or `other`), `term_has_access` (whether
  `private.current_account_access` has the member) and, for an Individual slot,
  `term_package_continues` (whether the package `internal.slot_package_now`
  returns, the one the slot's post moves into when the slot ends, ends after
  it). The website words it (`src/lib/services/email.ts`, wording awaiting the
  owner in `FRONTEND-CHANGES.md` group 91): the end date, that nothing renews
  and nothing more is charged, and how to buy again (My slots for an Individual
  slot, Billing otherwise); a slot whose post moves into the package is told
  only that; a member who cannot sign in is told only that nothing more is
  needed. No in-app notice.
- **Order.** Apply first, then merge. A website before the update drops the kind
  (`laterKinds`); an earlier website never claims it, so queued notices wait.
  Preflight: `../preflight/20261122111209_term_ending_notice.check.sql`;
  rollback: `../rollback/20261122111209_term_ending_notice.down.sql` (refused
  once any notice is queued). Behaviour test:
  `scripts/test-foundation-term-ending-notice.mjs`.

## Single-administrator mode for house slots and own posts, 21 November 2026

`20261121143000_one_person_admin_mode.sql` was applied on 22 November 2026 at
06:40 UTC (see the applied register). Launch checklist item 67 (owner's
decisions of 21 November 2026, "Option A", cap 25, and 22 November 2026, "Yes,
all my posts"). The owner has two admin accounts but one ID, so the two-person
rules for house slots could not be met: a house-slot grant needs a second
ID-verified administrator, and staff never review their own posts.

- **The mode.** `internal.single_administrator(account)` (no API role can run
  it) is true while the account holds an active admin role and an accepted ID
  review, and no other account with an active staff role has one. It is worked
  out at every call; nothing is stored. As soon as a second staff member's ID
  review is accepted (any staff role), the normal two-person rules apply again,
  also to an item already claimed. A suspended staff member does not count
  (their ID review is not current while the account is not active).
- **Self-grant (database owner only).** `internal.grant_house_slots` keeps its
  signature and every rule; in this mode `p_approved_by_email` may name the
  recipient's own account (otherwise 42501 `house_slots_self_approval`, as
  before). The owner's second admin account, which has no ID review, can neither
  receive nor approve (`house_slots_identity_required`,
  `house_slots_approver_identity_required`). Each event it records is marked
  `self_granted` (new column of the append-only `private.house_slot_events`,
  check: only on `granted` and `extended`), and the result has
  `self_granted: true`.
- **Cap 25 in total.** The cap is on the account's total house slots: a grant
  makes the recipient hold 1 to 25 house slots in all (was 15); outside that,
  22023 `house_slots_count_invalid`. LIM-SQL-house-slots-count in
  `docs/testing/limits-register.json` follows.
- **Staff review posts only with an ID review.** `internal.queue_conflict`
  counts every post as a conflict for a staff member without an accepted ID
  review of their own (`internal.current_verified_identity`), so such an account
  (the owner's second admin account, for one) can neither list, claim, open,
  renew nor decide (approve or reject) posts. The per-item commands
  (`claim_queue_item`, `staff_review_post`, `renew_queue_claim` for posts and
  `moderate_post` for every decision) refuse through the new
  `internal.assert_post_reviewer`: 42501 "ID verification required to review
  posts" (detail `staff_identity_required`), otherwise "self-review is not
  allowed" on a conflict. A moderator whose ID review ends while holding a claim
  can no longer renew or decide it. Reports are unchanged.
- **Self-approval of all own posts** (owner's decision of 22 November 2026,
  "Yes, all my posts"). While the mode holds, `internal.queue_conflict` no
  longer counts any of the administrator's own pending posts or edits as a
  conflict, whatever funds them (house slot, free first post, paid or package
  slot, an event), so the moderation queue lists them and `claim_queue_items`
  (which now asks `queue_conflict` instead of comparing the owner),
  `claim_queue_item`, `staff_review_post` and
  `assert_posting_verification_ready` and `assert_event_duplicate_absent`
  (likewise) accept them. The owner reviews members' posts and their own from
  the verified account; the second account sees an empty queue.
  `internal.moderate_post` lets them approve their own post, never reject it
  ("self-review is not allowed"). The admin role's `post:moderate` already needs
  an authenticator code from the last 15 minutes (`internal.staff_actor`); the
  update refuses to run unless it still does. The decision is recorded with
  `self_approved` (new column of the append-only `private.moderation_log`,
  check: approvals only) and the staff Audit log shows it as
  `post:self_approved` (`post_self_approved` on the page). House-slot grants
  keep their own rules (above). Identity reviews, refunds, business checks,
  reports and every other two-person rule are unchanged.

No API command, argument, grant or result field changes (internal functions, two
columns with a default, one branch of
`private.frontend_staff_nonpayment_audit_events`). ORDER: apply first, then
merge. No screen changes: the queue and the Audit log already show what the
database returns.

**Applying.**

1. Run `../preflight/20261121143000_one_person_admin_mode.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "one-person admin mode: update not applied; ID-verified
   staff: N; house slots: N; post claims by staff without an ID review: N" (any
   counts). ID-verified staff 1 means the mode will apply; post claims by staff
   without an ID review can no longer be decided or renewed after the update and
   expire within 15 minutes.
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "one-person admin mode: already applied; ID-verified
   staff: N; house slots: N; post claims by staff without an ID review: N;
   self-granted slot events: 0; self-approved decisions: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

**Granting afterwards (the owner, in the SQL editor).** With the ID-verified
admin account's own address in both places:
`select internal.grant_house_slots('<verified admin email>', <1 to 25>, <7 to 180 days>, '<written reason, 5 to 500 characters>', '<verified admin email>');`

The reviewed rollback is
`../rollback/20261121143000_one_person_admin_mode.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses unless the update is applied
and the nine functions still have its bodies (both records are locked first,
access exclusive), and while any event is `self_granted` or any decision
`self_approved` (those records are kept). Otherwise it puts back the nine
function bodies and the audit view, drops `internal.single_administrator`,
`internal.assert_post_reviewer` and the two columns.

`node --import tsx scripts/test-foundation-one-person-admin-mode.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; drifted bodies and a premature rollback
refused; apply, rollback and re-apply return the same fingerprints; no API role
can run the grant, the mode check or the conflict check; with two ID-verified
staff the mode is off and the cap is 25 (26 and a count below the slots held
refused); with one, the self-grant needs a reason, the verified account itself
(not the second account) and at most 25, and its events are marked and
append-only; the own house-slot post is listed, claimed, opened, refused with a
16-minute-old code and as a rejection, approved with a 14-minute-old code,
logged `self_approved` and shown as `post_self_approved`; the own
free-first-post, paid-slot and event posts and an edit are each refused as a
rejection and self-approved, marked; another member's post is approved as
before, unmarked; a second ID-verified staff member ends the mode for grants and
for every kind of own post (house slot, event, edits of the free-first-post and
paid-slot posts: listing, claims and items already claimed), and removing or
suspending them brings it back; the second admin account without an ID review
can neither claim the owner's post nor, with a lease written directly, open,
approve, reject or renew it (`staff_identity_required`), and the preflight
counts that claim; the owner's own ID review ending turns the mode off; the
rollback refuses a changed function and once a marked record exists; and after
every later update a 16-minute-old code is still refused.

## Business storefront, 21 November 2026

`20261121131915_business_storefront.sql` was applied on 21 November 2026 at
17:34 UTC (see the applied register). Launch checklist item 17b, business tools
plan section 1 (owner-approved 20 November 2026): a Multi-listing package's live
Market listings show on its owner's existing business page as "All stock", and
each of those listings names the business and links to it. Nothing is stored;
there is no set-up step.

- **Which business:** `internal.storefront_package(business)` gives the package
  whose listings a business page shows. A business has one only when it is
  publicly live, holds a current CIPC sticker (the business check, owner
  decision 12 of 14 November), its owner's package runs now
  (`internal.slot_package_now`) and it is the owner's first such business
  (earliest published, then id). An owner with several checked businesses has
  one storefront, and every listing links to that one.
- **Which listings:** the Market listings that hold a slot of that package (an
  unreleased activation on one of its grants), as public search already shows
  them. `internal.storefront_of_post(post)` goes the other way: for a live
  listing in a storefront, the storefront's business; for a business, the
  business itself.
- **Search:** `internal.search_posts` (so `api.search_posts` and
  `api.search_post_cards`) accepts `storefront` (a business id; a business
  without a storefront matches nothing) and `make` (1 to 80 characters, only
  with `storefront`; the vehicle make in any case). Every other filter, order,
  page and count is unchanged and works inside a storefront.
- **The read:** `api.get_public_storefront(post id)` (visitors and members,
  security invoker over a security definer `internal` twin) returns, for a
  business with a storefront or a listing in one, the business id and name, the
  number of listings, their categories with counts, and the vehicle makes and
  property areas (province and city) among them; null for any other post. Only
  public card facts: no owner, package, slot, account or contact.

New command and two optional search filters only (expand). A website without the
matching code never sends the new filters. ORDER: apply first, then merge; the
website reads the storefront only while `SHOW_BUSINESS_STOREFRONT` is on (off
until launch switch-on).

**Applying.**

1. Run `../preflight/20261121131915_business_storefront.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "business storefront: update not applied; running
   packages: N; checked businesses: M" (any counts).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "business storefront: already applied; running packages:
   N; checked businesses: M; storefronts: K".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261121131915_business_storefront.down.sql` (only with the owner's
decision; prefer a forward fix; switch `SHOW_BUSINESS_STOREFRONT` off first). It
refuses (55000) unless every function of the update has the update's body; then
it puts back `internal.search_posts` byte for byte and drops the read and the
two helpers. No data is removed (the update stores none).

`node --import tsx scripts/test-foundation-business-storefront.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; a drifted search body and a premature
rollback refused; apply, rollback and re-apply return the same fingerprints; the
grants (the read for visitors and members, never the server key; the helpers for
nobody; the api wrapper security invoker); a package bought through checkout
with a checked business shows only its live listings (not a draft or a deleted
one), with the read's fields the same from the business, from each listing and
for a member; every search filter inside the storefront (make in any case,
category with gearbox and year, text, area, pages and totals); the malformed
filters refused and the make's 80-character bound; only the owner's first
checked business; none without a sticker, with an expired one, without a
package, or after the package ended.

## Post performance statistics for the owner's Performance page, 21 November 2026

`20261121100028_post_performance_stats.sql` was applied on 21 November 2026 at
17:33 UTC (see the applied register). Launch checklist item 2, the part after
the views and likes update. **Order: apply-first** (the default): the website
release from the same pull request names the three new commands, and the deploy
preflight probes every command in `../runtime-api-manifest.json`. The website
records only while `SHOW_ENGAGEMENT_TOTALS` is on and shows the page only while
`SHOW_OWNER_METRICS` is on; both stay off in production until launch, so
applying the update changes nothing anyone sees. It adds one table, one column,
three API commands and two internal functions, and replaces three functions with
full bodies: the retention job, the engagement clean-up and the scheduled job
catalogue. It refuses (55000) unless its parts are all absent or all present and
the three functions have their reviewed bodies (or this update's).

- **What the page shows, and where each figure comes from.** The restored
  Performance page (`/dashboard/metrics`, from the 27 October frontend) shows
  posts and live posts, views with engaged views, leads and the lead rate; for
  the last 30 days appearances in lists, search, the home page, the showrooms
  and organisation pages, detail views, WhatsApp, phone, website, directions,
  booking and ticket taps, shares, saves and unique viewers; the 10 busiest
  posts; where detail views came from; and each live post's showroom turns over
  the last 7 days next to the fair share. The pages already send the events to
  `/api/analytics/events` (`src/lib/analytics/commercial-events.ts`): a card
  counts as seen when half of it is on screen for one second (the IAB/MRC
  viewable impression rule), a detail view on opening the post's page, a tap on
  the click. Engaged views come from the video tracker (30 seconds, or 90% of a
  shorter video) through `/api/engagement/view`.
  - Views, unique viewers and saves reuse what the views and likes update
    stores: views are the post's counted views (all time), unique viewers the
    counted views of the last 30 days (one per browser per post per day, so a
    visitor who comes back another day counts again, as in privacy-first
    analytics with a daily salt), saves the likes made in the last 30 days that
    still count. Leads are the enquiries received (kept 12 months).
  - Everything else is a daily counter per post in the new table.
- **What is stored.** `private.post_activity_days`: one row per post per day
  (Africa/Johannesburg) with 21 counters (`list_impressions`,
  `search_appearances`, `homepage_appearances`, `showroom_home`,
  `showroom_business`, `showroom_market`, `showroom_tourism`,
  `showroom_programme`, `directory_appearances`, `views_direct`,
  `views_internal`, `views_search`, `views_social`, `views_referral`,
  `whatsapp_taps`, `phone_taps`, `website_taps`, `directions_taps`,
  `booking_taps`, `ticket_taps`, `shares`); deleted with the post, and after 31
  days by the clean-up job. `private.post_engagement_totals.engaged_views`: the
  post's engaged views (all time). An engaged view also keeps one mark
  (`sha256(day salt || 'engaged:' || browser || post)`) in
  `private.post_view_marks` for 24 hours. Never an account, browser identifier,
  network address or user agent.
- **`api.record_post_activity(p_post_ids, p_metrics, p_device, p_account)`**
  (service only): 1 to 50 (post, counter) pairs of the same length (22023
  `activity_invalid` otherwise); a counter is one of the 21 columns or
  `engaged_views`, which needs `p_device`. Each distinct (post, counter) pair
  counts at most once per call. Pairs of posts that do not count are skipped:
  posts that are not publicly live, the signed-in owner's own events and every
  event by an account with an active staff role (an inactive account counts as
  signed out). An engaged view counts at most once per browser per post in 24
  hours, and only when that browser's view of the post was counted in the last
  24 hours, so engaged views never exceed views. One statement per request
  updates each post's row for the day. Returns `{"posts", "engaged"}`.
- **`api.get_my_post_performance()`** (authenticated, live session, the caller's
  own posts only; edit copies are not posts): `posts`, `live_posts`, `views`,
  `engaged_views`, `leads`, `last_30_days` (keyed as the page's event names,
  plus `unique_viewers`), `top_posts` (at most 10: post, title, area,
  appearances, views, unique viewers, contacts, saves, shares), `sources`
  (`direct`, `internal`, `search`, `social`, `referral`, only those above zero)
  and `showroom_turns` (each live post on the home showroom and its area's
  showroom: appearances in the last 7 days, the fair share, which is that
  showroom's appearances in the last 7 days divided by the posts now eligible
  for it, and that number of posts). The fair share is an average over every
  eligible post; no other owner's post is named or counted separately.
- **The clean-up is its own job.** `api.purge_post_engagement()` (service only)
  runs the engagement clean-up (view and engaged marks older than 24 hours,
  salts older than yesterday, waiting likes that are due, and now activity days
  older than 31 days) and records the run as scheduled job `engagement_purge`
  (every minute, late after 10 minutes), which the staff operations page lists.
  The website's minute job calls it (`src/lib/foundation/operation-jobs.ts`);
  `internal.run_retention` no longer does. Between applying and deploying, old
  marks wait for the new website's minute job; they stop counting after 24 hours
  anyway.
- **Website limits (not in the database).** `/api/analytics/events` needs no
  sign-in or cookie (list pages never run the Turnstile check, so requiring the
  signed browser identifier would drop most first visits). It refuses cross-site
  requests, ignores crawlers, headless browsers and prefetches, reads at most
  16,384 bytes and 50 events, and counts within `engagement:activity` per IPv4
  address or IPv6 /48 (30 a minute, 600 an hour, 3,000 a day). Each (post,
  counter) pair counts once per request. A post's page events (detail views,
  contact taps, shares) count for at most 200 requests a day per address or /48
  (`engagement:activity:post`; more is dropped silently), far above what one
  person reaches and with room for a shared carrier address; card appearances
  are not checked against it, so a page left open cannot use it up. Saves (the
  like button), sponsor clicks and organisation events are not counted there.
  Flooding one's own or another owner's figures only changes counts the owner
  alone sees, within those limits, and the table's size does not grow with the
  number of events.

**Write cost against the Supabase free plan (500 MB database).** Assumptions per
visitor a day: about 30 card appearances, 3 detail pages, 0.3 contact taps, 0.05
shares and 0.3 engaged views, sent in about 10 beacons (the pages batch up to 50
events and send every 2 seconds while someone browses); posts on the site grow
with visitors (assumed 500, 3,000 and 20,000 posts, every one active every day,
which over-counts). A row is about 300 bytes with its two indexes and update
bloat.

| Daily visitors | Activity requests a day | Row updates a day | New rows a day | Activity table (31 days) | Engaged marks (24 h) |
| -------------- | ----------------------- | ----------------- | -------------- | ------------------------ | -------------------- |
| 1,000          | 10,000                  | about 25,000      | 500            | about 5 MB               | 300 rows, 40 KB      |
| 10,000         | 100,000                 | about 250,000     | 3,000          | about 28 MB              | 3,000 rows, 0.4 MB   |
| 100,000        | 1,000,000               | about 2,500,000   | 20,000         | about 186 MB             | 30,000 rows, 4 MB    |

The table's size depends on posts and days, not on visitors: visitors add
updates of existing rows (no indexed column changes, so most are HOT updates),
not rows. 1,000 and 10,000 daily visitors fit the free plan easily. At 100,000
daily visitors and 20,000 posts the table alone would use over a third of the
free plan's 500 MB, at about 29 updates a second on average; by then the project
needs the Pro plan for its overall size anyway. On Cloudflare every beacon is
one Worker request plus one rate limiter call for the address, and one more for
each post with page events (1 or 2 on a post page, none on a list page; about
1.35 limiter calls a beacon on average): about 0.4 million limiter calls a month
at 1,000 daily visitors, 4 million at 10,000 and 40 million at 100,000, against
the 10 million requests a month Workers Paid includes (shared with the rest of
the site).

Preflight `../preflight/20261121100028_post_performance_stats.check.sql`
(summary "post performance stats: update not applied; publicly listed posts: N"
before, "post performance stats: already applied; activity days: N; engaged
views: N" after; a problem row for each replaced function without its reviewed
body); rollback `../rollback/20261121100028_post_performance_stats.down.sql`
(only with the owner's decision; switch the recording off instead where
possible; it refuses once any activity or engaged view is recorded, and puts
back the three earlier function bodies byte for byte, so the retention job runs
the clean-up again). Behaviour test
`scripts/test-foundation-post-performance-stats.mjs` (part of
`pnpm db:foundation:lifecycle-test`).

**Applying.**

1. Run `../preflight/20261121100028_post_performance_stats.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "post performance stats: update not applied; publicly
   listed posts: N" (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "post performance stats: already applied; activity days:
   0; engaged views: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

## Automatic ID checks by an independent verification partner, 21 November 2026

`20261121094003_automatic_identity_checks.sql` was applied on 21 November 2026
at 17:32 UTC (see the applied register). Didit plan, build step 5 (the database
part of automatic ID checks). It changes nothing for members or staff while the
new setting is `manual`, its starting value.

**The setting stays `manual` until the retention update (Didit plan C1) is
applied, and the database enforces it:** `api.set_identity_check_mode` refuses
any other value (PT409 `identity_check_retention_pending`) until C1 replaces the
function. This update deletes the partner's copy of a check only when it never
finished and 5 days after an automatic decline nobody asked about. C1 must set
`identity_checks.provider_delete_due` for checks staff reject or send back
(`staff_final`, or after "ask a person") and for checks whose "ask a person"
ends without the identity being accepted, and decide how long a check row (with
its start names, network hash and device kind, which are kept only as long as
the row) stays after a failed attempt.

- **The setting:** one row in `private.identity_check_settings`: `manual` (staff
  review the photos, as today), `staff_final` (a clean automatic pass verifies
  at once, anything else goes to the staff queue) or `automatic` (a clean pass
  verifies at once, anything else is declined and the member may ask a person to
  look again). `api.set_identity_check_mode(mode, reason)` needs the new
  capability `identity_check:configure` (admins, authenticator code from the
  last 15 minutes) and a reason of 5 to 500 characters; each change is logged in
  the append-only `private.identity_check_mode_events`. The reason may not hold
  control or direction characters. `api.get_identity_check_settings` (staff with
  `queue:view`) shows the setting, any pause, the last 7 days' counts and the
  latest 5 changes. The setting is read when a result arrives.
- **Pause:** `api.report_identity_check_unavailable(check, reason)` (server)
  marks a check that could not start as `unavailable` and pauses automatic
  checks for everyone: 15 minutes after an `outage`, 1 hour after `no_credit` or
  `not_configured`. `newly_paused` is true only for the call that started the
  pause, so the website sends one alert. Setting the mode, even to the current
  value, ends a pause early (for example after a top-up).
- **Spending guard:** 3 checks per member in 7 days and 60 checks a day
  site-wide (unavailable checks are not counted). Above either, or while the
  setting is `manual` or paused, `api.get_identity_check_availability` answers
  route `manual` with reason `limit`, `paused` or `mode`, and
  `api.start_my_identity_check` refuses a new check (PT409
  `identity_check_<reason>`). An unfinished check is resumed whatever the
  setting now says; if the setting is `manual` when its result arrives, the
  result goes to staff.
- **A check:** `private.identity_checks`, bound to the member's open identity
  case; the partner only sees its random id. The start context stays on the row,
  never with the partner: the typed legal names at start (recorded by
  `api.start_my_identity_check`), and a keyed hash of the member's network (64
  lowercase hex) and the device kind (`phone` or `computer`), given by the
  server to `api.attach_identity_check_session`.
  `api.begin_identity_check_evidence` returns them to the server. The member
  starts it (`api.start_my_identity_check`, a verified phone and typed legal
  names required); the server binds the partner session once
  (`api.attach_identity_check_session`), reserves the two evidence files before
  copying the photos (`api.begin_identity_check_evidence`) and records the
  result once (`api.complete_identity_check`). A result after the check's
  24-hour expiry is recorded as not finished.
- **The result** becomes an ordinary identity submission through
  `internal.complete_evidence_upload` and
  `internal.register_identity_submission` (the same files, fingerprint,
  encrypted ID number and names snapshot as the manual route). The server gives
  the first and last names it compared with the ID (`p_names`); when they are
  not exactly the names the new submission records (the member can change their
  typed names during the check), the database adds `names_differ`, so a clean
  pass always locks the names that were compared. It also adds `banned`,
  `duplicate` (the ID number is verified on another account) and `high_risk`
  (risk score above 50). The server may add `session_moved` when the result came
  from another network or device; like the other findings it sends the result to
  staff (`staff_final`) or declines it (`automatic`). A clean pass on a partner
  setting writes the accepted identity fact with `automatic_check_id` instead of
  a staff reviewer (`accepted_identity_facts.reviewed_by` is null only then,
  enforced by a check), so the name lock and the "verified" notice work
  unchanged.
- **Declines** (`automatic` setting, including the partner's "in review"):
  `internal.decline_automatic_identity_submission` keeps the submission but
  removes it from the case's current place, so no staff queue shows it and the
  member's page offers a new attempt.
  `api.ask_person_identity_check(check, reason)` (within 5 days, before anything
  replaced it; reason 20 to 2,000 characters) records the request on the check
  (`asked_at`, `ask_reason`) and puts the submission back in the staff queue.
  Staff decide it with the usual commands, and the existing "verified" or "sent
  back" notice tells the member. No appeal is created. A new check cannot start
  while the request waits.
- **Reviewers:** `api.get_identity_check_for_case(case)` (staff with
  `evidence:view` holding a current claim on that open case, logged as a
  `routine_review` evidence access, like the identity review context) shows the
  check's status, reason codes and the member's request.
- **The partner's copy:** `api.claim_identity_check_deletions(limit)` returns
  sessions to delete (a check that never finished at once, also one still
  unfinished an hour after its 24-hour expiry; a declined check 5 days after the
  decline unless the member asked a person), skipping fraud and legal holds,
  each held for 5 minutes; `api.mark_identity_check_provider_deleted` records
  the deletion. Deleting our own copies of failed attempts is part of C1.
- **Retention:** a check row goes with its identity case and its submission
  (`on delete cascade`), and a deleted evidence file only clears its reference
  (`on delete set null`), so the five-year history sweep in
  `internal.retention_verification` removes a closed account's checks with the
  rest of its identity history.

**For the server code (Didit plan, build step 6).**

- **Session link lure:** the partner session link is a bearer link. Compare the
  partner's network and device with the start context
  `api.begin_identity_check_evidence` returns, pass `session_moved` on a
  mismatch, and consider the partner's phone step. Send the partner no names or
  network data.
- **No bypass of the automatic route:** the website's photo upload and
  submission routes must check `api.get_identity_check_availability` first, so
  an automatic decline and the one "ask a person" per check cannot be bypassed
  through the manual route while the automatic route is open.
- **Names:** compare the typed names with the names on the ID without regard to
  case in the website, and pass the typed names as `p_names` (the start names
  `api.begin_identity_check_evidence` returns; the database still compares them
  with the submission's snapshot).

New tables, columns, constraints and commands only (expand); no existing
function body changes. `reviewed_by` becomes nullable for automatic facts only;
a website release without the matching code never calls the commands. ORDER:
apply first, then merge.

**Applying.**

1. Run `../preflight/20261121094003_automatic_identity_checks.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "automatic identity checks: update not
   applied; admins: N" (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "automatic identity checks: already applied; admins: N;
   mode: manual; checks: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261121094003_automatic_identity_checks.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses unless the update is
applied, and refuses once a check or a setting change was recorded. Otherwise it
drops the commands, helpers and tables, puts back the widened constraint, makes
`reviewed_by` required again and removes the capability.

`node --import tsx scripts/test-foundation-automatic-identity-checks.mjs` (part
of `pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted body and a
premature rollback; apply, rollback and re-apply return the same fingerprints;
the capability and the grants; nothing starts on `manual`; who may change the
setting (moderator, governor and an admin with a 20-minute-old code are refused)
and its log; a clean pass verified by the check with the name lock and notice;
an automatic fact never naming a reviewer; `staff_final` sending anything else
to the queue with its reasons, the reviewer read only under a claim and logged,
and a real staff return; a typed name changed during the check caught as
`names_differ` (to staff, or declined) and never locked; `automatic` declining
"in review", banned, duplicate and high-risk results out of every queue; asking
a person (no appeal, the submission back in the queue, a new check refused
meanwhile), then a real staff approval and a real staff return; the 5-day window
and a replaced attempt; the partner deletions (at once, after 5 days, held by a
legal hold, the expiry sweep, a late result not recorded); both spending limits
at their bound; the pause and its resume; session binding and result rules; a
result after the expiry; `manual` at the moment a result arrives; the setting
command refusing anything but `manual` and a reason with control or direction
characters; a new check needing a verified phone; and the five-year history
sweep removing a closed account's checks.

## Staff sales figures, the VAT alert and the VAT wording from the database, 21 November 2026

`20261121090305_staff_sales_and_vat.sql` was applied on 21 November 2026 at
17:30 UTC (see the applied register). Launch checklist item 16 (roadmap M8.7,
remainder). Everything is computed from the existing payment records; no table
is added.

- **What a sale is.** A payment's amount, less the slots refunded or charged
  back (reversed payment lines), and nothing once the whole payment was refunded
  or charged back (`internal.payment_net_cents`). It counts on the day it was
  paid, the way a sales report counts an order on its order date.
- **The VAT position** (`internal.vat_sales_position`): sales paid in the last
  12 months, the VAT setting (`private.invoice_merchant_config`, which the
  invoices already check), the alert level R1.8 million and the compulsory level
  R2.3 million (SARS, from 1 April 2026), and whether the alert is on (not
  registered for VAT and the total at or above R1.8 million).
- **The staff read** `api.get_staff_sales_summary()` (`payments:view`, the staff
  payments page's own capability, with a recent authenticator code; read only):
  the VAT position, sales of the last 12 months by product (Individual slot,
  Multi-listing package, add-on, other) and term in days, and the online
  checkouts sent to Ozow in the last 30 days with how many were paid, failed,
  cancelled, expired or are still open (a checkout replaced before it reached
  Ozow is not counted). Counts and amounts only.
- **The public read** `api.get_vat_registration()` (visitors and members, like
  the price catalogue): the VAT setting's status and, only when registered, the
  VAT number. The pricing, billing and Trust & Safety pages state it instead of
  a fixed sentence in the website.
- **The daily payment summary** (`internal.claim_payment_digest`, service only)
  keeps its signature and grants; the summary it stores gains one field,
  `sales`, with the VAT position. The website reads the summary with a
  non-strict reader, so an older release keeps sending it unchanged.

New commands and one added summary field only. **Apply first, then merge:**
until the update is applied, the release that uses it shows "Sales figures could
not be loaded" on the staff payments page and leaves the VAT line out of the
public pages.

**Applying.**

1. Run `../preflight/20261121090305_staff_sales_and_vat.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "staff sales and VAT: update not applied".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "staff sales and VAT: already applied; VAT setting:
   not_registered".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261121090305_staff_sales_and_vat.down.sql` (only with the owner's
decision; prefer a forward fix). It refuses (55000) unless the update is
applied, every function it replaces or drops still has the update's body, and no
other function uses what it drops; then it puts back
`internal.claim_payment_digest` byte for byte and drops the two reads, their
internal twins, `internal.vat_sales_position` and `internal.payment_net_cents`.

`node --import tsx scripts/test-foundation-staff-sales-and-vat.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted summary
command and a premature rollback, changing nothing; apply, rollback and re-apply
return the same fingerprints; the rollback refuses while another function uses
what it drops; who may run each function; sales net of a refunded slot and of a
refunded payment, a bank transfer counted, a payment of 13 months ago left out;
sales by product and term; online checkouts of the last 30 days by outcome (bank
transfers, checkouts never sent to Ozow and older checkouts left out); the alert
off one cent below R1.8 million, on at it, and off once registered for VAT; the
daily summary's `sales` field; the public read for visitors and members; and
only staff with `payments:view` and an authenticator code of the last 12 hours
can read the figures (an admin whose code is 11 hours old can; a moderator, a
member, an admin whose code is 13 hours old, the server key and a visitor are
refused).

## Privacy exports while a request is in progress, at most 5, every one notified, 21 November 2026

`20261121053224_privacy_export_simple.sql` was applied on 21 November 2026 at
17:15 UTC (see the applied register). It replaces only
`internal.export_frontend_privacy_request` (same signature, owner and grants; no
API, manifest or type change):

- **Only an access request in progress** (identity verified, at the stated
  revision) can be exported; a completed request can no longer be. A request not
  in progress is refused with PT409 `privacy_export_not_in_progress`; the other
  refusals, the staff and second-factor checks and the self-export refusal are
  as before.
- **The row lock is `FOR NO KEY UPDATE`** (was `FOR SHARE`): what is new is that
  parallel exports of one request queue behind each other, so the cap of 5
  holds. Completing the request (which bumps its revision) already waited for a
  running export under `FOR SHARE`, and still does. The cap relies on READ
  COMMITTED (PostgREST's default); staff have no direct SQL. Retention, which
  minimises only completed or rejected requests, is unchanged.
- **At most 5 exports per request**: the 6th is refused with PT429
  `privacy_export_limit`. The website's per-staff rate limit stays.
- **The member is told about every export**: each adds a bell notice
  (`privacy_export_made`); the requester's email is still queued once per
  request. A too large export (PT413) is raised before anything is recorded.

Accepted risks: a dataset-name mismatch the website refuses after the export was
recorded gives the member one extra notice and uses up one of the 5 places; a
completed request cannot be exported again (open a new request).

The website words the two new refusals ("Only a request in progress can be
exported…", "…already been exported 5 times…"); a release without that code
shows its generic refusal. As usual: apply first, then merge.

**Applying.**

1. Run `../preflight/20261121053224_privacy_export_simple.check.sql` unchanged
   in the SQL editor (read only). Continue only if its single row reads "privacy
   export simple: update not applied; exports recorded: N".
2. Run the update (waits at most 5 seconds for a lock). The preflight then reads
   "privacy export simple: already applied; exports recorded: N".
3. Run `set search_path to "$user", public;` and `../fingerprint.sql`, compare
   with `../fingerprint.json`, and record it as described above.

The reviewed rollback
`../rollback/20261121053224_privacy_export_simple.down.sql` (only with the
owner's decision) refuses (55000) unless the update's body is in place, then
puts back the previous body byte for byte. Recorded exports and notices stay.

`node --import tsx scripts/test-foundation-privacy-export-simple.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; drift and a premature rollback refused;
apply, rollback and re-apply give the same fingerprints and the rollback
restores the previous definition exactly; only in-progress, verified access
requests at their revision; the staff, second-factor and self-export checks; 5
exports with a notice each and one email, the 6th refused, also with two exports
racing at 4; a too large export records nothing; completing waits for a running
export, and an export waiting for a completion is refused.

## Authority requests: opening a kept identity record, 21 November 2026

`20261121043124_identity_record_disclosure.sql` was applied on 21 November 2026
at 08:55 UTC (see the applied register). Didit plan, build step 4: a governor or
admin opens a member's kept identity record to answer a police or court request,
and every opening is logged before anything is shown.

- **Who:** the new staff capability `identity:disclose`, held by the governor
  and admin roles with `requires_recent_mfa`, so `internal.staff_actor` needs an
  authenticator code from the last 15 minutes on every command. Moderators never
  hold it.
- **The request:** `api.open_identity_disclosure` takes the request type (closed
  list: `subpoena`, `court_order`, `warrant`, `police_case`, `regulator`), the
  reference (3 to 100 characters), the reason (10 to 2,000) and the confirmation
  that the request is genuine and signed. Each missing part is refused with
  22023 and its own detail (`disclosure_*`).
- **Never by name:** the search is by `post` (post id or link slug), `id_number`
  (the one-way fingerprint the website's server makes with the verification key;
  the number itself never reaches the database here), `phone` (+27 form) or
  `email`. Any other kind is refused (`disclosure_lookup_invalid`), and each
  value must have its kind's form (`disclosure_lookup_value_invalid`).
- **Log first:** the new append-only table `private.identity_disclosures` gets
  the row (staff member, time, the request, the search and the outcome `record`,
  `no_record`, `attempt_only` or `no_match`, with up to 5 account ids, the most
  recent first, and the total) before anything is answered. A search that finds
  nobody is logged too. The opening answers only the row's id, number, outcome,
  match count and closing time.
- **The record:** `api.read_identity_disclosure(disclosure, purpose, subject)`
  first writes a `viewed`, `printed` or `selfie_viewed` row to the append-only
  `private.identity_disclosure_events`, then returns the request and, per
  account, the full names as on the ID, the verification date, whether the ID
  number and the selfie are still kept, the ID photo's state and every verified
  phone number with its dates. Only the staff member who opened it, while they
  still hold the capability, until 15 minutes after it was opened (fixed by a
  check); otherwise PT409 `disclosure_unavailable` or `disclosure_closed`. An ID
  number that was only tried (never accepted) returns the account and the dates
  of the attempts, nothing more.
- **Server only:** `api.identity_disclosure_material(disclosure, staff)`
  (service role) gives the website's server the encrypted ID number and the
  selfie's stored object of an open disclosure opened by that staff member (who
  must still hold the capability), so it can decrypt the number and show the
  selfie. Browsers never receive object keys or ciphertext.
  `api.list_identity_disclosures` lists the latest 50 openings without the
  person or the search value.
- **Audit log:** `private.frontend_staff_audit_events` (the staff Audit log)
  gains every opening (`identity:disclosure_<outcome>`) and every later look
  (`identity:disclosure_<kind>`), with target type `account` (one the live
  website already reads) and a reason giving only the disclosure number, the
  request type and reference, and the kind of search.
- **Drift guard:** the update and the preflight pin `internal.staff_actor`,
  `internal.append_only_guard` and the md5 of the audit trail view's definition,
  so an unexpected change to any of them is refused.
- **Keeping:** both logs refuse update, delete and truncate
  (`internal.append_only_guard`); a delete is possible only under the retention
  setting `vm.retention`. No retention job deletes them: their keeping period is
  for the owner (and the lawyer list) to decide.

New commands only (expand); the only replaced object is the audit trail view,
which keeps its columns and adds two branches. A website release without the
matching code never calls the commands, and its Audit log reads the new rows.
ORDER: apply first, then merge.

**Applying.**

1. Run `../preflight/20261121043124_identity_record_disclosure.check.sql`
   unchanged in the SQL editor. It is read only. Continue only if its result is
   the single "summary" row reading "identity record disclosure: update not
   applied; governors and admins: N" (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "identity record disclosure: already applied; governors
   and admins: N; disclosures: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261121043124_identity_record_disclosure.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses unless the update is
applied, and refuses while the disclosure log holds any row (authority request
records are kept). Otherwise it puts back the audit trail view as it was,
removes the capability and drops the four commands, their helpers and both logs.

`node --import tsx scripts/test-foundation-identity-record-disclosure.mjs` (part
of `pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted body and a
premature rollback; a changed audit trail view refused; apply, rollback and
re-apply return the same fingerprints; the capability (governor and admin,
recent code; never moderator); the grants and that nothing is security definer
at the `api` layer; who may open, read and list (a visitor, a member, a
moderator, an admin or governor whose code is 16 or 20 minutes old are refused;
a governor and an admin with a fresh code succeed) and that a refusal logs
nothing; every request rule; never by name (name kinds and names typed as any
kind are refused, and a raw ID number too); log before show (the opening answers
only the row, the row exists before the read, and when either log cannot be
written nothing is answered); the record's content and that it never carries the
stored object or ciphertext; the server material only for the opener; every way
of searching (post id and slug, ID number fingerprint, current and earlier
phone, email in any case); no match logged; an ID number only tried; only the
opener; closing after 15 minutes; the list and the Audit log never show the
person; both logs append-only with the retention exception; the rollback refused
with a row; and a staff member who loses the role (no record and no server
material).

## Post templates, 21 November 2026

`20261122191646_post_templates.sql` is pending (see the applied register).
Launch checklist item 17b, business tools plan section 4 (owner-approved 20
November 2026 with all 10 recommendations): a member whose Multi-listing package
runs saves a reusable starting point for Market listings.

- **What a template keeps:** `private.post_templates` holds up to 20 per
  account, each with a name (1 to 60 characters, unique per account ignoring
  case; otherwise 22023, detail `template_name_invalid`) and the form fields the
  plan lists, at most 16 KiB: the category, the condition, the details that
  repeat (text, yes/no or lists of text), the description, the location and
  which contact buttons to show (by name, never a number). Refused (22023,
  detail `template_invalid`): any other field (photos, video, title, price), an
  empty category, price details (`monthly_rent_zar`, `salary_min`, `salary_max`,
  `levy_zar`, `rates_taxes_zar`) and details of one item (`year`, `mileage_km`,
  `number_of_owners`, `battery_health_pct`, `colour`, `accident_free`,
  `registration_province`, `available_from`, `application_deadline`,
  `age_months`, `quantity`).
- **Saving:** `api.save_my_post_template(name, data)` (members) saves a
  template, or replaces the caller's template with the same name ("save again
  under the same name"), only while the caller's package runs
  (`internal.slot_package_now`; PT402, detail `package_required`). A 21st
  template is refused (PT429, detail `template_limit`).
- **Reading and tidying up:** `api.list_my_post_templates()` returns the
  caller's templates and whether their package runs;
  `api.rename_my_post_template(template, name)` and
  `api.delete_my_post_template(template)` act on the caller's own templates only
  (PT404, detail `template_unavailable`; a name already used is PT409, detail
  `template_name_taken`), also after the package ends.
- **Deletion:** the trigger `post_templates_account_closed` deletes an account's
  templates when it closes; the Auth user's deletion cascades too.
- **Privacy export:** one more dataset, `post_templates`. The full
  `internal.frontend_privacy_export_data` body is the live one from
  `20261121150309_copy_a_post.sql` (posts rows keep `copied_from`) with that one
  dataset added.
- **Teams:** package teams (P4c, item 15) are not built, so a template belongs
  to the account that made it.

Expand only: four new commands, a table and a trigger; the export gains a
dataset. ORDER: **website-first**: the live staff access export
(`/api/admin/dsar/export`) accepts exactly 42 datasets and would refuse every
export once the update adds the 43rd; the website in this change accepts 42 or
more. `SHOW_POST_TEMPLATES` is on in that website (like every other switch since
the owner's decision of 22 November 2026), and until the update is applied the
template read fails, so nothing shows: 'Save as template' stays hidden and
Create Post shows no templates. Merge and deploy the website, then apply the
update.

**Applying.**

1. Run `../preflight/20261122191646_post_templates.check.sql` unchanged in the
   SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "post templates: update not applied; slot packages: N"
   (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "post templates: already applied; slot packages: N;
   templates: 0; accounts with templates: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261122191646_post_templates.down.sql`
(only with the owner's decision; prefer a forward fix; switch
`SHOW_POST_TEMPLATES` off first). It refuses (55000) unless every piece of the
update has the update's body; then it puts back
`internal.frontend_privacy_export_data` byte for byte and drops the trigger, the
nine functions and `private.post_templates` (saved templates go with it; posts
made from them stay).

`node --import tsx scripts/test-foundation-post-templates.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; a drifted body and a premature rollback
refused; apply, rollback and re-apply return the same fingerprints; the grants
(members only, wrappers security invoker, the trigger function for nobody, no
table access); saving, replacing by name (ignoring case), listing, renaming and
deleting; the limits (20 per account, names of 1 to 60 characters, 16 KiB);
refusals for other fields, an empty category, a price detail, a detail of one
item, a detail that is a number or an object, a number or an unknown contact
button, without a running package, for another member's template and for a
visitor; deletion when the account closes; and the export dataset.

## Staff operations health and a last-run record for every scheduled job, 20 November 2026

`20261120163500_staff_operations_health.sql` was applied on 21 November 2026 at
04:53 UTC (see the applied register). Launch checklist item 8 (roadmap M5.5,
first part). The staff page `/admin/operations` read job, incident and retention
records that only the retired backend had; it now reads one staff command over
what this database holds. The page stays switched off (`SHOW_STAFF_OPERATIONS`)
until launch.

- **Every scheduled job records its last successful run.** Fifteen service-only
  commands the timed Workers start through the website (every minute: slot
  renewals, post lifecycle, sponsorships, inbox purge, intro trials, partner
  commissions, bank transfer expiry, added-slot invoices, email delivery,
  payment alerts, privacy notices; every 5 minutes: retention, form drafts,
  evidence and media cleanup) keep their signatures, grants and results; each
  passes its result through `internal.note_scheduled_job_run`, which writes the
  job's time in the new `private.scheduled_job_runs` (one row per job, no
  account data, no API role access, RLS on). The record is written in the same
  transaction as the job's work, so a failed command records nothing. At most
  one write per job every 20 seconds, and never a time later than now (a future
  time written by hand shows as late and is pulled back on the next run). Only
  the api wrappers change; `internal.run_retention` and the other internal
  functions are untouched.
- **The two payment jobs** run several steps in the website, so their commands
  are not changed. The website calls the new service-only command
  `api.record_scheduled_job_run(job)` only after the whole run succeeded: the
  10-minute payment status check when no payment failed (`payment_checks`), and
  the daily Ozow refund check when Ozow's whole list was read (`refund_check`).
  It accepts only those two jobs (22023 otherwise). A run that fails records
  nothing, so the job turns late.
- **Late jobs.** `internal.scheduled_job_catalogue()` lists each job, how often
  it runs and when it counts as late (10 minutes for the minute jobs, 30 for the
  5-minute jobs, 40 for the payment checks, 26 hours for the daily refund
  check). Until a job's first run after the update it shows as late with no run
  recorded. The refund check runs only while the Ozow refund key is set.
- **The staff read** `api.get_staff_operations_health()` (governor and admin,
  `audit:view`, with a recent authenticator code; read only) returns each job's
  last run and whether it is late; stuck emails (unsent after the last of 8
  attempts, or a day after queuing) with the size of the unsent queue; stuck
  privacy request notices (same rule, only notices the notice job can still
  send), and apart the number queued in the last 30 days that it can never send
  (the request was minimised, or the account's address changed or is not
  confirmed; retention minimises closed requests after 30 days, so older ones
  are not counted); payment problems seen in the past 7 days and paid payments
  not activated; account deletions held back, file deletions stuck over a day or
  queued, ID evidence past its deletion date outside legal and fraud holds, and
  accounts on legal hold; and open cost alarms. Lists have at most 50 rows;
  counts are complete. It returns kinds, reasons, counts, times and an
  8-character payment reference, never an account id, name, email, phone or
  message text.

The job commands keep their signatures, so a website release without the
matching code works with the update, and the release with it shows "could not be
loaded" on the (switched-off) page until the update is applied. As usual: apply
first, then merge.

**Applying.**

1. Run `../preflight/20261120163500_staff_operations_health.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "staff operations health: update not applied".
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "staff operations health: already applied; jobs with a
   recorded run: N of 17" (N grows to 15 within about 10 minutes as the timed
   jobs run; the payment checks follow once the matching website release is
   live, and the refund check after its next daily run).
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261120163500_staff_operations_health.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses (55000) unless the update is
applied, every function it replaces or drops still has the update's body, and no
other function uses what it drops (the run table, the catalogue, the note and
record helpers or the read; matched as exact text); then it puts back the
fifteen job commands byte for byte and drops the read, the record command, their
internal twins, `internal.note_scheduled_job_run`,
`internal.scheduled_job_catalogue` and `private.scheduled_job_runs`.

`node --import tsx scripts/test-foundation-staff-operations-health.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted body and a
premature rollback, changing nothing; apply, rollback and re-apply return the
same fingerprints, and the rollback restores every job command byte for byte
with its grants, leaving the two payment commands untouched; the rollback
refuses once a job command changed later or another function uses the run table,
the catalogue, the helpers or the read (an underscore in a name is not a
wildcard); each of the fifteen commands, called as the timed jobs call it,
records only its own job and returns its result unchanged, while the two payment
commands record nothing and the record command records only those two jobs; a
failed command records nothing, and a failed payment run turns late; at most one
write per job every 20 seconds; a future time shows late and is pulled back to
now; only catalogued jobs can be recorded, and members and visitors can run
neither the commands nor the helpers; every job is listed in order and turns
late after its limit (9 and 11 minutes, 29 and 31, 39 and 41, 25 and 27 hours);
stuck emails and notices (notices of the last 30 days that can never be sent
counted apart, older ones not), payment problems, blocked deletions, evidence
past its date (a held account's excluded) and open alarms are counted and listed
as described, with no account, subject, request or case id; lists stop at 50
while counts stay complete; and only governor and admin with a recent
authenticator code can read it (a moderator, a member, an admin whose code is 20
minutes old, the server key and a visitor are refused).

## ID photos with the camera only, and Continue on your phone, 20 November 2026

`20261120131212_camera_capture_handoff.sql` was applied on 21 November 2026 at
01:58 UTC (see the applied register). Didit plan, build step 2: ID photos and
selfies are taken only with the camera on the verification page, and a member on
a computer without a usable camera continues on their phone, **signed in there
as the same account** (owner decision). Works on today's Manual setting.

- **Links:** new table `private.capture_handoffs`. The website makes a random
  32-byte token and stores only its SHA-256; the link carries the token in its
  `#fragment`. A link belongs to one account, its open identity case and the
  computer's live session, works for 15 minutes (fixed by a check) and only the
  newest link of an account works. At most 5 links an hour per account (PT429,
  detail `handoff_rate_limited`). No API role has table access; links are
  deleted one day after they expire by `internal.purge_capture_handoffs`, run by
  `api.run_retention` as `capture_handoffs`.
- **Making a link:** `api.start_capture_handoff` (members with a live session)
  takes the typed legal names (saved as the ID upload saves them) and
  `p_with_id`, never an ID number receipt. With `p_with_id` the link works only
  after `api.attach_capture_handoff_identity` (service only) has attached the
  encrypted receipt the website's server made from the typed, checked ID number;
  a member can never supply one. Without ID details only the selfie can be
  taken, after an ID photo of the case (PT409 `handoff_needs_id`).
- **The phone:** `api.redeem_capture_handoff`, `api.capture_handoff_context` and
  `api.reserve_handoff_verification_upload` are service only and take the
  phone's GoTrue-verified account (`p_signed_in`): none gives 42501
  `handoff_sign_in_required`, another account 42501 `handoff_other_account`,
  both without using the link. Opening uses the link once and binds the SHA-256
  of a capture grant the website keeps in an HttpOnly cookie on the phone; every
  unusable link gets PT409 `handoff_unavailable`. Reserving works only for the
  link's case, on the computer's session, with the same rules as
  `api.reserve_frontend_verification_upload`, and stops once the link has both
  photos (PT409 `handoff_done`); the selfie is stored as taken with the camera.
  The uploads are completed by the existing service commands, so signing out on
  the computer also stops the phone.
- **Camera only (website):** the upload routes refuse a photo the page did not
  take: no `camera` capture method, no valid capture token from when the camera
  started (HMAC with the server secret, bound to the account, the photo kind and
  the sign-in session or the phone's grant, at most 10 minutes old), not a JPEG,
  any APP1 metadata (EXIF or XMP), an ID photo under 1,000 px or a selfie under
  480 px on the long edge. None of this proves a picture came from a live
  camera; staff still review every case.
- **Expand only:** `internal.record_my_selfie_capture` is unchanged. Its refusal
  of selfies the browser says were uploaded files comes in a later contract
  update, after this website release is deployed (here it would break the live
  page between applying and deploying; the website already refuses them).

New commands only: no existing command changes. A website release without the
matching code never calls them, and the release with them needs them (its
"Continue on your phone" answers "not available" without the update). ORDER:
apply first, then merge.

**Applying.**

1. Run `../preflight/20261120131212_camera_capture_handoff.check.sql` unchanged
   in the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "camera capture handoff: update not applied; selfies
   said to be uploaded files: N" (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "camera capture handoff: already applied; selfies said to
   be uploaded files: N; phone links: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is
`../rollback/20261120131212_camera_capture_handoff.down.sql` (only with the
owner's decision; prefer a forward fix). It refuses unless the update is
applied, puts back `internal.run_retention` byte for byte, and drops the five
commands, their helpers and `private.capture_handoffs` (open links and the ID
number receipts they hold). Uploads already completed from a phone are kept.

`node --import tsx scripts/test-foundation-camera-capture-handoff.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after, read only; the refusals with a drifted body and a
premature rollback; a changed audit trail view refused; apply, rollback and
re-apply return the same fingerprints; the selfie capture report is unchanged; a
link stores only hashes, its case and session, and lasts 15 minutes; a member
can never supply a receipt (the start takes none and the attach is server only),
a link waiting for one cannot be opened, and bad input, missing ID details, a
reused token and a sixth link in an hour are refused; the phone must be signed
in as the same account (signed out or another account is refused without using
the link); the phone's ID photo and selfie complete through the existing service
commands and register the submission, after which the link takes nothing more; a
grant reaches only its own case and not a decided one; a link stops working when
expired, replaced, signed out on the computer or the account is closed; a
selfie-only link; only the website's server opens links, attaches receipts and
reserves phone uploads, and no API role reads the table; links go one day after
they expired.

## A daily limit on SMS codes for the whole site, 20 November 2026

`20261120074411_sms_daily_limit.sql` was applied on 20 November 2026 at 12:26
UTC (see the applied register). Launch checklist item 12, launch assurance
LA-A15: an operational limit so that many accounts, or a fault in the website,
cannot send an unbounded number of SMS codes (each one is paid for) in one day.
The website's limits per number (10 a day), per account (10 a day) and per
network (30 a day) are unchanged; this limit is counted in the database for the
whole site.

- **What counts:** every SMS code the website sends follows exactly one stored
  challenge, so `internal.create_verification_phone_challenge` counts it, per
  South African day, in the new table `private.sms_code_days` (one row a day:
  the date and the count; no account, number or code; no API role has access).
  It counts after every existing refusal (account, number, own number, change
  rules, `phone_banned`, `phone_in_use`), so a refused request uses no place.
  The challenges already stored on the day the update is applied are counted by
  the update.
- **Safe with requests at the same moment:** the count is one `UPDATE` of the
  day's row with `sent < limit` in its condition. The row lock makes concurrent
  requests count one at a time, and a request that waited re-checks the
  condition on the newest row, so the count never passes the limit.
- **At the limit:** PT429 'daily SMS code limit reached', reason
  `sms_daily_limit`, before a challenge is stored or the member's open code is
  expired: no SMS is sent and a code already sent still works. The website
  answers 503 with "We can't send codes right now. Please try again later." and
  logs the request (reason `sms_daily_limit`). It resets at midnight, South
  African time.
- **Staff see it** on the staff cost page: a cost alarm 'warning' when the day's
  count reaches 70% of the limit and 'critical' when it reaches the limit (at
  most once each a day, under open alarms, until acknowledged), and the line
  "SMS verification codes sent today (daily limit)" with the limit.
- **The setting** is the cost allowance `sms_codes_day` (`free_quantity`, 500 to
  start; read by `internal.sms_daily_limit()`, which gives 500 when the row is
  empty and at most 1,000,000). The owner decides the value. To change it, a
  reviewed update or the owner in the SQL editor runs
  `update private.cost_allowances set free_quantity=<n> where metric='sms_codes_day';`
  It takes effect on the next request. A value lowered below the day's count
  refuses at once but raises no alarm that day. If the row is deleted the limit
  of 500 still holds, but no alarm is raised (a cost alarm needs its row).

No API command changes, so the order does not matter: a website release without
the matching code shows its generic "Phone verification could not be completed"
for the new refusal (still with no SMS), and the release with it works without
the update (no daily limit). As usual: apply first, then merge.

**Applying.**

1. Run `../preflight/20261120074411_sms_daily_limit.check.sql` unchanged in the
   SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "sms daily limit: update not applied; codes today: N"
   (any count).
2. Run the update. It waits at most 5 seconds for any lock. Run the preflight
   again: it must read "sms daily limit: already applied; codes today: N;
   counted today: N; limit: 500", with the two counts equal (a code sent in
   between counts in both).
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261120074411_sms_daily_limit.down.sql`
(only with the owner's decision; prefer a forward fix, such as a higher limit).
It refuses unless the update is applied, puts back
`internal.create_verification_phone_challenge` byte for byte and drops
`internal.sms_daily_limit`, `private.sms_code_days`, the cost allowance
`sms_codes_day` and its cost alarms.

`node --import tsx scripts/test-foundation-sms-daily-limit.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database, with no
SMS provider involved: the preflight before and after, read only; the refusals
with a drifted body and a premature rollback, changing nothing; apply, rollback
and re-apply return the same fingerprints; the codes stored earlier that day
count and the limit is 500; each stored code counts once; at the limit no
challenge is stored, the member's open code is not expired and can still be
used, and other members are refused too; raising the setting allows more codes
at once; at the limit, requests refused for another reason still get that reason
and none is counted; the warning alarm at 70% and the critical one at the limit,
once a day; 20 requests at the same moment, waiting on the day's row together,
store exactly the 5 codes the limit leaves; a new day starts at zero and keeps
the previous day's count; the setting's fallback and bounds; with the setting
row deleted, the 350th and 500th codes are stored and the 501st is refused with
`sms_daily_limit`, with no alarm; and no API role can read the counts or run the
helper.

## Add slots part-way through a Multi-listing package, 20 November 2026

`20261120045404_package_add_slots.sql` was applied on 20 November 2026 at 10:45
UTC (see the applied register). Roadmap P4b; the owner's decision D1 of 19
November 2026. It needs `20261114154823_slot_packages.sql`,
`20261119025106_package_invoices.sql` and
`20261119151152_package_gap_fixes.sql`, and refuses (55000) unless the seventeen
functions it replaces have their reviewed bodies (or this update's), the fifteen
it adds are absent (or this update's) and `private.package_invoice_requests` has
no column `kind` (or this update's). It only adds: three member commands and one
service sweep, four columns, a foreign key and two rules on the request table
(and a wider slots rule), and a void rule on `private.customer_invoices` that
also allows the database's own void of an ended package's add invoice; no API
command, argument or grant is removed or changed. **Nothing can be added after
it is applied**: packages stay off sale and every new command refuses with PT403
`packages_not_on_sale` until the owner switches them on (launch item 60).

- **The price.** Added slots end with the package, always, and start on payment.
  One added slot costs the package term's catalogue price for the whole 24-hour
  periods left (rounded down), R100 per 30 days, rounded to the cent
  (`internal.slot_package_add_quote`, from the term's catalogue row on sale,
  `internal.slot_package_term_plan`); an add of n slots costs n times that, so
  an invoice keeps "slots × unit price = total". A package holds at most 250
  slots.
- **Online.**
  `api.start_package_add_checkout(p_package_id, p_slots, p_expected_total_cents, p_cooling_off_consent)`:
  the switch on (PT403), an accepted ID review (PT412), the box ticked (22023;
  `package-add-starts-now-v1` in the payment's snapshot), the account's running
  package (PT409 `package_ended`) with 7 or more whole days left (PT409
  `package_add_too_late`), 1 slot or more and 250 in all (22023
  `package_slots_invalid`), 100 in all and the online payment limit (PT413
  `package_invoice_required`), the total shown (PT428) and no unpaid package
  invoice (PT409 `package_invoice_unpaid`). One payment, one line holding every
  added slot, snapshot category `slot_package_add` naming the package. The same
  order within 30 minutes is continued; another unsent one is replaced; one open
  at Ozow is returned to continue, check or cancel.
  `internal.claim_checkout_request` sends an add to Ozow only while its package
  runs with room, an online order only within 30 minutes of its price (PT409
  `package_add_price_expired`) and with 7 or more days left.
- **By invoice (D1).**
  `api.request_package_add_invoice(p_package_id, p_slots, p_expected_total_cents, p_cooling_off_consent, p_request_id)`
  only while 10 or more whole days are left (PT409
  `package_add_invoice_too_late`), at the price of that moment, at most 245
  slots in one add (22023 `package_slots_invalid`). The request (`kind` `add`,
  the package as a foreign key, set to null if the retention job removes the
  package record, and the days left; the guard keeps them) uses the existing
  queue, repeats and limits. Staff issue it (above R50,000 a second admin
  approves) only while the package runs with 10 or more whole days left and room
  (PT409 `package_ended`, `package_add_invoice_too_late`,
  `package_slots_invalid`), at the price asked for or, when fewer whole days are
  left by then, for those days at their lower price ("Multi-listing package: <n>
  slots added for <d> days", slots × unit price = total), due 3 days after it is
  issued or on the package's last day when sooner (staff do not choose the days
  for an add). The request records the days invoiced (`invoiced_days`); the
  staff queue shows the days priced, the days left now and the package's end;
  the invoice gains `days_added` and `package_ends_at`. A new package's request,
  read and checkout never take an add request or an add order for theirs (the
  checkout closes any add order still pending, even one open at Ozow, and a Pay
  now attempt on an add invoice: its package has ended, so it can no longer be
  delivered; the sweep below then voids that invoice). An unpaid add invoice of
  a package that has ended blocks no other package order
  (`internal.package_invoice_blocking`) and is voided by the website's minute
  operations job (`api.void_ended_package_add_invoices`, service only, no staff
  member, one fixed reason, which the trigger `customer_invoices_system_void`
  refuses on any other invoice; an invoice with a payment open at Ozow or a
  transfer waiting is left for staff). The privacy export lists each request's
  kind, package and days. `api.get_my_package_add_offer()` gives the member's
  running package, the days left, one slot's price, the most that can be added,
  which ways are open, an unpaid package invoice, their latest add request and
  the adds so far.
- **Delivery and late money.** Every way an add is paid (the Ozow notice, staff
  activation, Pay now, a bank transfer) delivers it only to the package it was
  bought for while that package runs and has room
  (`internal.slot_package_add_ok`): a further grant of the package
  (`internal.issue_slot_line_entitlements`) from payment to the package's end, 4
  new posts per added slot per 30 days, the partner commission on its line.
  Money that arrives after the package ended is not delivered: an Ozow payment
  goes to reconciliation (staff refund it in full; staff activation refuses it,
  PT409 `package_ended`); Pay now and a bank transfer are refused (PT409
  `package_ended`; staff void the invoice and return the money). The same holds
  for an order or Pay now attempt the new-package checkout closed while it was
  open at Ozow: the 10-minute status check keeps asking Ozow about a closed
  order with an Ozow request for 14 days, and a success reported by the notice
  or that check is kept as paid and goes to reconciliation
  (`complete_unfulfillable_target`), which emails staff at once.
- **Refunds.** An add is its own line, refunded alone with the existing tools.
  When any package grant is revoked, the posts in it that still fit in the
  package's other running grants stay, the most recently approved first
  (`internal.slot_package_keep_posts`, run by the revocation trigger); the
  reversal ends the others as before. The places are counted under the package's
  row lock, the one an activation holds, taken without waiting: while an
  activation holds it the reversal is refused (PT409 `package_busy`) and staff
  retry it; any other failure never stops the reversal.

**Order: apply first, then merge.** The website release from the same pull
request calls the new commands (behind the switch) and the deploy preflight
probes every command in `../runtime-api-manifest.json`. Earlier releases keep
working with the update applied: an add request or add invoice (the only answers
with new fields) cannot exist while packages are off sale, and the operations
job of an earlier release does not call the new sweep.

**Applying.**

1. Run `../preflight/20261120045404_package_add_slots.check.sql` unchanged in
   the SQL editor. It is read only. Continue only if its result is the single
   "summary" row reading "package add slots: update not applied; on sale: no;
   packages running: 0; package invoice requests: 0; added-slots requests: none
   (column absent); added-slots payments: 0; invoices voided by the database:
   0".
2. Run the update. It waits at most 5 seconds for any lock (it briefly locks
   `private.package_invoice_requests` and `private.customer_invoices` to add
   their columns and rules). Run the preflight again: it must read "package add
   slots: already applied; on sale: no; packages running: 0; package invoice
   requests: 0; added-slots requests: 0; added-slots payments: 0; invoices
   voided by the database: 0".
3. Run `set search_path to "$user", public;` and then `../fingerprint.sql`, and
   compare with `../fingerprint.json`; once it matches, record it as described
   above.

The reviewed rollback is `../rollback/20261120045404_package_add_slots.down.sql`
(only with the owner's decision; prefer a forward fix). Revert and deploy the
website release first. It refuses once an added-slots request or payment exists
or an invoice was voided by the database; otherwise it puts back the seventeen
earlier bodies byte for byte, drops the added functions, the four columns, the
foreign key and its index and the void trigger, and restores the earlier slots
and void rules.

`node --import tsx scripts/test-foundation-package-add-slots.mjs` (part of
`pnpm db:foundation:lifecycle-test`) proves on the throwaway database: the
preflight before and after; drifted bodies and a premature rollback refused,
changing nothing; apply, rollback and re-apply return the same fingerprints; the
grants; nothing added while off sale; the offer; the online rules, repeat,
replacement and delivery (one grant ending with the package, the new posts
allowance, the partner commission); the 30-minute price hold and the 7-day rule
at Ozow; invoices only from 10 days; an add paid after its package ended goes to
reconciliation and cannot be activated; an invoice add asked, repeated, queued,
issued at the price asked for and paid by a confirmed bank transfer or Pay now;
late money refused, the ended package's invoice blocking no new package and
voided by the sweep; an invoice issued later for the fewer days left, due by the
package's end, and none issued with fewer than 10 days; a new-package request,
read and checkout never taking an add's, and an order or Pay now attempt it
closed while open at Ozow still checked and, paid late, sent to reconciliation;
the 245 and 250-slot limits; the privacy export; a refunded add keeps the posts
that fit (the most recently approved first) and ends only the others; two adds
paid at once near 250 (one delivered, one to reconciliation); a refund while an
activation holds the package refused at once and going through after; and the
rollback refused once slots were added.

## Sign-up mode in the database, and member invitations, 20 November 2026

`20261120040242_signup_mode_member_invitations.sql` was applied on 20 November
2026 at 07:15 UTC (see the applied register). **Order: apply-first** (the
default): the website release from the same pull request names
`api.get_signup_mode` and `api.check_email_domain`, and the deploy preflight
probes every command in `../runtime-api-manifest.json`, so a deploy before the
update is applied stops there. The sign-up limiter's new action
`auth:register:network` needs no step of its own: the rate limiter Worker
(`workers/rate-limiter.ts`) is deployed by the same production Deploy workflow,
right after the website; until it is, the old Worker gives that action its
default limit (30 a minute) and answers normally. The update refuses (55000)
unless its 21 objects are all absent or all present and the four functions it
replaces (`internal.acceptance_signup_guard`, `internal.run_retention`,
`internal.claim_owner_admin_invitation`, `internal.erase_closed_account`) have
their reviewed bodies (or this update's).

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
  access; updates, deletes and truncation are refused. It has no retention
  period: it is the record of who opened or closed sign-up. Its account key is
  `ON DELETE RESTRICT`, like the staff role rows of the same administrators, so
  account erasure keeps that administrator's Auth user (erasure already keeps
  staff accounts).
- **Reading the mode.** `api.get_signup_mode()` (anon and authenticated):
  `{"mode"}` only. The website words its uniform registration reply from it.
- **Member invitations, apart from administrator invitations.** New table
  `private.member_invitations` (address, who invited it or none for the owner's
  SQL editor, when, expiry 30 days later, the account that used it and when,
  revocation). A member invitation admits ONE sign-up in either mode and never
  grants a staff role; only `private.owner_admin_invitations` (owner only) makes
  an administrator. Staff commands (authenticated, capability `member:invite`,
  admin role only, the 12-hour authenticator rule): `api.invite_member(p_email)`
  (adds, or renews for 30 days, which makes a used invitation usable again;
  22023 `member_invitation_email_invalid`; PT409
  `member_invitation_account_exists` ("This person already has an account.") for
  an address that already has an account (owner decision, 20 November); 54000
  `member_invitation_limit` over 200 invitations and renewals per staff member
  in 24 hours), `api.revoke_member_invitation(p_email)` (idempotent) and
  `api.list_member_invitations()` (latest 500: address, dates, status `open`,
  `used`, `expired` or `revoked`, and whether the account that used it still
  exists; never who invited). Until a staff screen exists, the owner can also
  invite in the SQL editor:
  `insert into private.member_invitations(email) values ('person@example.com');`.
- **Invitation history.** New append-only table
  `private.member_invitation_events`: one row per invitation, renewal or
  revocation made with the commands (address, action, staff account, time). No
  API role has access. The daily limit counts these rows, so renewing someone
  else's invitation never moves anyone's count. Kept 12 months (the retention
  job), and deleted with the person's invitation when their account is erased.
- **One sign-up per invitation.** New trigger `claim_signup_invitations` on
  `auth.users` (after insert): the new account marks the matching open member
  invitation used (`claimed_by`, `claimed_at`) and the matching administrator
  invitation signed up (new columns `signed_up_by`, `signed_up_at` on
  `private.owner_admin_invitations`, filled when the update is applied for
  invitations already claimed, from their claim, and for invitations whose
  address already has an account). The hook admits neither again, so changing
  the account's email or erasing it does not let the same address sign up a
  second time. An administrator invitation still becomes an administrator role
  when the account enrols an authenticator app
  (`internal.claim_owner_admin_invitation`, unchanged except that an invitation
  already signed up is claimed only by the account that signed up with it).
- **The sign-up hook** (`internal.acceptance_signup_guard`, same invoker rights
  and the same "Registration is not open yet" refusal) admits an unrevoked
  administrator invitation not yet signed up, or an unrevoked, unused, unexpired
  member invitation, in either mode. Otherwise `invite_only` refuses as before,
  and `open` admits everyone except an address the domain rule
  `internal.signup_email_domain_refused` refuses: a malformed, numeric or
  address-literal domain, a reserved name (test, example, invalid, localhost,
  local, internal, onion, arpa, lan, home, corp, intranet),
  example.com/.net/.org, or (under) a domain in the new table
  `private.signup_blocked_domains` (seeded with 15 well-known disposable-address
  services; the owner adds rows in the SQL editor). Those get "Registration is
  not available for this email address" (403); the website still gives its one
  uniform reply, and a Google sign-up gets a plain login-page message. The hook
  may read only the mode, the invitation address, expiry, use and revocation,
  the administrator invitation's sign-up time and the blocked domain (column
  grants and `supabase_auth_admin` select policies).
- **Email change.** `api.check_email_domain(p_email)` (authenticated):
  `{"allowed"}`, false only while sign-up is open and the domain rule refuses
  the address. The website's email change refuses such an address.
- **Retention and erasure.** `internal.run_retention` also runs
  `internal.purge_member_invitations` (`"member_invitations"`: invitations
  deleted 30 days after they expired or were revoked; history older than 12
  months). `internal.erase_closed_account` also deletes the person's member
  invitations (the one they used and any for their address) and that history.

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
once a mode change is recorded; member invitations and their history are lost).
Behaviour test `scripts/test-foundation-signup-mode.mjs`.

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
premature rollback; a changed audit trail view refused; apply, rollback and
re-apply return the same fingerprints; the one rule before the sweep (no confirm
or decline, also through the guard; the staff lists, the member read, Pay now,
voiding and the erasure hold follow it); 13 days 23 hours 59 minutes still
waits; the sweep marks 14 days or more, reruns change nothing, the limit holds
and a row that cannot be changed does not stop the others; the record guard;
recording the money again, once, also when it cleared more than 90 days ago
(only the exact credit of an expired transfer); the invoice takes a new transfer
and shows the expiry only to its member; old money for another account or
invoice is refused; the duplicate count flags expired records of the same money;
staff resolve an expired transfer once, audited; staff see each expired transfer
until it is followed up; the audit trail; the privacy export; the grants; and
the rollback refusal. `scripts/test-foundation-access-matrix.mjs` gives another
member an invoice whose transfer expired, and checks that only the service role
runs the sweep and only that member reads the expiry.

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
- `20261120040242_signup_mode_member_invitations.sql`: applied 2026-11-20 07:15
  UTC; owner-approved, apply-first, Supabase SQL editor (browser, the owner's
  signed-in session), preflight + fingerprint checked; update sha256 starting
  98491eb2 (pull request #304); preflight (sha256 starting a53666a8) after
  "signup mode and member invitations: already applied; mode: invite_only; mode
  changes recorded: 0; member invitations open: 0; blocked domains: 15;
  administrator invitations not yet used: 0"; production fingerprint after it
  (fingerprint.sql at cd725fb9) matched the full replay (except the known schema
  grant difference)
- `20261120045404_package_add_slots.sql`: applied 2026-11-20 10:45 UTC;
  owner-approved, apply-first, Supabase SQL editor (browser, the owner's
  signed-in session), preflight + fingerprint checked; update, preflight and
  fingerprint.sql loaded from the reviewed files at 710fc91b (raw GitHub; pull
  request #306) and checked in the browser before running; update sha256
  starting 811b772f; preflight (sha256 starting 1afe4a19) before "package add
  slots: update not applied; on sale: no; packages running: 0; package invoice
  requests: 0; added-slots requests: none (column absent); added-slots payments:
  0; invoices voided by the database: 0", after "package add slots: already
  applied; on sale: no; packages running: 0; package invoice requests: 0;
  added-slots requests: 0; added-slots payments: 0; invoices voided by the
  database: 0"; production fingerprint after it (fingerprint.sql at cd725fb9)
  matched the full replay (except the known schema grant difference)

- `20261120074411_sms_daily_limit.sql`: applied 2026-11-20 12:26 UTC;
  owner-approved, apply-first, Supabase SQL editor (the owner's signed-in
  session), preflight + fingerprint checked; update and preflight from the
  reviewed files at 1cc61068 (pull request #311) and checked in the page before
  running; update sha256 starting 6087d33a; preflight (sha256 starting e9551d55)
  before "sms daily limit: update not applied; codes today: 0", after "sms daily
  limit: already applied; codes today: 0; counted today: 0; limit: 500";
  production fingerprint after it (fingerprint.sql at cd725fb9) matched the full
  replay (except the known schema grant difference)

- `20261120131212_camera_capture_handoff.sql`: applied 2026-11-21 01:58 UTC;
  owner-approved, apply-first, Supabase SQL editor (the owner's signed-in
  session), preflight + fingerprint checked; update and preflight from the
  reviewed files at 767b7172 (pull request #317) and checked in the page before
  running; update sha256 starting c3102864; preflight (sha256 starting 69783a55)
  before "update not applied; selfies said to be uploaded files: 0", after
  "already applied; selfies said to be uploaded files: 0; phone links: 0";
  production fingerprint after it (fingerprint.sql at cd725fb9) matched the full
  replay (except the known schema grant difference)

- `20261120163500_staff_operations_health.sql`: applied 2026-11-21 04:53 UTC;
  owner-approved, apply-first, Supabase SQL editor (the owner's signed-in
  session), preflight + fingerprint checked; update and preflight from the
  reviewed files at a04ace88 (pull request #319) and checked in the page before
  running; update sha256 starting d75e3442; preflight (sha256 starting 37ac91bd)
  before "staff operations health: update not applied", after "staff operations
  health: already applied; jobs with a recorded run: 0 of 17"; production
  fingerprint after it (fingerprint.sql at cd725fb9) matched the full replay
  (except the known schema grant difference)

- `20261121043124_identity_record_disclosure.sql`: applied 2026-11-21 08:55 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #328); update
  sha256 starting a720f7d0; preflight sha256 starting 55a780b8; production
  fingerprint after it (fingerprint.sql) matched the full replay (except the
  known schema grant difference)

- `20261121053224_privacy_export_simple.sql`: applied 2026-11-21 17:15 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #331); update
  and preflight from the reviewed files at 6824f7ae and checked in the page
  before running; update sha256 starting e26d63d2; preflight (sha256 starting
  0e2c7bf3) before "privacy export simple: update not applied; exports recorded:
  0", after "privacy export simple: already applied; exports recorded: 0";
  production fingerprint after it (fingerprint.sql) matched the full replay
  (except the known schema grant difference)

- `20261121090305_staff_sales_and_vat.sql`: applied 2026-11-21 17:30 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #333); update
  and preflight from the reviewed files at 9ea47fcd and checked in the page
  before running; update sha256 starting 136e84ca; preflight (sha256 starting
  69b7a139) before "staff sales and VAT: update not applied", after "staff sales
  and VAT: already applied; VAT setting: not_registered"; production fingerprint
  after it (fingerprint.sql) matched the full replay (except the known schema
  grant difference)

- `20261121094003_automatic_identity_checks.sql`: applied 2026-11-21 17:32 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #335); update
  and preflight from the reviewed files at dd710894 and checked in the page
  before running; update sha256 starting a18f7793; preflight (sha256 starting
  6871c179) before: update not applied (no drift, none of the update's objects,
  the reviewed check in place; admins: 2), after: already applied (mode: manual;
  checks: 0); production fingerprint after it (fingerprint.sql) matched the full
  replay (except the known schema grant difference)

- `20261121100028_post_performance_stats.sql`: applied 2026-11-21 17:33 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #336); update
  and preflight from the reviewed files at 669f4ae3 and checked in the page
  before running; update sha256 starting bbcf0ccb; preflight (sha256 starting
  742c3ba5) before: update not applied (the 3 replaced bodies as before, none of
  the update's objects), after: already applied (the 3 bodies as updated, 7 of 7
  objects; activity days: 0; engaged views: 0); production fingerprint after it
  (fingerprint.sql) matched the full replay (except the known schema grant
  difference)

- `20261121131915_business_storefront.sql`: applied 2026-11-21 17:34 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #340); update
  and preflight from the reviewed files at 1bb40c65 and checked in the page
  before running; update sha256 starting ceebb2aa; preflight (sha256 starting
  5129e999) before: update not applied (search_posts at its reviewed body, the 4
  new functions absent), after: already applied (the 5 bodies as updated);
  production fingerprint after it (fingerprint.sql) matched the full replay
  (except the known schema grant difference)

- `20261121143000_one_person_admin_mode.sql`: applied 2026-11-22 06:40 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #343); update
  sha256 starting 3cceed8f; preflight (sha256 starting 7074a32b) before: update
  not applied (ID-verified staff 1, no problems), after: already applied (11 of
  11 bodies as updated, both new columns present; self-granted slot events: 0;
  self-approved decisions: 0); production fingerprint after it (fingerprint.sql)
  matched the full replay (except the known schema grant difference)

- `20261121150309_copy_a_post.sql`: applied 2026-11-22 11:40 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #341); update
  sha256 starting 1acd618f; preflight (sha256 starting 73f33a34) before: update
  not applied (draft posts: 0, no problems), after: already applied (11 of 11
  parts as updated; copies: 0); production fingerprint after it
  (fingerprint.sql) matched the full replay (except the known schema grant
  difference)

- `20261122013616_authority_request_types.sql`: applied 2026-11-22 13:00 UTC;
  owner-approved, apply-first, Supabase SQL editor (pull request #346); update
  sha256 starting 3528b0f5; preflight (sha256 starting 10c3307f) before: update
  not applied (4 of 4 bodies reviewed, new objects 0 of 6, disclosures 0, no
  problems), after: already applied (4 of 4 bodies updated, 6 of 6 new objects,
  disclosures 0); production fingerprint after it (fingerprint.sql) matched the
  full replay (except the known schema grant difference)

- `20261122022323_identity_keep_for.sql`: applied 2026-11-22 15:44 UTC;
  owner-approved, apply-first (pull request #347); update sha256 starting
  cc0a7d59; preflight after: already applied; applied in one sitting with
  `20261122023000_fair_showroom.sql` a minute later and no production
  fingerprint captured between the two, so it is checked by the capture after
  that update (the full replay through both matched, except the known schema
  grant difference)

- `20261122023000_fair_showroom.sql`: applied 2026-11-22 15:45 UTC;
  owner-approved, apply-first (pull request #344); update sha256 starting
  0c6ae7a6; preflight after: already applied; production fingerprint after it
  and `20261122022323_identity_keep_for.sql` (fingerprint.sql) matched the full
  replay (except the known schema grant difference)

- `20261122111209_term_ending_notice.sql`: applied 2026-11-22 17:33 UTC;
  owner-approved, apply-first (pull request #349); update sha256 starting
  ec2ffdb0; preflight after: already applied; applied in one sitting with
  `20261122130744_free_credits.sql` two minutes later and no production
  fingerprint captured between the two, so it is checked by the capture after
  that update (the full replay through both matched, except the known schema
  grant difference)

- `20261122130744_free_credits.sql`: applied 2026-11-22 17:35 UTC;
  owner-approved, apply-first (pull request #352); update sha256 starting
  2cbdd9ab; preflight after: already applied; production fingerprint after it
  and `20261122111209_term_ending_notice.sql` (fingerprint.sql) matched the full
  replay (except the known schema grant difference)

- `20261122182304_free_credit_reminder.sql`: applied 2026-11-23 22:00 UTC;
  owner-approved, apply-first (pull request #355); update sha256 starting
  479d18bf; preflight after: already applied; production fingerprint after it
  (fingerprint.sql) matched the full replay (except the known schema grant
  difference)

- `20261122191646_post_templates.sql`: applied 2026-11-24 23:05 UTC;
  owner-approved, website-first in practice: applied after the merge of pull
  request #342 (90a5855a) and before its deploy succeeded, because the deploy
  gate requires the four new API commands; update sha256 starting 336bf554;
  preflight after: already applied; production fingerprint after it
  (fingerprint.sql) matched the full replay (except the known schema grant
  difference)

- `20261123225900_posting_terms_v6.sql`: applied 2026-11-25 01:22 UTC;
  owner-approved, website-first (after the website release of pull request #356,
  merged as aeb6c641); update sha256 starting febe65c5; preflight after: current
  posting-v6 (update already applied), posting-v6 published, 0 acceptances;
  production fingerprint after it (fingerprint.sql) matched the full replay
  (except the known schema grant difference)

- `20261124235920_identity_check_consent.sql`: applied 2026-11-25 08:02 UTC;
  owner-approved, website-first (after the website release of pull request #361,
  merged as 5fb18f09); Supabase SQL editor (browser), file from raw GitHub at
  5fb18f09, update sha256 starting 99e9c7120814ffa0; preflight before "update
  not applied; mode: manual; checks: 0; started: 0" with no problem rows, after
  "already applied; mode: manual; checks: 0; started: 0; with consent: 0";
  production fingerprint after it (fingerprint.sql) matched the full replay
  (except the known schema grant difference)

- `20261125044115_retire_paid_addons.sql`: applied 2026-11-25 10:17 UTC;
  apply-first, owner-approved, before pull request #364 was merged; Supabase SQL
  editor (browser), file from raw GitHub at 435c0be4, update sha256 starting
  a78b758dbfeae58b; preflight before "update not applied; add-on versions on
  sale: 3; add-on payments: pending 0, complete 0, refunded or charged back 0,
  other 0; add-on windows running: 0" with no problem rows, after "already
  applied" with add-on versions on sale 0 and the same counts; production
  fingerprint after it (fingerprint.sql) matched the full replay (except the
  known schema grant difference)

- `20261125113433_add_lost_days.sql`: applied 2026-11-25 13:05 UTC; apply-first,
  owner-approved, before pull request #363 was merged; Supabase SQL editor
  (browser), file from raw GitHub at bef94898, update sha256 starting
  61dcf8481a3fffeb; preflight before "update not applied; running paid grants:
  0" with no problem rows, after "already applied; running paid grants: 0;
  additions: 0"; production fingerprint after it (fingerprint.sql) matched the
  full replay (except the known schema grant difference)

- `20261125131322_lost_email_alert_staff_deadlines.sql`: applied 2026-11-25
  14:30 UTC; apply-first, owner-approved, before pull request #368 was merged;
  Supabase SQL editor (browser), file from raw GitHub at da285b2b, update sha256
  starting f7c6c764eb0b7705; preflight before "update not applied; lost emails:
  0; open privacy requests: 0; open appeals: 0; open reports: 0; staff emails
  queued: 0" with no problem rows, after "already applied" with the same counts;
  production fingerprint after it (fingerprint.sql) matched the full replay
  (except the known schema grant difference)

- `20261125133916_staff_part_refunds.sql`: applied 2026-11-25 16:28 UTC;
  apply-first, owner-approved, before pull request #369 was merged; Supabase SQL
  editor (browser), file from raw GitHub at d1d6661c, update sha256 starting
  505c3dfdc564d844; preflight before "update not applied; waiting for approval:
  0; through Ozow not sent: 0; part refunds: 0" with no problem rows, after
  "already applied" with the same counts; production fingerprint after it
  (fingerprint.sql) matched the full replay (except the known schema grant
  difference)

- `20261125150215_small_lifecycle_rules.sql`: applied 2026-11-25 18:21 UTC;
  apply-first, owner-approved, before pull request #374 was merged; Supabase SQL
  editor (browser), file from raw GitHub at d84c80ed, update sha256 starting
  bb5c43b2d640764d; preflight before "update not applied; events starting over
  365 days ahead: 0; stickers ending within 30 days: 0; posts with an open
  report: 0; reminders queued: 0" with no problem rows, after "already applied"
  with the same counts; production fingerprint after it (fingerprint.sql)
  matched the full replay (except the known schema grant difference)

- `20261125150338_admin_removal_needs_approval.sql`: applied 2026-11-25 19:45
  UTC; apply-first, owner-approved, before pull request #373 was merged;
  Supabase SQL editor (browser), file from raw GitHub at 2545b23c, update sha256
  starting f31ca126e7d354fa; preflight before "update not applied; active
  admins: 3; role changes waiting: 0 (admin removals: 0)" with no problem rows,
  after "already applied" with the same counts; production fingerprint after it
  (fingerprint.sql) matched the full replay (except the known schema grant
  difference)

- `20261125161326_change_verified_place.sql`: applied 2026-11-26 02:01 UTC;
  apply-first, owner-approved, before pull request #376 was merged; Supabase SQL
  editor (browser), file from raw GitHub at f8578cd7, update sha256 starting
  81a4568c156240c7; preflight before "verified place: update not applied;
  members with a place: 3" with no problem rows, after "verified place: already
  applied; members with a place: 3; place changes: 0"; production fingerprint
  after it (fingerprint.sql) matched the full replay (except the known schema
  grant difference)

- `20261125174942_end_admin_role_before_restriction.sql`: applied 2026-11-26
  03:46 UTC; apply-first, owner-approved, before pull request #377 was merged;
  Supabase SQL editor (browser), file from raw GitHub at 23b0691f, update sha256
  starting 137ee2de7c3a5690; preflight before "end admin role before
  restriction: update not applied; active admins: 3; admins who cannot sign in:
  0; restriction proposals about an admin: 0" with no problem rows, after "end
  admin role before restriction: already applied; active admins: 3; admins who
  cannot sign in: 0; restriction proposals about an admin: 0"; production
  fingerprint after the last of the five stacked updates (fingerprint.sql, 06:02
  UTC) matched the full replay (except the known schema grant difference)

- `20261125194727_part_refund_follow_ups.sql`: applied 2026-11-26 05:32 UTC;
  website-first, owner-approved, after pull request #380 was merged and
  deployed; Supabase SQL editor (browser), file from raw GitHub at 2c97b5dd,
  update sha256 starting 2a54cb18c3c53cfa; preflight before "part refund
  follow-ups: update not applied; part refunds keeping the slot running: 0; of
  them on payments not activated: 0; slots reversed after one: 0" with no
  problem rows, after "part refund follow-ups: already applied; part refunds
  keeping the slot running: 0; of them on payments not activated: 0; slots
  reversed after one: 0"; production fingerprint after the last of the five
  stacked updates (fingerprint.sql, 06:02 UTC) matched the full replay (except
  the known schema grant difference)

- `20261125212548_email_alert_follow_ups.sql`: applied 2026-11-26 05:52 UTC;
  apply-first, owner-approved, before pull request #381 was merged; Supabase SQL
  editor (browser), file from raw GitHub at 65fc00ca, update sha256 starting
  d9df49991cde7a24; preflight before "email alert follow-ups: update not
  applied; lost emails: 0; alerts sent over 400 days ago: 0; staff without an
  authenticator app: 0; staff emails queued today: 0 / 0" with no problem rows,
  after "email alert follow-ups: already applied; lost emails: 0; alerts sent
  over 400 days ago: 0; staff without an authenticator app: 0; staff emails
  queued today: 0 / 0"; production fingerprint after the last of the five
  stacked updates (fingerprint.sql, 06:02 UTC) matched the full replay (except
  the known schema grant difference)

- `20261125213005_release_one_phone_number.sql`: applied 2026-11-26 05:55 UTC;
  apply-first, owner-approved, before pull request #382 was merged; Supabase SQL
  editor (browser), file from raw GitHub at 651b1705, update sha256 starting
  4fb6f3732b33e7e9; preflight before "release one phone number: update not
  applied; numbers blocked: 0; release requests waiting: 0; numbers released: 0"
  with no problem rows, after "release one phone number: already applied;
  numbers blocked: 0; release requests waiting: 0; numbers released: 0";
  production fingerprint after the last of the five stacked updates
  (fingerprint.sql, 06:02 UTC) matched the full replay (except the known schema
  grant difference)

- `20261125225855_lifecycle_rule_follow_ups.sql`: applied 2026-11-26 05:59 UTC;
  apply-first, owner-approved, before pull request #384 was merged; Supabase SQL
  editor (browser), file from raw GitHub at 3c235bed, update sha256 starting
  33493f1e4e7aa735; preflight before "lifecycle rule follow-ups: update not
  applied; posts with an open report: 0 (of which the owner may delete after the
  update: 0); reminders waiting: 0 (of which the owner's ID is not reviewed: 0)"
  with no problem rows, after "lifecycle rule follow-ups: already applied; posts
  with an open report: 0 (of which the owner may delete after the update: 0);
  reminders waiting: 0 (of which the owner's ID is not reviewed: 0)"; production
  fingerprint after the last of the five stacked updates (fingerprint.sql, 06:02
  UTC) matched the full replay (except the known schema grant difference)

- `20261126001811_staff_access_follow_ups.sql`: applied 2026-11-26 16:50 UTC;
  apply-first, owner-approved, before pull request #385 was merged; Supabase SQL
  editor (browser), file from raw GitHub at e8bc1688, update sha256 starting
  d3900178bc952443; preflight before "staff access follow-ups: update not
  applied; active admins: 3; admin invitations waiting: 0 (account already has
  an authenticator app: 0); closed accounts with a staff role: 0" with no
  problem rows, after "staff access follow-ups: already applied; active admins:
  3; admin invitations waiting: 0 (account already has an authenticator app: 0);
  closed accounts with a staff role: 0"; production fingerprint after the last
  of the two stacked updates (fingerprint.sql, 18:33 UTC) matched the full
  replay (except the known schema grant difference)

- `20261126001956_video_length_checked.sql`: applied 2026-11-26 18:31 UTC;
  apply-first, owner-approved, after pull request #385 deployed and before pull
  request #386 was merged; Supabase SQL editor (browser), file from raw GitHub
  at 6703262f, update sha256 starting 921862a35b6ab6da; preflight before "video
  length check: update not applied; videos stored: 1; posts waiting with a
  video: 0 (events: 0)" with no problem rows, after "video length check: already
  applied; videos stored: 1; posts waiting with a video: 0 (events: 0)";
  production fingerprint after the last of the two stacked updates
  (fingerprint.sql, 18:33 UTC) matched the full replay (except the known schema
  grant difference)

- `20261126053631_keep_for_periods.sql`: applied 2026-11-26 20:15 UTC;
  apply-first, owner-approved, before pull request #392 was merged; Supabase SQL
  editor (browser), file from raw GitHub at a06dadd3, update sha256 starting
  c43721a8d16441dc; preflight before "keep-for periods: update not applied;
  contact messages: 0; admin invitations: 0; change logs: 0; appeals and holds:
  0; closed reports: 0; role changes: 0; claim events: 0; slot limits: 0; ID
  return reasons: 0; privacy request proofs: 0" with no problem rows, after
  "keep-for periods: already applied; contact messages: 0; admin invitations: 0;
  change logs: 0; appeals and holds: 0; closed reports: 0; role changes: 0;
  claim events: 0; slot limits: 0; ID return reasons: 0; privacy request proofs:
  0"; production fingerprint after it (fingerprint.sql, 20:18 UTC) matched the
  full replay (except the known schema grant difference)

- `20261126053701_invoice_pay_link.sql`: applied 2026-11-26 20:30 UTC;
  apply-first, owner-approved, before pull request #394 was merged; Supabase SQL
  editor (browser), file from raw GitHub at 1d30293c, update sha256 starting
  cd1e79ba0ef2af6d; preflight before "invoice payment link: update not applied;
  unpaid invoices: 0" with no problem rows, after "invoice payment link: already
  applied; unpaid invoices: 0; invoices with a link: 0; invoice emails: 0";
  production fingerprint after it and 20261126053631_keep_for_periods.sql
  (fingerprint.sql, 20:31 UTC) matched the full replay (except the known schema
  grant difference)

- `20261126062428_catalogue_filters_in_database.sql`: applied 2026-11-26 23:48
  UTC; apply-first; production fingerprint after it (fingerprint.sql, read-only,
  23:5x UTC) matched the full replay (except the known schema grant difference)
- `20261126202833_allowance_says_package_running.sql`: pending; website-first
- `20261127044054_public_presentation_display_fields.sql`: pending; apply-first
- `20261127055550_reveal_business_contacts.sql`: pending; apply-first

<!-- applied-register:end -->
