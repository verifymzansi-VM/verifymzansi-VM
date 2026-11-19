// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// The switches that hide a feature keep today's values unless the build is the
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

describe("launch configuration switches", () => {
  for (const value of [undefined, "0", "", "true", "yes", " 1"])
    it(`keep production values when the build value is ${JSON.stringify(value)}`, async () => {
      const { flag, hidden, pricing, banner } = await loadSwitches(value);
      expect(flag.LAUNCH_CONFIG_BUILD).toBe(false);
      const switches = Object.entries(hidden);
      expect(switches.length).toBeGreaterThanOrEqual(17);
      for (const [name, on] of switches) expect(on, name).toBe(false);
      expect(pricing.PACKAGES_ON_SALE).toBe(false);
      expect(banner.PRELAUNCH_BANNER_ENABLED).toBe(true);
    });

  it("give each switch its launch value in the launch-configuration test build", async () => {
    const { flag, hidden, pricing, banner } = await loadSwitches("1");
    expect(flag.LAUNCH_CONFIG_BUILD).toBe(true);
    const values: Record<string, boolean> = flag.LAUNCH_VALUES;
    for (const [name, on] of Object.entries(hidden)) expect(on, name).toBe(values[name]);
    expect(pricing.PACKAGES_ON_SALE).toBe(flag.LAUNCH_VALUES.PACKAGES_ON_SALE);
    expect(banner.PRELAUNCH_BANNER_ENABLED).toBe(flag.LAUNCH_VALUES.PRELAUNCH_BANNER_ENABLED);
  });

  it("list every switch once in the launch table, with the reviewed launch values", async () => {
    const { flag, hidden } = await loadSwitches(undefined);
    expect(Object.keys(flag.LAUNCH_VALUES).sort()).toEqual(
      [...Object.keys(hidden), "PACKAGES_ON_SALE", "PRELAUNCH_BANNER_ENABLED"].sort()
    );
    // The database refuses turning Analytics or Third-party sharing on, so
    // these switches stay off at launch; the pop-up is gone on launch day.
    expect(flag.LAUNCH_VALUES.SHOW_DATA_USE_CHOICES).toBe(false);
    expect(flag.LAUNCH_VALUES.PRELAUNCH_BANNER_ENABLED).toBe(false);
    expect(
      Object.entries(flag.LAUNCH_VALUES)
        .filter(([, on]) => !on)
        .map(([name]) => name)
        .sort()
    ).toEqual(["PRELAUNCH_BANNER_ENABLED", "SHOW_DATA_USE_CHOICES"]);
  });
});
