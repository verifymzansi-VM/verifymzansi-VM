module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make initialization order and refactors harder to reason about.",
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
        pathNot: "(^src/test/|/__tests__/|\\.(test|spec)\\.(ts|tsx)$)",
      },
      to: {
        path: "(^src/test/|/__tests__/|\\.(test|spec)\\.(ts|tsx)$)",
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
    includeOnly: "^src",
    exclude: "(^node_modules|^\\.next|^coverage|^tmp|^output|^playwright-report|^test-results|\\.d\\.ts$)",
    doNotFollow: {
      path: "node_modules",
    },
  },
};