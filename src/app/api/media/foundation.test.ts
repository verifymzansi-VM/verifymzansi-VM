/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { HEAD, POST as upload } from "./upload/route";
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
