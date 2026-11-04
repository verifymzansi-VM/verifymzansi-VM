import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStaffEvidence } from "./staff-evidence-fetch";
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("../supabase/client", () => ({ createClient: () => ({ auth: { getUser } }) }));
describe("staff evidence re-verification", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["mfa_required", "step_up_required"])(
    "returns %s reviewers to the same evidence page",
    async (code) => {
      const assign = vi.fn();
      vi.stubGlobal("window", {
        location: {
          pathname: "/admin/verification/evidence",
          search: "?stepId=synthetic-step",
          assign,
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ code, verifyUrl: "https://untrusted.example" }), {
            status: 403,
          })
        )
      );
      const response = await fetchStaffEvidence("/api/admin/verification/evidence", {
        method: "POST",
      });
      const href = new URL(assign.mock.calls[0][0], "https://example.test");
      expect(href.origin).toBe("https://example.test");
      expect(href.pathname).toBe("/staff/two-step");
      expect(href.searchParams.get("next")).toBe(
        "/admin/verification/evidence?stepId=synthetic-step"
      );
      expect(href.searchParams.get("confirm")).toBe(code === "step_up_required" ? "1" : null);
      expect(await response.json()).toMatchObject({ code });
    }
  );
  it.each([401, 403, 200])(
    "preserves a non-MFA %i response without redirecting",
    async (status) => {
      const assign = vi.fn();
      vi.stubGlobal("window", { location: { assign } });
      const original = new Response("synthetic result", { status });
      const mockFetch = vi.fn().mockResolvedValue(original);
      vi.stubGlobal("fetch", mockFetch);
      const init = { method: "POST", headers: { "x-csrf-token": "synthetic" }, body: "synthetic" };
      expect(await fetchStaffEvidence("/api/admin/verification/evidence", init)).toBe(original);
      expect(mockFetch).toHaveBeenCalledWith("/api/admin/verification/evidence", init);
      expect(assign).not.toHaveBeenCalled();
      expect(await original.text()).toBe("synthetic result");
    }
  );
});

describe("native private evidence actor fence", () => {
  const actor = "11111111-1111-4111-8111-111111111111";
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("checks the current user before releasing a private response to a viewer", async () => {
    const response = new Response("private fixture", {
      headers: { "X-VerifyMzansi-Actor": actor },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await fetchStaffEvidence("/api/admin/verification/evidence", { method: "POST" })).toBe(
      response
    );
    expect(getUser).toHaveBeenCalledTimes(1);
  });
  it("rejects a missing actor receipt or an account switch during the request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("private fixture"))
      .mockResolvedValueOnce(
        new Response("private fixture", { headers: { "X-VerifyMzansi-Actor": actor } })
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      fetchStaffEvidence("/api/admin/verification/evidence", { method: "POST" })
    ).rejects.toThrow("authorization could not be confirmed");
    getUser.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
      error: null,
    });
    await expect(
      fetchStaffEvidence("/api/admin/verification/evidence/metadata", { method: "POST" })
    ).rejects.toThrow("Staff account changed");
  });
});
