// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// The switches that hid features are on in every build, apart from STILL_OFF below (owner's decision of
// 22 November 2026). Only the pre-launch pop-up differs in the
// launch-configuration test build, whose value next.config.js fixes at build
// time ("0" in every production build; scripts/launch-config-build.test.mjs).
async function loadSwitches(buildValue: string | undefined) {
  vi.resetModules();
  if (buildValue === undefined) vi.stubEnv("VERIFYMZANSI_LAUNCH_CONFIG_BUILD", undefined);
  else vi.stubEnv("VERIFYMZANSI_LAUNCH_CONFIG_BUILD", buildValue);
  const [flag, hidden, pricing, banner] = await Promise.all([
    import("@/lib/launch-config"),
    import("@/lib/hidden-features"),
    import("@/lib/constants/pricing"),
    import("@/lib/prelaunch-banner"),
  ]);
  return { flag, hidden, pricing, banner };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Switches that stay off because what they show is not built (the review of
 * launch checklist item 71): the organisation report (item 46) and package
 * teams (item 15). Every other switch is on. */
const STILL_OFF = new Set(["SHOW_ORGANISATION_REPORT", "SHOW_PACKAGE_TEAMS"]);

describe("launch configuration switches", () => {
  for (const value of [undefined, "0", "", "true", "yes", " 1"])
    it(`keep production values when the build value is ${JSON.stringify(value)}`, async () => {
      const { flag, hidden, pricing, banner } = await loadSwitches(value);
      expect(flag.LAUNCH_CONFIG_BUILD).toBe(false);
      const switches = Object.entries(hidden);
      expect(switches.length).toBeGreaterThanOrEqual(12);
      for (const [name, on] of switches) expect(on, name).toBe(!STILL_OFF.has(name));
      expect(pricing.PACKAGES_ON_SALE).toBe(true);
      expect(banner.PRELAUNCH_BANNER_ENABLED).toBe(true);
    });

  it("turn only the pre-launch pop-up off in the launch-configuration test build", async () => {
    const { flag, hidden, pricing, banner } = await loadSwitches("1");
    expect(flag.LAUNCH_CONFIG_BUILD).toBe(true);
    for (const [name, on] of Object.entries(hidden)) expect(on, name).toBe(!STILL_OFF.has(name));
    expect(pricing.PACKAGES_ON_SALE).toBe(true);
    expect(banner.PRELAUNCH_BANNER_ENABLED).toBe(false);
  });

  it("list only the pre-launch pop-up in the launch table", async () => {
    const { flag } = await loadSwitches(undefined);
    expect(flag.LAUNCH_VALUES).toEqual({ PRELAUNCH_BANNER_ENABLED: false });
  });
});
