# Owner listing and business/event metadata contracts

Status: local implementation; current verification is recorded in the active
continuation. This contract does not approve target deployment or real intake.

`api.get_owner_listing_editor(p_post_id uuid)` returns one owner-bound listing
snapshot or normal null for an absent/foreign/non-listing resource. The internal
function derives the actual caller from verified request context, checks the
current account and live session, reads all fields in one SELECT, then rechecks
the caller before returning. An invalid/revoked caller receives an error even
when the resource result would be null.

Only authenticated callers can execute it. Anonymous and service credentials
have no execution grant. No base-table or private-schema API access is added.
The API wrapper is invoker; the internal definer has a fixed pg_catalog search
path and explicit PUBLIC revocation. SQL role grants do not replace ownership
checks.

The closed response contains listing identity/category, lifecycle status, exact
revision, optional edit-copy parent, nullable title/description/public locality,
explicit advertising price terms, stored attribute version/attributes, and
linked owned media metadata. It omits owner IDs, contact/evidence data, object
keys, digests, bytes, provider identifiers and cleanup/claim credentials. Media
bytes and preview resolution require their own reviewed contract.

The listing DTO validates kind/area, supported category, incomplete price terms,
attribute version and partial category rules, media kind/purpose/dimensions,
unique slots and references. A valid read gives no mutation permission: price
terms currently require draft; content/attributes/media have separate SQL
guards. Read-only inspection of live, pending, rejected or paused posts must not
bypass those guards. A terminal revision can be read but cannot be used for a
write.

`createFoundationListingDraft` makes exactly one creation call and validates its
single draft/revision1/category acknowledgement. Editor loading is a separate
operation. A failed/malformed response can follow a committed creation, so
callers must not silently repeat creation.

`saveFoundationPostContent` sends an explicit sparse patch. Omitted properties
stay unchanged; null clears them. Empty/undefined-only patches and authority
metadata are rejected. Kind selects client text limits only; the database
derives the actual kind/owner/state. Text uses SQL-compatible
trim/hidden-character rules, UTF16 limits and the12KB payload bound. Selecting a
city and a typed locality in one patch is rejected. Each acknowledgement must
match the requested UUID and exact next revision. PT409 requires explicit
reload; no automatic retries occur.

The partial attribute validator uses the existing versioned rules and rejects
unknown, inactive or invalid fields while allowing missing required fields
during drafting. Complete submission validation still requires every applicable
field. Explicit UTF16 length checks match SQL despite Zod's code-point length
behavior.

Acceptance covers real caller creation/content/read, public approved versus
pending-copy isolation, foreign-kind/owner and anonymous/service denials,
expired sessions, restricted accounts and expiry during a blocked read. Full
form/page, media byte/provider, consent/contact, and general workflow acceptance
remain separate. No current source page is switched to the new backend by this
contract.

Activity-aware identity creation uses one optional final p_activity_key
argument. Existing four-argument calls retain their six-field acknowledgement.
Activity is validated against the database category catalogue and inserted with
the parent row; required categories cannot be created without it. The activity
guard, owner/session checks and draft quota remain in force. Replacement of the
old signature and grants is atomic.

createFoundationPostDraft validates the single returned kind, area, category,
activity and initial revision. readFoundationPostDraft restores only owner draft
identity, with an exact requested UUID and current authority check. Neither is a
complete event/business editor. General form/content, media and submission
integration still require their own acceptance before any source page changes.

## Business and event metadata restore

api.get_owner_business_event_editor(p_post_id uuid) returns a single owner-bound
snapshot for a canonical business or event, or normal null for a foreign,
missing or wrong-kind resource. The fixed-search-path internal definer checks
the current owner/session before and after its one SELECT, including null
results. The invoker wrapper and helper grant execution only to authenticated
users.

The closed DTO contains kind/area/category/activity, lifecycle status, exact
revision/edit-copy identity, nullable core content, linked owned media metadata
and an event window for events. Business windows are null. Event instants are
explicit UTC with millisecond precision; stored timezone aliases are preserved.
Past/archived events remain inspectable. Database category/activity membership
and required-activity rules remain authoritative.

