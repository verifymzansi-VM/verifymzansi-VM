"use client";

import { useCallback, useEffect, useRef } from "react";
import { TURNSTILE_UNAVAILABLE_MESSAGE, getTurnstileClientState } from "@/lib/turnstile-client";

/**
 * Cloudflare Turnstile CAPTCHA widget.
 *
 * Renders the Turnstile challenge and calls onSuccess with the token
 * when the user passes. Falls back to a hidden input in development
 * when NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set.
 *
 * @see https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */

interface TurnstileWidgetProps {
  /** Called with the Turnstile token on successful challenge */
  onSuccess: (token: string) => void;
  /** Called when the token expires (user sat idle) */
  onExpire?: () => void;
  /** Called on error */
  onError?: (error: string) => void;
  /** Called when the script/widget is successfully loaded */
  onLoad?: () => void;
  /** Called when the widget cannot be rendered in the current environment */
  onUnavailable?: (message: string) => void;
  /** Widget theme */
  theme?: "light" | "dark" | "auto";
  /** Widget size */
  size?: "normal" | "compact";
  /** Additional CSS class */
  className?: string;
}

// Track global script load state
let scriptLoaded = false;
let scriptLoading = false;
let scriptFailed = false;
const loadCallbacks: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();

  // If a previous attempt failed, reset so we can retry
  if (scriptFailed) {
    scriptFailed = false;
    scriptLoading = false;
  }

  return new Promise((resolve, reject) => {
    if (scriptLoading) {
      loadCallbacks.push({ resolve, reject });
      return;
    }

    scriptLoading = true;

    // Set up the callback that Turnstile calls when ready
    (window as unknown as Record<string, unknown>).__turnstile_onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      scriptFailed = false;
      resolve();
      loadCallbacks.forEach((cb) => cb.resolve());
      loadCallbacks.length = 0;
    };

    // Remove any previously failed script tag
    const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstile_onload&render=explicit";
    script.async = true;
    script.defer = true;

    script.onerror = () => {
      scriptLoading = false;
      scriptFailed = true;
      const err = new Error("Turnstile script failed to load");
      reject(err);
      loadCallbacks.forEach((cb) => cb.reject(err));
      loadCallbacks.length = 0;
    };

    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  onSuccess,
  onExpire,
  onError,
  onLoad,
  onUnavailable,
  theme = "auto",
  size = "normal",
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const renderAttemptRef = useRef(0);
  const { mode, siteKey } = getTurnstileClientState();
  const isBypassMode = mode === "bypass";
  const isConfigured = mode === "configured";
  const isUnavailable = mode === "unavailable";

  const cleanupWidget = useCallback(() => {
    if (
      widgetIdRef.current !== null &&
      typeof window !== "undefined" &&
      (window as unknown as Record<string, { remove: (id: string) => void }>).turnstile
    ) {
      try {
        (window as unknown as Record<string, { remove: (id: string) => void }>).turnstile.remove(
          widgetIdRef.current
        );
      } catch {
        // Widget may already be cleaned up
      }
      widgetIdRef.current = null;
    }

    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
  }, []);

  const renderWidget = useCallback(async () => {
    if (!siteKey || !containerRef.current) return;

    // Clean up previous widget if re-rendering
    cleanupWidget();
    const attemptId = renderAttemptRef.current + 1;
    renderAttemptRef.current = attemptId;
    const container = containerRef.current;

    try {
      await loadTurnstileScript();
    } catch {
      onError?.("Turnstile script failed to load");
      return;
    }

    const turnstile = (
      window as unknown as Record<
        string,
        {
          render: (el: HTMLElement, opts: Record<string, unknown>) => string;
        }
      >
    ).turnstile;

    if (
      !turnstile ||
      !containerRef.current ||
      renderAttemptRef.current !== attemptId ||
      containerRef.current !== container
    ) {
      onError?.("Turnstile not available after script load");
      return;
    }

    // Signal that the widget has loaded
    onLoad?.();

    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme,
      size,
      callback: onSuccess,
      "expired-callback": onExpire,
      "error-callback": onError,
    });
  }, [siteKey, theme, size, onSuccess, onExpire, onError, onLoad, cleanupWidget]);

  useEffect(() => {
    if (!isConfigured) return;

    renderWidget();

    return () => {
      cleanupWidget();
    };
  }, [isConfigured, renderWidget, cleanupWidget]);

  useEffect(() => {
    if (isBypassMode) {
      onSuccess("dev-turnstile-bypass");
    }
  }, [isBypassMode, onSuccess]);

  useEffect(() => {
    if (isUnavailable) {
      onUnavailable?.(TURNSTILE_UNAVAILABLE_MESSAGE);
    }
  }, [isUnavailable, onUnavailable]);

  if (isBypassMode || isUnavailable) {
    return null;
  }

  return <div ref={containerRef} className={className} />;
}

/**
 * Retry loading the Turnstile widget. This resets the global script state
 * so a fresh attempt can be made after a failure.
 */
TurnstileWidget.retry = () => {
  scriptFailed = true; // forces reset on next loadTurnstileScript call
  scriptLoaded = false;
  scriptLoading = false;
};
