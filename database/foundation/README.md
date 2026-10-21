# Guarded clean backend candidate

This separate target baseline contains 265 functions and 86 API commands. It
preserves the reviewed domain transactions while excluding six test-only
functions and synthetic category compatibility. Browser roles have no base-table
access. API execution eligibility remains distinct from business authorization.

The single CLI-created migration deliberately raises an exception. The candidate
is not a deployable migration, and this checkout must not be linked to the
current hosted source. Deployment, hosted configuration, complete
application/provider workflows and recovery acceptance remain outstanding.

candidate.sql is assembled from allowlisted prototype SQL modules. assembly.json
records source and candidate hashes. Generated API types, role aliases and role
OpenAPI manifests are checked by builds and contract tests. Canonical LF source
bytes and generator-owned JSON formatting keep these hashes reproducible across
Windows and CI.

Local reproduction creates its own ignored evidence:

1. Run node scripts/prepare-foundation-native.mjs and the owned local startup.
2. Run node --import tsx scripts/test-foundation-native.mjs.
3. Supply that passing results.json path to node
   scripts/build-foundation-baseline.mjs.
4. Run node scripts/replay-foundation-baseline.mjs.
5. Run node scripts/check-foundation-api-contracts.mjs and maintained review
   gates.

If replay changes generated types captured by the native run, repeat steps 2–4
with the refreshed inputs. The final native source hashes and clean replay must
match the same working bytes; an earlier passing record remains historical.

The empty-baseline rehearsal copies the local CLI Auth definitions, ownership,
permissions and component migration ledger, without copying accounts or
sessions. It checks SQL, role surfaces, actual SDK transport and a disposable
GoTrue process: fresh fixture accounts, required confirmation, explicit terms
consent, cookie refresh, forged-signature denial and live-session revocation.
Confirmation uses the local admin fixture; no external messages are sent. Its
path translation and local HS256 keys do not establish hosted ES256 keys,
gateway/provider or callback configuration. Separate native proof exercises the
local CLI gateway. Production performance and successful physical recovery
remain outstanding.

Versioned posting terms are stored as immutable public document snapshots in
src/lib/legal/terms-documents. The baseline seeds their version and canonical
document hash only, with no account acceptance data. Authenticated users must
explicitly accept the current version once; SQL blocks submission without that
acceptance. A new version requires a separately shipped snapshot and renewed
acceptance. Existing version files must never be rewritten after publication.
Keep the explicit FOUNDATION_* application bindings unset until target Auth,
schema, application workflows and release acceptance are ready.

Account profiles hold the display name, bio, avatar and an unreviewed legal-name
claim. Identity registration snapshots that claim; an accepted review locks
exactly those names, and a lock must always match an accepted identity fact.
Profile input can never set verified names, roles, badges, phone or locality.
Person names follow one generated Unicode letter/mark table
(scripts/generate-person-name-rule.mjs) shared by SQL and the app, so both
accept the same names. Account authority also requires a confirmed email. The
first administrator is granted only by the operator-only
internal.bootstrap_first_administrator, once, to a confirmed account that
already has a verified authenticator app.

Detailed security reports and recovery notes are kept outside the public commit.

The request bridge in src/lib/foundation/request-api.ts uses an explicit
foundation connection and a complete request cookie adapter. It treats the
cookie session as a candidate token, verifies that exact token with GoTrue, and
returns only the typed authenticated API RPC surface. SQL remains responsible
for current session, account, MFA and command authority.

Route handlers can use createFoundationRouteContext from
src/lib/foundation/request-route.ts. Construct it once per request, enforce the
route's origin/CSRF and input checks, then await authenticate() before calling a
domain adapter. Return both success and error responses through respond() to
preserve refresh/clear cookies and private browser/CDN cache headers. No client
or context may be shared across requests. These bridges do not switch existing
routes or provision target Auth accounts. A bounded local transport check is
available with node --conditions=react-server --import tsx
scripts/probe-foundation-staff-adapter.mjs --request-session after preparing the
owned native fixture; it never targets hosted projects.
