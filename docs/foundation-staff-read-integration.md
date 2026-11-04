# Foundation staff read integration

The `staff-read-surfaces.sql` module adds `staff_audit_page` and
`staff_decision_page` to the API schema. Their internal implementations derive
the caller through `internal.staff_actor`; the caller cannot supply an actor or
role to gain authority. Audit actor filters select events only. Audit access is
assigned to governors and administrators and requires recent authenticator
verification. Decision reads use the existing sensitive decision-approval
capability.

API wrappers remain security invokers. Internal implementations have a fixed
`pg_catalog` search path. Anonymous and service roles have no execution grant,
and no base-table grants are added. The audit projection includes recorded
moderation, evidence access, queue, organisation, partner, role and decision
events without evidence object keys or raw proposal payloads.

Both readers use bounded keyset pages. Cursor timestamps retain the original
Postgres microseconds. Audit date filters use South African calendar days.
Strict browser/server DTOs reject malformed filters, unexpected fields,
duplicate records, inconsistent finalization markers, and another caller's
decision page. Action hints in a response do not replace the native commands'
live authority, version, independent-reviewer and claim checks. Identity review
continues through the dedicated evidence/identity review protocol.

Native escalation list/detail pages read this metadata with the verified
caller's API client. They distinguish an unavailable read from an empty history
and retain exact cursors across filters. Review links require assigned
case/evidence capabilities; the pages do not provide a generic identity-approval
shortcut.

The staff navigation uses assigned native capabilities rather than expanding a
presentation role through the source role hierarchy. The native evidence desk
requires the reviewer assignment and discards its private viewer when that
assignment changes. Evidence object URLs are revoked on completion, closure and
late responses; a claim remains releasable if context loading fails.

`test:foundation:native` includes the staff-read probe. It uses disposable local
GoTrue accounts and genuine TOTP sessions to verify role boundaries, pagination,
stale verification, role revocation, logout and private-table isolation. These
are local protocol checks, not proof of hosted provider delivery or full release
acceptance. Hosted SQL must be applied and verified before the corresponding UI
is activated. The unreleased clean baseline remains guarded.

## Preserved ID and selfie review

The additive `20261104162910_preserved_identity_review_workflow.sql` update
connects the selected frontend's separate ID and selfie decisions to the native
identity-pair command. A partial approval belongs to one reviewer, submission,
case version and current claim. Both explicit match attestations are required
before native acceptance; high-risk submissions still require an independent
decision. Exact final acknowledgements can be retried only within the original
lease. Rejection and retake requests invalidate older wizard upload receipts.

Private metadata and bytes use protected POSTs. Their responses identify the
reviewer, and the browser checks the current Auth account before displaying
them. Media type and size come from the inspected stream; an opaque evidence
object identifier is never presented as a storage key. Existing comparison,
lightbox and evidence-desk controls pass the viewed submission/version/claim
back to the decision route. Blob caching by artifact alone is disabled for this
backend. The owner dashboard distinguishes accepted identity from completion of
phone and locality verification.

The native posting fixture now exercises these commands with disposable local
GoTrue accounts and TOTP, including rejected resubmission and independent
high-risk approval. HTTP handler and viewer tests separately cover contract
binding, stream presentation and account changes. These synthetic checks do not
attest a real customer's document, hosted SMS delivery, or complete
authenticated browser acceptance. The update was applied to the connected London
project on 4 November; exact API grants, private-table isolation and the
provisioned-runtime preflight were then verified. Deployment remains dependent
on the remaining restored-page integrations.
