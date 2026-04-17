import { cookies } from "next/headers";

export interface CookieStoreLike {
  get(name: string): { value: string } | undefined;
  set(options: { name: string; value: string; [key: string]: unknown }): void;
}

const EMPTY_COOKIE_STORE: CookieStoreLike = {
  get() {
    return undefined;
  },
  set() {},
};

function isMissingRequestScopeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("outside a request scope") ||
    message.includes("outside a request context") ||
    message.includes("next-dynamic-api-wrong-context")
  );
}

export async function getOptionalCookieStore(): Promise<CookieStoreLike> {
  try {
    return await cookies();
  } catch (error) {
    if (isMissingRequestScopeError(error)) {
      return EMPTY_COOKIE_STORE;
    }

    throw error;
  }
}

export function readCookieValue(cookieStore: CookieStoreLike, name: string) {
  return cookieStore.get(name)?.value;
}
