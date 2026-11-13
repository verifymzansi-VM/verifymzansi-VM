/** @vitest-environment node */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  COMMUNICATION_WORDING_SHA256,
  COMMUNICATION_WORDING_VERSION,
  communicationChoiceUpdateSchema,
} from "./communication-choices";

/** The labels and descriptions of the switches, in page order. */
function pageWording() {
  const source = readFileSync("src/components/dashboard/communication-hub.tsx", "utf8");
  return [...source.matchAll(/label="([^"]+)"\s+description="([^"]+)"/g)].map((m) => [m[1], m[2]]);
}

it("records a new wording version whenever a switch's wording changes", () => {
  const wording = pageWording();
  expect(wording.map(([label]) => label)).toEqual([
    "Marketing email",
    "Marketing SMS",
    "Analytics",
    "Third-party sharing",
  ]);
  const digest = createHash("sha256").update(JSON.stringify(wording)).digest("base64url");
  // When this fails, the page's wording changed: give the choices a new
  // COMMUNICATION_WORDING_VERSION and record this digest beside it.
  expect({ version: COMMUNICATION_WORDING_VERSION, digest }).toEqual({
    version: COMMUNICATION_WORDING_VERSION,
    digest: COMMUNICATION_WORDING_SHA256,
  });
  expect(COMMUNICATION_WORDING_VERSION).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
});

it("accepts only the four choices as booleans, at least one", () => {
  expect(communicationChoiceUpdateSchema.safeParse({ analytics: false }).success).toBe(true);
  for (const input of [
    {},
    { analytics: null },
    { analytics: "false" },
    { data_processing: true },
    { analytics: true, account_id: "x" },
  ])
    expect(communicationChoiceUpdateSchema.safeParse(input).success).toBe(false);
});
