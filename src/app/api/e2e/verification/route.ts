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
 *   profile to an unverified member. Also enables the kyc_v2_flow
 *   feature flag in the stub store.
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
  ensurePlaywrightVerifiedMember,
} from "@/lib/supabase/playwright-fixture-store";
import { isPlaywrightSupabaseStubMode, isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";

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
  z.object({ action: z.literal("prepare_kyc"), persona: personaSchema }),
  z.object({ action: z.literal("snapshot"), persona: personaSchema }),
  z.object({ action: z.literal("claim"), persona: personaSchema, stepId: uuidSchema }),
  z.object({
    action: z.literal("set_risk"),
    persona: personaSchema,
    stepId: uuidSchema,
    riskLevel: z.enum(["low", "high"]),
    riskScore: z.number().int().min(0).max(100),
  }),
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
          legal_first_name: null,
          legal_last_name: null,
          legal_name_locked_at: null,
          updated_at: new Date().toISOString(),
        }
      : row
  );
  writePlaywrightTableRows("account_profiles", profiles);

  const enabledFlags = ["kyc_v2_flow"];
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

  const userId = ensurePlaywrightVerifiedMember(parsed.data.persona).id;

  if (parsed.data.action === "snapshot") {
    const steps = listPlaywrightTableRows("verification_steps")
      .filter((row) => row.user_id === userId)
      .map(
        ({
          id,
          step_type,
          status,
          artifact_id,
          updated_at,
          risk_level,
          reviewed_by,
          reviewed_at,
        }) => ({
          id,
          step_type,
          status,
          artifact_id,
          updated_at,
          risk_level,
          reviewed_by,
          reviewed_at,
        })
      );
    const profile = listPlaywrightTableRows("account_profiles").find(
      (row) => row.user_id === userId
    );
    const artifacts = listPlaywrightTableRows("kyc_artifacts")
      .filter((row) => row.user_id === userId)
      .map(({ id, step_type, status, purge_after }) => ({ id, step_type, status, purge_after }));
    return NextResponse.json({
      ok: true,
      userId,
      steps,
      artifacts,
      profile: {
        account_verification_status: profile?.account_verification_status,
        display_name: profile?.display_name,
        legal_name_locked_at: profile?.legal_name_locked_at,
      },
    });
  }
  if (parsed.data.action === "set_risk") {
    const role = listPlaywrightTableRows("staff_roles").find(
      (row) => row.user_id === userId && row.status === "active"
    );
    if (!role) return NextResponse.json({ error: "Reviewer fixture required" }, { status: 403 });
    const { stepId, riskLevel, riskScore } = parsed.data;
    const steps = listPlaywrightTableRows("verification_steps");
    if (!steps.some((row) => row.id === stepId))
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    writePlaywrightTableRows(
      "verification_steps",
      steps.map((row) =>
        row.id === stepId
          ? {
              ...row,
              risk_level: riskLevel,
              risk_score: riskScore,
              updated_at: new Date().toISOString(),
            }
          : row
      )
    );
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.action === "claim") {
    const { stepId } = parsed.data;
    const role = listPlaywrightTableRows("staff_roles").find(
      (row) => row.user_id === userId && row.status === "active"
    );
    if (!role) return NextResponse.json({ error: "Reviewer fixture required" }, { status: 403 });
    const rows = listPlaywrightTableRows("queue_claims").filter((row) => row.item_id !== stepId);
    rows.push({
      id: crypto.randomUUID(),
      queue: "kyc",
      item_type: "verification_step",
      item_id: stepId,
      claimed_by: userId,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    });
    writePlaywrightTableRows("queue_claims", rows);
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "prepare_kyc") {
    resetVerificationState(userId);
    const now = new Date().toISOString();
    writePlaywrightTableRows(
      "account_profiles",
      listPlaywrightTableRows("account_profiles").map((row) =>
        row.user_id === userId ? { ...row, phone: "+27110000000" } : row
      )
    );
    const steps = listPlaywrightTableRows("verification_steps");
    steps.push({
      id: crypto.randomUUID(),
      user_id: userId,
      step_type: "phone",
      status: "approved",
      phone_verified_at: now,
      created_at: now,
      updated_at: now,
    });
    writePlaywrightTableRows("verification_steps", steps);
    return NextResponse.json({ ok: true, userId });
  }

  if (parsed.data.action === "reset") {
    resetVerificationState(userId);
    return NextResponse.json({ ok: true, userId });
  }

  const phone = seedOtpChallenge(userId, parsed.data.phone, parsed.data.otp);
  return NextResponse.json({ ok: true, userId, phone });
}
