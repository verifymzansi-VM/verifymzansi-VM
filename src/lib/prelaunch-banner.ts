import { LAUNCH_CONFIG_BUILD } from "@/lib/launch-config";

/**
 * The "Launching soon" pop-up shown when a visitor opens the site before the
 * public launch. The site works normally behind it; it only tells visitors they
 * are viewing an early preview. On launch day set this to false (or remove the
 * pop-up) and redeploy.
 *
 * True in production; false only in the launch-configuration browser-test
 * build, which shows the site as on launch day (src/lib/launch-config.ts).
 */
export const PRELAUNCH_BANNER_ENABLED: boolean = !LAUNCH_CONFIG_BUILD;
