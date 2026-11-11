/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { readSeenEvidenceFile, sendSeenOwnerMessage, uploadSeenPhoto } from "./seen-media-route";
import { attachNativeCipcReplyFile } from "./cipc-document-route";
import { readMyBusinessChecks } from "./business-seen";
import { storeBusinessEvidence } from "./business-evidence-route";
import { createFoundationRouteContext } from "./request-route";
import { createFoundationServiceApi } from "./service-api";
import { readCipcFile } from "../business-verification/intake";
import { getR2ObjectBytes } from "../services/storage";
import { checkRateLimit } from "../utils/rate-limit";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("./cipc-document-route", () => ({ attachNativeCipcReplyFile: vi.fn() }));
vi.mock("./business-seen", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readMyBusinessChecks: vi.fn(),
}));
vi.mock("./business-evidence-route", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  storeBusinessEvidence: vi.fn(),
}));
vi.mock("../business-verification/intake", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readCipcFile: vi.fn(),
}));
vi.mock("../services/storage", () => ({ getR2ObjectBytes: vi.fn() }));
vi.mock("../utils/encryption", () => ({ decryptData: vi.fn(async (b: Buffer) => b.subarray(4)) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: vi.fn(() => ({ key: "client" })),
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [account, business, caseId, artifact, other, cipcCase] = [1, 2, 3, 4, 5, 6].map(uuid);
const csrf = "c".repeat(64);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2]);
const gif = Buffer.from("GIF89a synthetic image");
const stored = Buffer.concat([Buffer.from("ENC:"), png]);
const api = { rpc: vi.fn() };
const service = { rpc: vi.fn() };
const ok = (data: unknown) => ({ data, error: null });
const reserved = { artifact_id: artifact, owner_id: account, completed: false };
const intake = (bytes: Buffer, over = {}) => ({
  bytes,
  isPdf: false,
  activeContent: null,
  ...over,
});
const photo = () => new File([jpeg], "shop.jpg", { type: "image/jpeg" });
const post = (fields: Array<[string, string | File]>) => {
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  return new Request("https://verifymzansi.com/api/x", {
    method: "POST",
    body: form,
    headers: {
      origin: "https://verifymzansi.com",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  });
};
const json = async (r: NextResponse) => ({ status: r.status, body: await r.json() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false } as never);
  vi.mocked(createFoundationServiceApi).mockReturnValue(service as never);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: vi.fn(async () => ({ api, accountId: account, sessionId: uuid(9) })),
    respond: vi.fn(async (r: NextResponse) => r),
  } as never);
  vi.mocked(readCipcFile).mockResolvedValue(intake(jpeg) as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("uploadSeenPhoto", () => {
  const receipt = {
    fileId: artifact,
    by: account,
    takenAt: "2026-11-11T10:00:00Z",
    lat: -33.92486,
    lng: null,
  };
  it("reserves the photo by digest with rounded, bounded coordinates", async () => {
    api.rpc.mockResolvedValueOnce(ok(reserved)).mockResolvedValueOnce(ok(receipt));
    const response = await uploadSeenPhoto(
      post([
        ["file", photo()],
        ["lat", "-33.924861234"],
        ["lng", "200"],
      ]),
      caseId
    );
    expect(await json(response)).toEqual({ status: 201, body: { photo: receipt } });
    expect(api.rpc.mock.calls[0][1]).toEqual({
      p_case: caseId,
      p_digest: sha(jpeg),
      p_mime: "image/jpeg",
      p_lat: -33.92486,
      p_lng: undefined,
    });
    expect(storeBusinessEvidence).toHaveBeenCalledWith(
      reserved,
      caseId,
      jpeg,
      "business_visit_photo"
    );
  });

  it.each([
    [
      "an unexpected field",
      [
        ["file", photo()],
        ["owner", account],
      ],
    ],
    [
      "a repeated coordinate",
      [
        ["file", photo()],
        ["lat", "1"],
        ["lat", "2"],
      ],
    ],
    ["no file", [["lat", "1"]]],
  ] as const)("refuses %s", async (_n, fields) => {
    expect(await json(await uploadSeenPhoto(post(fields as never), caseId))).toEqual({
      status: 400,
      body: { error: "Choose one photograph." },
    });
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a PDF", intake(png, { isPdf: true }), 400],
    ["active content", intake(jpeg, { activeContent: "polyglot" }), 400],
    ["a GIF", intake(gif), 400],
    [
      "an oversized file",
      { error: "Files can be up to 5 MB.", code: "file_too_large", status: 413 },
      413,
    ],
  ])("refuses %s before reserving", async (_n, data, status) => {
    vi.mocked(readCipcFile).mockResolvedValue(data as never);
    expect((await uploadSeenPhoto(post([["file", photo()]]), caseId)).status).toBe(status);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("refuses a receipt for a different photo", async () => {
    api.rpc
      .mockResolvedValueOnce(ok(reserved))
      .mockResolvedValueOnce(ok({ ...receipt, fileId: other }));
    expect((await uploadSeenPhoto(post([["file", photo()]]), caseId)).status).toBe(503);
  });
});

describe("readSeenEvidenceFile", () => {
  const scope = { case_id: caseId, artifact_id: artifact, version: 2 };
  const object = {
    object_key: `evidence/${caseId}/${artifact}`,
    sha256: sha(stored),
    content_sha256: sha(png),
    size_bytes: stored.length,
    mime: "image/png",
  };
  const read = () =>
    readSeenEvidenceFile(
      new Request("https://verifymzansi.com/api/x", { method: "GET" }),
      artifact
    );
  beforeEach(() => {
    api.rpc.mockResolvedValue(ok(scope));
    service.rpc.mockResolvedValue(ok(object));
    vi.mocked(getR2ObjectBytes).mockResolvedValue({ bytes: stored });
  });

  it("serves verified bytes and records the view only after the integrity checks", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).equals(png)).toBe(true);
    expect(api.rpc.mock.calls.map((c) => c[1].p_record)).toEqual([false, true]);
  });

  it.each([
    ["a missing object", () => vi.mocked(getR2ObjectBytes).mockResolvedValue(null)],
    [
      "a different stored digest",
      () => service.rpc.mockResolvedValue(ok({ ...object, sha256: "0".repeat(64) })),
    ],
    ["a different size", () => service.rpc.mockResolvedValue(ok({ ...object, size_bytes: 99 }))],
    [
      "changed content",
      () => service.rpc.mockResolvedValue(ok({ ...object, content_sha256: "1".repeat(64) })),
    ],
    [
      "a mismatched type",
      () => service.rpc.mockResolvedValue(ok({ ...object, mime: "image/jpeg" })),
    ],
    [
      "a key in another case",
      () =>
        service.rpc.mockResolvedValue(
          ok({ ...object, object_key: `evidence/${other}/${artifact}` })
        ),
    ],
    [
      "an unexpected type",
      () => service.rpc.mockResolvedValue(ok({ ...object, mime: "text/html" })),
    ],
    [
      "a scope for another file",
      () => api.rpc.mockResolvedValue(ok({ ...scope, artifact_id: other })),
    ],
  ])("refuses %s without serving bytes or recording a view", async (_n, arrange) => {
    arrange();
    const response = await read();
    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(api.rpc.mock.calls.filter((c) => c[1].p_record)).toEqual([]);
  });

  it("answers 404 for a purged file", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { code: "PT404" } });
    expect((await read()).status).toBe(404);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("refuses when the case version changes during the read", async () => {
    api.rpc.mockResolvedValueOnce(ok(scope)).mockResolvedValueOnce(ok({ ...scope, version: 3 }));
    expect((await read()).status).toBe(409);
  });
});

