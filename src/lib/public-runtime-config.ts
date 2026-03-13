export interface PublicRuntimeConfig {
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  turnstileSiteKey: string;
  cfImageResizing: boolean;
}

export const PUBLIC_RUNTIME_CONFIG_ELEMENT_ID = "vmz-public-config";

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function readEnvConfig(): Partial<PublicRuntimeConfig> {
  return {
    appUrl: normalizeString(process.env.NEXT_PUBLIC_APP_URL),
    supabaseUrl: normalizeString(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: normalizeString(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    turnstileSiteKey: normalizeString(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    cfImageResizing: normalizeBoolean(process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING),
  };
}

function readDomConfig(): Partial<PublicRuntimeConfig> {
  if (typeof document === "undefined") {
    return {};
  }

  const element = document.getElementById(PUBLIC_RUNTIME_CONFIG_ELEMENT_ID);
  if (!(element instanceof HTMLElement)) {
    return {};
  }

  return {
    appUrl: normalizeString(element.dataset.appUrl),
    supabaseUrl: normalizeString(element.dataset.supabaseUrl),
    supabaseAnonKey: normalizeString(element.dataset.supabaseAnonKey),
    turnstileSiteKey: normalizeString(element.dataset.turnstileSiteKey),
    cfImageResizing: normalizeBoolean(element.dataset.cfImageResizing),
  };
}

function mergeConfig(
  envConfig: Partial<PublicRuntimeConfig>,
  domConfig: Partial<PublicRuntimeConfig>
): PublicRuntimeConfig {
  return {
    appUrl: envConfig.appUrl ?? domConfig.appUrl ?? "https://verifymzansi.com",
    supabaseUrl: envConfig.supabaseUrl ?? domConfig.supabaseUrl ?? "",
    supabaseAnonKey: envConfig.supabaseAnonKey ?? domConfig.supabaseAnonKey ?? "",
    turnstileSiteKey: envConfig.turnstileSiteKey ?? domConfig.turnstileSiteKey ?? "",
    cfImageResizing: envConfig.cfImageResizing ?? domConfig.cfImageResizing ?? false,
  };
}

export function getServerPublicRuntimeConfig(): PublicRuntimeConfig {
  return mergeConfig(readEnvConfig(), {});
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  return mergeConfig(readEnvConfig(), readDomConfig());
}
