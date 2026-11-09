import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import path from "node:path";
import { DOCUMENTED_SKIPS } from "./skip-policy";

type Skip = { location: string; title: string; project: string; reason: string };

function skipReason(test: TestCase, result: TestResult): string {
  const annotations = [...result.annotations, ...test.annotations];
  const skip = annotations.find((item) => item.type === "skip" || item.type === "fixme");
  return skip?.description?.trim() ?? "";
}

/**
 * Lists every skipped test with its reason and, in CI, fails the run when a
 * test skipped for a reason that is not a documented platform skip
 * (skip-policy.ts). A skip that depends on missing data or credentials must
 * not turn into a green run: such a test gets its data or fails.
 */
export default class SkipGuardReporter implements Reporter {
  /** Last result per test: a retry that passes replaces an earlier skip. */
  private readonly last = new Map<string, { test: TestCase; result: TestResult }>();
  private readonly enforce =
    process.env.PLAYWRIGHT_SKIP_GUARD === "enforce" ||
    (Boolean(process.env.CI) && process.env.PLAYWRIGHT_SKIP_GUARD !== "report");

  printsToStdio() {
    return false;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.last.set(test.id, { test, result });
  }

  private skipped(): Skip[] {
    const skips: Skip[] = [];
    for (const { test, result } of this.last.values()) {
      if (result.status !== "skipped") continue;
      const file = path.relative(process.cwd(), test.location.file).split(path.sep).join("/");
      skips.push({
        location: `${file}:${test.location.line}`,
        title: test.titlePath().slice(3).join(" > "),
        project: test.parent.project()?.name ?? "",
        reason: skipReason(test, result),
      });
    }
    return skips;
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    const documented = new Map<string, number>();
    const unexpected: Skip[] = [];
    const skips = this.skipped();
    for (const skip of skips) {
      if (DOCUMENTED_SKIPS.some((item) => item.reason === skip.reason)) {
        documented.set(skip.reason, (documented.get(skip.reason) ?? 0) + 1);
      } else {
        unexpected.push(skip);
      }
    }

    const lines = [`Skip guard: ${skips.length} skipped test(s).`];
    for (const [reason, count] of [...documented].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${String(count).padStart(3)} documented: ${reason}`);
    }
    for (const skip of unexpected) {
      lines.push(
        `  UNDOCUMENTED skip [${skip.project}] ${skip.location} ${skip.title}: ${skip.reason || "(no reason given, or not run after an earlier failure in its serial group)"}`
      );
    }
    if (unexpected.length > 0) {
      lines.push(
        this.enforce
          ? `Skip guard: ${unexpected.length} skip(s) are not documented platform skips (e2e/support/skip-policy.ts). A test that lacks data must get it or fail; the run fails.`
          : `Skip guard: ${unexpected.length} undocumented skip(s); not enforced in this run (enforced in CI).`
      );
    }
    process.stdout.write(`${lines.join("\n")}\n`);

    if (this.enforce && unexpected.length > 0 && result.status === "passed") {
      return { status: "failed" };
    }
    return undefined;
  }
}