Business text is bounded at100/3000 UTF16 units; event text at120/5000. Media
validation shares the listing contract, permits reuse across purposes and
rejects duplicate slots/references and object-key fields. The SQL child query
selects at most101 references; DTOs reject more than100 rather than silently
restoring a partial editor.

This operation restores core metadata. Full legacy business/event fields,
contact/consent, media byte resolution and complete form/submission workflows
remain separate acceptance work. Stored live/pending fixtures in the read tests
demonstrate snapshot isolation. Context mutation and core event publication are
exercised separately by the context workflow fixture described below.

## Business/event context updates

save_business_event_context accepts a post UUID, exact expected revision and a
nonempty sparse patch containing activity_key and/or event_window. Omitted
fields stay unchanged. Explicit null clears activity only where the stored
category permits it. An event window is always a complete starts_at, ends_at and
timezone object. The database derives ownership, actual kind/category and
editable state, locks the original before its copy, and checks live authority
again after all waits.

The client normalizes explicit instants to UTC milliseconds and preserves
timezone aliases; the database's timezone catalogue is authoritative. Windows
are finite, within UTC years1–9999, ordered and at most90 days. Drafts can
retain past windows. Unknown fields and partial/null windows are rejected. A
successful mutation increments the whole-post revision once, including a
combined patch. The acknowledgement binds the requested UUID and exact next
revision; PT409 requires reload and uncertain writes are never replayed
automatically.

The migration enables this operation and its event approval correction in one
atomic statement. Approval preserves publication time, identity, paid windows
and financial records. An approved event's visibility ends at its reviewed end;
both the captured original deadlines and proposed end must still be current
after media and projection waits. Owner eligibility is also checked again.
Paused originals remain paused, and normal free-event edits retain their
existing two-approval allowance. Complete forms, website integration and
remaining rollout gates are separate acceptance work.

For bounded local reproduction, the staff adapter probe accepts
--negotiable-races to exercise real local Auth and controlled lock waits. The
full native fixture additionally keeps the large browse dataset. These fixtures
use synthetic media metadata and local payment settlement; physical scanning,
provider delivery and complete website workflows require separate verification.

## Approved public event schedule

get_public_post includes event_window with starts_at, ends_at and timezone for
approved public events. Instants are UTC with exact millisecond precision; the
stored timezone label and aliases are preserved. Listings and businesses have an
explicit null window. The shared stored-window validator enforces finite UTC
years1–9999, positive duration up to90days and a closed field set.

Schedule data comes from the eligible original post. Pending/rejected copies
remain private and cannot replace the public schedule before approval. Existing
visibility, pricing, media and permission rules are unchanged. This adds the
backend detail contract; complete website forms and schedule rendering remain
separate work.

## Event admission and duplicate protection

Free events are limited per account to five pending/live originals and ten
retained originals submitted within the rolling 30-day window. Deleting an
original restores a place; edits and corrections retain the same logical
identity. Resubmission uses the original row's latest submitted_at; no
deleted-event usage ledger is kept.

Submission and approval serialize event admission for the owner after the
existing post/media locks. A different pending/live logical event with the same
normalized complete title, description, category, activity, province,
city/locality and exact UTC start/end is rejected with PT409 and constant detail
duplicate_event. Pending edit proposals reserve their proposed tuple only while
their live parent has both future visibility and event-end deadlines. Current
owner or staff authority is checked after waiting and before returning a
duplicate error. Rejected calls leave post, claim, audit and financial records
unchanged. Uncertain writes never retry.

Text normalization uses NFC, database-locale lowercase and collapsed ECMAScript
whitespace. This is not full Unicode case folding. Media and timezone aliases do
not distinguish events. Listed-city and manually typed locality remain distinct
when their stored city IDs differ, even if display labels match. Different
accounts and meaningfully different core data remain allowed. This conservative
comparison is not proof that two posts represent the same real-world event.
Administrator suspicion flags and claimed human review remain separate work; the
guard creates no flags and applies no sanctions automatically.
