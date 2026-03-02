"use client";

import { useCallback, useEffect, useRef } from "react";

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
const loadCallbacks: (() => void)[] = [];

function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();

  return new Promise((resolve) => {
    if (scriptLoading) {
      loadCallbacks.push(resolve);
      return;
    }

    scriptLoading = true;

    // Set up the callback that Turnstile calls when ready
    (window as unknown as Record<string, unknown>).__turnstile_onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks.length = 0;
    };

    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstile_onload&render=explicit";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  onSuccess,
  onExpire,
  onError,
  theme = "auto",
  size = "normal",
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const isDev = !siteKey || siteKey === "dummy_site_key";

  const renderWidget = useCallback(async () => {
    if (!siteKey || !containerRef.current) return;

    // Clean up previous widget if re-rendering
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
    }

    await loadTurnstileScript();

    const turnstile = (
      window as unknown as Record<
        string,
        {
          render: (el: HTMLElement, opts: Record<string, unknown>) => string;
        }
      >
    ).turnstile;

    if (!turnstile || !containerRef.current) return;

    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme,
      size,
      callback: onSuccess,
      "expired-callback": onExpire,
      "error-callback": onError,
    });
  }, [siteKey, theme, size, onSuccess, onExpire, onError]);

  // No client-side dev bypass. Server-side bypass in src/lib/utils/turnstile.ts
  // handles dev mode token validation. In dev, show a manual trigger button.

  useEffect(() => {
    if (isDev) return;

    renderWidget();

    return () => {
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
          // ignore
        }
      }
    };
  }, [isDev, renderWidget]);

  // Auto-bypass Turnstile in dev mode so login works without real keys
  useEffect(() => {
    if (isDev) {
      onSuccess("dev-turnstile-bypass");
    }
  }, [isDev, onSuccess]);

  if (isDev) {
    return null;
  }

  return <div ref={containerRef} className={className} />;
}
