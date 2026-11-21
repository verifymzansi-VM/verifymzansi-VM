/** @vitest-environment node */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { verifyDiditWebhookSignature as verifyDiditWebhook } from "@/lib/foundation/didit-webhook";
import { POST as handleDiditWebhook } from "./route";
import {
  PermanentResultError,
  recordIdentityCheckResult,
} from "@/lib/foundation/identity-check-result";
import { checkRateLimit } from "@/lib/utils/rate-limit";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/identity-check-result", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  recordIdentityCheckResult: vi.fn(),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: () => "198.51.100.1",
}));

const secret = "whsec_fixture";
const session = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-11-21T10:00:00Z");
const sign = (body: string, key = secret) => createHmac("sha256", key).update(body).digest("hex");
const headers = (values: Record<string, string>) => new Headers(values);

function request(body: string, extra: Record<string, string> = {}) {
  return new NextRequest("https://verifymzansi.com/api/webhooks/didit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-signature": sign(body),
      ...extra,
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DIDIT_WEBHOOK_SECRET", secret);
  vi.stubEnv("DIDIT_API_KEY", "fixture-key");
  vi.stubEnv("DIDIT_WORKFLOW_ID", "77777777-7777-4777-8777-777777777777");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, retryAfter: 0 });
});

describe("the signature", () => {
  const body = JSON.stringify({
    session_id: session,
    status: "Approved",
    webhook_type: "status.updated",
    timestamp: now / 1000,
  });
  const at = String(now / 1000);

  it("accepts the exact body signed with the secret, or the previous secret after a rotation", () => {
    expect(
      verifyDiditWebhook(
        body,
        headers({ "x-timestamp": at, "x-signature": sign(body) }),
        secret,
        now
      )
    ).toBe(true);
    expect(
      verifyDiditWebhook(
        body,
        headers({
          "x-timestamp": at,
          "x-signature": sign(body, "new"),
          "x-signature-previous": sign(body),
        }),
        secret,
        now
      )
    ).toBe(true);
  });

  it("refuses another body, another secret, a stale or missing time, and no secret", () => {
    const ok = { "x-timestamp": at, "x-signature": sign(body) };
    expect(verifyDiditWebhook(body + " ", headers(ok), secret, now)).toBe(false);
    expect(
      verifyDiditWebhook(body, headers({ ...ok, "x-signature": sign(body, "other") }), secret, now)
    ).toBe(false);
    expect(
      verifyDiditWebhook(
        body,
        headers({ ...ok, "x-timestamp": String(now / 1000 - 301) }),
        secret,
        now
      )
    ).toBe(false);
    expect(
      verifyDiditWebhook(
        body,
        headers({ ...ok, "x-timestamp": String(now / 1000 + 301) }),
        secret,
        now
      )
    ).toBe(false);
    expect(verifyDiditWebhook(body, headers({ "x-signature": sign(body) }), secret, now)).toBe(
      false
    );
    expect(verifyDiditWebhook(body, headers(ok), undefined, now)).toBe(false);
    // The signed body's own timestamp: an old body with a fresh header is refused.
    for (const stale of [
      { session_id: session, webhook_type: "status.updated", timestamp: now / 1000 - 301 },
      { session_id: session, webhook_type: "status.updated" },
      { session_id: session, webhook_type: "status.updated", timestamp: String(now / 1000) },
    ]) {
      const old = JSON.stringify(stale);
      expect(
        verifyDiditWebhook(
          old,
          headers({ "x-timestamp": at, "x-signature": sign(old) }),
          secret,
          now
        )
      ).toBe(false);
    }
    expect(verifyDiditWebhook(body, headers(ok), "", now)).toBe(false);
  });
});

describe("POST /api/webhooks/didit", () => {
  const status = JSON.stringify({
    session_id: session,
    status: "Approved",
    webhook_type: "status.updated",
    timestamp: Math.floor(Date.now() / 1000),
  });

  it("only tells the server to look at the session again", async () => {
    vi.mocked(recordIdentityCheckResult).mockResolvedValue({ recorded: true, status: "approved" });
    const res = await handleDiditWebhook(request(status));
    expect(res.status).toBe(200);
    expect(recordIdentityCheckResult).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { apiKey: "fixture-key", workflowId: "77777777-7777-4777-8777-777777777777" },
      session
    );
  });

  it("refuses an unsigned delivery and ignores other events", async () => {
    expect(
      (await handleDiditWebhook(request(status, { "x-signature": "0".repeat(64) }))).status
    ).toBe(400);
    const edit = JSON.stringify({
      session_id: session,
      webhook_type: "data.updated",
      timestamp: Math.floor(Date.now() / 1000),
    });
    const ignored = await handleDiditWebhook(request(edit));
    expect(await ignored.json()).toEqual({ ignored: true });
    expect(recordIdentityCheckResult).not.toHaveBeenCalled();
  });

  it("asks for another delivery when the result could not be recorded", async () => {
    vi.mocked(recordIdentityCheckResult).mockRejectedValue(new Error("database"));
    expect((await handleDiditWebhook(request(status))).status).toBe(503);
    vi.stubEnv("DIDIT_API_KEY", "");
    expect((await handleDiditWebhook(request(status))).status).toBe(503);
  });

  it("answers 200 to a delivery that can never be recorded, so it is not retried", async () => {
    for (const reason of [
      "decision_not_found",
      "photo_unsupported",
      "evidence_mismatch",
    ] as const) {
      vi.mocked(recordIdentityCheckResult).mockRejectedValueOnce(new PermanentResultError(reason));
      const res = await handleDiditWebhook(request(status));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ recorded: false, status: reason });
    }
  });

  it("is rate limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 60 });
    expect((await handleDiditWebhook(request(status))).status).toBe(429);
  });
});
