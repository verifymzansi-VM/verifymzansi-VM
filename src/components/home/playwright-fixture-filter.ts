import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

const PLAYWRIGHT_USER_ID_PATTERN = /^pw-[A-Za-z0-9-]+$/;
const PLAYWRIGHT_OWNER_KEYS = ["user_id", "owner_id", "seller_id", "actor_id"] as const;

function isPlaywrightFixtureUserId(value: unknown): boolean {
  return typeof value === "string" && PLAYWRIGHT_USER_ID_PATTERN.test(value);
}

export function shouldHidePlaywrightFixtureRow(row: object): boolean {
  return shouldHidePlaywrightFixtureRowWhenEnabled(row, isPlaywrightTestMode());
}

export function shouldHidePlaywrightFixtureRowWhenEnabled(row: object, enabled: boolean): boolean {
  if (!enabled) {
    return false;
  }

  const candidate = row as Record<string, unknown>;
  return PLAYWRIGHT_OWNER_KEYS.some((key) => isPlaywrightFixtureUserId(candidate[key]));
}
