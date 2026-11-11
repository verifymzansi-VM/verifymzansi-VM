/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { HEAD, POST as upload } from "./upload/route";
import { POST as uploadUrl } from "./upload-url/route";
import { POST as uploadComplete } from "./upload-complete/route";
import { uploadFoundationMediaRequest } from "./upload/foundation";

vi.mock("./upload/foundation", () => ({ uploadFoundationMediaRequest: vi.fn() }));

// uploadFoundationMediaRequest is tested in upload/foundation.test.ts.
it("hands uploads to the foundation media upload", async () => {
  const answer = NextResponse.json({ urls: [] });
  vi.mocked(uploadFoundationMediaRequest).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/media/upload", {
    method: "POST",
  });
  expect(await upload(request)).toBe(answer);
  expect(uploadFoundationMediaRequest).toHaveBeenCalledExactlyOnceWith(request);
});

it("answers the upload preflight without a body", async () => {
  const response = HEAD();
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
});

it.each([
  ["upload-url", uploadUrl],
  ["upload-complete", uploadComplete],
] as const)("answers the retired direct upload route %s with 410", async (_path, post) => {
  const response = await post();
  expect(response.status).toBe(410);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    error: "This upload method is no longer available",
    code: "upload_method_retired",
  });
});
