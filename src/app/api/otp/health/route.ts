import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";

/**
 * OTP pipeline health check — verifies env vars, DB table,
 * Web Crypto availability, and admin client connectivity.
 *
 * Requires admin/moderator authentication.
 * Returns 200 with pass/fail per check.
 * Does NOT expose secret values.
 */
export async function GET() {
  // ── Auth guard: require admin/moderator ───────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await verifyStaffActorRoleFromDb(user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    // 1. Environment variables
    checks.supabaseUrl = {
      ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    };
    checks.serviceRoleKey = {
      ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    checks.africasTalkingApiKey = {
      ok: !!process.env.AFRICASTALKING_API_KEY,
    };
    checks.africasTalkingUsername = {
      ok: !!process.env.AFRICASTALKING_USERNAME,
    };

    // 2. Web Crypto API
    try {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      checks.webCryptoRandom = { ok: true };
    } catch {
      checks.webCryptoRandom = {
        ok: false,
        detail: "unavailable",
      };
    }

    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode("test"),
        "PBKDF2",
        false,
        ["deriveBits"]
      );
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: enc.encode("salt"), iterations: 1, hash: "SHA-512" },
        keyMaterial,
        64
      );
      checks.webCryptoPbkdf2 = { ok: true };
    } catch {
      checks.webCryptoPbkdf2 = {
        ok: false,
        detail: "unavailable",
      };
    }

    // 3. Admin Supabase client + table access
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { count: _count, error } = await admin
        .from("otp_challenges")
        .select("*", { count: "exact", head: true });

      if (error) {
        checks.otpChallengesTable = { ok: false, detail: "query_failed" };
      } else {
        checks.otpChallengesTable = { ok: true };
      }
    } catch {
      checks.otpChallengesTable = {
        ok: false,
        detail: "client_creation_failed",
      };
    }

    // 4. otp_logs table
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { count: _count, error } = await admin
        .from("otp_logs")
        .select("*", { count: "exact", head: true });

      if (error) {
        checks.otpLogsTable = { ok: false, detail: "query_failed" };
      } else {
        checks.otpLogsTable = { ok: true };
      }
    } catch {
      checks.otpLogsTable = {
        ok: false,
        detail: "client_creation_failed",
      };
    }

    const allOk = Object.values(checks).every((c) => c.ok);

    return NextResponse.json(
      { status: allOk ? "healthy" : "unhealthy", checks },
      { status: allOk ? 200 : 503 }
    );
  } catch {
    return NextResponse.json(
      {
        status: "error",
        detail: "Internal error",
        checks,
      },
      { status: 500 }
    );
  }
}
