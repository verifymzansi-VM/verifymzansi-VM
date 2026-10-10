import { decodePlaywrightPersona as decodeSessionPersona } from "./playwright-token";
import "server-only";

export const PLAYWRIGHT_SESSION_COOKIE = "vmz_pw_session";

/** Synthetic KYC reviewer only; callers must already enforce isolated E2E mode. */
export function getPlaywrightPersonaRole(
  persona: string
): "member" | "moderator" | "governance_controller" {
  if (/^kyc-governor(?:-[A-Za-z0-9]+)*$/.test(persona)) return "governance_controller";
  return /^kyc-reviewer(?:-[A-Za-z0-9]+)*$/.test(persona) ? "moderator" : "member";
}

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
    app_metadata: { role: getPlaywrightPersonaRole(normalizedPersona) },
    user_metadata: { display_name: `Playwright ${normalizedPersona}` },
    identities: [{ id: deterministicId(`identity:${normalizedPersona}`) }],
  };
}

export function getPlaywrightStubUserFromToken(token: string | null | undefined) {
  const persona = decodeSessionPersona(token);
  return persona ? buildStubUser(persona) : null;
}
