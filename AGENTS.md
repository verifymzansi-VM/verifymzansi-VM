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
