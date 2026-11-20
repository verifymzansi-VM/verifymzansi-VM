/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { POST as start } from "../verification/handoff/route";
import { POST as open } from "./open/route";
import { GET as state } from "./state/route";
import { POST as upload } from "./upload/route";
import { POST as phoneToken } from "./capture-token/route";
import { POST as memberToken } from "../verification/capture-token/route";
import { handoffLink } from "@/lib/foundation/capture-handoff";
import {
  checkCaptureToken,
  grantChannel,
  issueCaptureToken,
  sessionChannel,
} from "@/lib/foundation/capture-token";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { putImmutableR2Bytes } from "@/lib/services/storage";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { cleanEvidence } from "@/lib/foundation/verification-runtime";
import { cameraJpegFile } from "@/test/fixtures/camera-jpeg";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("@/lib/services/storage", () => ({ putImmutableR2Bytes: vi.fn() }));
vi.mock("@/lib/foundation/verification-runtime", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  cleanEvidence: vi.fn(),
}));
vi.mock("@/lib/utils/encryption", () => ({
  encryptData: vi.fn(async (b) => b),
  decryptData: vi.fn(async (b) => b),
}));
vi.mock("@/lib/foundation/capture-handoff", async (original) => {
  const real = await original<{ handoffLink: (origin: string, token: string) => string }>();
  return { ...real, handoffLink: vi.fn(real.handoffLink) };
});
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture-ip" }),
}));

const owner = "11111111-1111-4111-8111-111111111111",
  stranger = "55555555-5555-4555-8555-555555555555",
  artifact = "22222222-2222-4222-8222-222222222222",
  caseId = "33333333-3333-4333-8333-333333333333",
  receipt = "44444444-4444-4444-8444-444444444444",
  csrf = "c".repeat(64),
  token = "T".repeat(43),
  grant = "G".repeat(43),
  rpc = vi.fn(),
  serviceRpc = vi.fn();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const identity = {
  fingerprint: "a".repeat(42) + "A",
  encrypted_number: {
    ciphertext: "b".repeat(26),
    iv: "c".repeat(24),
    tag: "d".repeat(32),
    key_id: "identity-number-v1",
  },
};
const handoffState = (needsId = true, needsSelfie = true) => ({
  owner_id: owner,
  expires_at: new Date(Date.now() + 14 * 60_000).toISOString(),
  public_name: "Thando D.",
  needs_id: needsId,
  needs_selfie: needsSelfie,
});
let signedIn: string | null = owner;

const headers = (cookie = "") => ({
  origin: "https://verifymzansi.com",
  "x-csrf-token": csrf,
  cookie: `vm_csrf=${csrf}${cookie ? `; ${cookie}` : ""}`,
});
const json = (path: string, body: unknown, cookie = "") =>
  new NextRequest(`https://verifymzansi.com${path}`, {
    method: "POST",
    headers: { ...headers(cookie), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const form = (fields: Record<string, string>, file: File = cameraJpegFile(), cookie = "") => {
  const data = new FormData();
  data.append("file", file);
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return new NextRequest("https://verifymzansi.com/api/handoff/upload", {
    method: "POST",
    headers: headers(cookie),
    body: data,
  });
};
// Over HTTPS the grant cookie carries the __Secure- prefix.
const grantCookie = `__Secure-vm_capture_grant=${grant}`;
const session = "66666666-6666-4666-8666-666666666666";
const phoneTokenFor = (kind: "id_front" | "selfie", now = Date.now(), accountId = owner) =>
  issueCaptureToken({ accountId, kind, channel: grantChannel(sha(grant)) }, now);

beforeEach(() => {
  vi.clearAllMocks();
  signedIn = owner;
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  vi.stubEnv("ID_ENCRYPTION_KEY", "fedcba9876543210".repeat(4));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, retryAfter: 0 });
  vi.mocked(cleanEvidence).mockResolvedValue(Buffer.from("clean-fixture"));
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_b, _k, bytes) => bytes);
  rpc.mockResolvedValue({
    data: { expires_at: "2026-11-20T12:15:00Z", needs_id: true },
    error: null,
  });
  serviceRpc.mockImplementation(async (name: string) => ({
    data:
      name === "redeem_capture_handoff" || name === "capture_handoff_context"
        ? handoffState()
        : name === "reserve_handoff_verification_upload"
          ? { artifact_id: artifact, completed: false, identity }
          : name === "attach_capture_handoff_identity"
            ? { attached: true }
            : name === "frontend_verification_upload_context"
              ? {
                  completed: false,
                  artifact_id: artifact,
                  purpose: "id_front",
                  case_id: caseId,
                  object_key: `evidence/${caseId}/${artifact}`,
                  fingerprint: null,
                  document_sha256: null,
                }
              : { completed: true, artifact_id: artifact, purpose: "id_front" },
    error: null,
  }));
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: async () => {
      if (!signedIn) throw new FoundationSessionError(401);
      return { api: { rpc }, accountId: signedIn, sessionId: session };
    },
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(createFoundationServiceApi).mockReturnValue({
    rpc: serviceRpc,
  } as unknown as ReturnType<typeof createFoundationServiceApi>);
});
afterEach(() => vi.unstubAllEnvs());

