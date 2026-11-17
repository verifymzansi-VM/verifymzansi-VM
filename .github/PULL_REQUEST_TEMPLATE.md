# Pull Request

Merging into `main` releases to production (`.github/workflows/deploy.yml`
deploys after CI passes on `main`). One roadmap slice per pull request.

## Slice

- Slice ID: <!-- e.g. M0.1 -->
- Findings fixed: <!-- register IDs, e.g. CQ-03 -->
- Depends on: <!-- earlier pull requests or owner actions, or "none" -->

## Summary

<!-- What changes, in plain words. 1-3 bullet points. Describe security fixes neutrally. -->

-

## Evidence

<!-- Commands run and their results; the slice's own pass/fail checks. -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] Relevant tests:
- [ ] Slice pass/fail checks:

## User-visible

- [ ] No visible change
- [ ] Visible change: phone (375 px) and desktop (1280 px) screenshots attached,
      owner approval recorded, and the change is listed in the frontend change
      ledger

## Database

- [ ] No database change
- [ ] New reviewed file in `database/foundation/updates/` (never an edit of
      `candidate.sql`); applied to production only after merge, before the code
      that needs it is deployed

## Rollback

<!-- How to undo this safely, e.g. "revert this pull request". -->

## Checklist

- [ ] No secrets, keys or personal data in code, tests, logs or this description
- [ ] POPIA impact reviewed (if touching identity, personal data or audit logs)
- [ ] Worker size budget headroom checked (if the build grew noticeably)
