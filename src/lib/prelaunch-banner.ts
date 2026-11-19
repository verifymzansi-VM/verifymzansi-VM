import { LAUNCH_CONFIG_BUILD, LAUNCH_VALUES } from "@/lib/launch-config";

/**
 * The "Launching soon" pop-up shown when a visitor opens the site before the
 * public launch. The site works normally behind it; it only tells visitors they
 * are viewing an early preview. On launch day set this to false (or remove the
 * pop-up) and redeploy.
 *
 * True in production; in the launch-configuration browser-test build, which
 * shows the site as on launch day, it takes its launch value (false;
 * LAUNCH_VALUES in src/lib/launch-config.ts).
 */
export const PRELAUNCH_BANNER_ENABLED: boolean =
  !LAUNCH_CONFIG_BUILD || LAUNCH_VALUES.PRELAUNCH_BANNER_ENABLED;
