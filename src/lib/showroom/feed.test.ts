import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mockRpc }) }));
vi.mock("@/lib/utils/logger", () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/utils/media-url", () => ({ normalizeMediaUrl: (value: string) => value }));

import {
  clearShowroomOrderCacheForTests,
  loadShowroomItems,
  varyFrontCard,
  type ShowroomClient,
} from "./feed";

type Row = Record<string, unknown> & { id: string };

function fakeClient(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; ids?: string[] }> = [];
  const client = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: rows, error: null }),
        in: (_column: string, ids: string[]) => {
          calls.push({ table, ids });
          return Promise.resolve({ data: rows.filter((row) => ids.includes(row.id)), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as ShowroomClient, calls };
}

const business = (id: string, province = "Gauteng", name = `Business ${id}`): Row => ({
  id,
  business_name: name,
  description: "A real business",
  location_province: province,
  cover_photo: `/covers/${id}.jpg`,
});

describe("loadShowroomItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearShowroomOrderCacheForTests();
    // Keep the ranked leader first so order assertions are exact.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("keeps the database's fair order and mixes local posts first", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { content_table: "businesses", content_id: "n1", is_local: false },
        { content_table: "businesses", content_id: "n2", is_local: false },
        { content_table: "businesses", content_id: "g1", is_local: true },
      ],
      error: null,
    });
    const { client } = fakeClient({
      businesses: [business("n1", "Limpopo"), business("n2", "Limpopo"), business("g1")],
    });

    const items = await loadShowroomItems("business", { province: "Gauteng", client });

    expect(mockRpc).toHaveBeenCalledWith("get_showroom_feed", {
      p_surface: "business",
      p_province: "Gauteng",
      p_limit: 30,
    });
    expect(items.map((item) => item.id)).toEqual(["g1", "n1", "n2"]);
  });

  it("drops placeholder posts and caps the showroom size", async () => {
    mockRpc.mockResolvedValue({
      data: Array.from({ length: 10 }, (_, index) => ({
        content_table: "businesses",
        content_id: `b${index}`,
        is_local: false,
      })),
      error: null,
    });
    const rows = Array.from({ length: 10 }, (_, index) =>
      business(`b${index}`, "Gauteng", index === 0 ? "[demo] Placeholder" : `Business ${index}`)
    );
    const { client } = fakeClient({ businesses: rows });

    const items = await loadShowroomItems("business", { province: null, client });

    expect(items).toHaveLength(7);
    expect(items.map((item) => item.id)).not.toContain("b0");
  });

  it("falls back to newest first when the ranking is unavailable", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "function missing" } });
    const { client } = fakeClient({
      businesses: [
        { ...business("old"), created_at: "2026-01-01T00:00:00Z" },
        { ...business("new"), created_at: "2026-09-01T00:00:00Z" },
      ],
    });

    const items = await loadShowroomItems("business", { province: null, client });

    expect(items.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("reuses the ranking for a minute instead of re-ranking every visit", async () => {
    mockRpc.mockResolvedValue({
      data: [{ content_table: "businesses", content_id: "b1", is_local: false }],
      error: null,
    });
    const { client } = fakeClient({ businesses: [business("b1")] });

    await loadShowroomItems("market", { province: null, client });
    await loadShowroomItems("market", { province: null, client });
    await loadShowroomItems("market", { province: "Gauteng", client });

    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe("varyFrontCard", () => {
  const entry = (id: string, isLocal: boolean) => ({ table: "businesses" as const, id, isLocal });

  it("puts one of the top 3 first and keeps the rest in order", () => {
    const list = [entry("a", false), entry("b", false), entry("c", false), entry("d", false)];
    expect(varyFrontCard(list, () => 0).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(varyFrontCard(list, () => 0.99).map((e) => e.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps a local post at the front when the leader is local", () => {
    const list = [entry("l1", true), entry("l2", true), entry("n1", false), entry("l3", true)];
    for (const roll of [0, 0.5, 0.99]) {
      expect(varyFrontCard(list, () => roll)[0].isLocal).toBe(true);
    }
  });
});

describe("loadShowroomItems under load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearShowroomOrderCacheForTests();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("shares one ranking query between simultaneous visitors", async () => {
    let release: (value: unknown) => void = () => {};
    mockRpc.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { client } = fakeClient({ businesses: [business("b1")] });

    const visits = [1, 2, 3].map(() => loadShowroomItems("tourism", { province: null, client }));
    release({
      data: [{ content_table: "businesses", content_id: "b1", is_local: false }],
      error: null,
    });
    const results = await Promise.all(visits);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(results.every((items) => items[0]?.id === "b1")).toBe(true);
  });

  it("backs off after a failure instead of asking the database on every visit", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
    const { client } = fakeClient({ businesses: [business("b1")] });

    await loadShowroomItems("home", { province: "Limpopo", client });
    await loadShowroomItems("home", { province: "Limpopo", client });

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
