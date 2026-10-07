import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as sendOtp } from "@/app/api/otp/send/route";
import { POST as verifyOtp } from "@/app/api/otp/verify/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as smsService from "@/lib/services/sms";
import { sendPhoneChangeNotification } from "@/lib/services/email";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const CSRF_TOKEN = "a".repeat(64);
const OTP_PBKDF2_ITERATIONS = 100000;

async function hashOtpForTest(otp: string): Promise<string> {
  const salt = new Uint8Array(16);
  salt.fill(7);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(otp), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: OTP_PBKDF2_ITERATIONS,
      hash: "SHA-512",
    },
    keyMaterial,
    512
  );
  const toHex = (buf: Uint8Array) =>
    Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return `${toHex(salt)}:${toHex(new Uint8Array(derivedBits))}`;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/services/sms", () => ({
  sendOtpSms: vi.fn(),
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/services/email", () => ({
  sendPhoneChangeNotification: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

function createMockRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

function createMissingCsrfRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

// ── OTP send helpers ────────────────────────────────────────────────────────

/** pending_phone staging is written with the admin client. */
function createStagingMock(error: { code?: string; message?: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  return { update, eq };
}

/** Routes the profile table to the staging mock and everything else to `defaultQuery`. */
function routeAdminTables(defaultQuery: unknown, staging: ReturnType<typeof createStagingMock>) {
  return vi.fn((table: string) =>
    table === ACCOUNT_PROFILE_WRITE_TABLE ? { update: staging.update } : defaultQuery
  );
}

function createSendAdminQuery(
  recentSends = 0,
  insert = vi.fn().mockResolvedValue({ error: null })
) {
  const adminQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    delete: vi.fn(),
    insert,
  };
  adminQuery.select.mockReturnValue(adminQuery);
  adminQuery.eq.mockReturnValue(adminQuery);
  adminQuery.gte.mockResolvedValue({ count: recentSends });

  const invalidateQuery = {
    eq: vi.fn(),
    is: vi.fn().mockResolvedValue({ error: null }),
  };
  invalidateQuery.eq.mockReturnValue(invalidateQuery);
  adminQuery.delete.mockReturnValue(invalidateQuery);

  return adminQuery;
}

// ── OTP verify helpers ──────────────────────────────────────────────────────

type MockDbError = { code?: string; message: string } | null;

/**
 * Admin client for the verify route. Models:
 * - the active-challenge lookup,
 * - the increment_otp_attempt RPC that reserves an attempt before comparing,
 * - the atomic claim (update → eq → is → select → maybeSingle),
 * - the sibling-challenge invalidation (update → eq → eq → is → neq),
 * - ensureAccountProfile + the single admin profile update scoped by id and user_id,
 * - verification_steps / verification_sessions upserts and the otp_logs sync.
 */