describe("sendSeenOwnerMessage", () => {
  beforeEach(() => {
    api.rpc.mockResolvedValue(ok({ ok: true }));
    vi.mocked(readMyBusinessChecks).mockResolvedValue({
      cases: [
        { id: caseId, kind: "seen" },
        { id: cipcCase, kind: "cipc", registrationNumber: "2020/123456/07", route: "director" },
      ],
    } as never);
  });
  const send = (fields: Array<[string, string | File]>) =>
    sendSeenOwnerMessage(post(fields), business);

  it("sends a trimmed text message without reading the business", async () => {
    expect(
      (
        await send([
          ["caseId", caseId],
          ["body", "  Hello  "],
        ])
      ).status
    ).toBe(201);
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith(
      "send_frontend_seen_message",
      { p_case: caseId, p_business: business, p_body: "Hello" },
      { get: false }
    );
    expect(readMyBusinessChecks).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an empty message",
      [
        ["caseId", caseId],
        ["body", "   "],
      ],
    ],
    [
      "an unexpected field",
      [
        ["caseId", caseId],
        ["body", "Hi"],
        ["ownerId", account],
      ],
    ],
    [
      "an overlong body",
      [
        ["caseId", caseId],
        ["body", "x".repeat(2001)],
      ],
    ],
    [
      "a malformed case id",
      [
        ["caseId", "1 or 1=1"],
        ["body", "Hi"],
      ],
    ],
  ] as const)("refuses %s", async (_n, fields) => {
    expect((await send(fields as never)).status).toBe(400);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("stores a Seen attachment under the caller's reservation", async () => {
    api.rpc.mockResolvedValueOnce(ok(reserved)).mockResolvedValueOnce(ok({ ok: true }));
    expect(
      (
        await send([
          ["caseId", caseId],
          ["file", photo()],
        ])
      ).status
    ).toBe(201);
    expect(storeBusinessEvidence).toHaveBeenCalledWith(
      reserved,
      caseId,
      jpeg,
      "business_reply_attachment"
    );
    expect(api.rpc.mock.calls[1][1]).toMatchObject({ p_artifact: artifact, p_body: "" });
  });

  it("refuses a reply reservation owned by another account", async () => {
    api.rpc.mockResolvedValueOnce(ok({ ...reserved, owner_id: other }));
    expect(
      (
        await send([
          ["caseId", caseId],
          ["file", photo()],
        ])
      ).status
    ).toBe(503);
    expect(storeBusinessEvidence).not.toHaveBeenCalled();
  });

  it("routes a CIPC attachment through the CIPC document checks", async () => {
    vi.mocked(attachNativeCipcReplyFile).mockResolvedValue(artifact);
    expect(
      (
        await send([
          ["caseId", cipcCase],
          ["file", photo()],
        ])
      ).status
    ).toBe(201);
    expect(vi.mocked(attachNativeCipcReplyFile).mock.calls[0][2]).toMatchObject({ id: cipcCase });
    expect(readCipcFile).not.toHaveBeenCalled();
  });

  it.each([
    ["a case on another business", other, intake(jpeg), 404],
    ["active content", caseId, intake(jpeg, { activeContent: "js" }), 422],
  ])("refuses an attachment for %s", async (_n, id, data, status) => {
    vi.mocked(readCipcFile).mockResolvedValue(data as never);
    expect(
      (
        await send([
          ["caseId", id],
          ["file", photo()],
        ])
      ).status
    ).toBe(status);
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
