import { describe, expect, it, vi } from "vitest";

const { guard, createAdminClient } = vi.hoisted(() => ({
  guard: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
import { POST } from "./route";

// Operations health and its Retry route are hidden until they work on the live
// backend (SHOW_STAFF_OPERATIONS in src/lib/hidden-features.ts).
describe("POST /api/admin/ops/jobs/retry while hidden", () => {
  it("answers 404 before any other check", async () => {
    const res = await POST(
      new Request("https://verifymzansi.com/api/admin/ops/jobs/retry", {
        method: "POST",
        body: JSON.stringify({ jobId: "00000000-0000-4000-8000-000000000001" }),
      })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(guard).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
