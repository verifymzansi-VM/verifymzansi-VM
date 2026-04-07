"use client";

import { useMemo, useState } from "react";
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
  const [dismissed, setDismissed] = useState(
    () => safeGetLocalStorageItem(DISMISSED_STORAGE_KEY) === "true"
  );
  const [requesting, setRequesting] = useState(false);

  const shouldShow = useMemo(() => {
    if (!enabled || dismissed) {
      return false;
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      return false;
    }

    return Notification.permission === "default";
  }, [dismissed, enabled]);

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

  return (
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
          <Button size="sm" onClick={() => void handleEnable()} disabled={requesting}>
            {requesting ? "Enabling..." : "Enable"}
          </Button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1 rounded-full text-muted-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss notification prompt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
