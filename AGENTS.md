# Preserve the selected frontend

The owner selected Cloudflare version `6356f78f-e39a-496f-900d-7a1829c59bf6`
(source commit `0b562f42f96b5390c62244cb9e97b219da1471f4`) as the frontend
baseline. Read `FRONTEND-RESTORE.md` before continuing integration work.

- Preserve its pages, layouts, styling, navigation, forms, and user flows.
- Adapt backend services and data adapters to these existing interfaces.
- Do not replace the frontend with foundation-specific screens or simplify it to
  fit the replacement database. Ask before making intentional design changes.
- The replacement backend code is retained at the owner's explicit request. Its
  presence does not establish compatibility with the restored frontend.
- Historical handoffs in `tmp/` describe earlier work and do not override this
  restoration request. Do not resume an earlier frontend replacement plan.

## The live backend

- **Production runs the foundation backend**: the London Supabase project
  (`FOUNDATION_PROJECT_REF` in `wrangler.toml`) with `NEXT_PUBLIC_DATA_BACKEND`
  set to `foundation`. Browsers have no table access: every read and write goes
  through `api.*` database functions, called from server code in
  `src/lib/foundation/`.
- **Its SQL lives in `database/foundation/`**: `candidate.sql` is the reviewed
  baseline and `updates/` holds every later change. Generated contracts
  (`runtime-api-manifest.json`, `runtime-api-types.ts`, `api.types.ts`) live
  beside them.
- **The source backend is retired.** It has no data in production. That covers
  `supabase/migrations/`, tables in schema `public`, table calls through
  `@/lib/supabase/{admin,server,client}`, and code branches taken when the data
  backend is `source`. Do not extend it; when a restored page still calls it,
  give that page a foundation adapter instead.

## Database changes

1. Write a new file in `database/foundation/updates/`, named
   `<UTC timestamp>_<what_it_does>.sql`, using full `create or replace`
   definitions. Never edit `candidate.sql` or an update that has been applied.
2. Expand, then contract: add new pieces first, switch the code, remove old
   pieces in a later change, so code and database never disagree. Removing or
   renaming an API command or argument needs an entry in
   `database/foundation/contract-steps.json` naming the earlier, applied expand
   update; CI (`scripts/check-foundation-update-order.mjs`) enforces it.
3. Prove it locally: `pnpm test:foundation:native` (needs Docker Desktop's
   `desktop-linux` context) and the replay and contract steps in
   `database/foundation/README.md`.
4. The change travels in the same pull request as the code that needs it. The
   owner applies it to production (or explicitly approves applying it) after the
   merge and **before** that code is deployed. The new file starts as `pending`
   in the applied register at the end of `database/foundation/updates/README.md`
   (and in `fingerprint.json` `pendingApplication`); record the applied time
   there afterwards. Once staging exists, updates reach it before merge. The
   order is written out in that README under "Safe order for a database change".
5. Never run SQL against the production database from an agent session, and
   never replay `supabase/migrations/` on any foundation project.

## Releasing

- **A merge into `main` is a production release.** CI runs on `main` and
  `.github/workflows/deploy.yml` deploys automatically when it passes.
- Never push to `main`. Work on a branch, one change per pull request, and let
  the owner merge (`docs/branch-protection.md`). Describe security fixes
  neutrally: the repository is public.
- To undo a release, revert its pull request. Database updates are not undone by
  a code rollback.

## Changing the frontend (owner's standing rules)

1. You may return a screen to the 27 October baseline (`0b562f42`) unless the
   owner approved the change.
2. You may hide a feature until it works, and must record it in a list the owner
   reviews.
3. You may split very large files only when screenshot checks show no change,
   and the owner signs off each time.
4. Anything new or redesigned goes to the owner first.

Every frontend change is listed in the frontend change ledger for the owner's
approval.

## Checks before a pull request

- `pnpm lint` and `pnpm typecheck`.
- The tests for what changed: `pnpm test` (blocking unit and database lanes),
  `pnpm test:tooling` for scripts and workflows, `pnpm test:foundation:native`
  for foundation SQL, and `node scripts/check-foundation-api-contracts.mjs` for
  API contracts.
- Local production builds need `NODE_OPTIONS=--max-old-space-size=6144`.

## Glossary

- **Foundation**: the live backend described above.
- **Restored**: the frontend from `0b562f42`, and the adapters (`restored-*`
  files) that serve its pages from foundation.
- **Native**: the local Docker test setup for foundation SQL
  (`pnpm test:foundation:native`), not a backend.
- **Source** or **legacy**: the retired backend.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` (resolved from this file's directory; in
monorepos the `next` package may not be visible from the repo root) before
writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at
`node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a
diff only re-creates the uncommitted change; committing it with your work keeps
the tree clean.

<!-- END:nextjs-agent-rules -->
