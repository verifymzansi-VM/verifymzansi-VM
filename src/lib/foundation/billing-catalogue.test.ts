/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationPublicApi } from "./public-api";
import {
  parseFoundationBillingCatalogue,
  readFoundationBillingCatalogue,
} from "./billing-catalogue";

const config = {
  url: "http://127.0.0.1:55443",
  expectedProjectRef: "local-foundation",
  publishableKey: "sb_publishable_synthetic",
};
const plan = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "market_test",
  label: "Synthetic",
  area: "market",
  price_cents: "100",
  currency: "ZAR",
  duration_days: 30,
  slot_capacity: 1,
  max_photos: 5,
  max_videos: 0,
  addon_capabilities: ["boost"],
};
const payload = () => ({ plans: [{ ...plan }], addons: [] });

it("uses only api RPCs with a public key and omits cookies, persisted auth and cache reuse", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async (_request, _init) =>
      new Response(JSON.stringify(payload()), { headers: { "content-type": "application/json" } })
  );
  const api = createFoundationPublicApi(config, fetcher);
  expect(Object.keys(api)).toEqual(["rpc"]);
  expect(await readFoundationBillingCatalogue(api)).toEqual(payload());
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [request, init] = fetcher.mock.calls[0];
  expect(String(request)).toBe("http://127.0.0.1:55443/rest/v1/rpc/billing_catalogue");
  const headers = new Headers(init?.headers);
  expect(headers.get("content-profile")).toBe("api");
  expect(headers.get("apikey")).toBe(config.publishableKey);
  expect(headers.has("cookie")).toBe(false);
  expect(init).toMatchObject({ credentials: "omit", cache: "no-store", redirect: "error" });
});

it.each([
  { ...config, publishableKey: "sb_secret_private" },
  { ...config, publishableKey: "legacy-jwt" },
  { ...config, url: "http://127.0.0.1:55443?host=remote" },
  { ...config, url: "http://127.0.0.1:55442" },
  {
    ...config,
    url: "https://tnygdgormnofpgjknlhr.supabase.co",
    expectedProjectRef: "tnygdgormnofpgjknlhr",
  },
  {
    ...config,
    url: "https://ubrtdtmumfhjpuegxnhj.supabase.co",
    expectedProjectRef: "ubrtdtmumfhjpuegxnhj",
  },
  {
    ...config,
    url: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    expectedProjectRef: "bbbbbbbbbbbbbbbbbbbb",
  },
  { ...config, ownerId: plan.id },
])(
  "refuses a secret/legacy key, wrong project or unexpected configuration before fetching %#",
  (input) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createFoundationPublicApi(input, fetcher)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it("rejects unknown/private response fields and invalid monetary/capability representations", () => {
  for (const row of [
    { ...plan, owner_id: plan.id },
    { ...plan, price_cents: 100 },
    { ...plan, price_cents: "0100" },
    { ...plan, price_cents: "1e4" },
    { ...plan, price_cents: "100000001" },
    { ...plan, price_cents: "99" },
    { ...plan, currency: "USD" },
    { ...plan, slot_capacity: 1.5 },
    { ...plan, addon_capabilities: ["boost", "boost"] },
    { ...plan, addon_capabilities: ["unknown"] },
  ])
    expect(() => parseFoundationBillingCatalogue({ plans: [row], addons: [] })).toThrow(
      "Invalid foundation billing catalogue"
    );
  expect(() => parseFoundationBillingCatalogue({ ...payload(), private: {} })).toThrow();
  expect(() => parseFoundationBillingCatalogue({ plans: [plan, plan], addons: [] })).toThrow();
  expect(parseFoundationBillingCatalogue({ plans: [], addons: [] })).toEqual({
    plans: [],
    addons: [],
  });
});

it("returns a fixed safe error without leaking database error details and makes one request", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ code: "42501", message: "private database diagnostic" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
  );
  await expect(
    readFoundationBillingCatalogue(createFoundationPublicApi(config, fetcher))
  ).rejects.toThrow(/^Foundation billing catalogue unavailable$/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("disables SDK retries even for a caller selecting a GET read", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ code: "synthetic", message: "unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
  );
  const result = await createFoundationPublicApi(config, fetcher).rpc(
    "billing_catalogue",
    {},
    { get: true }
  );
  expect(result.error).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
