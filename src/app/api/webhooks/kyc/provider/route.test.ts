import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

const { mockRpc, mockCheckRateLimit } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mockRpc }) }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: () => "127.0.0.1",
}));
import { POST } from "./route";

const payload = { provider_ref: "ref-1", status: "approved" };
const secret = "test-only-kyc-signing-secret";
function request(body: unknown = payload, signature?: string, signed = true) {
  const raw = JSON.stringify(body);
  return new NextRequest("http://localhost/api/webhooks/kyc/provider", {
    method: "POST",
    body: raw,
    headers: signed
      ? {
          "x-webhook-signature":
            signature ?? crypto.createHmac("sha256", secret).update(raw).digest("hex"),
        }
      : {},
  });
}

describe("POST /api/webhooks/kyc/provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVIRONMENT", "production");
    vi.stubEnv("KYC_PROVIDER", "veriff");
    vi.stubEnv("KYC_WEBHOOK_SECRET", secret);
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "production");
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockRpc.mockResolvedValue({
      data: { outcome: "applied", provider_result_id: "result-1" },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a signed callback and commits it through one RPC", async () => {
    const res = await POST(request({ ...payload, scores: { liveness_score: 80 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ acknowledged: true, provider_result_id: "result-1" });
    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith(
      "apply_kyc_provider_webhook",
      expect.objectContaining({ p_scores: { liveness_score: 80 } })
    );
  });
  it("acknowledges an unknown provider reference", async () => {
    mockRpc.mockResolvedValue({ data: { outcome: "unknown" }, error: null });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ acknowledged: true, warning: "Unknown provider reference" });
  });
  it("acknowledges duplicates without replaying updates", async () => {
    mockRpc.mockResolvedValue({
      data: { outcome: "duplicate", provider_result_id: "result-1" },
      error: null,
    });
    const res = await POST(request());
    expect(await res.json()).toMatchObject({
      duplicate: true,
      skipped_reason: "already_finalized",
    });
  });
  it("returns a retryable failure on database errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Database unavailable" } });
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
  it.each([
    {},
    { status: "approved" },
    { provider_ref: "ref-1", status: "pending" },
    { ...payload, scores: { face_match_score: "high" } },
    { ...payload, scores: { liveness_score: 101 } },
    { ...payload, ocr_payload: { value: "x".repeat(50_001) } },
  ])("rejects invalid payloads before database access: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it.each(["missing", "incorrect", "odd-length", "oversized"])(
    "rejects %s signatures",
    async (mode) => {
      const valid = crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(payload))
        .digest("hex");
      const req =
        mode === "missing"
          ? request(payload, undefined, false)
          : request(
              payload,
              mode === "odd-length"
                ? valid + "a"
                : mode === "oversized"
                  ? valid + "aa"
                  : "0".repeat(64)
            );
      expect((await POST(req)).status).toBe(401);
      expect(mockRpc).not.toHaveBeenCalled();
    }
  );
  it("rejects an oversized body before database access", async () => {
    expect((await POST(request({ ...payload, ignored: "é".repeat(140_000) }))).status).toBe(413);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("returns 503 when callbacks are disabled for the stub provider", async () => {
    vi.stubEnv("KYC_PROVIDER", "stub");
    expect((await POST(request())).status).toBe(503);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("returns 503 when the secret is missing", async () => {
    vi.stubEnv("KYC_WEBHOOK_SECRET", "");
    expect((await POST(request())).status).toBe(503);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("never enables the unsigned development bypass in a production environment", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "development");
    vi.stubEnv("ENABLE_DEV_KYC_WEBHOOK_BYPASS", "1");
    vi.stubEnv("KYC_WEBHOOK_SECRET", "");
    expect((await POST(request(payload, undefined, false))).status).toBe(503);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("allows the explicit localhost development bypass", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENVIRONMENT", "development");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "development");
    vi.stubEnv("ENABLE_DEV_KYC_WEBHOOK_BYPASS", "1");
    vi.stubEnv("KYC_WEBHOOK_SECRET", "");
    vi.stubEnv("KYC_PROVIDER", "stub");
    expect((await POST(request(payload, undefined, false))).status).toBe(200);
  });
  it("retains webhook rate limiting", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 30 });
    const res = await POST(request());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
