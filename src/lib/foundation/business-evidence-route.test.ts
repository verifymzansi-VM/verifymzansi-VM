/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { protectBusinessEvidenceRoute, storeBusinessEvidence } from "./business-evidence-route";
import { createFoundationRouteContext } from "./request-route";
import { FoundationSessionError } from "./request-api";
import { createFoundationServiceApi } from "./service-api";
import { FoundationStaffCommandError } from "./staff-command";
import { checkRateLimit } from "../utils/rate-limit";
import { RequestBodyTooLargeError } from "../utils/request-body";
import { putImmutableR2Bytes } from "../services/storage";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: vi.fn(() => ({ key: "client" })),
}));
vi.mock("../services/storage", () => ({ putImmutableR2Bytes: vi.fn() }));
// A reversible stand-in for AES-GCM: stored bytes differ from the plaintext.
vi.mock("../utils/encryption", () => ({
  encryptData: vi.fn(async (b: Buffer) => Buffer.concat([Buffer.from("ENC:"), b])),
  decryptData: vi.fn(async (b: Buffer) => b.subarray(4)),
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [account, caseId, artifact, otherCase] = [uuid(1), uuid(2), uuid(3), uuid(4)];
const csrf = "c".repeat(64);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const service = { rpc: vi.fn() };
const respond = vi.fn(async (r: NextResponse) => r);
const command = vi.fn(async () => NextResponse.json({ ok: true }, { status: 201 }));
const request = (withCsrf = true) =>
  new NextRequest("https://verifymzansi.com/api/businesses/x/verification/cipc", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      cookie: `vm_csrf=${csrf}`,
      ...(withCsrf ? { "x-csrf-token": csrf } : {}),
    },
  });
const run = (req = request(), mutate = true) =>
  protectBusinessEvidenceRoute(req, "business-verification:cipc", mutate, command);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(createFoundationServiceApi).mockReturnValue(service as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false } as never);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: vi.fn(async () => ({ api: {}, accountId: account, sessionId: uuid(9) })),
    respond,
  } as never);
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_b, _k, bytes) => bytes);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("protectBusinessEvidenceRoute", () => {
  it("runs the command for a verified caller and returns through the session context", async () => {
    const response = await run();
    expect(response.status).toBe(201);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: account }),
      expect.any(NextRequest)
    );
    expect(respond).toHaveBeenCalledWith(response);
  });

  it("refuses a write without the CSRF token before any session or command", async () => {
    expect((await run(request(false))).status).toBe(403);
    expect(createFoundationRouteContext).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("does not require a CSRF token for a read-only action", async () => {
    expect((await run(request(false), false)).status).toBe(201);
  });

  it.each([
    [{ limited: true, retryAfter: 30 }, 429, "30"],
    [{ limited: false, degraded: true }, 503, "60"],
  ])("blocks a limited or degraded rate limiter (%o)", async (limit, status, retry) => {
    vi.mocked(checkRateLimit).mockResolvedValue(limit as never);
    const response = await run();
    expect(response.status).toBe(status);
    expect(response.headers.get("Retry-After")).toBe(retry);
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    ["an oversized body", new RequestBodyTooLargeError(), 413, "Files can be up to 5 MB."],
    ["invalid input", new z.ZodError([]), 400, "Check the business evidence details."],
    ["a missing session", new FoundationSessionError(401), 401, "Sign in to continue."],
    ["an unavailable session", new FoundationSessionError(503), 503, "could not be confirmed"],
    [
      "a database conflict",
      new FoundationStaffCommandError(409, "Reload first."),
      409,
      "Reload first.",
    ],
    [
      "an unknown failure",
      new Error(`R2 key evidence/${caseId}/${artifact}`),
      503,
      "could not be confirmed",
    ],
  ])("maps %s to a fixed, private-data-free refusal", async (_name, error, status, message) => {
    command.mockRejectedValueOnce(error);
    const response = await run();
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body.error).toContain(message);
    expect(JSON.stringify(body)).not.toContain(caseId);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("answers 503 when the foundation connection cannot be created", async () => {
    vi.mocked(createFoundationRouteContext).mockImplementation(() => {
      throw new Error("missing secret");
    });
    const response = await run();
    expect(response.status).toBe(503);
    expect(command).not.toHaveBeenCalled();
  });
});

describe("storeBusinessEvidence", () => {
  const bytes = Buffer.from("%PDF-1.4 synthetic registration certificate");
  const reserved = { artifact_id: artifact, owner_id: account, completed: false };
  const target = {
    case_id: caseId,
    artifact_id: artifact,
    purpose: "registration",
    object_key: `evidence/${caseId}/${artifact}`,
  };
  const answer = (data: unknown) => ({ data, error: null });

  it("stores ciphertext at the reserved key and records both digests", async () => {
    service.rpc.mockResolvedValueOnce(answer(target)).mockResolvedValueOnce(answer(null));
    await storeBusinessEvidence(reserved, caseId, bytes, "registration");
    const stored = vi.mocked(putImmutableR2Bytes).mock.calls[0][2];
    expect(vi.mocked(putImmutableR2Bytes).mock.calls[0][1]).toBe(target.object_key);
    expect(stored.includes(bytes)).toBe(true);
    expect(stored.equals(bytes)).toBe(false);
    expect(service.rpc).toHaveBeenLastCalledWith(
      "complete_evidence_upload",
      {
        p_artifact: artifact,
        p_stored_sha256: sha(stored),
        p_content_sha256: sha(bytes),
        p_size: stored.length,
      },
      { get: false }
    );
  });

  it("does nothing for an upload the database already completed", async () => {
    await storeBusinessEvidence({ ...reserved, completed: true }, caseId, bytes, "registration");
    expect(service.rpc).not.toHaveBeenCalled();
    expect(putImmutableR2Bytes).not.toHaveBeenCalled();
  });

  it.each([
    ["another case", { case_id: otherCase }],
    ["another purpose", { purpose: "business_visit_photo" }],
    ["a key in another case folder", { object_key: `evidence/${otherCase}/${artifact}` }],
    ["a key outside evidence storage", { object_key: "media/public/file" }],
    ["an extra field", { bucket: "public" }],
  ])("refuses an upload target for %s before writing bytes", async (_name, change) => {
    service.rpc.mockResolvedValueOnce(answer({ ...target, ...change }));
    await expect(storeBusinessEvidence(reserved, caseId, bytes, "registration")).rejects.toThrow();
    expect(putImmutableR2Bytes).not.toHaveBeenCalled();
  });

  it("refuses to complete when a retry finds different bytes already stored", async () => {
    service.rpc.mockResolvedValueOnce(answer(target));
    vi.mocked(putImmutableR2Bytes).mockResolvedValueOnce(Buffer.from("ENC:other upload bytes!!!"));
    await expect(storeBusinessEvidence(reserved, caseId, bytes, "registration")).rejects.toThrow(
      "does not match"
    );
    expect(service.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails when the completion receipt is refused", async () => {
    service.rpc
      .mockResolvedValueOnce(answer(target))
      .mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    await expect(storeBusinessEvidence(reserved, caseId, bytes, "registration")).rejects.toThrow(
      "Evidence receipt unavailable"
    );
  });
});
