import { randomBytes } from "node:crypto";

/** Synthetic, production-shaped settings for the isolated Worker startup check. */
export function createCloudflareStartupFixture(publicSettings = {}) {
  const fixture = () => randomBytes(32).toString("hex");
  const serverKey = `sb_secret_${fixture()}`;
  const publicKey = publicSettings.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? `sb_publishable_${fixture()}`;
  return {
    NODE_ENV: "production",
    ENVIRONMENT: "production",
    STRICT_ENV_STARTUP_BLOCK: "1",
    NEXT_PUBLIC_DATA_BACKEND: "foundation",
    NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
    FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy",
    FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: publicKey,
    FOUNDATION_SUPABASE_SECRET_KEY: serverKey,
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_REGISTRATION_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_RECOVERY_ENABLED: "true",
    SUPABASE_SERVICE_ROLE_KEY: serverKey,
    HEALTH_DIAGNOSTIC_TOKEN: fixture(),
    FOUNDATION_PHONE_OTP_KEY: fixture(),
    INTERNAL_JOBS_SECRET: fixture(),
    RATE_LIMITER_API_KEY: fixture(),
    OTP_RATE_LIMITER_URL: "https://limiter.runtime-check.invalid",
    KYC_WEBHOOK_SECRET: fixture(),
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
