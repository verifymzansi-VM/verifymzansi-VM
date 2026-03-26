"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const isIOSFallback = useSyncExternalStore(
    subscribeDisplayMode,
    getIOSFallbackSnapshot,
    () => false
  );
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if the user has already dismissed or installed the app in this session/device
    const isDismissed = localStorage.getItem("pwa-prompt-dismissed");

    const userAgent = window.navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

    // iOS Safari does not fire beforeinstallprompt; show manual A2HS guidance.
    if (isIOSDevice && !isStandalone) {
      queueMicrotask(() => {
        setShowPrompt(true);
      });
    }

    // Only handle if not dismissed previously
    if (isDismissed !== "true") {
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
    }
  }, []);

  const handleInstallClick = async () => {
    if (isIOSFallback) {
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

  if (dismissed || !(showPrompt || isIOSFallback)) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 md:hidden animate-in slide-in-from-bottom flex justify-center pb-safe">
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
    </div>
  );
}
