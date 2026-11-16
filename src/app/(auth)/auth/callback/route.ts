import { handleFoundationConfirmation } from "@/app/api/foundation/auth/_lib/confirmation";
import {
  EMAIL_CHANGE_LANDING_PARAM,
  handleFoundationEmailChangeLanding,
} from "@/app/api/foundation/auth/_lib/email-change-landing";
import { NextResponse } from "next/server";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";
import { foundationAuthPrivateResponse } from "@/app/api/foundation/auth/_lib/attempt-route";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Email change links only pick a page; they never reach the session handlers.
  if (searchParams.get("backend") === "foundation" && searchParams.has(EMAIL_CHANGE_LANDING_PARAM))
    return handleFoundationEmailChangeLanding(request);
  if (searchParams.get("backend") === "foundation")
    return handleFoundationConfirmation(
      request,
      searchParams.get("recovery") === "1"
        ? "recovery"
        : searchParams.get("oauth") === "google"
          ? "google"
          : "signup"
    );
  return foundationAuthPrivateResponse(
    NextResponse.redirect(
      new URL("/login?error=auth_callback_failed", resolveAppOrigin(request)),
      303
    )
  );
}
