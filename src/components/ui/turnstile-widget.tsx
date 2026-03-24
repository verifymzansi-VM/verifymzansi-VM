"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { TURNSTILE_UNAVAILABLE_MESSAGE, getTurnstileClientState } from "@/lib/turnstile-client";
import { shouldBypassTurnstileInNonProduction } from "@/lib/turnstile-mode";

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
const TERMINAL_TURNSTILE_ERROR_CODES = new Set(["110200"]);

function extractTurnstileErrorCode(error: unknown): string | null {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "number"
          ? String(error)
          : "";

  const match = /\b(\d{6})\b/.exec(message);
  return match ? match[1] : null;
}

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
    (window as typeof window & { __turnstile_onload?: () => void }).__turnstile_onload = () => {
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
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unavailableReportedRef = useRef(false);
  const bypassReportedRef = useRef(false);
  const errorCountRef = useRef(0);
  const [terminalUnavailable, setTerminalUnavailable] = useState(false);
  const runtimeConfig = getPublicRuntimeConfig();
  const { mode, siteKey } = getTurnstileClientState(runtimeConfig);
  const shouldBypassConfiguredTurnstile =
    typeof window !== "undefined" &&
    mode === "configured" &&
    shouldBypassTurnstileInNonProduction({
      currentHost: window.location.hostname,
      configuredAppUrl: runtimeConfig.appUrl,
      nodeEnv: process.env.NODE_ENV,
    });
  const isBypassMode = mode === "bypass" || shouldBypassConfiguredTurnstile;
  const isConfigured =
    mode === "configured" && !shouldBypassConfiguredTurnstile && !terminalUnavailable;
  const isUnavailable = mode === "unavailable" || terminalUnavailable;

  const clearRenderTimeout = useCallback(() => {
    if (renderTimeoutRef.current !== null) {
      clearTimeout(renderTimeoutRef.current);
      renderTimeoutRef.current = null;
    }
  }, []);

  const cleanupWidget = useCallback(() => {
    clearRenderTimeout();
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
  }, [clearRenderTimeout]);

  const markUnavailable = useCallback(
    (message = TURNSTILE_UNAVAILABLE_MESSAGE) => {
      cleanupWidget();
      setTerminalUnavailable(true);

      if (!unavailableReportedRef.current) {
        unavailableReportedRef.current = true;
        onUnavailable?.(message);
      }
    },
    [cleanupWidget, onUnavailable]
  );

  const renderWidget = useCallback(async () => {
    if (!siteKey || !containerRef.current) return;

    // Clean up previous widget if re-rendering
    cleanupWidget();
    const attemptId = renderAttemptRef.current + 1;
    renderAttemptRef.current = attemptId;
    errorCountRef.current = 0;
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
      callback: (token: string) => {
        clearRenderTimeout();
        onSuccess(token);
      },
      "expired-callback": () => {
        clearRenderTimeout();
        onExpire?.();
      },
      "error-callback": (err: string) => {
        clearRenderTimeout();
        errorCountRef.current += 1;

        if (
          TERMINAL_TURNSTILE_ERROR_CODES.has(extractTurnstileErrorCode(err) ?? "") ||
          errorCountRef.current >= 2
        ) {
          markUnavailable();
          return;
        }

        onError?.(err);
      },
    });

    // If Turnstile never fires any callback (e.g. headless browsers), stop
    // retrying and surface the shared unavailable state instead.
    renderTimeoutRef.current = setTimeout(() => {
      renderTimeoutRef.current = null;
      if (renderAttemptRef.current === attemptId) {
        markUnavailable();
      }
    }, 15_000);
  }, [
    siteKey,
    theme,
    size,
    onSuccess,
    onExpire,
    onError,
    onLoad,
    cleanupWidget,
    clearRenderTimeout,
    markUnavailable,
  ]);

  useEffect(() => {
    if (!shouldBypassConfiguredTurnstile || bypassReportedRef.current) return;

    cleanupWidget();
    bypassReportedRef.current = true;
    onSuccess("dev-turnstile-bypass");
  }, [shouldBypassConfiguredTurnstile, cleanupWidget, onSuccess]);

  useEffect(() => {
    if (!isConfigured) return;

    const shouldBypass = shouldBypassTurnstileInNonProduction({
      currentHost: window.location.hostname,
      configuredAppUrl: runtimeConfig.appUrl,
      nodeEnv: process.env.NODE_ENV,
    });
    if (shouldBypass) return;

    renderWidget();

    return () => {
      cleanupWidget();
    };
  }, [isConfigured, renderWidget, cleanupWidget, runtimeConfig.appUrl]);

  useEffect(() => {
    if (mode === "bypass" && !bypassReportedRef.current) {
      bypassReportedRef.current = true;
      onSuccess("dev-turnstile-bypass");
    }
  }, [mode, onSuccess]);

  useEffect(() => {
    if (mode === "unavailable") {
      cleanupWidget();
      if (!unavailableReportedRef.current) {
        unavailableReportedRef.current = true;
        onUnavailable?.(TURNSTILE_UNAVAILABLE_MESSAGE);
      }
    }
  }, [mode, cleanupWidget, onUnavailable]);

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
