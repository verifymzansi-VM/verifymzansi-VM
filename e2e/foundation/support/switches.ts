import { LAUNCH_CONFIG_SETTINGS } from "../../../scripts/lib/foundation-e2e-website.mjs";
import { LAUNCH_VALUES, type LaunchSwitch } from "../../../src/lib/launch-config";

// Which state the website under test serves for each switch that hides a
// feature, from the same values its build uses: the ordinary lane
// (playwright.foundation.config.ts) runs production's values, every hidden
// feature off; the launch lane (playwright.launch-config.config.ts) runs each
// switch's launch value (LAUNCH_VALUES in src/lib/launch-config.ts). A spec
// that checks a switched feature asserts both states, one per lane.

/** True in the launch-configuration lane, whose config sets it for the specs. */
export const LAUNCH_LANE = process.env.VERIFYMZANSI_LAUNCH_CONFIG === "1";

type HiddenFeatureSwitch = Exclude<LaunchSwitch, "PRELAUNCH_BANNER_ENABLED">;

/** Whether a hidden feature is on in the build under test: its launch value in
 * the launch lane, off (production's value) otherwise. */
export function switchOn(name: HiddenFeatureSwitch): boolean {
  return LAUNCH_LANE && LAUNCH_VALUES[name];
}

/** Whether the copy's website sells paid add-ons (the runtime switch
 * ADDON_SALES_ENABLED, src/lib/billing/addon-sales.ts): "false" in the
 * ordinary copy, as in production, and its launch value in the launch lane
 * (LAUNCH_CONFIG_SETTINGS, scripts/lib/foundation-e2e-website.mjs). */
export const ADDON_SALES_OPEN =
  LAUNCH_LANE && LAUNCH_CONFIG_SETTINGS.ADDON_SALES_ENABLED === "true";