describe("the computer makes a link", () => {
  it("never sends the ID number receipt with the member: the server attaches it", async () => {
    const res = await start(
      json("/api/verification/handoff", {
        idNumber: "8001015009087",
        firstName: "Thando Sipho",
        lastName: "Dlamini",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.qr.path).toMatch(/^M/);
    expect(body).not.toHaveProperty("link");
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("start_capture_handoff");
    expect(args).toEqual({
      p_token_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_first_name: "Thando Sipho",
      p_last_name: "Dlamini",
      p_with_id: true,
    });
    const attach = serviceRpc.mock.calls.find((c) => c[0] === "attach_capture_handoff_identity")!;
    expect(attach[1]).toEqual({
      p_owner: owner,
      p_token_sha256: args.p_token_sha256,
      p_identity: expect.objectContaining({
        encrypted_number: expect.objectContaining({ key_id: "identity-number-v1" }),
      }),
    });
    // The ID number itself never reaches the database.
    expect(JSON.stringify([...rpc.mock.calls, ...serviceRpc.mock.calls])).not.toContain(
      "8001015009087"
    );
    // Without a configured address, the link uses this request's own origin.
    expect(vi.mocked(handoffLink).mock.calls[0][0]).toBe("https://verifymzansi.com");
  });

  it("needs a signed-in member, valid details and a same-site request", async () => {
    signedIn = null;
    expect((await start(json("/api/verification/handoff", {}))).status).toBe(401);
    signedIn = owner;
    const bad = await start(
      json("/api/verification/handoff", {
        idNumber: "8001015009088",
        firstName: "A",
        lastName: "B",
      })
    );
    expect(bad.status).toBe(400);
    const cross = json("/api/verification/handoff", {});
    cross.headers.set("origin", "https://untrusted.example");
    expect((await start(cross)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains the limit, a missing ID photo and an account that cannot act", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PT429", details: "handoff_rate_limited" },
    });
    expect((await start(json("/api/verification/handoff", {}))).status).toBe(429);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PT409", details: "handoff_needs_id" },
    });
    const res = await start(json("/api/verification/handoff", {}));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("handoff_needs_id");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    const inactive = await start(json("/api/verification/handoff", {}));
    expect(inactive.status).toBe(403);
    expect((await inactive.json()).error).toMatch(/confirm your email/i);
  });
});

