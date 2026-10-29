# Frontend restoration and next integration

## Owner's decision, 27 October 2026

Restore the frontend from Cloudflare Worker version
`6356f78f-e39a-496f-900d-7a1829c59bf6`, remove subsequent frontend additions,
and keep the current backend code. Future work must fit the backend to this
frontend while preserving its design and user flows.

## Exact baseline

- Source commit: `0b562f42f96b5390c62244cb9e97b219da1471f4`.
- Successful deployment:
  [GitHub Actions run 40013014863](https://github.com/verifymzansi-VM/verifymzansi-VM/actions/runs/40013014863).
- Cloudflare version upload: 23 October 2026, 21:44 South African time.
- The deployment run's `headSha` and the local release receipt both identify
  this commit. The Cloudflare version ID alone is not a Git commit.

## Restored scope

All tracked files under `src/components`, `src/hooks`, `src/stores`, `public`,
and any `src/styles`, plus non-API `.tsx`, `.css`, and `.scss` files under
`src/app`, and `tailwind.config.ts`, match the baseline. Later additions in
these areas have been removed, including replacement foundation screens and the
added dashboard security page. Tests belonging exclusively to removed frontend
implementations are removed with them.

The current implementation outside that frontend scope remains from commit
`1bc248cdf020449b79378c29f4e69c58f28d4318`: API routes, the auth callback route,
server libraries and adapters, database definitions and migrations, workers,
dependency versions, deployment configuration, and backend tests. No hosted
database, stored data, secret, Worker version, or traffic allocation was
changed. No push or deployment is part of this restoration.

## Starting the backend integration

The restored frontend originally used the previous backend's contracts. Keeping
the replacement backend code does not reconnect those contracts automatically.
Authentication, profile fields, staff permissions, posting, billing, and data
reads need to be checked against the replacement backend before a release.
Existing foundation-aware server adapters are retained; verify how they interact
with each restored page. Some old pages still call services built for the old
schema. Do not point those calls at a new database and assume compatibility.

1. Inspect the restored page and its original fields, validation, interactions,
   and navigation before implementing its data adapter.
2. Reuse or adapt the retained APIs and backend services to serve that
   interface. Map data in adapters rather than replacing the page or its forms.
3. Verify the existing design at desktop and mobile sizes and test the actual
   user flow against an isolated backend fixture.
4. Obtain the owner's direction before intentional design changes. Do not run
   old database migrations against the replacement project to force a match.
5. Verify complete integration before deploying. The existing production deploy
   workflow can publish main after successful CI; pushing main is a release
   action and was not performed here.

To compare the frontend against its selected source, use:

```powershell
git diff 0b562f42f96b5390c62244cb9e97b219da1471f4 -- src/components src/hooks src/stores public tailwind.config.ts
git diff 0b562f42f96b5390c62244cb9e97b219da1471f4 -- ':(glob)src/app/**/*.tsx' ':(glob)src/app/**/*.css' ':(glob)src/app/**/*.scss'
```

These comparisons should initially have no differences. Backend directories are
deliberately outside this comparison.

## Validation

- Frontend source comparison with the selected commit: no differences.
- Retained API routes, auth callback, server libraries, database files, workers,
  scripts, dependencies, and workflows: unchanged from the pre-restore commit.
- TypeScript: `pnpm typecheck` passed.
- Production build: passed with `NODE_OPTIONS=--max-old-space-size=6144`. The
  first attempt compiled but its separate TypeScript worker exhausted the
  default 2 GB heap. The successful retry used a process-only memory allowance;
  no project configuration was changed for it.
- Focused Vitest checks: 255 tests passed across 23 files, covering restored
  marketplace, advertising, posting, verification, home, authentication,
  dashboard and staff UI, plus retained foundation login/registration APIs and
  staff navigation contracts.
- Recovery ZIP: opened successfully, with 3,312 entries, including frontend
  source and replacement backend APIs.

These are local source, type, and fixture checks. They do not establish that the
restored frontend is integrated with a hosted replacement backend.

During static page generation, the retained environment reported an unavailable
sponsor directory and fell back to the default commercial plan catalogue with
`Invalid schema: public`. These reads need adapters for the replacement backend;
they are not a reason to remove or redesign the original pages. Build warnings
also included the existing middleware deprecation, Edge Runtime dependencies,
PDF package imports, and local OpenNext Durable Object bindings.

## Local development follow-up

The existing Docker app container was stale: it used Next.js 16.3.8 instead of
16.4.1, retained the deleted backend's URL, and lacked its Linux workerd binary.
Its compiler reported existing backend modules as missing. The container is now
stopped. A Docker image rebuild was stopped after its last npm package download
stalled; do not assume that the Docker image or dependency volume was refreshed.

Native Windows `pnpm dev` is running at `http://localhost:3000` with the current
dependencies and backend settings. `.env.local` now sets the local app URL to
that address. The old shared `.next/dev` cache was renamed inside `.next` before
startup. Homepage and login returned HTTP 200 without the missing-module error,
and `/api/health` returned HTTP 200 with `status: ok`.

Docker Compose now isolates `/app/.next` from Windows output. To return to
Docker, first stop the native dev server, then use the rebuild/recreate command
in the README. The anonymous dependency volume also needs renewal to load new
packages. This follow-up did not change the selected frontend or hosted
services.

## Recovery

- Recovery branch: `codex/recovery-before-frontend-restore-20261027`, pointing
  at the complete project before restoration (`1bc248cd`).
- Restoration branch: `codex/restore-6356f78f-frontend`.
- Local tracked-source recovery archive:
  `C:\Users\SENZO\Documents\verifymzansi-recovery\2026-10-27-frontend-restore\project-before-restore.zip`.
- The archive contains tracked source; existing ignored environment files and
  local artifacts were left in place. Neither Git history nor the recovery
  branch was deleted or rewritten.