function buildVerifyAdmin(options: {
  storedHash: string;
  attemptCount?: number | null;
  rpcError?: MockDbError;
  claimed?: boolean;
  existingProfile?: { id: string; display_name: string } | null;
  createdProfileId?: string;
  profileUpdateError?: MockDbError;
  stepsError?: MockDbError;
  sessionError?: MockDbError;
}) {
  const challengeRow = {
    id: "challenge-1",
    otp_hash: options.storedHash,
    attempt_count: 0,
    locked_until: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };

  const rpc = vi.fn().mockResolvedValue(
    options.rpcError
      ? { data: null, error: options.rpcError }
      : {
          data: [
            {
              new_attempt_count: options.attemptCount === undefined ? 1 : options.attemptCount,
              new_locked_until: null,
            },
          ],
          error: null,
        }
  );

  const claimMaybeSingle = vi.fn().mockResolvedValue({
    data: options.claimed === false ? null : { id: "challenge-1" },
    error: null,
  });
  const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle });
  const siblingNeq = vi.fn().mockResolvedValue({ error: null });
  const challengeUpdate = vi.fn().mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue({ select: claimSelect, neq: siblingNeq });
    return chain;
  });

  const existingProfile =
    options.existingProfile === undefined
      ? { id: "profile-1", display_name: "Member" }
      : options.existingProfile;
  const profileUpsertSingle = vi.fn().mockResolvedValue({
    data: { id: options.createdProfileId ?? "profile-created", display_name: "New Member" },
    error: null,
  });
  const profileUpsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: profileUpsertSingle }),
  });
  const profileUserEq = vi.fn().mockResolvedValue({ error: options.profileUpdateError ?? null });
  const profileIdEq = vi.fn().mockReturnValue({ eq: profileUserEq });
  const profileUpdate = vi.fn().mockReturnValue({ eq: profileIdEq });

  const verificationStepUpsert = vi.fn().mockResolvedValue({ error: options.stepsError ?? null });
  const sessionUpsert = vi.fn().mockResolvedValue({ error: options.sessionError ?? null });

  const otpLogVerifyIs = vi.fn().mockResolvedValue({ error: null });
  const otpLogVerifyHashEq = vi.fn().mockReturnValue({ is: otpLogVerifyIs });
  const otpLogVerifyPhoneEq = vi.fn().mockReturnValue({ eq: otpLogVerifyHashEq });

  const from = vi.fn((table: string) => {
    if (table === "otp_challenges") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: challengeRow, error: null }),
        update: challengeUpdate,
      };
    }

    if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: existingProfile, error: null }),
          }),
        }),
        upsert: profileUpsert,
        update: profileUpdate,
      };
    }

    if (table === "verification_steps") {
      return { upsert: verificationStepUpsert };
    }

    if (table === "verification_sessions") {
      return { upsert: sessionUpsert };
    }

    if (table === "otp_logs") {
      return { update: vi.fn().mockReturnValue({ eq: otpLogVerifyPhoneEq }) };
    }

    return {};
  });

  const admin = { from, rpc };
  vi.mocked(createAdminClient).mockReturnValue(admin as never);

  return {
    admin,
    rpc,
    challengeUpdate,
    claimMaybeSingle,
    siblingNeq,
    profileUpsert,
    profileUpsertSingle,
    profileUpdate,
    profileIdEq,
    profileUserEq,
    verificationStepUpsert,
    sessionUpsert,
    otpLogVerifyPhoneEq,
    otpLogVerifyHashEq,
    otpLogVerifyIs,
  };
}

