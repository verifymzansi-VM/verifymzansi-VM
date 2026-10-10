# Prelaunch security assessment — 10 October 2026

Verdict remains NO-GO for collecting real personal information or payments until
the recorded release gates are resolved. Publishing source to main does not
establish production readiness.

- [Assessment and maintenance plan](assessment.md)
- [Ordered findings](findings.json)
- [ASVS 5.0.0 cumulative Level 1 and 2 coverage](asvs-coverage.json)
- [Local validation receipts](validation-results.json)
- [Production change review plan](production-review-plan.md)
- [Independent professional review brief](independent-review-brief.md)

The assessment records the inspected baseline and security patch commit
880758e3. Source links display current files; use the recorded baseline commit
to inspect the pre-fix implementation. Generated raw test logs and the
unclassified NUL terminal dump remain outside Git.

Main integration retains the existing Docker changes, fixes the Debian runtime
health check to use Node fetch, binds development Compose to loopback, and holds
automatic production deployment. Production deployment remains available only by
explicit manual dispatch after successful CI and the reviewed migration/recovery
prerequisites. No production migration is authorized by publishing this source.

## Main integration validation

[Current publication receipts](main-integration-validation.json): fresh
production-mode build and 24 browser tests passed, 2 duplicate-project scenarios
skipped (see receipt); all required desktop/mobile KYC journeys passed. The
updated Docker image built and ran in a network-isolated synthetic container:
homepage/health 200, anonymous evidence 401; test container removed. Publishable
source and fresh build-artifact secret scans passed. Original development-cache
scan errors remain disclosed.

Format, types, contracts, database invariants, security canaries, Compose and
the manual deployment guard passed. Application source is the previously
validated security commit: 5,323 unit and 5,245 coverage tests passed; native
database/migration/retention checks passed. CI on main will provide a separate
Linux verification record.
