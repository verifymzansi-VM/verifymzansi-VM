export interface PublicRuntimeConfig {
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  turnstileSiteKey: string;
  cfImageResizing: boolean;
  officialSocialLinks: {
    facebook?: string;
    youtube?: string;
    x?: string;
    tiktok?: string;
    linkedin?: string;
  };
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
    officialSocialLinks: {
      facebook: normalizeString(process.env.NEXT_PUBLIC_VERIFYMZANSI_FACEBOOK_URL),
      youtube: normalizeString(process.env.NEXT_PUBLIC_VERIFYMZANSI_YOUTUBE_URL),
      x: normalizeString(process.env.NEXT_PUBLIC_VERIFYMZANSI_X_URL),
      tiktok: normalizeString(process.env.NEXT_PUBLIC_VERIFYMZANSI_TIKTOK_URL),
      linkedin: normalizeString(process.env.NEXT_PUBLIC_VERIFYMZANSI_LINKEDIN_URL),
    },
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
    officialSocialLinks: {
      facebook: normalizeString(element.dataset.socialFacebookUrl),
      youtube: normalizeString(element.dataset.socialYoutubeUrl),
      x: normalizeString(element.dataset.socialXUrl),
      tiktok: normalizeString(element.dataset.socialTiktokUrl),
      linkedin: normalizeString(element.dataset.socialLinkedinUrl),
    },
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
    officialSocialLinks: {
      facebook: envConfig.officialSocialLinks?.facebook ?? domConfig.officialSocialLinks?.facebook,
      youtube: envConfig.officialSocialLinks?.youtube ?? domConfig.officialSocialLinks?.youtube,
      x: envConfig.officialSocialLinks?.x ?? domConfig.officialSocialLinks?.x,
      tiktok: envConfig.officialSocialLinks?.tiktok ?? domConfig.officialSocialLinks?.tiktok,
      linkedin: envConfig.officialSocialLinks?.linkedin ?? domConfig.officialSocialLinks?.linkedin,
    },
  };
}

export function getServerPublicRuntimeConfig(): PublicRuntimeConfig {
  return mergeConfig(readEnvConfig(), {});
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  return mergeConfig(readEnvConfig(), readDomConfig());
}
