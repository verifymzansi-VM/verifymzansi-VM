# Publication verification contract

This foundation interface remains guarded and local. It has not switched the
live site or configured the hosted target.

A member can prepare private drafts and complete verification without already
being verified. Submission and approval of listings, businesses and events
require the post owner's current canonical identity acceptance, active phone
proof and confirmed locality. Identity acceptance must still match the decided
case and submission version, with available clean, unexpired evidence and an
eligible account. Locality confirmation is self-declared; it is not proof of
physical address.

The database derives the real caller and post owner. It rechecks current
verification and caller authority after relevant waits, including edit merges.
Rejection remains available for correction. A failed publication transaction
rolls back publication state, edit merges, contact selection, search projection,
claims, moderation history and financial changes together.

An authenticated caller can invoke get_owner_verification_readiness with no
arguments. Its exact response is:

- verification_ready: boolean
- phone_verified: boolean
- locality_confirmed: boolean

True verification_ready implies both other booleans are true. Both other
booleans being true does not establish accepted identity. This response is an
observation for the current caller, never permission for a later submit or
approval. It contains no identity fingerprint, identity number, evidence
reference, phone number or selectable account.

The typed adapter rejects unexpected input and response fields and does not
retry. Missing selected contacts and a missing phone proof for Call or WhatsApp
retain their specific errors. The controlled posting_verification_required
refusal maps to a safe verification message; other authorization diagnostics
remain opaque.

Verification terms, consent text/version binding, additional profile
requirements, appeals, retention policy, physical uploads/scanning/SMS delivery,
deployment and restore assurance need their separate acceptance evidence.
