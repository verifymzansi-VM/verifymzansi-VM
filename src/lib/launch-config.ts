/**
 * Whether this is the launch-configuration test build: the private local
 * browser-test copy built with every hidden feature set to its launch value
 * (LAUNCH_VALUES below), as on launch day (scripts/lib/launch-config-build.cjs,
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
 * The value each compile-time switch takes on launch day, reviewed one by one.
 * Only the launch-configuration build uses it: each switch is
 * `LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.<name>` (src/lib/hidden-features.ts,
 * PACKAGES_ON_SALE in src/lib/constants/pricing.ts), and the pre-launch pop-up
 * is `!LAUNCH_CONFIG_BUILD || LAUNCH_VALUES.PRELAUNCH_BANNER_ENABLED`
 * (src/lib/prelaunch-banner.ts). So production keeps today's values whatever
 * this table says: every hidden feature off and the pop-up on.
 *
 * The browser tests read the same table (e2e/foundation/support/switches.ts),
 * so each spec expects the state the build it runs against serves.
 *
 * Changing a launch value here changes only that test build; switching a
 * feature on in production is a frontend change for the owner.
 */
export const LAUNCH_VALUES = {
  SHOW_ENGAGEMENT_TOTALS: true,
  SHOW_OWNER_METRICS: true,
  SHOW_LOCATION_DETECTION: true,
  SHOW_STAFF_OPERATIONS: true,
  SHOW_ORGANISATION_REPORT: true,
  SHOW_POST_TEMPLATES: true,
  SHOW_ACCOUNT_DELETION: true,
  SHOW_PAID_ADDONS: true,
  SHOW_SPONSOR_OFFER: true,
  SHOW_PACKAGE_TEAMS: true,
  SHOW_BUSINESS_STOREFRONT: true,
  SHOW_POST_COPY: true,
  PACKAGES_ON_SALE: true,
  // Off at launch: the partner programme opens once the partner agreement is
  // signed, which is not tied to launch day.
  SHOW_PARTNER_PAGE: false,
  // The pop-up is gone on launch day.
  PRELAUNCH_BANNER_ENABLED: false,
} as const satisfies Record<string, boolean>;
