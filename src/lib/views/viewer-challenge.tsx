"use client";

import { createRoot } from "react-dom/client";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf-client";

/**
 * Gets this browser its signed view-and-like identifier (cookie `vmz_viewer`)
 * when the server asks for it (`needs_challenge`): one Turnstile check with the
 * site's own widget, shown only if Cloudflare needs the visitor to click
 * ("interaction-only", bottom corner), then /api/engagement/viewer. One check
 * at a time per page; after a failure no new check for 10 minutes, so a page
 * never loops. Resolves true when the browser now holds an identifier.
 */

const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const CHALLENGE_TIMEOUT_MS = 60 * 1000;

let pending: Promise<boolean> | null = null;
let failedAt = 0;

export function obtainViewerIdentifier(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve(false);
  pending ??= run()
    .then((ok) => {
      if (!ok) failedAt = Date.now();
      return ok;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function run() {
  const token = await challengeToken();
  if (!token) return false;
  try {
    await ensureCsrfTokenReady();
    const response = await fetch("/api/engagement/viewer", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ turnstile_token: token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function challengeToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-viewer-challenge", "");
    host.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:60;max-width:calc(100vw - 32px)";
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      // Unmount after the widget's own callback has returned.
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), CHALLENGE_TIMEOUT_MS);
    root.render(
      <TurnstileWidget
        appearance="interaction-only"
        size="compact"
        onSuccess={(token) => finish(token)}
        onError={() => finish(null)}
        onUnavailable={() => finish(null)}
      />
    );
  });
}