describe("OTP Routes", () => {
  const mockUserClient = {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    // The user-scoped client only reads the profile; all profile writes go
    // through the admin client.
    mockUserClient.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }

      return {};
    });
    vi.mocked(createClient).mockResolvedValue(mockUserClient as never);
  });

  describe("POST /api/otp/send", () => {
    it("rejects requests without a CSRF token", async () => {
      const res = await sendOtp(
        createMissingCsrfRequest("/api/otp/send", { phone: "+27821234567" })
      );

      expect(res.status).toBe(403);
    });

    it("returns the shared rate-limit response when the external limiter blocks the request", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 45 });

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("45");
      expect(data).toMatchObject({
        error: "Too many OTP requests. Please wait before trying again.",
        code: "rate_limited",
        retryAfter: 45,
      });
    });

    it("fails closed with 429 when the shared limiter is degraded, since every OTP is a paid SMS", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        limited: true,
        degraded: true,
        retryAfter: 30,
      });

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data).toMatchObject({
        error: "Too many OTP requests. Please wait before trying again.",
        code: "rate_limited",
        retryAfter: 30,
      });
      expect(checkRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "otp:send", degradedMode: "block" })
      );
      expect(smsService.sendOtpSms).not.toHaveBeenCalled();
    });

    it("blocks when the per-IP send limit is exceeded, before staging or sending", async () => {
      vi.mocked(checkRateLimit)
        .mockResolvedValueOnce({ limited: false })
        .mockResolvedValueOnce({ limited: false })
        .mockResolvedValueOnce({ limited: true, retryAfter: 120 });
      const staging = createStagingMock();
      vi.mocked(createAdminClient).mockReturnValue({
        from: routeAdminTables(createSendAdminQuery(), staging),
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("120");
      expect(data).toMatchObject({ code: "rate_limited", retryAfter: 120 });
      expect(checkRateLimit).toHaveBeenNthCalledWith(3, {
        key: "127.0.0.1",
        action: "otp:send:ip",
        degradedMode: "block",
      });
      expect(staging.update).not.toHaveBeenCalled();
      expect(smsService.sendOtpSms).not.toHaveBeenCalled();
    });

    it("blocks when challenge send limit is exceeded", async () => {
      const staging = createStagingMock();
      const mockAdminClient = {
        from: routeAdminTables(createSendAdminQuery(5), staging),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(data.error).toBe("Maximum SMS limit reached. Please try again in 1 hour.");
      expect(data.code).toBe("hourly_limit_reached");
      expect(data.retryAfter).toBe(3600);
    });

    it("creates challenge and sends OTP when allowed", async () => {
      const otpLogInsert = vi
        .fn()
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: null });
      const staging = createStagingMock();
      const mockAdminClient = {
        from: routeAdminTables(createSendAdminQuery(0, otpLogInsert), staging),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      vi.mocked(smsService.sendOtpSms).mockResolvedValue({
        success: true,
        messageId: "sms-1",
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true });
      expect(smsService.sendOtpSms).toHaveBeenCalledWith("+27821234567", expect.any(String));
      expect(otpLogInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: "+27821234567",
          delivery_status: "sent",
          provider_name: "africastalking",
          provider_message_id: "sms-1",
          provider_error: null,
        })
      );
      // All three limits fail closed; the per-IP cap runs after the per-user caps.
      expect(checkRateLimit).toHaveBeenNthCalledWith(1, {
        key: "user-1:+27821234567",
        action: "otp:send",
        degradedMode: "block",
      });
      expect(checkRateLimit).toHaveBeenNthCalledWith(2, {
        key: "user-1",
        action: "otp:send:user",
        degradedMode: "block",
      });
      expect(checkRateLimit).toHaveBeenNthCalledWith(3, {
        key: "127.0.0.1",
        action: "otp:send:ip",
        degradedMode: "block",
      });
      // pending_phone is staged with the admin client, scoped to the user.
      expect(staging.update).toHaveBeenCalledWith({ pending_phone: "+27821234567" });
      expect(staging.eq).toHaveBeenCalledWith("user_id", "user-1");
    });

    it("returns a structured provider error when the SMS provider rejects the send", async () => {
      const otpLogInsert = vi
        .fn()
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: null });
      const staging = createStagingMock();
      const mockAdminClient = {
        from: routeAdminTables(createSendAdminQuery(0, otpLogInsert), staging),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      vi.mocked(smsService.sendOtpSms).mockResolvedValue({
        success: false,
        error: "HTTP 401: Generator rejected",
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(502);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(data).toMatchObject({
        error: "Failed to send OTP. Please try again.",
        code: "sms_delivery_failed",
        detail: "The SMS provider could not accept the message.",
        retryAfter: 60,
      });
      expect(otpLogInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: "+27821234567",
          delivery_status: "failed",
          provider_name: "africastalking",
          provider_message_id: undefined,
          provider_error: "HTTP 401: Generator rejected",
        })
      );
    });

    it("returns 409 when staging pending_phone fails with unique conflict", async () => {
      const staging = createStagingMock({
        code: "23505",
        message: "duplicate key value violates unique constraint",
      });
      vi.mocked(createAdminClient).mockReturnValue({
        from: routeAdminTables(createSendAdminQuery(), staging),
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data).toMatchObject({
        error: "This phone number is already linked to another account.",
      });
      expect(staging.update).toHaveBeenCalledWith({ pending_phone: "+27821234567" });
      expect(smsService.sendOtpSms).not.toHaveBeenCalled();
    });

    it("returns 409 when the phone is already verified on the same account", async () => {
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { phone: "+27821234567" },
                  error: null,
                }),
              }),
            }),
            update: vi.fn(),
          };
        }

        return {};
      });

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data).toMatchObject({
        error: "This phone number is already verified on your account.",
        code: "already_verified",
      });
      expect(smsService.sendOtpSms).not.toHaveBeenCalled();
    });

    it("returns 429 with the phoneCooldown payload when the 15-day phone change cooldown is active", async () => {
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    phone: "+27820000000",
                    contact_last_phone_change_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn(),
          };
        }

        return {};
      });

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data.code).toBe("PHONE_COOLDOWN");
      expect(data.error).toMatch(/change your phone number again after/i);
      expect(data.retryAfter).toEqual(expect.any(String));
      expect(smsService.sendOtpSms).not.toHaveBeenCalled();
    });

    it("proceeds with the OTP send when the phone change cooldown has expired", async () => {
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    phone: "+27820000000",
                    contact_last_phone_change_at: "2020-01-01T00:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }

        return {};
      });

      const staging = createStagingMock();
      const mockAdminClient = {
        from: routeAdminTables(createSendAdminQuery(), staging),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      vi.mocked(smsService.sendOtpSms).mockResolvedValue({
        success: true,
        messageId: "sms-cooldown-1",
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true });
      expect(smsService.sendOtpSms).toHaveBeenCalledWith("+27821234567", expect.any(String));
      expect(staging.update).toHaveBeenCalledWith({ pending_phone: "+27821234567" });
    });
  });

  it("returns service unavailable when admin client credentials are missing", async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error("Missing Supabase admin credentials");
    });

    const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data).toMatchObject({
      error: "Service temporarily unavailable",
      code: "database_unavailable",
    });
  });

  describe("POST /api/otp/verify", () => {
    it("rejects OTP verification requests without a CSRF token", async () => {
      const res = await verifyOtp(
        createMissingCsrfRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );

      expect(res.status).toBe(403);
    });

    it("returns 400 when there is no active challenge for the user+phone", async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid or expired OTP");
    });

    it("returns 429 when the per-account verify limit is hit, before touching challenges", async () => {
      vi.mocked(checkRateLimit)
        .mockResolvedValueOnce({ limited: false })
        .mockResolvedValueOnce({ limited: true, retryAfter: 90 });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("90");
      expect(data.error).toBe("Too many attempts. Please try again later.");
      expect(checkRateLimit).toHaveBeenNthCalledWith(1, {
        key: "127.0.0.1",
        action: "otp:verify",
        degradedMode: "local",
      });
      expect(checkRateLimit).toHaveBeenNthCalledWith(2, {
        key: "user-1",
        action: "otp:verify:user",
        degradedMode: "block",
      });
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("returns 400 when the challenge was consumed by a concurrent verify request", async () => {
      const storedHash = await hashOtpForTest("123456");
      const mocks = buildVerifyAdmin({ storedHash, claimed: false });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid or expired OTP");
      expect(mocks.claimMaybeSingle).toHaveBeenCalled();
      expect(mocks.profileUpdate).not.toHaveBeenCalled();
      expect(smsService.sendSms).not.toHaveBeenCalled();
    });

    it("returns 400 when the fallback claim path cannot confirm verified_at was stamped", async () => {
      const storedHash = await hashOtpForTest("123456");

      // Track eq filters so the claim re-read can honour the CAS filter
      // (verified_at = nowIso). A zero-row update means no row matches, so the
      // re-read must return null rather than the unclaimed row.
      const eqFilters: Array<[string, unknown]> = [];
      const mockAdminClient = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ new_attempt_count: 1, new_locked_until: null }],
          error: null,
        }),
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockImplementation((col: string, val: unknown) => {
                eqFilters.push([col, val]);
                return mockAdminClient.from("otp_challenges");
              }),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockImplementation(() => {
                // If the query filters on verified_at (the CAS claim re-read),
                // the zero-row update means no row matches → return null.
                const filtersOnVerifiedAt = eqFilters.some(([col]) => col === "verified_at");
                if (filtersOnVerifiedAt) {
                  return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({
                  data: {
                    id: "challenge-1",
                    otp_hash: storedHash,
                    attempt_count: 0,
                    locked_until: null,
                    expires_at: new Date(Date.now() + 60_000).toISOString(),
                    verified_at: null,
                  },
                  error: null,
                });
              }),
              // Claim builder without .select() — forces the fallback path.
              update: vi.fn().mockImplementation(() => {
                const chain: Record<string, unknown> = {};
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.is = vi.fn().mockResolvedValue({ error: null });
                return chain;
              }),
            };
          }

          return {};
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid or expired OTP");
      expect(smsService.sendSms).not.toHaveBeenCalled();
    });

    it("returns 429 when the challenge is locked", async () => {
      const rpc = vi.fn();
      const mockAdminClient = {
        rpc,
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "challenge-locked",
                  otp_hash: "deadbeef:deadbeef",
                  attempt_count: 5,
                  locked_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                },
                error: null,
              }),
            };
          }
          return {};
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data).toMatchObject({
        error: "Too many attempts. Please wait 15 minutes.",
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("keeps OTP verification available when the shared limiter is degraded and only returns 429 after the fallback limit is hit", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        limited: true,
        degraded: true,
        retryAfter: 25,
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("25");
      expect(data.error).toBe("Too many attempts. Please try again later.");
    });

    it("does not allow legacy bypass codes without a stored challenge", async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "999999" })
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "Invalid or expired OTP",
      });
    });

    describe("attempt reservation (increment_otp_attempt before comparing)", () => {
      it("returns 400 for a wrong code while attempts remain, without claiming the challenge", async () => {
        const storedHash = await hashOtpForTest("123456");
        const mocks = buildVerifyAdmin({ storedHash, attemptCount: 1 });

        const res = await verifyOtp(
          createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "654321" })
        );

        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({ error: "Invalid or expired OTP" });
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.challengeUpdate).not.toHaveBeenCalled();
        expect(mocks.profileUpdate).not.toHaveBeenCalled();
      });

      it("returns 429 for a wrong code on the final allowed attempt", async () => {
        const storedHash = await hashOtpForTest("123456");
        const mocks = buildVerifyAdmin({ storedHash, attemptCount: 5 });

        const res = await verifyOtp(
          createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "654321" })
        );

        expect(res.status).toBe(429);
        await expect(res.json()).resolves.toMatchObject({
          error: "Too many attempts. Please wait 15 minutes.",
        });
        expect(mocks.challengeUpdate).not.toHaveBeenCalled();
      });

      it("accepts a correct code on the final allowed attempt", async () => {
        const storedHash = await hashOtpForTest("123456");
        const mocks = buildVerifyAdmin({ storedHash, attemptCount: 5 });

        const res = await verifyOtp(
          createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
        );

        expect(res.status).toBe(200);
        expect(mocks.profileUpdate).toHaveBeenCalledTimes(1);
      });

      it("emails the account owner when a verified phone is replaced", async () => {
        mockUserClient.auth.getUser.mockResolvedValue({
          data: {
            user: { id: "user-1", email: "owner@example.com", email_confirmed_at: "2026-01-01" },
          },
          error: null,
        });
        mockUserClient.from.mockImplementation(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { pending_phone: "+27821234567", phone: "+27829990000" },
                error: null,
              }),
            }),
          }),
        }));
        buildVerifyAdmin({ storedHash: await hashOtpForTest("123456"), attemptCount: 1 });

        const res = await verifyOtp(
          createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
        );

        expect(res.status).toBe(200);
        await vi.waitFor(() =>
          expect(sendPhoneChangeNotification).toHaveBeenCalledWith("owner@example.com", "567")
        );
      });

      it("returns 429 once attempts are exhausted, even for the correct code", async () => {
        const storedHash = await hashOtpForTest("123456");
        const mocks = buildVerifyAdmin({ storedHash, attemptCount: 6 });

        const res = await verifyOtp(
          createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
        );

        expect(res.status).toBe(429);
        await expect(res.json()).resolves.toMatchObject({
          error: "Too many attempts. Please wait 15 minutes.",
        });
        expect(mocks.challengeUpdate).not.toHaveBeenCalled();
        expect(mocks.profileUpdate).not.toHaveBeenCalled();
        expect(smsService.sendSms).not.toHaveBeenCalled();
      });

      it("returns 400 when the attempt could not be reserved because the challenge was already claimed", async () => {
        const storedHash = await hashOtpForTest("123456");
        const mocks = buildVerifyAdmin({ storedHash, attemptCount: null });

        const res = await verifyOtp(
          createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
        );

        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({ error: "Invalid or expired OTP" });
        expect(mocks.challengeUpdate).not.toHaveBeenCalled();
        expect(mocks.profileUpdate).not.toHaveBeenCalled();
      });

      it("returns 503 when the attempt reservation RPC fails", async () => {
        const storedHash = await hashOtpForTest("123456");
        const mocks = buildVerifyAdmin({
          storedHash,
          rpcError: { message: "connection reset" },
        });

        const res = await verifyOtp(
          createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
        );

        expect(res.status).toBe(503);
        expect(mocks.challengeUpdate).not.toHaveBeenCalled();
      });
    });

    it("persists phone verification to profile, step, and session on success", async () => {
      const storedHash = await hashOtpForTest("123456");
      const mocks = buildVerifyAdmin({ storedHash });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
      // The attempt is reserved for successful attempts too.
      expect(mocks.rpc).toHaveBeenCalledWith("increment_otp_attempt", {
        challenge_id: "challenge-1",
        max_attempts: 5,
        lockout_duration: "15 minutes",
      });
      expect(mocks.profileIdEq).toHaveBeenCalledWith("id", "profile-1");
      expect(mocks.profileUserEq).toHaveBeenCalledWith("user_id", "user-1");
      expect(mocks.verificationStepUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          step_type: "phone",
          status: "approved",
        }),
        { onConflict: "user_id,step_type" }
      );
      expect(mocks.sessionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          phone_verified_at: expect.any(String),
        }),
        { onConflict: "user_id" }
      );
      expect(mocks.otpLogVerifyPhoneEq).toHaveBeenCalledWith("phone", "+27821234567");
      expect(mocks.otpLogVerifyHashEq).toHaveBeenCalledWith("otp_hash", storedHash);
      expect(mocks.otpLogVerifyIs).toHaveBeenCalledWith("verified_at", null);
      expect(mocks.siblingNeq).toHaveBeenCalledWith("id", "challenge-1");
      expect(smsService.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+27821234567",
          message: expect.stringContaining("Your phone number was verified successfully"),
        })
      );
    });

    it("does not fail verification when post-verification SMS delivery fails", async () => {
      vi.mocked(smsService.sendSms).mockRejectedValueOnce(new Error("sms down"));
      const storedHash = await hashOtpForTest("123456");
      buildVerifyAdmin({ storedHash });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
    });

    it("creates a missing profile and promotes the phone with the admin client", async () => {
      const storedHash = await hashOtpForTest("123456");
      const mocks = buildVerifyAdmin({
        storedHash,
        existingProfile: null,
        createdProfileId: "profile-created-by-admin",
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
      expect(mocks.profileUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "user-1" }),
        { onConflict: "user_id" }
      );
      expect(mocks.profileUpsertSingle).toHaveBeenCalledTimes(1);
      expect(mocks.profileIdEq).toHaveBeenCalledWith("id", "profile-created-by-admin");
      expect(mocks.profileUserEq).toHaveBeenCalledWith("user_id", "user-1");
    });

    it("promotes the verified phone with a single admin-client update scoped to the profile and user", async () => {
      const storedHash = await hashOtpForTest("123456");
      const mocks = buildVerifyAdmin({ storedHash });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
      expect(mocks.profileUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.profileUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: "+27821234567",
          pending_phone: null,
          contact_last_phone_change_at: expect.any(String),
        })
      );
      expect(mocks.profileIdEq).toHaveBeenCalledWith("id", "profile-1");
      expect(mocks.profileUserEq).toHaveBeenCalledWith("user_id", "user-1");
      // The user-scoped client never writes the profile.
      for (const [table] of mockUserClient.from.mock.calls) {
        expect(table).toBe(ACCOUNT_PROFILE_WRITE_TABLE);
      }
      for (const result of mockUserClient.from.mock.results) {
        expect(result.value).not.toHaveProperty("update");
      }
    });

    it("returns 409 when the verified phone already belongs to another account", async () => {
      const storedHash = await hashOtpForTest("123456");
      const mocks = buildVerifyAdmin({
        storedHash,
        profileUpdateError: {
          code: "23505",
          message: "Phone number already linked to another account",
        },
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: "This phone number is already linked to another account.",
      });
      expect(mocks.verificationStepUpsert).not.toHaveBeenCalled();
    });

    it("rejects OTP verify when profile pending_phone does not match requested phone", async () => {
      const storedHash = await hashOtpForTest("123456");
      const mocks = buildVerifyAdmin({ storedHash });

      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { pending_phone: "+27825555555" },
                  error: null,
                }),
              }),
            }),
          };
        }

        return {};
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "Invalid or expired OTP",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("returns error when verification_steps upsert fails", async () => {
      const storedHash = await hashOtpForTest("123456");
      buildVerifyAdmin({ storedHash, stepsError: { message: "DB connection lost" } });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe("Failed to record phone verification. Please try again.");
    });

    it("returns error when verification_sessions upsert fails", async () => {
      const storedHash = await hashOtpForTest("123456");
      buildVerifyAdmin({ storedHash, sessionError: { message: "Session table unavailable" } });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe("Failed to record phone verification. Please try again.");
    });
  });
});
