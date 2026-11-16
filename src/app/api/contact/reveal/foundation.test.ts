/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { revealFoundationContact } from "@/lib/foundation/contact-reveal-route";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/foundation/contact-reveal-route", () => ({ revealFoundationContact: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

it("hands the contact reveal to the foundation handler", async () => {
  const answer = NextResponse.json({ methods: [] });
  vi.mocked(revealFoundationContact).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/contact/reveal", {
    method: "POST",
  });
  expect(await POST(request)).toBe(answer);
  expect(revealFoundationContact).toHaveBeenCalledExactlyOnceWith(request);
  expect(createAdminClient).not.toHaveBeenCalled();
});
