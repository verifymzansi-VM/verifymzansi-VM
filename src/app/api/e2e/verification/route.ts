/**
 * POST /api/e2e/verification
 * Test-only fixture endpoint for driving the verification wizard end-to-end
 * in the Playwright stub environment. Guards mirror /api/e2e/auth/session:
 * it exists only when PLAYWRIGHT_TEST_MODE + stub Supabase mode are active
 * and the host is local, so it can never ship in a production deployment.
 *
 * Actions:
 * - { action: "reset", persona } — clears the persona's verification state
 *   (steps, sessions, OTP challenges/logs, risk signals) and reverts the
 *   profile to an unverified member. Also enables the kyc_v2_flow and
 *   kyc_gps_location feature flags in the stub store.
 * - { action: "seed_otp", persona, phone, otp } — replaces the persona's
 *   pending OTP challenge for that phone with one whose PBKDF2 hash matches
 *   the given plaintext OTP, so the browser flow can submit a known code
 *   after the real send endpoint created its (unknowable) challenge.
 */

import { type NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import {
  listPlaywrightTableRows,
  writePlaywrightTableRows,
} from "@/lib/supabase/playwright-fixture-store";
import { isPlaywrightSupabaseStubMode, isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";

const OTP_PBKDF2_ITERATIONS = 100000;

const VERIFICATION_TABLES = [
  "verification_steps",
  "verification_sessions",
  "verification_artifacts",
  "kyc_artifacts",
  "kyc_risk_signals",
  "otp_challenges",
  "otp_logs",
];

const personaSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset"), persona: personaSchema }),
  z.object({
    action: z.literal("seed_otp"),
    persona: personaSchema,
    phone: z.string().min(6).max(20),
    otp: z.string().regex(/^\d{6}$/),
  }),
]);

function ensureEnabled() {
  return isPlaywrightTestMode() && isPlaywrightSupabaseStubMode();
}

function isLocalOrTestHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".test")
  );
}

function hashOtp(otp: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  // Salt must be the decoded bytes, not the ASCII hex string, to match the
  // Web Crypto verification in /api/otp/verify.
  const hash = crypto
    .pbkdf2Sync(otp, Buffer.from(salt, "hex"), OTP_PBKDF2_ITERATIONS, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

function resetVerificationState(userId: string) {
  for (const table of VERIFICATION_TABLES) {
    const rows = listPlaywrightTableRows(table).filter((row) => row.user_id !== userId);
    writePlaywrightTableRows(table, rows);
  }

  const profiles = listPlaywrightTableRows("account_profiles").map((row) =>
    row.user_id === userId
      ? {
          ...row,
          phone: null,
          pending_phone: null,
          masked_phone_public: null,
          contact_last_phone_change_at: null,
          location_province: null,
          location_city: null,
          location_town: null,
          account_verification_status: "incomplete",
          updated_at: new Date().toISOString(),
        }
      : row
  );
  writePlaywrightTableRows("account_profiles", profiles);

  const enabledFlags = ["kyc_v2_flow", "kyc_gps_location"];
  const flags = listPlaywrightTableRows("feature_flags").filter(
    (row) => !enabledFlags.includes(String(row.key))
  );
  for (const key of enabledFlags) {
    flags.push({
      key,
      enabled: true,
      mode: "on",
      rollout_percent: null,
      allowlist_roles: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  writePlaywrightTableRows("feature_flags", flags);
}

function seedOtpChallenge(userId: string, rawPhone: string, otp: string) {
  const phone = normalizeSaPhone(rawPhone);
  const now = new Date();

  const challenges = listPlaywrightTableRows("otp_challenges").filter(
    (row) => !(row.user_id === userId && row.phone === phone && row.verified_at == null)
  );
  challenges.push({
    id: crypto.randomUUID(),
    user_id: userId,
    phone,
    otp_hash: hashOtp(otp),
    attempt_count: 0,
    locked_until: null,
    expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    verified_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  writePlaywrightTableRows("otp_challenges", challenges);

  return phone;
}

export async function POST(request: NextRequest) {
  if (!ensureEnabled() || !isLocalOrTestHost(new URL(request.url).hostname)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await parseAndValidateJsonRequest(request, bodySchema, {
    invalidJsonMessage: "Invalid JSON payload",
    validationErrorMessage: "Invalid request",
  });
  if (!parsed.success) {
    return parsed.response;
  }

  const userId = `pw-${parsed.data.persona}`;

  if (parsed.data.action === "reset") {
    resetVerificationState(userId);
    return NextResponse.json({ ok: true, userId });
  }

  const phone = seedOtpChallenge(userId, parsed.data.phone, parsed.data.otp);
  return NextResponse.json({ ok: true, userId, phone });
}
