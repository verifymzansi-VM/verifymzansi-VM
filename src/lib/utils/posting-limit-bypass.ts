const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthyEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isPostingLimitBypassEnabled(): boolean {
  // Never allow bypass in production — safety guard
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return isTruthyEnvValue(process.env.ENABLE_TEST_POSTING_BYPASS);
}
