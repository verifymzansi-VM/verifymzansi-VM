"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { TURNSTILE_UNAVAILABLE_MESSAGE, getTurnstileClientState } from "@/lib/turnstile-client";
import {
  TURNSTILE_SCRIPT_MAX_RETRIES,
  TURNSTILE_SCRIPT_RETRY_BASE_DELAY_MS,
  TURNSTILE_WIDGET_RENDER_TIMEOUT_MS,
} from "@/lib/turnstile-constants";
import { shouldBypassTurnstileInNonProduction } from "@/lib/turnstile-mode";
import { useHydrated } from "@/hooks/use-hydrated";
import { createLogger } from "@/lib/utils/logger";

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
  /** Changes when the caller wants to explicitly retry the widget */
  retryToken?: number;
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

// Track global script load state
let scriptLoaded = false;
let scriptLoading = false;
let scriptFailed = false;
const loadCallbacks: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
const TERMINAL_TURNSTILE_ERROR_CODES = new Set(["110200"]);
const log = createLogger("TurnstileWidget");

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

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  retryToken,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const renderAttemptRef = useRef(0);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unavailableReportedRef = useRef(false);
  const bypassReportedRef = useRef(false);
  const errorCountRef = useRef(0);
  const terminalErrorCountRef = useRef(0);
  const [unavailableRetryToken, setUnavailableRetryToken] = useState<number | undefined>(undefined);
  const onSuccessRef = useLatestRef(onSuccess);
  const onExpireRef = useLatestRef(onExpire);
  const onErrorRef = useLatestRef(onError);
  const onLoadRef = useLatestRef(onLoad);
  const onUnavailableRef = useLatestRef(onUnavailable);
  const isHydrated = useHydrated();
  const runtimeConfig = getPublicRuntimeConfig();
  const { mode, siteKey } = getTurnstileClientState(runtimeConfig);
  const shouldBypassConfiguredTurnstile =
    isHydrated &&
    mode === "configured" &&
    shouldBypassTurnstileInNonProduction({
      currentHost: window.location.hostname,
      configuredAppUrl: runtimeConfig.appUrl,
      nodeEnv: process.env.NODE_ENV,
    });
  const isBypassMode = mode === "bypass" || shouldBypassConfiguredTurnstile;
  const terminalUnavailable =
    unavailableRetryToken !== undefined && unavailableRetryToken === retryToken;
  const isConfigured =
    mode === "configured" && !shouldBypassConfiguredTurnstile && !terminalUnavailable;
  const isUnavailable = mode === "unavailable" || terminalUnavailable;

  useEffect(() => {
    unavailableReportedRef.current = false;
    bypassReportedRef.current = false;
    errorCountRef.current = 0;
    terminalErrorCountRef.current = 0;
  }, [retryToken]);

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
      setUnavailableRetryToken(retryToken);

      log.warn("Marking Turnstile as unavailable", {
        reason: message,
        retryToken,
      });

      if (!unavailableReportedRef.current) {
        unavailableReportedRef.current = true;
        onUnavailableRef.current?.(message);
      }
    },
    [cleanupWidget, onUnavailableRef, retryToken]
  );

  const renderWidget = useCallback(async () => {
    if (!siteKey || !containerRef.current) return;

    // Clean up previous widget if re-rendering
    cleanupWidget();
    const attemptId = renderAttemptRef.current + 1;
    renderAttemptRef.current = attemptId;
    errorCountRef.current = 0;
    terminalErrorCountRef.current = 0;
    const container = containerRef.current;

    let loaded = false;
    for (let attempt = 0; attempt <= TURNSTILE_SCRIPT_MAX_RETRIES; attempt += 1) {
      try {
        await loadTurnstileScript();
        loaded = true;
        break;
      } catch {
        log.warn("Turnstile script load attempt failed", {
          attempt: attempt + 1,
          maxAttempts: TURNSTILE_SCRIPT_MAX_RETRIES + 1,
        });

        if (attempt >= TURNSTILE_SCRIPT_MAX_RETRIES) {
          markUnavailable(
            "Security verification is temporarily unavailable. Please try again later."
          );
          return;
        }

        await waitFor(TURNSTILE_SCRIPT_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }

    if (!loaded) {
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
      onErrorRef.current?.("Turnstile not available after script load");
      return;
    }

    // Signal that the widget has loaded
    onLoadRef.current?.();

    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme,
      size,
      callback: (token: string) => {
        clearRenderTimeout();
        onSuccessRef.current(token);
      },
      "expired-callback": () => {
        clearRenderTimeout();
        onExpireRef.current?.();
      },
      "error-callback": (err: string) => {
        clearRenderTimeout();
        errorCountRef.current += 1;

        const turnstileErrorCode = extractTurnstileErrorCode(err) ?? "";
        const isTerminalError = TERMINAL_TURNSTILE_ERROR_CODES.has(turnstileErrorCode);

        log.warn("Turnstile challenge callback error", {
          errorCode: turnstileErrorCode || "unknown",
          isTerminalError,
          errorCount: errorCountRef.current,
          terminalErrorCount: terminalErrorCountRef.current,
        });

        if (isTerminalError) {
          terminalErrorCountRef.current += 1;

          if (terminalErrorCountRef.current >= 2) {
            markUnavailable();
            return;
          }

          onErrorRef.current?.(err);
          return;
        }

        if (errorCountRef.current >= 2) {
          markUnavailable();
          return;
        }

        onErrorRef.current?.(err);
      },
    });

    // If Turnstile never fires any callback (e.g. headless browsers), stop
    // retrying and surface the shared unavailable state instead.
    renderTimeoutRef.current = setTimeout(() => {
      renderTimeoutRef.current = null;
      if (renderAttemptRef.current === attemptId) {
        log.warn("Turnstile render timed out", {
          timeoutMs: TURNSTILE_WIDGET_RENDER_TIMEOUT_MS,
          attemptId,
        });
        markUnavailable();
      }
    }, TURNSTILE_WIDGET_RENDER_TIMEOUT_MS);
  }, [
    siteKey,
    theme,
    size,
    cleanupWidget,
    clearRenderTimeout,
    markUnavailable,
    onErrorRef,
    onExpireRef,
    onLoadRef,
    onSuccessRef,
  ]);

  useEffect(() => {
    if (!isBypassMode || bypassReportedRef.current) return;

    cleanupWidget();
    bypassReportedRef.current = true;
    log.info("Using Turnstile bypass mode on client", {
      mode,
      shouldBypassConfiguredTurnstile,
    });
    onSuccessRef.current("dev-turnstile-bypass");
  }, [cleanupWidget, isBypassMode, mode, onSuccessRef, shouldBypassConfiguredTurnstile]);

  useEffect(() => {
    if (!isConfigured) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void renderWidget();
      }
    });

    return () => {
      cancelled = true;
      cleanupWidget();
    };
  }, [cleanupWidget, isConfigured, renderWidget, retryToken]);

  useEffect(() => {
    if (mode === "unavailable") {
      cleanupWidget();
      if (!unavailableReportedRef.current) {
        unavailableReportedRef.current = true;
        onUnavailableRef.current?.(TURNSTILE_UNAVAILABLE_MESSAGE);
      }
    }
  }, [mode, cleanupWidget, onUnavailableRef]);

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
