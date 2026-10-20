# Private post contact preferences

Local listing/event contact selection only. Verification evidence is kept in the
private foundation pack; complete forms, reveal policy, providers, retention and
hosted cutover remain separate acceptance work.

An owner can select Call, WhatsApp and the enquiry form. The compatibility input
in_app becomes form. Selections are stored as an ordered set in
private.post_contacts: call, whatsapp, form. No number, email, owner ID or
phone-proof snapshot is copied there. Business contact fields require their own
validation and policy.

Creating a listing/event may include explicit detail.contact_channels. Omission
leaves the selection unset and preserves the existing creation signature,
one-command acknowledgement and initial revision. No channel is chosen on the
owner's behalf. The owner read returns channels:null for unset and [] for a
deliberately cleared draft. Explicit JSON null is not a clear command.

get_owner_post_contacts returns one owned listing/event snapshot with the whole
post revision, lifecycle state, selected channels and a current phone_ready
hint. It returns null for an unavailable, foreign or unsupported-kind resource.
It exposes no raw number, owner identifier or proof identifier. The hint grants
no permission to publish or reveal a contact.

set_post_contacts replaces the selection using the expected whole-post revision.
Draft, rejected and paused states follow the existing editor rules. It locks the
original before an edit copy, rechecks the actual caller after waiting and
increments the post revision once. A live original cannot be overwritten while
its reviewed edit is outstanding.

A selected draft may await phone verification. Submission and approval require
at least one channel. Call or WhatsApp additionally requires the owner's
current, unrevoked canonical phone proof. The internal readiness check derives
the actual owner or staff caller again before any data-dependent refusal,
including after post, quota, media and projection waits. These checks do not
assert that an SMS was actually delivered by the external provider.

An edit starts with the approved selection. Pending or rejected changes do not
replace the original. Approval merges the reviewed selection with the content
atomically and removes the copy. Deletion cascades contact preferences with
their post. A changed selection makes a listing edit a normal content edit;
canonical order or in_app/form equivalence does not turn an otherwise price-only
change into a different contact selection. Phone proof or number changes are
account assurance changes, not post-content edits.

The private table uses RLS with no browser or service table grants. The
read/save API wrappers accept only the current authenticated caller. Internal
canonical selection and readiness helpers have no direct client or service
execute grant. Strict adapters bind resource ID, exact next revision and the
acknowledged canonical selection. Unknown authority/contact fields and
mismatched responses are refused. Uncertain writes are never retried
automatically.

Public detail and search DTOs gain no contact values. Public reveal,
authentication requirements, rate limits, business landline/email validation,
contact history, terms/consent events and physical retention remain unfinished.
Current-state preferences are not an append-only consent or contact-history log.
