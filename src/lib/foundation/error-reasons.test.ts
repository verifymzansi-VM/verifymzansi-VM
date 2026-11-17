/** @vitest-environment node */
import { expect, it } from "vitest";
import {
  currentFunctionFiles,
  readDatabaseReasons,
} from "../../../scripts/lib/foundation-error-reasons.mjs";
import {
  STAFF_SECOND_FACTOR_MESSAGES,
  STAFF_SECOND_FACTOR_PATTERN,
  hasDatabaseMessage,
  hasDatabaseReason,
  isStaffSecondFactorRefusal,
  lookupDatabaseReason,
  type FoundationErrorReason,
} from "./error-reasons";

it("the staff second-factor pattern matches exactly the listed database messages", () => {
  const { allMessages } = readDatabaseReasons(currentFunctionFiles(process.cwd()));
  const matched = [...allMessages]
    .filter((message: string) => STAFF_SECOND_FACTOR_PATTERN.test(message))
    .sort();
  expect(matched).toEqual([...STAFF_SECOND_FACTOR_MESSAGES].sort());
});

it("matches listed reasons only, by the details the database sent", () => {
  const error = { code: "PT409", details: "posting_terms_required", message: "x" };
  expect(hasDatabaseReason(error, "posting_terms_required")).toBe(true);
  expect(hasDatabaseReason(error, "posting_terms_changed", "posting_terms_required")).toBe(true);
  expect(hasDatabaseReason(error, "slug_conflict")).toBe(false);
  expect(hasDatabaseReason({ details: "not_a_listed_reason" }, "slug_conflict")).toBe(false);
  expect(hasDatabaseReason(null, "slug_conflict")).toBe(false);
});

it("looks reasons up in a map keyed by listed reasons", () => {
  const map = new Map<FoundationErrorReason, string>([["profile_changed", "changed"]]);
  expect(lookupDatabaseReason(map, { details: "profile_changed" })).toBe("changed");
  expect(lookupDatabaseReason(map, { details: "legal_name_locked" })).toBeUndefined();
  expect(lookupDatabaseReason(map, { details: "constructor" })).toBeUndefined();
  expect(lookupDatabaseReason(map, { details: null })).toBeUndefined();
});

it("recognises listed messages and the staff second-factor refusals", () => {
  expect(
    hasDatabaseMessage({ message: "all posting capacity is in use" }, "postingCapacityInUse")
  ).toBe(true);
  expect(hasDatabaseMessage({ message: "something else" }, "postingCapacityInUse")).toBe(false);
  for (const message of STAFF_SECOND_FACTOR_MESSAGES)
    expect(isStaffSecondFactorRefusal({ message })).toBe(true);
  expect(isStaffSecondFactorRefusal({ message: "staff capability required" })).toBe(false);
  expect(isStaffSecondFactorRefusal(null)).toBe(false);
});
