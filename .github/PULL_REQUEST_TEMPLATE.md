# Pull Request

## Summary

<!-- What does this PR do? Keep it to 1-3 bullet points. -->

-

## Type of change

<!-- Check the relevant option. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to
      not work as expected)
- [ ] Refactor (no functional change)
- [ ] Docs / config update

## Checklist

- [ ] I have tested this locally
- [ ] New and existing unit tests pass (`pnpm test`)
- [ ] Lint and type checks pass (`pnpm lint && pnpm typecheck`)
- [ ] CI safety gate passes (`safety-gate-snapshot`)
- [ ] Safety blocker artifact reviewed (`latest-ci-review-blockers.txt` reports
      `total_blockers=0`)
- [ ] I have added tests for new functionality (if applicable)
- [ ] No sensitive data (API keys, secrets) included in this PR
- [ ] RLS policies updated if database schema changed
- [ ] POPIA / compliance impact reviewed (if touching KYC, audit logs, or user
      data)

## Test plan

<!-- How can a reviewer verify this works? -->

-

## Safety evidence

<!-- Paste artifact pointers from the CI upload when available. -->

- latest-ci-review-blockers.txt:
- latest.json:

## Screenshots (if UI change)

<!-- Attach before/after screenshots if applicable. -->
