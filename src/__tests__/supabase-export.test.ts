// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { exportSupabaseTable } from "../../scripts/lib/export-supabase-table";

const page = (rows: unknown[], range: string) =>
  new Response(JSON.stringify(rows), {
    headers: { "Content-Range": range },
  });

describe("supplemental Supabase export", () => {
  it("continues from the returned range when the server caps pages", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], "0-1/3"))
      .mockResolvedValueOnce(page([{ id: 3 }], "2-2/3"));
    expect(await exportSupabaseTable("https://example.test", "items", {}, request)).toHaveLength(3);
    expect(new Headers(request.mock.calls[1][1]?.headers).get("Range")).toBe("2-1001");
    expect(new Headers(request.mock.calls[0][1]?.headers).get("Prefer")).toBe("count=exact");
  });
  it("accepts a proven empty table", async () => {
    expect(
      await exportSupabaseTable(
        "https://example.test",
        "items",
        {},
        vi.fn().mockResolvedValue(page([], "*/0"))
      )
    ).toEqual([]);
  });
  it.each(["0-0/*", "1-1/2", "0-2/2", "*/2"])(
    "fails closed for inconsistent range %s",
    async (range) => {
      await expect(
        exportSupabaseTable(
          "https://example.test",
          "items",
          {},
          vi.fn().mockResolvedValue(page([{ id: 1 }], range))
        )
      ).rejects.toThrow();
    }
  );
  it("fails if concurrent writes change the total", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(page([{ id: 1 }], "0-0/2"))
      .mockResolvedValueOnce(page([{ id: 2 }], "1-1/3"));
    await expect(exportSupabaseTable("https://example.test", "items", {}, request)).rejects.toThrow(
      "Row count changed"
    );
  });
  it("stops on network failure without marking a partial export complete", async () => {
    await expect(
      exportSupabaseTable(
        "https://example.test",
        "items",
        {},
        vi.fn().mockResolvedValue(new Response("", { status: 503 }))
      )
    ).rejects.toThrow("HTTP 503");
  });
});
