import { LAUNCH_CONFIG_SETTINGS } from "../../../scripts/lib/foundation-e2e-website.mjs";

// Which state the website under test serves for each switch that still
// differs between the ordinary lane (playwright.foundation.config.ts, as
// production) and the launch lane (playwright.launch-config.config.ts). The
// compile-time switches that hid features (src/lib/hidden-features.ts and
// PACKAGES_ON_SALE) are on in every build since the owner's decision of
// 22 November 2026, so specs expect them on in both lanes.

/** True in the launch-configuration lane, whose config sets it for the specs. */
export const LAUNCH_LANE = process.env.VERIFYMZANSI_LAUNCH_CONFIG === "1";

/** Whether the copy's website sells paid add-ons (the runtime switch
 * ADDON_SALES_ENABLED, src/lib/billing/addon-sales.ts): "false" in the
 * ordinary copy, as in production, and its launch value in the launch lane
 * (LAUNCH_CONFIG_SETTINGS, scripts/lib/foundation-e2e-website.mjs). */
export const ADDON_SALES_OPEN =
  LAUNCH_LANE && LAUNCH_CONFIG_SETTINGS.ADDON_SALES_ENABLED === "true";
