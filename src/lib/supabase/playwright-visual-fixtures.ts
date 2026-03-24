import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

export const PLAYWRIGHT_HIDE_FIXTURES_COOKIE = "vmz_e2e_hide_fixtures";

export function shouldHidePlaywrightFixtures(cookieValue: string | null | undefined): boolean {
  if (!isPlaywrightTestMode()) {
    return false;
  }

  const normalized = cookieValue?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
