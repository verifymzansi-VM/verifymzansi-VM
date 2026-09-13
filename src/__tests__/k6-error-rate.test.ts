// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function runProfile(failingRequests: Set<number>, iterations: number) {
  const source = readFileSync("scripts/load-test.js", "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export const options =", "const options =")
    .replace("export default function ()", "function scenario()");
  let requests = 0;
  const samples: number[] = [];
  runInNewContext(`${source}\nfor (let i = 0; i < ${iterations}; i++) scenario();`, {
    __ENV: { K6_SCENARIOS: "smoke" },
    http: {
      get() {
        requests += 1;
        return { status: failingRequests.has(requests) ? 500 : 200, timings: { duration: 1 } };
      },
    },
    check(response: unknown, checks: Record<string, (response: unknown) => boolean>) {
      return Object.values(checks).every((check) => check(response));
    },
    sleep() {},
    Rate: class {
      add(sample: boolean | number) {
        samples.push(Number(sample));
      }
    },
    Trend: class {
      add() {}
    },
  });
  return {
    requests,
    samples,
    rate: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
  };
}

describe("k6 request failure rate", () => {
  it("records successful requests and reports zero failures", () => {
    const result = runProfile(new Set(), 2);
    expect(result.requests).toBe(10);
    expect(result.samples).toEqual(Array(10).fill(0));
    expect(result.rate).toBe(0);
  });

  it("reports one failure in 100 requests as 1%, below the 5% budget", () => {
    const result = runProfile(new Set([1]), 20);
    expect(result.requests).toBe(100);
    expect(result.samples).toHaveLength(100);
    expect(result.rate).toBe(0.01);
  });

  it.each([1, 2, 3, 4, 5])("counts failure of request group %i", (request) => {
    expect(runProfile(new Set([request]), 1).rate).toBe(0.2);
  });
});
