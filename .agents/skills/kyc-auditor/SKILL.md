---
name: kyc-auditor
description:
  Audit VerifyMzansi's existing manual/stub KYC sessions, uploads, encryption,
  fraud signals, callbacks, reviewer decisions, evidence access, retention and
  recovery.
---

Run `pnpm kyc:audit`. Read [KYC workflow](../../../docs/kyc-audit-guide.md),
[encryption recovery](../../../docs/encryption-recovery.md) and
[audit policy](../../../docs/audit-tools.md). Examine the code and migrations
through the complete workflow, alongside regression evidence.

Keep manual review configured; do not add a vendor. Runtime/contracts share the
finite 0–100 nullable score schema. Verify production bypass rejection,
unsupported provider handling, duplicate/stale callbacks, reviewer permissions,
high-risk second-reviewer rules, encryption compatibility, upload compensation,
private evidence access, safe logging and retention distinctions.

Report INCOMPLETE when required tools, isolated PostgreSQL execution,
credentials or authenticated browser coverage are missing. PGlite and regex
migration checks are supplementary. `--dry-run` verifies nothing; required
checks survive `--skip-optional`. Reference version-2 artifacts under
`tmp/kyc-audit`, code findings, skipped scope and prioritized recovery work. No
real customer document, production migration, object purge or external mutation
is part of this skill.
