import { NextResponse, type NextRequest } from "next/server";
import {
  createPlaywrightSession,
  resetPlaywrightFixtureStoreForPersona,
} from "@/lib/supabase/playwright-fixture-store";
import { PLAYWRIGHT_SESSION_COOKIE } from "@/lib/supabase/playwright-stub";
import { isPlaywrightSupabaseStubMode, isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

function ensureEnabled() {
  return isPlaywrightTestMode() && isPlaywrightSupabaseStubMode();
}

function getPersona(request: NextRequest) {
  return (
    request.nextUrl.searchParams.get("persona") ||
    request.nextUrl.searchParams.get("project") ||
    "verified-member"
  );
}

function shouldReset(request: NextRequest) {
  return request.nextUrl.searchParams.get("reset") === "1";
}

export async function GET(request: NextRequest) {
  if (!ensureEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const persona = getPersona(request);
  if (shouldReset(request)) {
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

export async function DELETE(_request: NextRequest) {
  if (!ensureEnabled()) {
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
