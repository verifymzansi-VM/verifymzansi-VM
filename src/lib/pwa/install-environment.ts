/**
 * Where the visitor is, as far as installing the web app goes.
 * - installed: already running from the home screen
 * - in-app: inside WhatsApp, Facebook, Instagram, TikTok etc. (cannot install there)
 * - ios: iPhone/iPad browser; install is Share → Add to Home Screen
 * - browser: everything else; Chrome/Edge/Samsung fire beforeinstallprompt when installable
 */
export type InstallEnvironment = "installed" | "in-app" | "ios" | "browser";

export const PROMPT_DISMISSED_STORAGE_KEY = "pwa-prompt-dismissed";
export const PROMPT_DISMISS_DAYS = 30;

// Android WebViews carry "; wv)"; the named apps tag their in-app browsers.
const IN_APP_BROWSER_PATTERN =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp|TikTok|musical_ly|BytedanceWebview|Snapchat|Line\/|LinkedInApp|; wv\)/i;

type NavigatorLike = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> & {
  standalone?: boolean;
};

function isIOSLike(nav: NavigatorLike): boolean {
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
  );
}

export function isAndroid(nav: Pick<Navigator, "userAgent">): boolean {
  return /Android/i.test(nav.userAgent);
}

export function detectInstallEnvironment(nav: NavigatorLike, isStandalone: boolean) {
  if (isStandalone || nav.standalone === true) return "installed" satisfies InstallEnvironment;
  if (IN_APP_BROWSER_PATTERN.test(nav.userAgent)) return "in-app" satisfies InstallEnvironment;
  if (isIOSLike(nav)) return "ios" satisfies InstallEnvironment;
  return "browser" satisfies InstallEnvironment;
}

/**
 * Android in-app browsers can hand the page to Chrome with an intent URL.
 * Returns null where that does not apply.
 */
export function chromeIntentUrl(pageUrl: string, nav: Pick<Navigator, "userAgent">) {
  if (!isAndroid(nav)) return null;
  try {
    const url = new URL(pageUrl);
    const scheme = url.protocol.replace(":", "");
    if (scheme !== "https" && scheme !== "http") return null;
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.toString())};end`;
  } catch {
    return null;
  }
}

/**
 * The banner stays hidden for PROMPT_DISMISS_DAYS after a dismissal. Older builds
 * stored "true"; that restarts the window from now.
 */
export function isDismissalActive(
  stored: string | null,
  now: number
): { active: boolean; migrate?: string } {
  if (stored === null) return { active: false };
  if (stored === "true") return { active: true, migrate: String(now) };
  const dismissedAt = Number(stored);
  if (!Number.isFinite(dismissedAt)) return { active: false };
  return { active: now - dismissedAt < PROMPT_DISMISS_DAYS * 24 * 60 * 60 * 1000 };
}
