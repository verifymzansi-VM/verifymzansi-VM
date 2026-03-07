const AUTH_CALLBACK_PATH = "/auth/callback";

function toOrigin(rawUrl: string): string {
  return new URL(rawUrl).origin;
}

function resolveBaseOrigin(request: Pick<Request, "url">): string {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredAppUrl) {
    return toOrigin(configuredAppUrl);
  }

  return toOrigin(request.url);
}

export function buildAuthCallbackUrl(request: Pick<Request, "url">, nextPath: string): string {
  const callbackUrl = new URL(AUTH_CALLBACK_PATH, resolveBaseOrigin(request));
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}
