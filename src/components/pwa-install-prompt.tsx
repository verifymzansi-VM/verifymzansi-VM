"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

const PROMPT_BLOCKED_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
];

// Define the interface for the beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

function subscribeDisplayMode(callback: () => void) {
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getIOSFallbackSnapshot() {
  const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return isIOSDevice && !window.matchMedia("(display-mode: standalone)").matches;
}

export function PwaInstallPrompt() {
  const pathname = usePathname();
  const isPlaywright = isPlaywrightTestMode();
  const isIOSFallback = useSyncExternalStore(
    subscribeDisplayMode,
    getIOSFallbackSnapshot,
    () => false
  );
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return localStorage.getItem("pwa-prompt-dismissed") === "true";
  });
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const promptBlockedForRoute = PROMPT_BLOCKED_PATH_PREFIXES.some(
    (prefix) => pathname != null && (pathname === prefix || pathname.startsWith(`${prefix}/`))
  );

  useEffect(() => {
    if (isPlaywright) {
      return;
    }

    if (dismissed) {
      return;
    }

    if (promptBlockedForRoute) {
      return;
    }

    const userAgent = window.navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

    // iOS Safari does not fire beforeinstallprompt; show manual A2HS guidance.
    if (isIOSDevice && !isStandalone) {
      queueMicrotask(() => {
        setShowPrompt(true);
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show the prompt UI
      setShowPrompt(true);
    };

    const handleAppInstalled = () => {
      // Hide the prompt if the app was installed successfully
      setShowPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [dismissed, isPlaywright, promptBlockedForRoute]);

  const handleInstallClick = async () => {
    if (isIOSFallback) {
      setShowIOSHelp(true);
      return;
    }

    if (!deferredPrompt) return;

    // Show the install prompt
    await deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    await deferredPrompt.userChoice;

    // We no longer need the prompt. Clear it up
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setDismissed(true);
    localStorage.setItem("pwa-prompt-dismissed", "true");
  };

  if (isPlaywright || dismissed || promptBlockedForRoute || !(showPrompt || isIOSFallback)) {
    return null;
  }

  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 md:hidden animate-in slide-in-from-bottom flex justify-center pb-safe">
      <div className="bg-background/95 backdrop-blur-md border shadow-lg rounded-xl p-4 flex items-center justify-between gap-4 w-full max-w-sm relative overflow-hidden">
        {/* Decorative background element for premium feel */}
        <div className="absolute inset-0 bg-gradient-to-r from-brand-green/10 to-transparent pointer-events-none" />

        <div className="flex items-center gap-3 relative z-10">
          <div className="bg-brand-green/10 p-2 rounded-lg text-brand-green">
            <Download className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Install App</h3>
            <p className="text-xs text-muted-foreground mr-1">
              {isIOSFallback
                ? "On iPhone: tap Share, then Add to Home Screen"
                : "Fast & easy access to VerifyMzansi"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 relative z-10">
          <Button
            size="sm"
            onClick={handleInstallClick}
            className="rounded-full shadow-sm shadow-brand-green/20"
          >
            {isIOSFallback ? "How To Install" : "Install"}
          </Button>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-full text-muted-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss install prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showIOSHelp && (
        <div
          className="fixed inset-0 z-[120] bg-black/70 px-4 py-6 flex items-end md:items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Install on iPhone"
        >
          <div className="w-full max-w-md rounded-2xl border bg-background p-5 shadow-2xl safe-area-inset-bottom">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold">Install on iPhone</h3>
              <button
                type="button"
                onClick={() => setShowIOSHelp(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted/50"
                aria-label="Close install instructions"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground list-decimal pl-5">
              <li>Tap the Share button in Safari.</li>
              <li>Scroll and tap Add to Home Screen.</li>
              <li>Tap Add to finish installation.</li>
            </ol>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => setShowIOSHelp(false)}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
