import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createClient, createAdminClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
import { GET } from "./route";

// The organisation report and its CSV downloads are hidden until they work on
// the live backend (SHOW_ORGANISATION_REPORT in src/lib/hidden-features.ts).
describe("GET /api/organisations/:id/report while hidden", () => {
  it("answers 404 before any other check", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const res = await GET(
      new NextRequest(`https://verifymzansi.com/api/organisations/${id}/report?days=30`),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
