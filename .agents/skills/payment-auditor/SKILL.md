---
name: payment-auditor
description:
  Audit VerifyMzansi Ozow checkout, paid plans/add-ons, fulfillment, invoices,
  billing UI, cancellation and reconciliation with maintained fixtures and
  gates.
---

Run `pnpm payments:audit`. Read
[Ozow integration](../../../docs/ozow-integration-guide.md) and
[audit policy](../../../docs/audit-tools.md). Use the registry for scope;
examine code from quoted server prices/ownership through checkout, provider
identifiers, signature checks, exact amount/currency/environment matching,
confirmation RPC, entitlements, invoices and billing UI.

Preserve recent Ozow repairs. Full and thin notification fixtures must follow
official schemas. Cover cancelled/duplicate/stale events, recovery, provider
outages, pagination/token expiry and a lost committed RPC response. A mocked
roundtrip is local evidence; it is not genuine provider delivery.

Report INCOMPLETE for missing Docker, provider credentials or unverified signing
secret/delivery. Required checks cannot be removed by `--skip-optional`.
`--dry-run` records no verified controls. `--local-only` keeps remote omissions
visible. Reference redacted version-2 artifacts under
`tmp/payment-security-audit`. Security failures block; no real payment,
deployment, production migration or remote configuration change is authorized by
this audit skill.
