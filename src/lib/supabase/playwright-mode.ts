function isExplicitE2eRuntime(): boolean {
  // The production worker sets ENVIRONMENT=production; test modes can never
  // switch on there, whatever other variables are present.
  if (process.env.ENVIRONMENT === "production") {
    return false;
  }
  return process.env.VERIFYMZANSI_RUNTIME_MODE === "e2e";
}

function hasClientPlaywrightMarker(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement?.dataset.playwright === "1";
}

export function isPlaywrightTestMode(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1" && hasClientPlaywrightMarker();
  }

  if (process.env.NODE_ENV === "production") {
    return isExplicitE2eRuntime() && process.env.PLAYWRIGHT_TEST_MODE === "1";
  }

  return (
    process.env.PLAYWRIGHT_TEST_MODE === "1" || process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1"
  );
}

/**
 * The private local foundation test copy (roadmap M0.7): browser test mode on
 * a server whose foundation connection is the local stack. Server only. Off in
 * production: ENVIRONMENT=production switches test mode off, and the local
 * project marker is accepted only with a 127.0.0.1 connection
 * (src/lib/foundation/connection.ts), never with the London project.
 */
export function isPlaywrightFoundationCopy(): boolean {
  if (typeof window !== "undefined" || process.env.ENVIRONMENT === "production") return false;
  return (
    isPlaywrightTestMode() &&
    process.env.FOUNDATION_PROJECT_REF === "local-foundation" &&
    /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(process.env.FOUNDATION_SUPABASE_URL ?? "")
  );
}
