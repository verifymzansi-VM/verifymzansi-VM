// Settings the production build may receive for real: public values and
// non-secret runtime configuration. Every other name in the synthetic Worker
// fixture is a private credential and must be synthetic during the build.
export const PUBLIC_BUILD_SETTINGS = new Set([
  "NODE_ENV",
  "ENVIRONMENT",
  "STRICT_ENV_STARTUP_BLOCK",
  "FOUNDATION_PROJECT_REF",
  "FOUNDATION_SUPABASE_URL",
  "FOUNDATION_SUPABASE_PUBLISHABLE_KEY",
  "FOUNDATION_PASSWORD_AUTH_MODE",
  "FOUNDATION_REGISTRATION_ENABLED",
  "FOUNDATION_AUTH_CALLBACK_ENABLED",
  "FOUNDATION_RECOVERY_ENABLED",
  "OTP_RATE_LIMITER_URL",
  "KYC_PROVIDER",
  "AFRICASTALKING_USERNAME",
  "AFRICASTALKING_SENDER_ID",
  "OZOW_ENV",
  "R2_PUBLIC_BUCKET",
  "R2_PRIVATE_BUCKET",
]);

/** Private credential names in the fixture; public NEXT_PUBLIC_* values are never replaced. */
export function privateBuildNames(fixture) {
  return Object.keys(fixture).filter(
    (name) => !name.startsWith("NEXT_PUBLIC_") && !PUBLIC_BUILD_SETTINGS.has(name)
  );
}

/** Release credentials that are not Worker settings and must never reach the build. */
export const RELEASE_ONLY_CREDENTIALS = [
  "CLOUDFLARE_API_TOKEN",
  "SITE_MONITOR_API_KEY",
  "DEPLOY_HEALTHCHECK_URL",
  "GITHUB_TOKEN",
  "SUPABASE_BACKUP_DB_PASSWORD",
  "BACKUP_R2_ACCESS_KEY_ID",
  "BACKUP_R2_SECRET_ACCESS_KEY",
];
