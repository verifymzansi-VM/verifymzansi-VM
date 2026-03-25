import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createPlaywrightSession,
  resetPlaywrightFixtureStoreForPersona,
} from "@/lib/supabase/playwright-fixture-store";
import { PLAYWRIGHT_SESSION_COOKIE } from "@/lib/supabase/playwright-stub";
import { isPlaywrightSupabaseStubMode, isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { parseAndValidateSearchParams } from "@/lib/utils/api";

const playwrightPersonaSchema = z
  .string()
  .min(1, "persona is required")
  .max(64, "persona is too long")
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "persona contains invalid characters");

const playwrightSessionQuerySchema = z.object({
  persona: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, playwrightPersonaSchema.optional()),
  project: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, playwrightPersonaSchema.optional()),
  reset: z.preprocess(
    (value) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) return true;
        if (["0", "false", "no", "off", ""].includes(normalized)) return false;
      }

      return value;
    },
    z.boolean({ error: "reset must be true or false" })
  ),
});

function ensureEnabled() {
  return isPlaywrightTestMode() && isPlaywrightSupabaseStubMode();
}

function isLocalOrTestHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".test")
  );
}

function isPrivilegedPersona(persona: string): boolean {
  const normalized = persona.trim().toLowerCase();
  return /(^|[-_])(admin|moderator|mod|staff|superuser|root)($|[-_])/.test(normalized);
}

export async function GET(request: NextRequest) {
  if (!ensureEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isLocalOrTestHost(new URL(request.url).hostname)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsedQuery = parseAndValidateSearchParams(
    new URL(request.url).searchParams,
    playwrightSessionQuerySchema,
    {
      validationErrorMessage: "Invalid Playwright session query",
      includeValidationDetails: false,
    }
  );

  if (!parsedQuery.success) {
    return parsedQuery.response;
  }

  const persona = parsedQuery.data.persona || parsedQuery.data.project || "verified-member";
  if (isPrivilegedPersona(persona)) {
    return NextResponse.json({ error: "Privileged personas are not allowed" }, { status: 403 });
  }

  if (parsedQuery.data.reset) {
    resetPlaywrightFixtureStoreForPersona(persona);
  }

  const { token, user } = createPlaywrightSession(persona);
  const response = NextResponse.json({
    success: true,
    persona,
    user: {
      id: user.id,
      email: user.email,
    },
  });

  response.cookies.set({
    name: PLAYWRIGHT_SESSION_COOKIE,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });

  return response;
}

export async function DELETE(request: NextRequest) {
  if (!ensureEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isLocalOrTestHost(new URL(request.url).hostname)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: PLAYWRIGHT_SESSION_COOKIE,
    value: "",
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
