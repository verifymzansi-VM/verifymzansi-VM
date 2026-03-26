export type LaunchValidationMode = "development" | "e2e" | "production";
export type LaunchCheckStatus = "pass" | "warn" | "fail";

export type EnvSource = Record<string, string | undefined>;

export interface LaunchValidationCheck {
  name: string;
  status: LaunchCheckStatus;
  detail: string;
}

export interface LaunchValidationSummary {
  mode: LaunchValidationMode;
  checks: LaunchValidationCheck[];
  errors: LaunchValidationCheck[];
  warnings: LaunchValidationCheck[];
  isValid: boolean;
}

const HEX_PLACEHOLDER = "cafebabe".repeat(8);
const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const DEV_ONLY_FLAGS = [
  "ENABLE_DEV_PAYMENT_BYPASS",
  "ENABLE_MOCK_OZOW",
  "DEV_EXPOSE_OTP",
  "ENABLE_DEV_KYC_WEBHOOK_BYPASS",
  "ENABLE_TEST_POSTING_BYPASS",
  "NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS",
  "ENABLE_DEV_TURNSTILE_BYPASS",
] as const;

/**
 * Environment variables that must NOT be set in production.
 * Unlike DEV_ONLY_FLAGS (which are boolean toggles), these carry
 * values that directly weaken security when present.
 */
const DANGEROUS_IN_PRODUCTION = [
  "BYPASS_OTP_CODE",
  "TEST_PHONE_NUMBERS",
  "SMS_MOCK",
  "PLAYWRIGHT_TEST_MODE",
  "PLAYWRIGHT_SUPABASE_MODE",
  "PLAYWRIGHT_E2E_AUTH",
  "NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE",
  "NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE",
] as const;

const REQUIRED_BY_MODE: Record<LaunchValidationMode, readonly string[]> = {
  development: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_APP_URL",
    "AFRICASTALKING_API_KEY",
    "AFRICASTALKING_USERNAME",
    "RESEND_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "KYC_ENCRYPTION_KEY",
    "ID_ENCRYPTION_KEY",
    "HMAC_SECRET",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
  ],
  e2e: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_APP_URL",
    "AFRICASTALKING_API_KEY",
    "AFRICASTALKING_USERNAME",
    "AFRICASTALKING_SENDER_ID",
    "RESEND_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "KYC_ENCRYPTION_KEY",
    "ID_ENCRYPTION_KEY",
    "HMAC_SECRET",
    "IP_HASH_SECRET",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
  ],
  production: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_APP_URL",
    "AFRICASTALKING_API_KEY",
    "AFRICASTALKING_USERNAME",
    "AFRICASTALKING_SENDER_ID",
    "OZOW_ENV",
    "OZOW_CLIENT_ID",
    "OZOW_CLIENT_SECRET",
    "OZOW_SITE_CODE",
    "OZOW_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "KYC_ENCRYPTION_KEY",
    "ID_ENCRYPTION_KEY",
    "HMAC_SECRET",
    "IP_HASH_SECRET",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
  ],
};

const PRODUCTION_SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "KYC_ENCRYPTION_KEY",
  "ID_ENCRYPTION_KEY",
  "HMAC_SECRET",
  "IP_HASH_SECRET",
  "AFRICASTALKING_API_KEY",
  "OZOW_CLIENT_SECRET",
  "OZOW_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
] as const;

function normalizeMode(value?: string): LaunchValidationMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "development" || normalized === "dev" || normalized === "local") {
    return "development";
  }
  if (normalized === "e2e" || normalized === "playwright" || normalized === "test") {
    return "e2e";
  }
  if (normalized === "production" || normalized === "prod" || normalized === "release") {
    return "production";
  }
  return null;
}

function hasValue(value?: string): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidAfricaTalkingSenderId(value?: string): boolean {
  return hasValue(value) && /^[A-Za-z0-9]{1,12}$/.test(value.trim());
}

function isTruthy(value?: string): boolean {
  return hasValue(value) && TRUTHY_VALUES.has(value.trim().toLowerCase());
}

