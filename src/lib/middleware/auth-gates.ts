import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { isStaff } from "@/lib/auth/roles";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("AuthGates");

export type CachedProfile = {
  phone?: string | null;
  account_status?: string | null;
  suspended_until?: string | null;
  account_verification_status?: string | null;
} | null;

// -- Cookie helpers ----------------------------------------------------------

export function setPhoneOkCookie(response: NextResponse): void {
  response.cookies.set("x-phone-ok", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 86400,
    path: "/",
  });
}

export function clearPhoneOkCookie(response: NextResponse): void {
  response.cookies.delete("x-phone-ok");
}

// -- Phone gate --------------------------------------------------------------

/**
 * Redirect users missing a phone number to the complete-profile page.
 * Returns a redirect response if gated, or null to continue.
 */
export async function checkPhoneGate(
  request: NextRequest,
  response: NextResponse,
  supabase: SupabaseClient,
  userId: string,
  cachedProfile: CachedProfile
): Promise<{ response: NextResponse | null; profile: CachedProfile }> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");
  const phoneGatedPrefixes = ["/dashboard", "/post", "/billing", "/verification"];
  const isPhoneGatedRoute = phoneGatedPrefixes.some((p) => pathname.startsWith(p));
  const isCompleteProfileRoute = pathname === "/dashboard/complete-profile";

  if (!isPhoneGatedRoute || isCompleteProfileRoute || isApiRoute) {
    return { response: null, profile: cachedProfile };
  }

  try {
    let profile = cachedProfile;
    if (!profile) {
      const { data } = await supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("phone, account_status, suspended_until, account_verification_status")
        .eq("user_id", userId)
        .maybeSingle();
      profile = data;
    }

    if (!profile?.phone) {
      const completeProfileUrl = new URL("/dashboard/complete-profile", request.url);
      completeProfileUrl.searchParams.set("returnUrl", pathname);
      const redirect = NextResponse.redirect(completeProfileUrl);
      clearPhoneOkCookie(redirect);
      return { response: redirect, profile };
    }

    setPhoneOkCookie(response);
    return { response: null, profile };
  } catch (phoneGateErr) {
    logger.error("Phone gate DB check failed — redirecting to error page", {
      path: pathname,
      userId,
      error: phoneGateErr instanceof Error ? phoneGateErr.message : "Unknown",
    });
    return {
      response: NextResponse.redirect(new URL("/error?reason=unavailable", request.url)),
      profile: cachedProfile,
    };
  }
}

// -- Admin gate --------------------------------------------------------------

/**
 * Enforce admin/moderator role on /admin routes.
 * Returns a response if gated, or null to continue.
 */
export function checkAdminGate(
  request: NextRequest,
  user: { app_metadata: Record<string, unknown>; is_anonymous?: boolean } | null
): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  if (
    pathname !== "/admin" &&
    !pathname.startsWith("/admin/") &&
    !pathname.startsWith("/api/admin/")
  ) {
    return null;
  }

  if (!user) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!isStaff(user)) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return null;
}

// -- Ban/suspension enforcement ----------------------------------------------

/**
 * Block banned/suspended users from protected routes and mutations.
 * Returns a response if blocked, or null to continue.
 */
export async function checkBanEnforcement(
  request: NextRequest,
  supabase: SupabaseClient,
  userId: string,
  isProtectedRoute: boolean,
  cachedProfile: CachedProfile
): Promise<{ response: NextResponse | null; profile: CachedProfile }> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");
  const isMutationRequest = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  const isBanEnforced = isProtectedRoute || (isApiRoute && isMutationRequest);

  if (!isBanEnforced) {
    return { response: null, profile: cachedProfile };
  }

  let statusProfile = cachedProfile;
  if (!statusProfile) {
    const { data, error: statusError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("account_status, suspended_until, account_verification_status")
      .eq("user_id", userId)
      .maybeSingle();

    if (!statusError) {
      statusProfile = data;
    } else {
      logger.error("Ban enforcement DB check failed — blocking access", {
        userId,
        error: statusError.message,
        code: statusError.code,
        path: pathname,
      });
      if (isApiRoute) {
        return {
          response: NextResponse.json(
            { error: "Service temporarily unavailable" },
            { status: 503 }
          ),
          profile: cachedProfile,
        };
      }
      return {
        response: NextResponse.redirect(new URL("/error", request.url)),
        profile: cachedProfile,
      };
    }
  }

  if (statusProfile) {
    if (statusProfile.account_status === "banned") {
      if (isApiRoute) {
        return {
          response: NextResponse.json({ error: "Banned" }, { status: 403 }),
          profile: statusProfile,
        };
      }
      return {
        response: NextResponse.redirect(new URL("/banned", request.url)),
        profile: statusProfile,
      };
    }

    if (statusProfile.account_status === "suspended") {
      const suspendResult = await handleSuspension(
        request,
        supabase,
        userId,
        statusProfile.suspended_until ?? null
      );
      if (suspendResult) {
        return { response: suspendResult, profile: statusProfile };
      }
    }
  }

  return { response: null, profile: statusProfile };
}

