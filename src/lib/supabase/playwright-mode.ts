export function isPlaywrightTestMode(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1";
  }

  return (
    process.env.PLAYWRIGHT_TEST_MODE === "1" || process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE === "1"
  );
}

export function isPlaywrightSupabaseStubMode(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE === "stub";
  }

  return process.env.PLAYWRIGHT_SUPABASE_MODE === "stub";
}
