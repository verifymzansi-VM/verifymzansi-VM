import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGACY_BACKEND_SUITES } from "@/test/legacy-backend-suites";

/**
 * The number of unit test files that still run against the retired "source"
 * backend. It may only go down: remove a file from the list (and lower this
 * number) once its code runs on foundation or is deleted. Raising it needs a
 * reviewed reason; new tests run on foundation by default.
 */
const LEGACY_BACKEND_SUITE_LIMIT = 135;

describe("unit tests run on the foundation backend by default", () => {
  it("gives every test file outside the legacy list the foundation backend", () => {
    expect(process.env.NEXT_PUBLIC_DATA_BACKEND).toBe("foundation");
  });

  it("keeps the legacy list from growing", () => {
    expect(
      LEGACY_BACKEND_SUITES.length,
      "The legacy (source backend) unit suite list grew. New tests must run on foundation."
    ).toBeLessThanOrEqual(LEGACY_BACKEND_SUITE_LIMIT);
    expect(
      LEGACY_BACKEND_SUITES.length,
      `The legacy list shrank to ${LEGACY_BACKEND_SUITES.length}: lower LEGACY_BACKEND_SUITE_LIMIT to match.`
    ).toBe(LEGACY_BACKEND_SUITE_LIMIT);
  });

  it("lists only existing test files, sorted and once each", () => {
    expect([...LEGACY_BACKEND_SUITES].sort()).toEqual([...LEGACY_BACKEND_SUITES]);
    expect(new Set(LEGACY_BACKEND_SUITES).size).toBe(LEGACY_BACKEND_SUITES.length);
    for (const file of LEGACY_BACKEND_SUITES) {
      expect(file).toMatch(/^src\/.+\.test\.tsx?$/);
      expect(existsSync(file), `${file} no longer exists; remove it from the list`).toBe(true);
    }
  });
});
