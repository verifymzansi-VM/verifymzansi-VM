"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { InAppInstallSteps, IOSInstallSteps } from "@/components/pwa/install-steps";
import { isDismissalActive, PROMPT_DISMISSED_STORAGE_KEY } from "@/lib/pwa/install-environment";

const HOME_PROMPT_MIN_SCROLL_Y = 360;

// Auth/verification flows need full attention; the showroom sections keep their
// bottom edge for the feed controls. /install has its own buttons.
const PROMPT_BLOCKED_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/verification",
  "/error",
  "/install",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
];

function safeGetLocalStorageItem(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorageItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures so the prompt remains usable in restricted contexts.
  }
}

function readDismissed() {
  if (typeof window === "undefined") return false;
  const { active, migrate } = isDismissalActive(
    safeGetLocalStorageItem(PROMPT_DISMISSED_STORAGE_KEY),
    Date.now()
  );
  if (migrate) safeSetLocalStorageItem(PROMPT_DISMISSED_STORAGE_KEY, migrate);
  return active;
}

export function PwaInstallPrompt() {
  const pathname = usePathname();
  const isPlaywright = isPlaywrightTestMode();
  const [dismissed, setDismissed] = useState(readDismissed);
  const promptBlockedForRoute = PROMPT_BLOCKED_PATH_PREFIXES.some(
    (prefix) => pathname != null && (pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
  const promptSuppressed = isPlaywright || dismissed || promptBlockedForRoute;
  const { environment, canPrompt, promptInstall } = usePwaInstall(!promptSuppressed);
  const needsHelp = environment === "ios" || environment === "in-app";
  const eligible = needsHelp || (environment === "browser" && canPrompt);

  const [revealed, setRevealed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const helpDialogRef = useRef<HTMLDivElement>(null);

  const closeHelp = useCallback(() => setShowHelp(false), []);

  // On the home page, wait until the hero has been scrolled past.
  useEffect(() => {
    if (!eligible) {
      queueMicrotask(() => {
        setRevealed(false);
        setShowHelp(false);
      });
      return;
    }
    if (pathname !== "/" || window.scrollY >= HOME_PROMPT_MIN_SCROLL_Y) {
      queueMicrotask(() => setRevealed(true));
      return;
    }
    // Navigating back to the top of the home page hides it again until the hero is passed.
    queueMicrotask(() => setRevealed(false));
    const revealAfterHero = () => {
      if (window.scrollY < HOME_PROMPT_MIN_SCROLL_Y) return;
      window.removeEventListener("scroll", revealAfterHero);
      setRevealed(true);
    };
    window.addEventListener("scroll", revealAfterHero, { passive: true });
    return () => window.removeEventListener("scroll", revealAfterHero);
  }, [eligible, pathname]);

  // Focus the dialog when it opens and handle Escape key
  useEffect(() => {
    if (!showHelp) return;
    helpDialogRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeHelp();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showHelp, closeHelp]);

  const handleInstallClick = async () => {
    if (needsHelp) {
      setShowHelp(true);
      return;
    }
    // Saying no in Chrome's own dialog counts as closing the banner.
    if ((await promptInstall()) === "dismissed") handleDismiss();
  };

  const handleDismiss = () => {
    setShowHelp(false);
    setDismissed(true);
    safeSetLocalStorageItem(PROMPT_DISMISSED_STORAGE_KEY, String(Date.now()));
  };

  if (promptSuppressed || !eligible || !revealed) {
    return null;
  }

  const inApp = environment === "in-app";
  const helpTitle = inApp ? "Open in your browser" : "Install on iPhone";

  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 md:hidden animate-in slide-in-from-bottom flex justify-center pb-safe">
      <div className="glass-panel elev-lg relative flex w-full max-w-sm items-center justify-between gap-4 overflow-hidden rounded-2xl p-4">
        {/* Decorative background element for premium feel */}
        <div className="absolute inset-0 bg-gradient-to-r from-brand-green/10 to-transparent pointer-events-none" />

        <div className="flex items-center gap-3 relative z-10">
          <div className="icon-tile h-11 w-11 bg-brand-green/10 text-brand-green dark:bg-brand-green/15 dark:text-brand-gold-300">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Install App</h3>
            <p className="text-xs text-muted-foreground mr-1">
              {inApp ? "Open in your browser to install" : "Free, no app store needed"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 relative z-10">
          <Button
            size="sm"
            onClick={handleInstallClick}
            className="rounded-full shadow-sm shadow-brand-green/20"
          >
            Install
          </Button>
          <button
            onClick={handleDismiss}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Dismiss install prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showHelp && (
        <div
          className="fixed inset-0 z-[120] bg-black/70 px-4 py-6 flex items-end md:items-center justify-center"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeHelp();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={helpTitle}
            ref={helpDialogRef}
            tabIndex={-1}
            className="w-full max-w-md rounded-3xl border border-border/60 bg-background p-6 elev-xl safe-area-inset-bottom"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold">{helpTitle}</h3>
              <button
                type="button"
                onClick={closeHelp}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted/50"
                aria-label="Close install instructions"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {inApp ? (
              <InAppInstallSteps pageUrl={new URL("/install", window.location.origin).toString()} />
            ) : (
              <IOSInstallSteps />
            )}
            <div className="mt-5 flex justify-end">
              <Button size="sm" onClick={closeHelp} className="rounded-full">
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
