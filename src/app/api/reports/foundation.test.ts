/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { POST as submitFoundationReport } from "../foundation/reports/route";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("../foundation/reports/route", () => ({ POST: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

it("hands the report to the foundation reports route", async () => {
  const answer = NextResponse.json({ success: true }, { status: 201 });
  vi.mocked(submitFoundationReport).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/reports", { method: "POST" });
  expect(await POST(request)).toBe(answer);
  expect(submitFoundationReport).toHaveBeenCalledExactlyOnceWith(request);
  expect(createAdminClient).not.toHaveBeenCalled();
});
