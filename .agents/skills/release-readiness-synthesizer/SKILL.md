---
name: release-readiness-synthesizer
description:
  Assess VerifyMzansi launch readiness using shared release gates, code
  examination and separate local/deployment/provider evidence.
---

Run `pnpm safety:release`. Read [audit policy](../../../docs/audit-tools.md),
[payment guide](../../../docs/ozow-integration-guide.md) and
[KYC guide](../../../docs/kyc-audit-guide.md), and examine the release's code.
Registry commands, required checks and exclusions are the source of truth.

`--skip-optional` omits only advisory checks. Payment/KYC unit and database
lanes, contracts, isolated browser flows and PostgreSQL verification remain
required. `--local-only` records omitted remote requirements; it cannot
establish readiness. `--dry-run` never verifies controls. FAIL or INCOMPLETE
means NO-GO.

Separate local deterministic tests, read-only deployed observations and genuine
provider delivery. Missing Docker, credentials, signing-secret verification,
CodeQL or authenticated browser coverage must be reported precisely. Review
migration/RPC deployment order and operational recovery in the code and guides.

Reference `tmp/safety-gate/latest-release.json`, Markdown, blocker summary and
per-run evidence. State scope, blockers, advisory warnings, quarantines/skips,
verification limitations and a prioritized residual backlog. No deployment,
production migration, payment, document submission or configuration mutation is
part of this skill. Approval of a later rollout requires concrete reviewed work.
