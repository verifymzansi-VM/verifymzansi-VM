import "server-only";

type StubUser = {
  id: string;
  email: string;
  password: string;
  persona: string;
  is_anonymous: false;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: Array<{ id: string }>;
};

type PlaywrightFixtureStore = {
  sessions: Map<string, string>;
  users: Map<string, StubUser>;
};

const GLOBAL_KEY = "__verifymzansiPlaywrightFixtureStore";

export const PLAYWRIGHT_SESSION_COOKIE = "vmz_pw_session";

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function getPlaywrightFixtureStore(): PlaywrightFixtureStore | null {
  const container = globalThis as unknown as Record<string, PlaywrightFixtureStore | undefined>;
  return container[GLOBAL_KEY] ?? null;
}

export function getPlaywrightStubUserFromToken(token: string | null | undefined) {
  if (!token) return null;

  const store = getPlaywrightFixtureStore();
  if (!store) {
    return null;
  }

  const userId = store.sessions.get(token);
  if (!userId) {
    return null;
  }

  return cloneValue(store.users.get(userId) ?? null);
}
