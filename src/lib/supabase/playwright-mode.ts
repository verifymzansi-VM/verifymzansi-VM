export function isPlaywrightTestMode(): boolean {
  // Never allow Playwright test mode in production — safety guard
  if (process.env.NODE_ENV === "production") return false;

  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1";
  }

  return (
    process.env.PLAYWRIGHT_TEST_MODE === "1" || process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1"
  );
}

export function isPlaywrightSupabaseStubMode(): boolean {
  // Never allow stub mode in production — safety guard
  if (process.env.NODE_ENV === "production") return false;

  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE === "stub";
  }

  return process.env.PLAYWRIGHT_SUPABASE_MODE === "stub";
}
