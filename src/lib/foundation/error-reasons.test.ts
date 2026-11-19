/** @vitest-environment node */
import { expect, it } from "vitest";
import {
  currentFunctionFiles,
  readDatabaseReasons,
} from "../../../scripts/lib/foundation-error-reasons.mjs";
import {
  FOUNDATION_ERROR_REASONS,
  FOUNDATION_UPCOMING_ERROR_REASONS,
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

it("matches the reasons of a pending database update like listed ones", () => {
  // A pending reason is never also in the generated list. The refund
  // follow-ups reasons were pending, and match the same way now they are listed.
  for (const reason of Object.keys(FOUNDATION_UPCOMING_ERROR_REASONS))
    expect(Object.hasOwn(FOUNDATION_ERROR_REASONS, reason)).toBe(false);
  expect(Object.hasOwn(FOUNDATION_ERROR_REASONS, "renewal_queued")).toBe(true);
  const error = { code: "PT409", details: "renewal_queued", message: "x" };
  expect(hasDatabaseReason(error, "renewal_queued")).toBe(true);
  expect(hasDatabaseReason(error, "outside_refund_window")).toBe(false);
  const map = new Map<FoundationErrorReason, string>([["outside_refund_window", "too late"]]);
  expect(lookupDatabaseReason(map, { details: "outside_refund_window" })).toBe("too late");
  expect(lookupDatabaseReason(map, { details: "renewal_queued" })).toBeUndefined();
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

it("leaves an owner-run command's refusals about another account's authenticator alone", () => {
  const { allMessages } = readDatabaseReasons(currentFunctionFiles(process.cwd()));
  const houseSlots = [...allMessages].filter((message: string) =>
    message.startsWith("house slots: ")
  );
  expect(houseSlots).toEqual(
    expect.arrayContaining([
      "house slots: the recipient needs a verified authenticator app",
      "house slots: the approver must be an active administrator with a verified authenticator app",
    ])
  );
  for (const message of houseSlots) expect(isStaffSecondFactorRefusal({ message })).toBe(false);
});
