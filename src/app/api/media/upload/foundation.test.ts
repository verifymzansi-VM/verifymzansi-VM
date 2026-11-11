/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { uploadFoundationMediaRequest } from "./foundation";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { FoundationMediaError, uploadFoundationMedia } from "@/lib/foundation/media-upload";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "@/lib/utils/request-body";
import type * as RequestBody from "@/lib/utils/request-body";

vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: () => service }));
vi.mock("@/lib/foundation/media-upload", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  uploadFoundationMedia: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture-ip" }),
}));
vi.mock("@/lib/utils/request-body", async (original) => ({
  ...(await original<typeof RequestBody>()),
  readBoundedRequestFormData: vi.fn(),
}));

const { actualReadForm } = await vi.hoisted(async () => ({
  actualReadForm: (await vi.importActual<typeof RequestBody>("@/lib/utils/request-body"))
    .readBoundedRequestFormData,
}));
const api = { marker: "caller" };
const service = { marker: "service" };
const authenticateCaller = vi.fn();
const csrf = "c".repeat(64);
const object = (n: number) => ({
  object_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  url: `https://media.verifymzansi.com/media/${n}`,
  kind: "image" as const,
  width: 1,
  height: 1,
});
const file = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });
function request(files: File[], { csrfValid = true } = {}) {
  const form = new FormData();
  for (const item of files) form.append("files", item);
  return new NextRequest("https://verifymzansi.com/api/media/upload", {
    method: "POST",
    body: form,
    headers: {
      origin: "https://verifymzansi.com",
      cookie: `vm_csrf=${csrf}`,
      ...(csrfValid ? { "x-csrf-token": csrf } : {}),
    },
  });
}
const json = async (response: NextResponse) => ({
  status: response.status,
  body: await response.json(),
  cache: response.headers.get("cache-control"),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(readBoundedRequestFormData).mockImplementation(actualReadForm);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  authenticateCaller.mockResolvedValue({ accountId: object(0).object_id, api });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller,
    respond: async (response: NextResponse) => {
      response.headers.set("cache-control", "private, no-store");
      return response;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  let n = 0;
  vi.mocked(uploadFoundationMedia).mockImplementation(async () => object(++n));
});
afterEach(() => vi.unstubAllEnvs());

describe("uploadFoundationMediaRequest", () => {
  it("uploads each file through the caller's media journal", async () => {
    const response = await uploadFoundationMediaRequest(request([file("a.png"), file("b.png")]));
    expect(await json(response)).toEqual({
      status: 200,
      body: {
        success: true,
        urls: [object(1).url, object(2).url],
        objects: [object(1), object(2)],
      },
      cache: "private, no-store",
    });
    expect(vi.mocked(uploadFoundationMedia).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [api, service],
      [api, service],
    ]);
    expect(vi.mocked(uploadFoundationMedia).mock.calls.map((call) => call[2].name)).toEqual([
      "a.png",
      "b.png",
    ]);
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "fixture-ip",
      action: "media:upload",
      degradedMode: "block",
    });
    expect(vi.mocked(readBoundedRequestFormData).mock.calls[0]![1]).toBe(
      50 * 1024 * 1024 + 1024 * 1024
    );
  });

  it("refuses a request without the CSRF token before anything else runs", async () => {
    const response = await uploadFoundationMediaRequest(
      request([file("a.png")], { csrfValid: false })
    );
    expect(response.status).toBe(403);
    expect(createFoundationRouteContext).not.toHaveBeenCalled();
    expect(uploadFoundationMedia).not.toHaveBeenCalled();
  });

  it("is unavailable, not cached, when the foundation connection cannot be built", async () => {
    vi.mocked(createFoundationRouteContext).mockImplementationOnce(() => {
      throw new Error("missing configuration");
    });
    const response = await uploadFoundationMediaRequest(request([file("a.png")]));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  });

  it.each([
    [{ limited: true }, 429],
    [{ limited: true, degraded: true }, 503],
  ])("refuses when upload protection says %o", async (limit, status) => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(limit);
    const response = await uploadFoundationMediaRequest(request([file("a.png")]));
    expect(response.status).toBe(status);
    expect(authenticateCaller).not.toHaveBeenCalled();
    expect(uploadFoundationMedia).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Sign in to upload media"],
    [503, "Media upload could not be completed"],
  ] as const)("returns %i when the session check fails that way", async (status, error) => {
    authenticateCaller.mockRejectedValueOnce(new FoundationSessionError(status));
    const response = await uploadFoundationMediaRequest(request([file("a.png")]));
    expect(await json(response)).toEqual({ status, body: { error }, cache: "private, no-store" });
    expect(uploadFoundationMedia).not.toHaveBeenCalled();
  });

  it("returns 413 for a body over the bound", async () => {
    vi.mocked(readBoundedRequestFormData).mockRejectedValueOnce(new RequestBodyTooLargeError());
    const response = await uploadFoundationMediaRequest(request([file("a.png")]));
    expect(response.status).toBe(413);
    expect(uploadFoundationMedia).not.toHaveBeenCalled();
  });

  it.each([
    ["no files", []],
    ["only empty files", [file("empty.png", 0)]],
    ["eleven files", Array.from({ length: 11 }, (_, n) => file(`${n}.png`))],
  ])("refuses %s", async (_label, files) => {
    const response = await uploadFoundationMediaRequest(request(files));
    expect(await json(response)).toMatchObject({
      status: 400,
      body: { error: "Choose one to ten media files" },
    });
    expect(uploadFoundationMedia).not.toHaveBeenCalled();
  });

  it("skips empty files and uploads the rest", async () => {
    await uploadFoundationMediaRequest(request([file("empty.png", 0), file("a.png")]));
    expect(vi.mocked(uploadFoundationMedia).mock.calls.map((call) => call[2].name)).toEqual([
      "a.png",
    ]);
  });

  it("reports a partial upload as 207 with the stored files and a neutral error", async () => {
    vi.mocked(uploadFoundationMedia)
      .mockResolvedValueOnce(object(1))
      .mockRejectedValueOnce(new FoundationMediaError(429));
    const response = await uploadFoundationMediaRequest(request([file("a.png"), file("b.png")]));
    expect(await json(response)).toEqual({
      status: 207,
      body: {
        success: false,
        urls: [object(1).url],
        objects: [object(1)],
        errors: ["A file could not be uploaded. Check the format and storage allowance."],
      },
      cache: "private, no-store",
    });
  });

  it.each([
    [new FoundationMediaError(400), 400],
    [new FoundationMediaError(403), 403],
    [new FoundationMediaError(409), 409],
    [new FoundationMediaError(429), 429],
    [new Error("storage down"), 503],
  ])("returns the failure status when every file fails with %o", async (error, status) => {
    vi.mocked(uploadFoundationMedia).mockRejectedValue(error);
    const response = await uploadFoundationMediaRequest(request([file("a.png")]));
    expect(await json(response)).toMatchObject({
      status,
      body: { success: false, urls: [], objects: [] },
    });
  });
});