// -- Posting gate ------------------------------------------------------------

/**
 * Require a verified account for posting routes.
 * Returns a response if gated, or null to continue.
 */
export async function checkPostingGate(
  request: NextRequest,
  supabase: SupabaseClient,
  userId: string,
  cachedProfile: CachedProfile
): Promise<{ response: NextResponse | null; profile: CachedProfile }> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  const isPostingRoute =
    (pathname.startsWith("/post/create") && pathname !== "/post/create") ||
    pathname.startsWith("/post/edit") ||
    pathname.startsWith("/api/post/create") ||
    pathname.startsWith("/api/post/edit");

  if (!isPostingRoute) {
    return { response: null, profile: cachedProfile };
  }

  let profile = cachedProfile;
  let profileError: { message: string; code?: string } | null = null;

  if (!profile) {
    const { data, error } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("account_verification_status, account_status, suspended_until")
      .eq("user_id", userId)
      .maybeSingle();

    profile = data;
    profileError = error;
  }

  if (profileError) {
    logger.error("Account profile lookup failed in posting gate", {
      path: pathname,
      userId,
      error: profileError.message,
      code: profileError.code,
    });
  }

  if (profile?.account_status === "banned") {
    if (isApiRoute) {
      return { response: NextResponse.json({ error: "Banned" }, { status: 403 }), profile };
    }
    return { response: NextResponse.redirect(new URL("/banned", request.url)), profile };
  }

  if (profile?.account_status === "suspended") {
    const suspendResult = await handleSuspension(
      request,
      supabase,
      userId,
      profile.suspended_until ?? null
    );
    if (suspendResult) {
      return { response: suspendResult, profile };
    }
  }

  let canPost = readAccountVerificationStatus(profile) === "verified";

  if (!canPost) {
    const { data: verificationSteps, error: verificationStepsError } = await supabase
      .from("verification_steps")
      .select("step_type, status")
      .eq("user_id", userId);

    if (verificationStepsError) {
      logger.error("Verification step lookup failed in posting gate", {
        path: pathname,
        userId,
        error: verificationStepsError.message,
        code: verificationStepsError.code,
      });
    }

    canPost =
      summarizeVerification(profile?.account_verification_status, verificationSteps ?? [])
        .accountVerificationStatus === "verified";
  }

  if (!canPost) {
    if (isApiRoute) {
      return {
        response: NextResponse.json({ error: "Verification required" }, { status: 403 }),
        profile,
      };
    }
    const verificationUrl = new URL("/verification", request.url);
    verificationUrl.searchParams.set("returnUrl", pathname);
    return { response: NextResponse.redirect(verificationUrl), profile };
  }

  return { response: null, profile };
}

// -- Suspension helper -------------------------------------------------------

async function handleSuspension(
  request: NextRequest,
  supabase: SupabaseClient,
  userId: string,
  suspendedUntil: string | null
): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  if (suspendedUntil && new Date(suspendedUntil) <= new Date()) {
    try {
      const { error: unsuspendError } = await supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({ account_status: "active", suspended_until: null })
        .eq("user_id", userId);
      if (unsuspendError) {
        logger.error("Auto-unsuspend DB update failed — treating as still suspended", {
          userId,
          error: unsuspendError.message,
        });
        // Fall through to suspension handling below
      } else {
        return null;
      }
    } catch (unsuspendErr) {
      logger.error("Auto-unsuspend DB update failed — user will retry on next request", {
        userId,
        error: unsuspendErr instanceof Error ? unsuspendErr.message : "Unknown",
      });
      // Fall through to suspension handling below
    }
  }

  // Avoid redirect loop: if already on /dashboard with ?suspended, let it through
  if (pathname === "/dashboard" && request.nextUrl.searchParams.get("suspended") === "true") {
    return null;
  }

  if (isApiRoute) {
    return NextResponse.json({ error: "Suspended" }, { status: 403 });
  }

  const suspendedUrl = new URL("/dashboard", request.url);
  suspendedUrl.searchParams.set("suspended", "true");
  if (suspendedUntil) {
    suspendedUrl.searchParams.set("until", suspendedUntil);
  }
  return NextResponse.redirect(suspendedUrl);
}
