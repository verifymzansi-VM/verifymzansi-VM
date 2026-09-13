type TestEnvironment = Record<string, string | undefined>;

export function assertNoK6TargetOverride(args: string[]): void {
  if (args.some((arg) => /^(?:--env=|-e=?)?BASE_URL(?:=|$)/.test(arg))) {
    throw new Error(
      "Use --base-url to select the k6 target; overriding BASE_URL in passthrough arguments is not allowed."
    );
  }
}

export function resolvePerformanceTestTarget(
  env: TestEnvironment,
  mode: "perf" | "k6",
  explicitUrl?: string
): string {
  const value =
    explicitUrl ??
    (mode === "k6" ? env.K6_BASE_URL || env.PERF_BASE_URL : env.PERF_BASE_URL) ??
    "http://localhost:3000";
  const target = new URL(value);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      "Performance test target must be an http(s) URL without credentials, query or fragment."
    );
  }

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  const productionHosts = ["verifymzansi.com", "www.verifymzansi.com"];
  const configuredAppOrigins = [
    env.NEXT_PUBLIC_APP_URL,
    env.APP_URL,
    env.PRODUCTION_APP_URL,
  ].filter((url): url is string => Boolean(url));
  if (
    !local &&
    (productionHosts.includes(target.hostname) ||
      configuredAppOrigins.some((url) => new URL(url).origin === target.origin))
  ) {
    throw new Error(
      "Refusing performance tests against the production or configured application origin. Use a dedicated test environment."
    );
  }
  return target.href.replace(/\/+$/, "");
}
