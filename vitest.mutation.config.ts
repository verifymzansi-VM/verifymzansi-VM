import baseConfig from "./vitest.config";

/**
 * The tests StrykerJS runs against each mutant in the mutation-testing trial
 * (stryker.config.mjs, `pnpm test:mutation`): only the suites that exercise
 * the mutated modules, so a run takes minutes rather than the whole suite's
 * time. Not used by CI.
 */
const mutationConfig = {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [
      "src/lib/foundation/person-name*.test.ts",
      "src/lib/foundation/limiter-key*.test.ts",
      "src/lib/utils/mutation-origin*.test.ts",
      "src/lib/utils/csrf*.test.ts",
      "src/__tests__/abuse-paths/mutation-route-refusals.test.ts",
    ],
    exclude: [],
    coverage: { enabled: false },
  },
};

export default mutationConfig;
