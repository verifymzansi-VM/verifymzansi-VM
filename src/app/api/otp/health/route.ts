import { NextResponse } from "next/server";

/**
 * OTP pipeline health check — verifies env vars, DB table,
 * Web Crypto availability, and admin client connectivity.
 *
 * Returns 200 with pass/fail per check.
 * Does NOT expose secret values.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    // 1. Environment variables
    checks.supabaseUrl = {
      ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      detail: process.env.NEXT_PUBLIC_SUPABASE_URL
        ? process.env.NEXT_PUBLIC_SUPABASE_URL.substring(0, 30) + "…"
        : "MISSING",
    };
    checks.serviceRoleKey = {
      ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      detail: process.env.SUPABASE_SERVICE_ROLE_KEY
        ? `set (${process.env.SUPABASE_SERVICE_ROLE_KEY.length} chars)`
        : "MISSING",
    };
    checks.africasTalkingApiKey = {
      ok: !!process.env.AFRICASTALKING_API_KEY,
      detail: process.env.AFRICASTALKING_API_KEY ? "set" : "MISSING",
    };
    checks.africasTalkingUsername = {
      ok: !!process.env.AFRICASTALKING_USERNAME,
      detail: process.env.AFRICASTALKING_USERNAME ? process.env.AFRICASTALKING_USERNAME : "MISSING",
    };

    // 2. Web Crypto API
    try {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      checks.webCryptoRandom = { ok: true, detail: `randomInt=${arr[0]}` };
    } catch (e) {
      checks.webCryptoRandom = {
        ok: false,
        detail: e instanceof Error ? e.message : "unavailable",
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
    } catch (e) {
      checks.webCryptoPbkdf2 = {
        ok: false,
        detail: e instanceof Error ? e.message : "unavailable",
      };
    }

    // 3. Admin Supabase client + table access
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { count, error } = await admin
        .from("otp_challenges")
        .select("*", { count: "exact", head: true });

      if (error) {
        checks.otpChallengesTable = { ok: false, detail: error.message };
      } else {
        checks.otpChallengesTable = { ok: true, detail: `rows=${count}` };
      }
    } catch (e) {
      checks.otpChallengesTable = {
        ok: false,
        detail: e instanceof Error ? e.message : "client creation failed",
      };
    }

    // 4. otp_logs table
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { count, error } = await admin
        .from("otp_logs")
        .select("*", { count: "exact", head: true });

      if (error) {
        checks.otpLogsTable = { ok: false, detail: error.message };
      } else {
        checks.otpLogsTable = { ok: true, detail: `rows=${count}` };
      }
    } catch (e) {
      checks.otpLogsTable = {
        ok: false,
        detail: e instanceof Error ? e.message : "client creation failed",
      };
    }

    const allOk = Object.values(checks).every((c) => c.ok);

    return NextResponse.json(
      { status: allOk ? "healthy" : "unhealthy", checks },
      { status: allOk ? 200 : 503 }
    );
  } catch (outerErr) {
    return NextResponse.json(
      {
        status: "error",
        detail: outerErr instanceof Error ? outerErr.message : "Unknown error",
        checks,
      },
      { status: 500 }
    );
  }
}