describe("the phone opens the link, signed in as the same account", () => {
  it("asks a signed-out phone to sign in, without using the link", async () => {
    signedIn = null;
    const res = await open(json("/api/handoff/open", { token }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Sign in on your phone with the same account, then take the photos.",
      code: "handoff_sign_in_required",
    });
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("uses the token once for the signed-in owner and keeps a __Secure- grant cookie", async () => {
    const res = await open(json("/api/handoff/open", { token }));
    expect(res.status).toBe(200);
    const [name, args] = serviceRpc.mock.calls[0];
    expect(name).toBe("redeem_capture_handoff");
    expect(args).toEqual({
      p_token_sha256: sha(token),
      p_grant_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_signed_in: owner,
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Secure-vm_capture_grant=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/Path=\/api\/handoff/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=strict/i);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(800);
    expect(maxAge).toBeLessThanOrEqual(900);
    const value = /vm_capture_grant=([^;]+)/.exec(cookie)![1];
    expect(value).not.toBe(token);
    expect(args.p_grant_sha256).toBe(sha(value));
  });

  it("refuses a phone signed in as another account, and a failed sign-in check", async () => {
    signedIn = stranger;
    serviceRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", details: "handoff_other_account" },
    });
    const res = await open(json("/api/handoff/open", { token }));
    expect(serviceRpc.mock.calls[0][1].p_signed_in).toBe(stranger);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("handoff_other_account");
    expect(res.headers.get("set-cookie")).toBeNull();
    vi.mocked(createFoundationRouteContext).mockReturnValueOnce({
      authenticateCaller: async () => {
        throw new FoundationSessionError(503);
      },
      respond: async (r: NextResponse) => r,
    } as unknown as ReturnType<typeof createFoundationRouteContext>);
    const unchecked = await open(json("/api/handoff/open", { token }));
    expect(unchecked.status).toBe(503);
    expect((await unchecked.json()).error).toMatch(/couldn't check your sign-in/i);
  });

  it("refuses a used, malformed or oversized request without a cookie", async () => {
    serviceRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PT409", details: "handoff_unavailable" },
    });
    const used = await open(json("/api/handoff/open", { token }));
    expect(used.status).toBe(409);
    expect(used.headers.get("set-cookie")).toBeNull();
    for (const body of [{ token: "123456" }, { token, extra: 1 }, {}]) {
      expect((await open(json("/api/handoff/open", body))).status).toBe(409);
    }
    expect((await open(json("/api/handoff/open", { token: "x".repeat(10_000) }))).status).toBe(413);
    expect(serviceRpc).toHaveBeenCalledTimes(1);
  });
});

