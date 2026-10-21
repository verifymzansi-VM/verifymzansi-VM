# Guarded clean backend candidate

This separate target baseline contains 237 functions and 79 API commands. It
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

The empty-baseline rehearsal copies Auth definitions without data and checks
SQL, role surfaces and actual SDK transport with synthetic JWT roles. Separate
native proof exercises real local Auth and gateway behavior. Neither establishes
hosted configuration, production performance or successful physical recovery.

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
