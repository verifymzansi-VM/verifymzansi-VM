---
name: code-review-security-auditor
description:
  Audit VerifyMzansi code and security before merge using the maintained shared
  registry and examined implementation evidence.
---

Run `pnpm safety:review`; CI uses `pnpm safety:ci-review`. Registry partitions
may use `--checks=id,id`; they attest only the selected scope. Read
[the audit guide](../../../docs/audit-tools.md) and
`scripts/lib/check-registry.ts` for commands, dependencies, exclusions and
blocking policy.

Examine changed code and its callers, auth boundaries, error paths,
configuration, migrations and tests alongside automated output. Cite actual
code/test evidence; a green command alone does not attest a control. Security
defects and new quality regressions block. Existing non-security debt requires a
reviewed exact baseline.

Report FAIL, INCOMPLETE, WARN or PASS with precise scope. Required unavailable,
timed-out or skipped checks block; advisory warnings remain visible. Missing
CodeQL, browser quarantines and authenticated skips are coverage limitations.
`--dry-run` is a plan with zero verified controls. Do not treat it as PASS.

Reference version-2 artifacts under `tmp/safety-gate`, including timestamped
logs, `latest-review.json`, `latest-review.md` and `latest-review-blockers.txt`.
Order findings by severity, give regression evidence for fixes and prioritize
residual work. External checks are read-only; no remote mutation is authorized.
