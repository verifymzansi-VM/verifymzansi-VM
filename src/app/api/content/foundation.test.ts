/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as deleteContent } from "./delete/route";
import { POST as lifecycle } from "./lifecycle/route";
import { POST as resubmit } from "./resubmit/route";
import { handleRestoredPostAction } from "@/lib/foundation/restored-post-actions";

vi.mock("@/lib/foundation/restored-post-actions", () => ({ handleRestoredPostAction: vi.fn() }));

// The restored post actions own CSRF, sign-in, validation and rate limits;
// they are tested in src/lib/foundation/restored-post-actions.test.ts.
it.each([
  ["delete", deleteContent],
  ["lifecycle", lifecycle],
  ["resubmit", resubmit],
] as const)(
  "POST /api/content/%s hands the request to the restored post action",
  async (mode, post) => {
    const answer = NextResponse.json({ success: true });
    vi.mocked(handleRestoredPostAction).mockResolvedValueOnce(answer);
    const request = new Request(`https://verifymzansi.com/api/content/${mode}`, {
      method: "POST",
      headers: { "x-csrf-token": "token" },
      body: JSON.stringify({ itemId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(await post(request)).toBe(answer);
    const [forwarded, forwardedMode] = vi.mocked(handleRestoredPostAction).mock.calls[0];
    expect(forwardedMode).toBe(mode);
    expect(forwarded).toBeInstanceOf(NextRequest);
    expect(forwarded.url).toBe(request.url);
    expect(forwarded.headers.get("x-csrf-token")).toBe("token");
    vi.mocked(handleRestoredPostAction).mockClear();
  }
);
