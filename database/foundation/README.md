# Guarded clean backend candidate

This separate target baseline contains 214 functions and 72 API commands. It
preserves the reviewed domain transactions while excluding six test-only API
commands and synthetic category compatibility. Browser roles have no base-table
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

The empty-baseline rehearsal copies Auth definitions without data and checks
SQL, role surfaces and actual SDK transport with synthetic JWT roles. Separate
native proof exercises real local Auth and gateway behavior. Neither establishes
hosted configuration, production performance or successful physical recovery.

Detailed security reports and recovery notes are kept outside the public commit.
