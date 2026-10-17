import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNRELEASED_BASELINE_GUARD,
  assertUnreleasedBaselineGuard,
} from "./lib/foundation-baseline-guard.mjs";

test("reviewed blocking guard accepts LF and CRLF checkouts", () => {
  assertUnreleasedBaselineGuard(UNRELEASED_BASELINE_GUARD);
  assertUnreleasedBaselineGuard(UNRELEASED_BASELINE_GUARD.replaceAll("\n", "\r\n"));
});
test("commenting out the raise fails despite retaining the old substring", () => {
  assert.throws(() =>
    assertUnreleasedBaselineGuard(
      UNRELEASED_BASELINE_GUARD.replace("  raise exception", "  -- raise exception")
    )
  );
});
test("a never-executed conditional raise cannot satisfy the guard", () => {
  assert.throws(() =>
    assertUnreleasedBaselineGuard(
      UNRELEASED_BASELINE_GUARD.replace(
        "  raise exception",
        "  if false then raise exception"
      ).replace(";\nend;", "; end if;\nend;")
    )
  );
});
test("a commented guard and appended DDL fail closed", () => {
  assert.throws(() => assertUnreleasedBaselineGuard(`/*${UNRELEASED_BASELINE_GUARD}*/`));
  assert.throws(() => assertUnreleasedBaselineGuard(UNRELEASED_BASELINE_GUARD + "select 1;\n"));
});
