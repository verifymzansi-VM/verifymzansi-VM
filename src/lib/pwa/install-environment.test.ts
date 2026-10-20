import { describe, expect, it } from "vitest";
import {
  chromeIntentUrl,
  detectInstallEnvironment,
  isDismissalActive,
  PROMPT_DISMISS_DAYS,
} from "./install-environment";

const DAY = 24 * 60 * 60 * 1000;

function nav(userAgent: string, platform = "Linux armv8l", maxTouchPoints = 0) {
  return { userAgent, platform, maxTouchPoints };
}

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

describe("detectInstallEnvironment", () => {
  it("treats a home-screen launch as installed", () => {
    expect(detectInstallEnvironment(nav(ANDROID_CHROME), true)).toBe("installed");
    expect(detectInstallEnvironment({ ...nav(IPHONE_SAFARI), standalone: true }, false)).toBe(
      "installed"
    );
  });

  it.each([
    ["Facebook", `${IPHONE_SAFARI} [FBAN/FBIOS;FBAV/450.0]`],
    ["Instagram", `${IPHONE_SAFARI} Instagram 300.0`],
    ["TikTok", `${ANDROID_CHROME} musical_ly_2023`],
    ["Android WebView", "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0"],
  ])("detects the %s in-app browser", (_name, userAgent) => {
    expect(detectInstallEnvironment(nav(userAgent), false)).toBe("in-app");
  });

  it("detects iPhone and iPadOS desktop-mode Safari", () => {
    expect(detectInstallEnvironment(nav(IPHONE_SAFARI), false)).toBe("ios");
    expect(
      detectInstallEnvironment(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5), false)
    ).toBe("ios");
  });

  it("falls back to a regular browser", () => {
    expect(detectInstallEnvironment(nav(ANDROID_CHROME), false)).toBe("browser");
  });
});

describe("chromeIntentUrl", () => {
  it("builds a Chrome intent with a fallback on Android", () => {
    const intent = chromeIntentUrl("https://verifymzansi.com/install?x=1", nav(ANDROID_CHROME));
    expect(intent).toBe(
      "intent://verifymzansi.com/install?x=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fverifymzansi.com%2Finstall%3Fx%3D1;end"
    );
  });

  it("returns null off Android or for non-web URLs", () => {
    expect(chromeIntentUrl("https://verifymzansi.com/", nav(IPHONE_SAFARI))).toBeNull();
    expect(chromeIntentUrl("javascript:alert(1)", nav(ANDROID_CHROME))).toBeNull();
    expect(chromeIntentUrl("not a url", nav(ANDROID_CHROME))).toBeNull();
  });
});

describe("isDismissalActive", () => {
  const now = Date.UTC(2026, 9, 19);

  it("is inactive when nothing is stored or the value is unreadable", () => {
    expect(isDismissalActive(null, now)).toEqual({ active: false });
    expect(isDismissalActive("soon", now)).toEqual({ active: false });
  });

  it("lasts PROMPT_DISMISS_DAYS", () => {
    expect(isDismissalActive(String(now - 2 * DAY), now).active).toBe(true);
    expect(isDismissalActive(String(now - (PROMPT_DISMISS_DAYS + 1) * DAY), now).active).toBe(
      false
    );
  });

  it("restarts the window for the legacy 'true' value", () => {
    expect(isDismissalActive("true", now)).toEqual({ active: true, migrate: String(now) });
  });
});
