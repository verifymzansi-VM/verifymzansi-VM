import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-public", () => ({
  foundationServerPublicApi: () => {
    throw new Error("tests pass their own client");
  },
}));

import { forgetHiddenSampleSlugs, loadHiddenSampleSlugs, readHiddenSampleSlugs } from "./hidden";
import type { FoundationPublicApi } from "@/lib/foundation/public-api";

const api = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as FoundationPublicApi & {
    rpc: ReturnType<typeof vi.fn>;
  };

describe("readHiddenSampleSlugs", () => {
  it("reads the slugs staff removed through the public command", async () => {
    const client = api({ data: { slugs: ["fish-braai", "guest-house"] }, error: null });
    expect([...(await readHiddenSampleSlugs(client))]).toEqual(["fish-braai", "guest-house"]);
    expect(client.rpc).toHaveBeenCalledWith("get_hidden_sample_posts", {}, { get: false });
  });

  it.each([
    ["a database error", { data: null, error: { code: "PGRST202", message: "missing" } }],
    ["an unexpected shape", { data: { slugs: ["ok-slug"], who: "x" }, error: null }],
    ["a malformed slug", { data: { slugs: ["Not A Slug"] }, error: null }],
    ["no list", { data: null, error: null }],
  ])("throws on %s (callers then show no sample)", async (_label, result) => {
    await expect(readHiddenSampleSlugs(api(result))).rejects.toThrow();
  });
});

describe("loadHiddenSampleSlugs", () => {
  afterEach(() => forgetHiddenSampleSlugs());

  it("keeps a successful read for 30 seconds, then reads again", async () => {
    let now = 1_000;
    const read = vi
      .fn()
      .mockResolvedValueOnce(new Set(["a-sample"]))
      .mockResolvedValueOnce(new Set(["b-sample"]));
    expect([...(await loadHiddenSampleSlugs(read, () => now))]).toEqual(["a-sample"]);
    now += 29_000;
    expect([...(await loadHiddenSampleSlugs(read, () => now))]).toEqual(["a-sample"]);
    now += 2_000;
    expect([...(await loadHiddenSampleSlugs(read, () => now))]).toEqual(["b-sample"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent callers and keeps no failure", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(new Set(["a-sample"]));
    const results = await Promise.allSettled([
      loadHiddenSampleSlugs(read),
      loadHiddenSampleSlugs(read),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect([...(await loadHiddenSampleSlugs(read))]).toEqual(["a-sample"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again at once after staff change the list on this instance", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(new Set<string>())
      .mockResolvedValueOnce(new Set(["a-sample"]));
    await loadHiddenSampleSlugs(read);
    forgetHiddenSampleSlugs();
    expect([...(await loadHiddenSampleSlugs(read))]).toEqual(["a-sample"]);
  });
});
