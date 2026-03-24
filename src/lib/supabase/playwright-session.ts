import "server-only";

export const PLAYWRIGHT_SESSION_COOKIE = "vmz_pw_session";
const PLAYWRIGHT_SESSION_PREFIX = "persona:";

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

function decodeSessionPersona(token: string | null | undefined): string | null {
  const normalizedToken = token ? decodeURIComponent(token) : null;

  if (!normalizedToken?.startsWith(PLAYWRIGHT_SESSION_PREFIX)) {
    return null;
  }

  try {
    return decodeURIComponent(normalizedToken.slice(PLAYWRIGHT_SESSION_PREFIX.length));
  } catch {
    return null;
  }
}

function deterministicId(seed: string): string {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${hex}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(0, 4)}-${hex}${hex}`.slice(
    0,
    36
  );
}

function buildStubUser(persona: string): StubUser {
  const normalizedPersona = persona.trim() || "verified-member";

  return {
    id: deterministicId(`user:${normalizedPersona}`),
    email: `${normalizedPersona}@playwright.verifymzansi.test`,
    password: `Playwright-${normalizedPersona}-Password1!`,
    persona: normalizedPersona,
    is_anonymous: false,
    app_metadata: { role: normalizedPersona.includes("admin") ? "admin" : "member" },
    user_metadata: { display_name: `Playwright ${normalizedPersona}` },
    identities: [{ id: deterministicId(`identity:${normalizedPersona}`) }],
  };
}

export function getPlaywrightStubUserFromToken(token: string | null | undefined) {
  const persona = decodeSessionPersona(token);
  return persona ? buildStubUser(persona) : null;
}
