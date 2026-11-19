// The launch-configuration test build: every switch that hides a feature
// (src/lib/hidden-features.ts, PACKAGES_ON_SALE, the pre-launch pop-up) is
// set to its launch value, so the browser tests can exercise the site as it
// will be on launch day. Only a build for the private local test copy may ask
// for it (scripts/foundation-e2e.mjs with VERIFYMZANSI_LAUNCH_CONFIG=1).
//
// How production is protected:
// - next.config.js always defines LAUNCH_CONFIG_BUILD_DEFINE at build time
//   ("1" or "0"), so the value is fixed in the compiled code; a Worker
//   variable of the same name set later cannot change it.
// - launchConfigBuild() answers true only for a local test-copy build:
//   ENVIRONMENT=test, the e2e runtime, a loopback Supabase address and not an
//   OpenNext (Cloudflare) build. Asked for anywhere else, it throws, so the
//   build fails instead of quietly ignoring the request.
// - build:cloudflare (deploy and the Cloudflare candidate) starts with
//   scripts/preflight-cloudflare.js, which refuses to run when the switch is
//   set at all (assertLaunchConfigNotRequested).
const LAUNCH_CONFIG_SWITCH = "VERIFYMZANSI_LAUNCH_CONFIG";
/** The name next.config.js defines in the compiled code (src/lib/launch-config.ts). */
const LAUNCH_CONFIG_BUILD_DEFINE = "VERIFYMZANSI_LAUNCH_CONFIG_BUILD";

const REFUSED =
  "VERIFYMZANSI_LAUNCH_CONFIG is only for builds of the local browser-test copy " +
  "(scripts/foundation-e2e.mjs); unset it.";

/** @param {Record<string, string | undefined>} env */
function isLocalTestCopyBuild(env) {
  if (env.NEXT_PRIVATE_STANDALONE === "true") return false;
  if (env.ENVIRONMENT !== "test" || env.VERIFYMZANSI_RUNTIME_MODE !== "e2e") return false;
  try {
    const target = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "invalid");
    const app = new URL(env.NEXT_PUBLIC_APP_URL || "invalid");
    return (
      target.protocol === "http:" &&
      target.hostname === "127.0.0.1" &&
      app.protocol === "http:" &&
      app.hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

/**
 * Whether this build is the launch-configuration test build. Unset or empty:
 * false (every production build). "1" on a local test-copy build: true.
 * Anything else throws.
 * @param {Record<string, string | undefined>} env
 */
function launchConfigBuild(env) {
  const requested = env[LAUNCH_CONFIG_SWITCH];
  if (requested === undefined || requested === "") return false;
  if (requested !== "1" || !isLocalTestCopyBuild(env)) throw new Error(REFUSED);
  return true;
}

/** For build:cloudflare: refuse to start when the switch is set at all.
 * @param {Record<string, string | undefined>} env */
function assertLaunchConfigNotRequested(env) {
  if (env[LAUNCH_CONFIG_SWITCH] !== undefined && env[LAUNCH_CONFIG_SWITCH] !== "")
    throw new Error(REFUSED);
}

module.exports = {
  LAUNCH_CONFIG_SWITCH,
  LAUNCH_CONFIG_BUILD_DEFINE,
  launchConfigBuild,
  assertLaunchConfigNotRequested,
};
