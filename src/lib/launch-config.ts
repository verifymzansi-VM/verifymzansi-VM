/**
 * Whether this is the launch-configuration test build: the private local
 * browser-test copy built with every hidden feature switched on, as on launch
 * day (scripts/lib/launch-config-build.cjs, playwright.launch-config.config.ts).
 *
 * next.config.js replaces `process.env.VERIFYMZANSI_LAUNCH_CONFIG_BUILD` with
 * a fixed value at build time: "0" in every production build (a build that
 * asks for "1" outside the local test copy fails), so this is false in
 * production and a Worker variable cannot change it. Unit tests run without
 * that replacement, where the variable is unset and this is false too.
 */
export const LAUNCH_CONFIG_BUILD: boolean = process.env.VERIFYMZANSI_LAUNCH_CONFIG_BUILD === "1";
