# Administrator event duplicate flags

Local candidate only. Bounded database and SDK verification is recorded in
evidence/staff-event-duplicate-flags-2026-10-18.json. Full release acceptance,
hosted migration and website cutover remain separate, unfinished work.

An administrator can compare two currently public original events and flag a
suspected duplicate. The flag requests independent review. Creating or resolving
it never hides a post, restricts an account, changes a payment or makes an
automatic duplicate finding.

preview_duplicate_events returns the canonical pair's public core, approved
schedule and current revisions, plus an existing open flag ID where permitted.
flag_duplicate_events accepts the two IDs, each corresponding expected revision
and a reason. It derives actor and both owners in SQL. Both require the explicit
admin capability, actual AAL2/live session/current role and recent TOTP. An
administrator who owns either event cannot create the flag or inspect its
private flag linkage through preview.

Pair commands lock original post IDs in canonical order using FOR NO KEY UPDATE.
They recheck current authority, public eligibility, actual event deadlines and
revisions after waiting. Reversing IDs preserves each revision's association.
One open staff flag is allowed per unordered pair. A retry returns that flag
without replacing the original creator, reason or captured revisions. The
acknowledgement echoes the requested canonical pair. Clients never retry an
uncertain write automatically.

Staff flags reuse private.reports with an explicit staff origin and duplicate
category. They use no IP fingerprint. Public-origin report intake retains its
five original categories, mandatory valid IP HMAC, service-only route and
signed/anonymous deduplication behavior. Separate staff-pair uniqueness permits
A/B and A/C flags to coexist. Reporter identity and IP are not exposed by the
new staff review DTO.

The original statement and origin, creator, pair, revisions and owner snapshots
are immutable. Foreign-key nulling of post/reporter references remains allowed;
plain UUID snapshots preserve provenance and conflict checks after deletion.
This retained metadata remains subject to the unfinished report-retention
policy.

Moderators/governors use the existing leased report claim and resolution
workflow. The creator and both event owners cannot claim, receive reassignment,
read or resolve the case, including after post deletion. Claimed reads lock the
report before its claim, acquire no base-post row locks and recheck actual
authority and the exact current claim before returning. Current event data is
public metadata or null when unavailable; stored IDs/revisions remain visible.
Changed current revisions do not replace the original reported revisions.

Reasons/notes use PostgreSQL character minima and UTF16 maxima; event DTOs use
the existing event UTF16 bounds. The client rejects unknown fields and
mismatched pair, report, claim or outcome responses. This prevents client
validation from changing Unicode semantics or supplying actor/owner authority.

The local proof uses real synthetic Auth/TOTP, API requests and controlled
concurrency. Ready-media metadata is synthetic. It does not prove physical
scanning, provider delivery, report retention, complete administrator UI or the
hosted migration.

The legacy administrator flagging actions are incompatible with this report
contract. Website integration must use these caller-bound adapters and explicit
human review, without routing suspicion to legacy automatic warning, hiding,
suspension or ban actions. Report retention, legal holds/rights handling and
full original foundation gates remain open.
