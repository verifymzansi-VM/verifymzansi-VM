# Reviewed updates for an already provisioned foundation

These are separately reviewed SQL update artifacts, not the retired root
`supabase/migrations` tree and not a request to remove the clean baseline guard.
Application status is recorded per update; file presence alone does not
establish that a hosted project has received it.

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

`scripts/test-restored-post-commands.mjs` checks these updates on the isolated
native PostgreSQL fixture, with real local GoTrue owner/reviewer sessions and a
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
