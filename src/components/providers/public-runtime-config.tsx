import {
  PUBLIC_RUNTIME_CONFIG_ELEMENT_ID,
  getServerPublicRuntimeConfig,
} from "@/lib/public-runtime-config";

export function PublicRuntimeConfigBridge() {
  const config = getServerPublicRuntimeConfig();

  return (
    <div
      id={PUBLIC_RUNTIME_CONFIG_ELEMENT_ID}
      hidden
      aria-hidden="true"
      data-app-url={config.appUrl}
      data-supabase-url={config.supabaseUrl}
      data-supabase-anon-key={config.supabaseAnonKey}
      data-turnstile-site-key={config.turnstileSiteKey}
      data-cf-image-resizing={String(config.cfImageResizing)}
    />
  );
}
