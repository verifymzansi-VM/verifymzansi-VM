// Frozen list of files that still import the retired Supabase clients
// (roadmap M0.11). It may only shrink: pnpm check:legacy-surface fails when a
// listed file stops importing them until the list is lowered with --update.
const { legacyClientImporters } = require("./scripts/legacy-surface-baseline.json");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const frozenLegacyImporters = `^(?:${legacyClientImporters.map(escapeRegExp).join("|")})$`;

module.exports = {
  forbidden: [
    {
      name: "no-new-legacy-supabase-client",
      severity: "error",
      comment:
        "Production runs the foundation backend. The retired clients @/lib/supabase/{admin,server,client} reach an empty schema there; use the foundation adapters in src/lib/foundation. Only the frozen importers in scripts/legacy-surface-baseline.json may still use them.",
      from: {
        path: "^(?:src|scripts|workers)/",
        pathNot: [
          "(^scripts/test-contract\\.ts$|^src/test/|/__tests__/|\\.(test|spec)\\.(ts|tsx|mjs)$)",
          frozenLegacyImporters,
        ],
      },
      to: {
        path: "^src/lib/supabase/(?:admin|server|client)\\.ts$",
      },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies make initialization order and refactors harder to reason about.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-production-code-to-test",
      severity: "error",
      comment: "Runtime code should not import test utilities, fixtures, or specs.",
      from: {
        pathNot: "(^scripts/test-contract\\.ts$|^src/test/|/__tests__/|\\.(test|spec)\\.(ts|tsx)$)",
      },
      to: {
        path: "(^scripts/test-contract\\.ts$|^src/test/|/__tests__/|\\.(test|spec)\\.(ts|tsx)$)",
      },
    },
    {
      name: "no-lib-to-app-entry",
      severity: "error",
      comment: "Library modules should stay reusable and must not depend on app entry surfaces.",
      from: {
        path: "^src/lib/",
      },
      to: {
        path: "^src/app/",
      },
    },
    {
      name: "no-public-page-to-admin-page",
      severity: "error",
      comment: "Admin page modules should not leak into public or dashboard-facing app surfaces.",
      from: {
        path: "^src/app/(?!admin/|dev/|api/)",
      },
      to: {
        path: "^src/app/admin/",
      },
    },
  ],
  options: {
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    },
    includeOnly: "^(src|scripts|workers)",
    exclude:
      "(^node_modules|^\\.next|^coverage|^tmp|^output|^playwright-report|^test-results|\\.d\\.ts$)",
    doNotFollow: {
      path: "node_modules",
    },
  },
};