function isHexKey(value?: string): boolean {
  return hasValue(value) && /^[0-9a-fA-F]{64}$/.test(value);
}

function isPlaceholderValue(value?: string): boolean {
  if (!hasValue(value)) return true;
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  return (
    trimmed === HEX_PLACEHOLDER ||
    lowered.startsWith("<set-") ||
    lowered.startsWith("<your-") ||
    lowered.startsWith("<replace-") ||
    lowered.startsWith("changeme") ||
    lowered.startsWith("replace-me") ||
    lowered === "your-value-here"
  );
}

function addCheck(
  checks: LaunchValidationCheck[],
  name: string,
  status: LaunchCheckStatus,
  detail: string
): void {
  checks.push({ name, status, detail });
}

export function getRequiredLaunchEnvKeys(mode: LaunchValidationMode): string[] {
  return [...REQUIRED_BY_MODE[mode]];
}

export function resolveLaunchValidationMode(env: EnvSource = process.env): LaunchValidationMode {
  const explicitMode =
    normalizeMode(env.VERIFYMZANSI_RUNTIME_MODE) ?? normalizeMode(env.VERIFYMZANSI_VALIDATION_MODE);
  if (explicitMode) {
    return explicitMode;
  }

  if (env.PLAYWRIGHT_TEST_MODE === "1") {
    return "e2e";
  }

  return env.NODE_ENV === "production" ? "production" : "development";
}

