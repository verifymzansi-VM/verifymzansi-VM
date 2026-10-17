# Backend foundation implementation

This is an unreleased backend candidate. It exposes explicit API functions while
keeping domain tables and transaction helpers outside the Data API. The current
website still uses its existing backend; publishing this code does not perform a
cutover or approve real provider intake.

The public folder contains implementation prototypes, local fixture tools, API
contracts and structural schema/source inventories derived from repository code.
The inventories contain no user rows and do not attest security or release
readiness. Detailed security findings, provider/account reports, recovery notes,
validation runs and operational handoffs remain local and are excluded from Git.

Use the installed Supabase CLI and isolated local fixture scripts for
verification. The fixture uses synthetic accounts and metadata. Never link it to
a hosted source project or run destructive fixtures against a shared
environment. Upload bytes, provider integration, complete UI workflows and
recovery require separate proof.

The clean candidate and its generated contracts live in database/foundation. Its
migration deliberately raises an exception until rollout gates are satisfied. Do
not remove that guard to force deployment. See database/foundation/README.md.

The five source inventory JSON files support structural tooling tests only;
their proposal and pending labels must never be interpreted as accepted field
contracts. Local native evidence is generated under evidence/ but is
intentionally ignored.
