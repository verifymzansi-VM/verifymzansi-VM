/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearCommercialSettingsCache,
  DEFAULT_COMMERCIAL_SETTINGS,
  getCommercialSettings,
} from "./settings";
import { defaultFallbackCount } from "@/lib/utils/fallback-events";

function reader(result: { data: unknown; error: { message: string; code?: string } | null }) {
  return {
    from: () => ({ select: async () => result }),
  } as unknown as Parameters<typeof getCommercialSettings>[0];
}

let warnings: string[];
beforeEach(() => {
  clearCommercialSettingsCache();
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
});
afterEach(() => {
  clearCommercialSettingsCache();
  vi.restoreAllMocks();
});

it("logs and counts each fallback to default settings", async () => {
  const before = defaultFallbackCount("commercial_settings");
  const failing = reader({
    data: null,
    error: { message: "relation for staff@example.com does not exist", code: "42P01" },
  });
  expect(await getCommercialSettings(failing)).toEqual(DEFAULT_COMMERCIAL_SETTINGS);
  expect(await getCommercialSettings(failing)).toEqual(DEFAULT_COMMERCIAL_SETTINGS);

  expect(defaultFallbackCount("commercial_settings")).toBe(before + 2);
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain('"event":"fallback_to_default"');
  expect(warnings[0]).toContain('"fallback":"commercial_settings"');
  expect(warnings[0]).toContain('"errorCode":"42P01"');
  expect(warnings[0]).toContain('"usedCachedValue":false');
  expect(warnings[1]).toContain(`"count":${before + 2}`);
  expect(warnings.join("\n")).not.toContain("staff@example.com");
});

it("does not log when the settings read succeeds", async () => {
  await getCommercialSettings(reader({ data: [], error: null }));
  expect(warnings).toHaveLength(0);
});
