// Whether `next build` may skip its own TypeScript pass. Only CI builds whose
// sole purpose is measuring the bundle opt in, with
// VERIFYMZANSI_SKIP_NEXT_TYPECHECK=1; the same commit's lint-type-security
// job runs the full typecheck (tsc). Production builds never skip it:
// build:cloudflare (used by deploy and the Cloudflare candidate) starts with
// scripts/preflight-cloudflare.js, which refuses to run when the flag is set,
// and build-route-verify does not set it.
const SKIP_NEXT_TYPECHECK = "VERIFYMZANSI_SKIP_NEXT_TYPECHECK";

/** @param {Record<string, string | undefined>} env */
function shouldSkipNextTypecheck(env) {
  // OpenNext (build:cloudflare) sets NEXT_PRIVATE_STANDALONE=true just before
  // it runs `next build`: never skip there, even if the flag arrived some
  // other way (for example from a .env file Next loads itself).
  if (env.NEXT_PRIVATE_STANDALONE === "true") return false;
  return env[SKIP_NEXT_TYPECHECK] === "1" && env.CI === "true";
}

/** @param {Record<string, string | undefined>} env */
function assertNextTypecheckNotSkipped(env) {
  if (env[SKIP_NEXT_TYPECHECK] !== undefined && env[SKIP_NEXT_TYPECHECK] !== "")
    throw new Error(
      `${SKIP_NEXT_TYPECHECK} is set; production (Cloudflare) builds must run Next's TypeScript check.`
    );
}

module.exports = { SKIP_NEXT_TYPECHECK, shouldSkipNextTypecheck, assertNextTypecheckNotSkipped };
