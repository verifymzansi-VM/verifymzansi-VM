const AUTH_CALLBACK_PATH = "/auth/callback";

function toOrigin(rawUrl: string): string {
  return new URL(rawUrl).origin;
}

function isLoopbackOrigin(rawOrigin: string): boolean {
  const hostname = new URL(rawOrigin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function resolveAppOrigin(request: Pick<Request, "url">): string {
  const requestOrigin = toOrigin(request.url);
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredAppUrl) {
    const configuredOrigin = toOrigin(configuredAppUrl);

    // In production, a stale localhost app URL should not poison auth emails
    // when the incoming request already proves the app is running on a public host.
    if (
      process.env.NODE_ENV === "production" &&
      isLoopbackOrigin(configuredOrigin) &&
      !isLoopbackOrigin(requestOrigin)
    ) {
      return requestOrigin;
    }

    return configuredOrigin;
  }

  return requestOrigin;
}

export function buildAuthCallbackUrl(request: Pick<Request, "url">, nextPath: string): string {
  const callbackUrl = new URL(AUTH_CALLBACK_PATH, resolveAppOrigin(request));
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}