describe("the phone's state, capture tokens and photos", () => {
  it("answer only the signed-in owner holding a grant", async () => {
    expect(
      (await state(new NextRequest("https://verifymzansi.com/api/handoff/state"))).status
    ).toBe(409);
    const withGrant = () =>
      new NextRequest("https://verifymzansi.com/api/handoff/state", {
        headers: { cookie: grantCookie },
      });
    signedIn = null;
    expect((await state(withGrant())).status).toBe(401);
    signedIn = owner;
    const res = await state(withGrant());
    expect(res.status).toBe(200);
    expect(serviceRpc).toHaveBeenCalledWith("capture_handoff_context", {
      p_grant_sha256: sha(grant),
      p_signed_in: owner,
    });
    expect(JSON.stringify(await res.json())).not.toContain(owner);
  });

  it("issue capture tokens bound to the phone's grant, and to the member's session", async () => {
    const phone = await phoneToken(
      json("/api/handoff/capture-token", { kind: "id_front" }, grantCookie)
    );
    expect(phone.status).toBe(200);
    const issued = (await phone.json()).token;
    expect(
      checkCaptureToken(issued, {
        accountId: owner,
        kind: "id_front",
        channel: grantChannel(sha(grant)),
      })
    ).toBe("ok");
    signedIn = null;
    expect(
      (await phoneToken(json("/api/handoff/capture-token", { kind: "id_front" }, grantCookie)))
        .status
    ).toBe(401);
    signedIn = owner;
    expect(
      (await phoneToken(json("/api/handoff/capture-token", { kind: "id_front" }))).status
    ).toBe(409);
    const member = await memberToken(json("/api/verification/capture-token", { kind: "selfie" }));
    expect(member.status).toBe(200);
    expect(
      checkCaptureToken((await member.json()).token, {
        accountId: owner,
        kind: "selfie",
        channel: sessionChannel(session),
      })
    ).toBe("ok");
    expect(
      (await memberToken(json("/api/verification/capture-token", { kind: "video" }))).status
    ).toBe(400);
  });

  it("store an ID photo for the link's case with the server's identity receipt", async () => {
    const res = await upload(
      form(
        {
          docType: "id_document",
          uploadRequestId: receipt,
          captureMethod: "camera",
          captureToken: phoneTokenFor("id_front"),
        },
        cameraJpegFile(),
        grantCookie
      )
    );
    expect(res.status).toBe(200);
    const reserve = serviceRpc.mock.calls.find(
      (c) => c[0] === "reserve_handoff_verification_upload"
    )!;
    expect(reserve[1]).toMatchObject({
      p_grant_sha256: sha(grant),
      p_signed_in: owner,
      p_request: receipt,
      p_purpose: "id_front",
      p_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(reserve[1]).not.toHaveProperty("p_browser_liveness_passed");
    const completed = serviceRpc.mock.calls.find(
      (c) => c[0] === "complete_frontend_verification_upload"
    )![1];
    expect(completed.p_owner).toBe(owner);
    expect(completed.p_identity).toEqual(identity);
  });

  it("refuse photos without a fresh capture token for this grant, or not from the camera", async () => {
    const old = Date.now() - 11 * 60_000;
    const refused: [Record<string, string>, File, string][] = [
      [{ captureMethod: "camera" }, cameraJpegFile(), "camera_required"],
      [
        { captureMethod: "camera", captureToken: phoneTokenFor("selfie") },
        cameraJpegFile(),
        "camera_required",
      ],
      [
        { captureMethod: "camera", captureToken: phoneTokenFor("id_front", Date.now(), stranger) },
        cameraJpegFile(),
        "camera_required",
      ],
      [
        { captureMethod: "camera", captureToken: phoneTokenFor("id_front", old) },
        cameraJpegFile(),
        "capture_expired",
      ],
      [
        { captureMethod: "file_upload", captureToken: phoneTokenFor("id_front") },
        cameraJpegFile(),
        "camera_required",
      ],
      [
        { captureMethod: "camera", captureToken: phoneTokenFor("id_front") },
        cameraJpegFile({ exif: true }),
        "camera_required",
      ],
      [
        { captureMethod: "camera", captureToken: phoneTokenFor("id_front") },
        new File(["x"], "x.png", { type: "image/png" }),
        "camera_required",
      ],
    ];
    for (const [fields, file, code] of refused) {
      const res = await upload(
        form({ docType: "id_document", uploadRequestId: receipt, ...fields }, file, grantCookie)
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe(code);
    }
    expect(serviceRpc.mock.calls.some((c) => c[0] === "reserve_handoff_verification_upload")).toBe(
      false
    );
    expect(putImmutableR2Bytes).not.toHaveBeenCalled();
  });

  it("refuse a signed-out phone, a missing grant, identity fields and a forged owner", async () => {
    const fields = {
      docType: "id_document",
      uploadRequestId: receipt,
      captureMethod: "camera",
      captureToken: phoneTokenFor("id_front"),
    };
    expect((await upload(form(fields))).status).toBe(409);
    signedIn = null;
    expect((await upload(form(fields, cameraJpegFile(), grantCookie))).status).toBe(401);
    signedIn = owner;
    expect(
      (await upload(form({ ...fields, owner_id: stranger }, cameraJpegFile(), grantCookie))).status
    ).toBe(400);
  });
});
