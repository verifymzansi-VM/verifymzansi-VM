/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/foundation/owner-route", () => ({ handleFoundationOwnerRoute: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

const request = "5f0c2b1e-7a3d-4c8e-9b6f-1d2e3f4a5b6c";

it("closes the account through the foundation owner route", async () => {
  const answer = NextResponse.json({ status: "closed" });
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValueOnce(answer);
  const incoming = new NextRequest("https://verifymzansi.com/api/account/delete", {
    method: "POST",
  });
  expect(await POST(incoming)).toBe(answer);
  const options = vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0];
  // Writes are same-origin and CSRF checked, limited per client and bound to
  // the verified session by the owner route.
  expect(options).toMatchObject({
    request: incoming,
    action: "account:delete",
    mutate: true,
    signInMessage: "Sign in again to delete your account.",
  });
  expect(options.includeAccountId).toBeFalsy();

  const rpc = vi.fn().mockResolvedValue({
    data: {
      status: "closed",
      closed_at: "2026-11-17T10:00:00.123456+00:00",
      erase_after: "2026-12-17T10:00:00.123456+00:00",
      request_id: request,
    },
    error: null,
  });
  await expect(options.command({ rpc } as never, { confirmation: "delete " })).resolves.toEqual({
    status: "closed",
    closedAt: "2026-11-17T10:00:00.123456+00:00",
    eraseAfter: "2026-12-17T10:00:00.123456+00:00",
    eraseBy: "2026-12-24T10:00:00.123Z",
  });
  expect(rpc).toHaveBeenCalledWith("close_my_account", {}, { get: false });

  // Without the typed word nothing is called.
  rpc.mockClear();
  const refused = await options.command({ rpc } as never, { confirmation: "yes" }).catch((e) => e);
  expect(options.refusal(refused)).toMatchObject({
    status: 422,
    reason: "confirmation_required",
  });
  expect(rpc).not.toHaveBeenCalled();

  expect(createAdminClient).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
});
