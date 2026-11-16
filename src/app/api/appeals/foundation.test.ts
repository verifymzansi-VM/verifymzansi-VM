/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/foundation/owner-route", () => ({ handleFoundationOwnerRoute: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

const decision = "0b0f7a6e-4c7a-4f5d-9a51-2e3c4d5a6b7c";
const appeal = "8d2e1f3a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";

it("submits the appeal through the foundation owner route", async () => {
  const answer = NextResponse.json({ status: "submitted" }, { status: 201 });
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/appeals", { method: "POST" });
  expect(await POST(request)).toBe(answer);
  const options = vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0];
  expect(options).toMatchObject({ action: "appeals:submit", mutate: true, successStatus: 201 });

  const rpc = vi.fn().mockResolvedValue({
    data: { appeal_id: appeal, status: "submitted" },
    error: null,
  });
  const reason = "The listing was removed although it met the rules.";
  await expect(
    options.command({ rpc } as never, { decisionId: decision, reason })
  ).resolves.toEqual({ status: "submitted", appealId: appeal });
  expect(rpc).toHaveBeenCalledWith(
    "submit_my_frontend_appeal",
    { p_action: decision, p_reason: reason },
    { get: false }
  );
  expect(createAdminClient).not.toHaveBeenCalled();
});
