/** @vitest-environment node */
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A synthetic signing secret generated for this run; never a real one.
const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const REFUND = "b1fa5055-19c5-41ab-86dd-15272d103455";
const TX = "497f6eca-6276-4993-bfeb-53cbbbba6f08";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  apply: vi.fn(),
  enabled: vi.fn(() => true),
  secret: vi.fn<() => string | null>(),
  security: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ env: vi.fn(() => "") }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ limited: false })),
  getClientIp: () => "203.0.113.9",
}));
vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: mocks.security,
  securityContext: () => ({}),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: () => ({}) }));
vi.mock("@/lib/foundation/ozow-refunds", () => ({ applyOzowRefundFact: mocks.apply }));
vi.mock("@/lib/payments/ozow-refunds", () => ({
  createOzowRefundClient: () => ({ get: mocks.get }),
  ozowApiRefundsEnabled: mocks.enabled,
  ozowRefundWebhookSecret: mocks.secret,
}));

const { POST } = await import("./route");

const ozowFact = {
  refundId: REFUND,
  transactionId: TX,
  amountCents: 6900,
  status: "Complete",
  requestedAt: null,
  completedAt: null,
};
function notice(
  body: unknown,
  { secret = SECRET, at = new Date(), id = "msg_synthetic_1", sign = true } = {}
) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sign) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = String(Math.floor(at.getTime() / 1000));
    headers["svix-signature"] = new Webhook(secret).sign(id, at, raw);
  }
  return new NextRequest("https://verifymzansi.com/api/webhooks/ozow/refunds", {
    method: "POST",
    body: raw,
    headers,
  });
}
const thin = (status = "Complete") => ({
  type: "refund.complete",
  timestamp: new Date().toISOString(),
  data: { id: REFUND, status, reason: null },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.secret.mockReturnValue(SECRET);
  mocks.get.mockResolvedValue(ozowFact);
  mocks.apply.mockResolvedValue({ outcome: "applied" });
});
afterEach(() => vi.useRealTimers());

describe("Ozow refund notices", () => {
  it("are refused while refunds through Ozow are off or without the secret", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await POST(notice(thin()))).status).toBe(503);
    mocks.enabled.mockReturnValue(true);
    mocks.secret.mockReturnValue(null);
    expect((await POST(notice(thin()))).status).toBe(503);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("refuse unsigned, wrongly signed and replayed notices before reading them", async () => {
    const wrong = `whsec_${randomBytes(24).toString("base64")}`;
    for (const request of [
      notice(thin(), { sign: false }),
      notice(thin(), { secret: wrong }),
      notice(thin(), { at: new Date(Date.now() - 60 * 60 * 1000) }),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(401);
    }
    // A body changed after signing.
    const signed = notice(thin("Failed"));
    const tampered = new NextRequest(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(thin("Complete")),
    });
    expect((await POST(tampered)).status).toBe(401);
    expect(mocks.security).toHaveBeenCalledTimes(4);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("apply Ozow's own record of the refund, never the notice's status", async () => {
    mocks.get.mockResolvedValue({ ...ozowFact, status: "Pending" });
    const response = await POST(notice(thin("Complete")));
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(REFUND);
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(
      {},
      { ...ozowFact, status: "Pending" },
      "refund_notice"
    );
  });

  it("read the full notice's refund id too", async () => {
    const full = {
      type: "refund.complete",
      timestamp: new Date().toISOString(),
      data: { RefundId: REFUND.toUpperCase(), Status: "Complete" },
    };
    expect((await POST(notice(full))).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(REFUND);
  });

  it("acknowledge other events and notices without a refund id without acting", async () => {
    expect(
      await (await POST(notice({ type: "transaction.complete", data: { id: TX } }))).json()
    ).toMatchObject({ ignored: true });
    expect(
      await (await POST(notice({ type: "refund.complete", data: { id: "nope" } }))).json()
    ).toMatchObject({ rejected: "missing_refund_id" });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("answer 503 so Ozow retries when Ozow or the database is unavailable", async () => {
    mocks.get.mockRejectedValueOnce(new Error("Ozow down"));
    expect((await POST(notice(thin()))).status).toBe(503);
    mocks.apply.mockRejectedValueOnce(new Error("database down"));
    expect((await POST(notice(thin(), { id: "msg_synthetic_2" }))).status).toBe(503);
  });
});
