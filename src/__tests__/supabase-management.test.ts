// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchManagementApi } from "../../scripts/lib/supabase-management";

describe("advisor management requests", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserves query headers, authenticates and supplies JSON content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([{ controls: {} }]));
    vi.stubGlobal("fetch", fetchMock);
    await fetchManagementApi("fixture-token", "/projects/fixture/database/query", {
      method: "POST",
      body: JSON.stringify({ query: "SELECT 1", read_only: true }),
      headers: { Prefer: "read-only", Authorization: "unexpected-override" },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer fixture-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Prefer")).toBe("read-only");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("honours caller cancellation in addition to its deadline", async () => {
    const caller = new AbortController();
    caller.abort("cancelled fixture");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    await fetchManagementApi("fixture-token", "/projects/fixture", { signal: caller.signal });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[0][1].signal.reason).toBe("cancelled fixture");
  });
  it("never returns provider error bodies or malformed JSON snippets in errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("private provider detail", { status: 403 }))
        .mockResolvedValueOnce(new Response("private malformed JSON detail"))
    );
    await expect(fetchManagementApi("fixture-token", "/projects/fixture")).rejects.toThrow(
      "Supabase Management API /projects/fixture failed (403)"
    );
    await expect(fetchManagementApi("fixture-token", "/projects/fixture")).rejects.toThrow(
      "Supabase Management API /projects/fixture returned invalid JSON"
    );
  });
});
