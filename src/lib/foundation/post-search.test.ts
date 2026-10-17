/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import {
  buildFoundationPostSearch,
  parseFoundationPostSearch,
  searchFoundationPosts,
} from "./post-search";
import { createFoundationPublicApi } from "./public-api";
const id = "00000000-0000-4000-8000-000000000001";
const item = () => ({
  id,
  kind: "listing",
  area: "market",
  category: "general_goods",
  activity: null,
  title: "Synthetic listing",
  summary: "",
  price_mode: "on_request",
  price_negotiable: false,
  price_cents: null,
  province: "gauteng",
  city: "johannesburg",
  locality: "Johannesburg",
  condition: "good",
  published_at: "2026-10-16T06:00:00.123456+00:00",
  score: null,
});
const page = () => ({
  items: [item()],
  sort: "newest",
  total: 1,
  facets: { categories: { general_goods: 1 } },
  next_cursor: null,
});
const config = {
  url: "http://127.0.0.1:55443",
  expectedProjectRef: "local-foundation",
  publishableKey: "sb_publishable_synthetic",
};
it("forwards exact opaque cursor and filters without inventing user/private scope", () => {
  const input = {
    area: "market",
    price_mode: "amount",
    min_price_cents: 0,
    max_price_cents: 200,
    cursor: "opaque_cursor==",
    limit: 24,
  };
  expect(buildFoundationPostSearch(input)).toEqual({ p_request: input });
  for (const bad of [
    { owner_id: id },
    { include_hidden: true },
    { category: "x", attributes: { value: { min: 2, max: 1 } } },
    { city: "johannesburg" },
    { activity: "rental" },
    { price_mode: "free", min_price_cents: 1 },
    { price_mode: "on_request", max_price_cents: 10 },
    { price_mode: "amount", min_price_cents: 2, max_price_cents: 1 },
    { limit: 49 },
    { attributes: { x: true } },
  ])
    expect(() => buildFoundationPostSearch(bad)).toThrow("Invalid foundation search request");
});
it("preserves decimal cents, exact timestamps, nullable request prices and distinct Free", () => {
  expect(parseFoundationPostSearch(page())).toEqual(page());
  expect(
    parseFoundationPostSearch({
      ...page(),
      items: [{ ...item(), price_mode: "free", price_cents: "0" }],
    }).items[0].price_cents
  ).toBe("0");
  expect(
    parseFoundationPostSearch({
      ...page(),
      items: [{ ...item(), price_mode: "amount", price_cents: "9999999900" }],
    }).items[0].price_cents
  ).toBe("9999999900");
});
it("rejects private fields, corrupt prices/kinds, unsafe counts and duplicate public identities", () => {
  for (const bad of [
    { ...item(), owner_id: id },
    { ...item(), phone: "+27000000000" },
    { ...item(), price_negotiable: "true" },
    { ...item(), price_negotiable: null },
    { ...item(), price_negotiable: undefined },
    { ...item(), price_mode: "free", price_cents: "0", price_negotiable: true },
    { ...item(), category: "jobs_services", price_negotiable: true },
    { ...item(), price_mode: "free", price_cents: null },
    { ...item(), price_mode: "amount", price_cents: 100 },
    { ...item(), price_mode: "amount", price_cents: "0100" },
    { ...item(), price_mode: "free", price_cents: "0", category: "jobs_services" },
    { ...item(), kind: "event" },
    { ...item(), score: "0.25" },
  ])
    expect(() => parseFoundationPostSearch({ ...page(), items: [bad] })).toThrow(
      "Invalid foundation search response"
    );
  expect(() =>
    parseFoundationPostSearch({ ...page(), total: Number.MAX_SAFE_INTEGER + 1 })
  ).toThrow();
  expect(() => parseFoundationPostSearch({ ...page(), items: [item(), item()] })).toThrow();
  expect(() =>
    parseFoundationPostSearch({ ...page(), facets: { categories: {}, owner: {} } })
  ).toThrow();
});
it("performs a public API RPC and rejects malformed input before issuing a request", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(page()), { headers: { "content-type": "application/json" } })
  );
  const api = createFoundationPublicApi(config, fetcher);
  expect(await searchFoundationPosts(api, { area: "market", limit: 1 })).toEqual(page());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    p_request: { area: "market", limit: 1 },
  });
  await expect(searchFoundationPosts(api, { actor_id: id })).rejects.toThrow(
    "Invalid foundation search request"
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("sanitises database errors without falling back to base tables or returning an empty success", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ code: "42501", message: "private diagnostic" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
  );
  await expect(
    searchFoundationPosts(createFoundationPublicApi(config, fetcher), {})
  ).rejects.toThrow(/^Foundation search unavailable$/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("preserves negotiated advertising on both amount and request-priced listings", () => {
  for (const tuple of [
    { price_mode: "amount", price_cents: "100" },
    { price_mode: "on_request", price_cents: null },
  ]) {
    const value = parseFoundationPostSearch({
      ...page(),
      items: [{ ...item(), ...tuple, price_negotiable: true }],
    });
    expect(value.items[0].price_negotiable).toBe(true);
  }
});
