# Owner listing editor contract

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