export function validateLaunchConfiguration(
  env: EnvSource = process.env,
  options: { mode?: LaunchValidationMode } = {}
): LaunchValidationSummary {
  const mode = options.mode ?? resolveLaunchValidationMode(env);
  const checks: LaunchValidationCheck[] = [];
  const missingRequired = getRequiredLaunchEnvKeys(mode).filter((key) => !hasValue(env[key]));

  if (missingRequired.length === 0) {
    addCheck(
      checks,
      "Launch env",
      "pass",
      `All ${getRequiredLaunchEnvKeys(mode).length} required ${mode} variables are present`
    );
  } else {
    addCheck(checks, "Launch env", "fail", `Missing: ${missingRequired.join(", ")}`);
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (!hasValue(appUrl)) {
    addCheck(checks, "App URL", "fail", "NEXT_PUBLIC_APP_URL is missing");
  } else {
    try {
      const parsed = new URL(appUrl);
      const isLocalhost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1";
      if (mode === "production") {
        if (parsed.protocol !== "https:" || isLocalhost) {
          addCheck(
            checks,
            "App URL",
            "fail",
            `Production app URL must be public HTTPS. Received: ${appUrl}`
          );
        } else {
          addCheck(checks, "App URL", "pass", appUrl);
        }
      } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        addCheck(checks, "App URL", "pass", appUrl);
      } else {
        addCheck(checks, "App URL", "fail", `Unsupported URL protocol: ${appUrl}`);
      }
    } catch {
      addCheck(checks, "App URL", "fail", `Invalid URL: ${appUrl}`);
    }
  }

  const afUsername = env.AFRICASTALKING_USERNAME;
  const afSenderId = env.AFRICASTALKING_SENDER_ID;
  if (mode === "production") {
    if (!hasValue(afSenderId)) {
      addCheck(
        checks,
        "Africa's Talking",
        "fail",
        "AFRICASTALKING_SENDER_ID is required in production"
      );
    } else if (isPlaceholderValue(afSenderId)) {
      addCheck(
        checks,
        "Africa's Talking",
        "fail",
        "AFRICASTALKING_SENDER_ID still contains a placeholder value"
      );
    } else if (!isValidAfricaTalkingSenderId(afSenderId)) {
      addCheck(
        checks,
        "Africa's Talking",
        "fail",
        "AFRICASTALKING_SENDER_ID must be 1-11 alphanumeric characters"
      );
    } else if (afUsername === "sandbox") {
      addCheck(
        checks,
        "Africa's Talking",
        "fail",
        "AFRICASTALKING_USERNAME is still set to sandbox in production"
      );
    } else {
      addCheck(checks, "Africa's Talking", "pass", `user=${afUsername} sender=${afSenderId}`);
    }
  } else if (!hasValue(afSenderId)) {
    addCheck(
      checks,
      "Africa's Talking",
      "warn",
      "AFRICASTALKING_SENDER_ID is optional locally but required for production SMS delivery"
    );
  } else if (!isValidAfricaTalkingSenderId(afSenderId)) {
    addCheck(
      checks,
      "Africa's Talking",
      "warn",
      "AFRICASTALKING_SENDER_ID should be 1-12 alphanumeric characters for SMS delivery"
    );
  } else {
    addCheck(checks, "Africa's Talking", "pass", `user=${afUsername} sender=${afSenderId}`);
  }

  const resendKey = env.RESEND_API_KEY;
  if (!hasValue(resendKey)) {
    addCheck(checks, "Resend", "fail", "RESEND_API_KEY is missing");
  } else if (!resendKey.startsWith("re_")) {
    addCheck(
      checks,
      "Resend",
      mode === "production" ? "fail" : "warn",
      "RESEND_API_KEY should start with 're_'"
    );
  } else {
    addCheck(checks, "Resend", "pass", "API key format looks valid");
  }

  const ozowEnv = env.OZOW_ENV;
  const ozowClientId = env.OZOW_CLIENT_ID;
  const ozowClientSecret = env.OZOW_CLIENT_SECRET;
  const ozowSiteCode = env.OZOW_SITE_CODE;
  const ozowWebhookSecret = env.OZOW_WEBHOOK_SECRET;
  const ozowApiBaseUrl = env.OZOW_API_BASE_URL;
  if (mode === "production") {
    if (
      !hasValue(ozowEnv) ||
      !hasValue(ozowClientId) ||
      !hasValue(ozowClientSecret) ||
      !hasValue(ozowSiteCode) ||
      !hasValue(ozowWebhookSecret)
    ) {
      addCheck(
        checks,
        "Ozow",
        "fail",
        "Ozow payment credentials are required for production checkout."
      );
    } else if (ozowEnv !== "production") {
      addCheck(checks, "Ozow", "fail", "OZOW_ENV must be set to production for live checkout");
    } else {
      addCheck(
        checks,
        "Ozow",
        "pass",
        `env=${ozowEnv} site=${ozowSiteCode}${hasValue(ozowApiBaseUrl) ? " custom-base-url" : ""}`
      );
    }
  } else if (
    hasValue(ozowClientId) &&
    hasValue(ozowClientSecret) &&
    hasValue(ozowSiteCode) &&
    hasValue(ozowWebhookSecret)
  ) {
    addCheck(
      checks,
      "Ozow",
      "pass",
      `env=${ozowEnv ?? "staging"} site=${ozowSiteCode}${hasValue(ozowApiBaseUrl) ? " custom-base-url" : ""}`
    );
  } else {
    addCheck(
      checks,
      "Ozow",
      "warn",
      "Ozow credentials are optional locally but required before production launch"
    );
  }

  const r2AccountId = env.R2_ACCOUNT_ID;
  const r2AccessKey = env.R2_ACCESS_KEY_ID;
  const r2SecretKey = env.R2_SECRET_ACCESS_KEY;
  if (
    hasValue(r2AccountId) &&
    hasValue(r2AccessKey) &&
    hasValue(r2SecretKey) &&
    r2AccountId.length >= 8 &&
    r2AccessKey.length >= 8 &&
    r2SecretKey.length >= 8
  ) {
    addCheck(checks, "R2 credentials", "pass", "R2 credential values look populated");
  } else {
    const status = mode === "production" ? "fail" : "warn";
    addCheck(
      checks,
      "R2 credentials",
      status,
      "R2 credentials look incomplete or too short for a real deployment"
    );
  }

  if (
    isHexKey(env.KYC_ENCRYPTION_KEY) &&
    isHexKey(env.ID_ENCRYPTION_KEY) &&
    isHexKey(env.HMAC_SECRET)
  ) {
    addCheck(checks, "Encryption keys", "pass", "KYC/ID/HMAC keys are 64-char hex values");
  } else {
    addCheck(
      checks,
      "Encryption keys",
      "fail",
      "KYC_ENCRYPTION_KEY, ID_ENCRYPTION_KEY, and HMAC_SECRET must all be 64-char hex values"
    );
  }

  const ipHashSecret = env.IP_HASH_SECRET;
  if (mode === "production" || mode === "e2e") {
    if (!hasValue(ipHashSecret)) {
      addCheck(checks, "IP hash secret", "fail", "IP_HASH_SECRET is required for launch paths");
    } else if (ipHashSecret.length < 32) {
      addCheck(checks, "IP hash secret", "fail", "IP_HASH_SECRET must be at least 32 characters");
    } else if (mode === "production" && isPlaceholderValue(ipHashSecret)) {
      addCheck(checks, "IP hash secret", "fail", "IP_HASH_SECRET still contains a placeholder");
    } else {
      addCheck(checks, "IP hash secret", "pass", "IP hashing secret present");
    }
  } else if (hasValue(ipHashSecret) && ipHashSecret.length < 32) {
    addCheck(checks, "IP hash secret", "warn", "IP_HASH_SECRET should be at least 32 characters");
  } else if (!hasValue(ipHashSecret)) {
    addCheck(
      checks,
      "IP hash secret",
      "warn",
      "IP_HASH_SECRET is optional locally but required for production audit privacy"
    );
  } else {
    addCheck(checks, "IP hash secret", "pass", "IP hashing secret present");
  }

  const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (hasValue(turnstileSiteKey) && hasValue(turnstileSecret)) {
    addCheck(checks, "Turnstile", "pass", "Site key and secret are present");
  } else {
    addCheck(checks, "Turnstile", "fail", "Turnstile site key and secret are required");
  }

  const activeDevOnlyFlags = DEV_ONLY_FLAGS.filter((flag) => isTruthy(env[flag]));
  if (mode === "production" && activeDevOnlyFlags.length > 0) {
    addCheck(
      checks,
      "Dev-only flags",
      "fail",
      `Disable before launch: ${activeDevOnlyFlags.join(", ")}`
    );
  } else if (activeDevOnlyFlags.length > 0) {
    addCheck(checks, "Dev-only flags", "warn", `Enabled: ${activeDevOnlyFlags.join(", ")}`);
  } else {
    addCheck(checks, "Dev-only flags", "pass", "No dev-only bypass flags enabled");
  }

  const dangerousVars = DANGEROUS_IN_PRODUCTION.filter((key) => hasValue(env[key]));
  if (mode === "production" && dangerousVars.length > 0) {
    addCheck(
      checks,
      "Dangerous env vars",
      "fail",
      `Remove before launch — these weaken security: ${dangerousVars.join(", ")}`
    );
  } else if (dangerousVars.length > 0) {
    addCheck(
      checks,
      "Dangerous env vars",
      "warn",
      `Set in ${mode} (OK for dev, must remove for production): ${dangerousVars.join(", ")}`
    );
  } else {
    addCheck(checks, "Dangerous env vars", "pass", "No dangerous override variables detected");
  }

  if (mode === "production") {
    const placeholderSecrets = PRODUCTION_SECRET_KEYS.filter((key) => isPlaceholderValue(env[key]));
    if (placeholderSecrets.length > 0) {
      addCheck(
        checks,
        "Production secrets",
        "fail",
        `Placeholder values detected: ${placeholderSecrets.join(", ")}`
      );
    } else {
      addCheck(checks, "Production secrets", "pass", "No placeholder production secrets detected");
    }
  }

  const warnings = checks.filter((check) => check.status === "warn");
  const errors = checks.filter((check) => check.status === "fail");

  return {
    mode,
    checks,
    errors,
    warnings,
    isValid: errors.length === 0,
  };
}
