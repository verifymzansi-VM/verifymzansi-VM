"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const DISMISSED_STORAGE_KEY = "lead-notification-prompt-dismissed";

function safeGetLocalStorageItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorageItem(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures in restricted contexts.
  }
}

interface LeadNotificationPermissionPromptProps {
  enabled: boolean;
}

export function LeadNotificationPermissionPrompt({
  enabled,
}: LeadNotificationPermissionPromptProps) {
  const { toast } = useToast();
  // Start hidden on both server and client; storage and the Notification API
  // only exist in the browser, so reading them during render caused a
  // hydration mismatch in the header on every page.
  const [dismissed, setDismissed] = useState(true);
  const [permissionIsDefault, setPermissionIsDefault] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    setDismissed(safeGetLocalStorageItem(DISMISSED_STORAGE_KEY) === "true");
    setPermissionIsDefault("Notification" in window && Notification.permission === "default");
  }, []);

  const shouldShow = enabled && !dismissed && permissionIsDefault;

  async function handleEnable() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    setRequesting(true);
    try {
      const permission = await Notification.requestPermission();

      if (permission === "granted") {
        toast({
          title: "Lead alerts enabled",
          description: "You will now get browser alerts for new leads.",
          variant: "success",
        });
        setDismissed(true);
        safeSetLocalStorageItem(DISMISSED_STORAGE_KEY, "true");
        return;
      }

      toast({
        title: "Lead alerts not enabled",
        description: "You can enable browser notifications anytime in site settings.",
        variant: "default",
      });
      setDismissed(true);
      safeSetLocalStorageItem(DISMISSED_STORAGE_KEY, "true");
    } catch {
      toast({
        title: "Could not enable alerts",
        description: "Please try again from a supported browser.",
        variant: "destructive",
      });
    } finally {
      setRequesting(false);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    safeSetLocalStorageItem(DISMISSED_STORAGE_KEY, "true");
  }

  if (!shouldShow) {
    return null;
  }

  // Portal to <body>: the sticky header uses backdrop-filter, which would
  // otherwise become the containing block and pin this banner to the header.
  return createPortal(
    <div className="fixed bottom-24 left-4 right-4 z-50 md:hidden animate-in slide-in-from-bottom flex justify-center pb-safe">
      <div className="bg-background/95 backdrop-blur-md border shadow-lg rounded-xl p-3 flex items-center justify-between gap-3 w-full max-w-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-brand-green/10 to-transparent pointer-events-none" />

        <div className="flex items-center gap-2 relative z-10 min-w-0">
          <div className="bg-brand-green/10 p-2 rounded-lg text-brand-green">
            <Bell className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">Enable lead alerts</p>
            <p className="text-xs text-muted-foreground truncate">
              Get notified instantly when buyers message you.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 relative z-10">
          <Button
            size="sm"
            variant="trust-verified"
            className="h-10 rounded-full"
            onClick={() => void handleEnable()}
            disabled={requesting}
          >
            {requesting ? "Enabling..." : "Enable"}
          </Button>
          <button
            type="button"
            onClick={handleDismiss}
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Dismiss notification prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
