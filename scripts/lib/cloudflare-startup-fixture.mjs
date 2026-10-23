import { randomBytes } from "node:crypto";

/** Synthetic, production-shaped settings for the isolated Worker startup check. */
export function createCloudflareStartupFixture() {
  const fixture = () => randomBytes(32).toString("hex");
  return {
    NODE_ENV: "production",
    ENVIRONMENT: "production",
    STRICT_ENV_STARTUP_BLOCK: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.runtime-check.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture(),
    SUPABASE_SERVICE_ROLE_KEY: fixture(),
    NEXT_PUBLIC_APP_URL: "https://runtime-check.invalid",
    KYC_PROVIDER: "manual",
    KYC_ENCRYPTION_KEY: fixture(),
    ID_ENCRYPTION_KEY: fixture(),
    HMAC_SECRET: fixture(),
    IP_HASH_SECRET: fixture(),
    AFRICASTALKING_API_KEY: fixture(),
    AFRICASTALKING_USERNAME: "runtimecheck",
    AFRICASTALKING_SENDER_ID: "VerifyMzansi",
    OZOW_ENV: "production",
    OZOW_CLIENT_ID: fixture(),
    OZOW_CLIENT_SECRET: fixture(),
    OZOW_SITE_CODE: fixture(),
    OZOW_WEBHOOK_SECRET: fixture(),
    RESEND_API_KEY: `re_${fixture()}`,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: fixture(),
    TURNSTILE_SECRET_KEY: fixture(),
    R2_ACCOUNT_ID: fixture().slice(0, 32),
    R2_ACCESS_KEY_ID: fixture().slice(0, 32),
    R2_SECRET_ACCESS_KEY: fixture(),
    R2_PUBLIC_BUCKET: "runtime-check-public",
    R2_PRIVATE_BUCKET: "runtime-check-private",
    OPS_JOBS_SECRET: fixture(),
  };
}
