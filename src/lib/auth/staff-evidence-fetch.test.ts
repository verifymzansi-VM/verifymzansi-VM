import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStaffEvidence } from "./staff-evidence-fetch";
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
