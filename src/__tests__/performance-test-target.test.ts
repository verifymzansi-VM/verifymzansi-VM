import { describe, expect, it } from "vitest";
import {
  assertNoK6TargetOverride,
  resolvePerformanceTestTarget,
} from "../../scripts/performance-test-target";

describe("performance test target isolation", () => {
  it.each([
    ["--env", "BASE_URL=https://example.com"],
    ["--env=BASE_URL=https://example.com"],
    ["-e", "BASE_URL=https://example.com"],
    ["-eBASE_URL=https://example.com"],
  ])("rejects target overrides in k6 passthrough: %j", (...args) => {
    expect(() => assertNoK6TargetOverride(args)).toThrow("Use --base-url");
  });

  it("allows unrelated k6 passthrough options", () => {
    expect(() =>
      assertNoK6TargetOverride(["--quiet", "--env", "K6_SCENARIOS=smoke"])
    ).not.toThrow();
  });

  it.each(["perf", "k6"] as const)("defaults %s to loopback despite application URLs", (mode) => {
    expect(
      resolvePerformanceTestTarget(
        {
          NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
          APP_URL: "https://verifymzansi.com",
          SMOKE_BASE_URL: "https://smoke.example.com",
          STAGING_APP_URL: "https://staging.example.com",
        },
        mode
      )
    ).toBe("http://localhost:3000");
  });

  it("accepts an explicitly selected staging environment", () => {
    expect(
      resolvePerformanceTestTarget(
        {
          PERF_BASE_URL: "https://staging.example.com/",
          NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
        },
        "perf"
      )
    ).toBe("https://staging.example.com");
  });

  it("prefers K6_BASE_URL for k6 and respects a CLI override", () => {
    const env = { K6_BASE_URL: "http://localhost:3100", PERF_BASE_URL: "http://localhost:3200" };
    expect(resolvePerformanceTestTarget(env, "k6")).toBe("http://localhost:3100");
    expect(resolvePerformanceTestTarget(env, "k6", "http://127.0.0.1:3300/")).toBe(
      "http://127.0.0.1:3300"
    );
    expect(resolvePerformanceTestTarget(env, "perf")).toBe("http://localhost:3200");
  });

  it.each(["https://verifymzansi.com", "https://www.verifymzansi.com"])(
    "rejects the known production host %s even without application env",
    (url) =>
      expect(() => resolvePerformanceTestTarget({ PERF_BASE_URL: url }, "perf")).toThrow("Refusing")
  );

  it.each(["NEXT_PUBLIC_APP_URL", "APP_URL", "PRODUCTION_APP_URL"])(
    "rejects the origin identified by %s",
    (key) =>
      expect(() =>
        resolvePerformanceTestTarget(
          {
            [key]: "https://app.example.com/path",
            K6_BASE_URL: "https://app.example.com/another-path",
          },
          "k6"
        )
      ).toThrow("Refusing")
  );

  it("allows the locally running application", () => {
    expect(
      resolvePerformanceTestTarget(
        {
          NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        },
        "perf"
      )
    ).toBe("http://localhost:3000");
  });

  it.each([
    "file:///tmp/test",
    "https://user:password@example.com",
    "https://example.com/?target=prod",
    "https://example.com/#fragment",
    "",
  ])("rejects invalid or ambiguous target %s", (url) =>
    expect(() => resolvePerformanceTestTarget({}, "k6", url)).toThrow()
  );
});
