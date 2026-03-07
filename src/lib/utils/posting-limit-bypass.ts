const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthyEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isPostingLimitBypassEnabled(): boolean {
  return (
    isTruthyEnvValue(process.env.ENABLE_TEST_POSTING_BYPASS) ||
    isTruthyEnvValue(process.env.NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS)
  );
}
