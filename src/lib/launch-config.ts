/**
 * Whether this is the launch-configuration test build: the private local
 * browser-test copy built as on launch day: the pre-launch pop-up off
 * (LAUNCH_VALUES below) (scripts/lib/launch-config-build.cjs,
 * playwright.launch-config.config.ts).
 *
 * next.config.js replaces `process.env.VERIFYMZANSI_LAUNCH_CONFIG_BUILD` with
 * a fixed value at build time: "0" in every production build (a build that
 * asks for "1" outside the local test copy fails), so this is false in
 * production and a Worker variable cannot change it. Unit tests run without
 * that replacement, where the variable is unset and this is false too.
 */
export const LAUNCH_CONFIG_BUILD: boolean = process.env.VERIFYMZANSI_LAUNCH_CONFIG_BUILD === "1";

/**
 * The value each compile-time switch takes on launch day, where it still
 * differs from production. Only the launch-configuration build uses it: the
 * pre-launch pop-up is `!LAUNCH_CONFIG_BUILD || LAUNCH_VALUES.PRELAUNCH_BANNER_ENABLED`
 * (src/lib/prelaunch-banner.ts), so production keeps the pop-up whatever this
 * table says.
 *
 * The switches that hid features (src/lib/hidden-features.ts and
 * PACKAGES_ON_SALE in src/lib/constants/pricing.ts) are on in production and
 * every build since the owner's decision of 22 November 2026 (hide nothing
 * before launch), apart from two whose features are not built
 * (SHOW_ORGANISATION_REPORT and SHOW_PACKAGE_TEAMS, off in every build), so
 * they are no longer listed here.
 *
 * Changing a launch value here changes only that test build; changing what
 * production shows is a frontend change for the owner.
 */
export const LAUNCH_VALUES = {
  // The pop-up is gone on launch day.
  PRELAUNCH_BANNER_ENABLED: false,
} as const satisfies Record<string, boolean>;
