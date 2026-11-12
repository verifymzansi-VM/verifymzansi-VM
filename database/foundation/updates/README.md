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
4. **Merge, then apply to production.** The owner applies the update (or
   explicitly approves applying it) after the merge and before the code that
   needs it is deployed. The release preflight compares what production answers
   with what the commit expects and warns "database behind by N" or "database
   ahead by N". Afterwards, one pull request records it, changing together:
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
`scripts/lib/foundation-sql-checks.mjs`), as the browser test copy's checkout
specs do (`e2e/foundation/support/plan-sales.ts`).

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
- `20261112080000_payment_problem_alerts.sql`: pending
- `20261112122001_publish_posting_terms_v4.sql`: pending
- `20261112173841_switch_posting_terms_v4.sql`: pending

<!-- applied-register:end -->
