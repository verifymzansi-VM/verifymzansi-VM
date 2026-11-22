import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIpGeolocation } from "./ip-geolocation";

// Outside the Worker, getCloudflareContext() would ask wrangler's platform
// proxy, which answers with the server machine's own location. The helper must
// never use it: this mock fails any test that reaches it.
const { platformProxy } = vi.hoisted(() => ({
  platformProxy: vi.fn(async () => ({
    cf: { country: "ZA", regionCode: "KZN", region: "KwaZulu-Natal", city: "Durban" },
  })),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: platformProxy }));

const scope = globalThis as Record<PropertyKey, unknown>;
const key = Symbol.for("__cloudflare-context__");
const original = scope[key];
afterEach(() => {
  if (original === undefined) delete scope[key];
  else scope[key] = original;
  expect(platformProxy).not.toHaveBeenCalled();
});

describe("Cloudflare province aliases", () => {
  it.each(["GP", "GT", "ZA-GT"])("accepts Gauteng code %s", (regionCode) => {
    scope[key] = { cf: { country: "ZA", regionCode, city: "Johannesburg" } };
    expect(resolveIpGeolocation()).toMatchObject({ province: "Gauteng" });
  });
  it("uses region names if the code is unavailable", () => {
    scope[key] = { cf: { country: "ZA", region: "Western Cape", city: "Cape Town" } };
    expect(resolveIpGeolocation()).toMatchObject({ province: "Western Cape" });
  });
});

describe("only the request's own Cloudflare data", () => {
  it("returns null outside the Worker, without asking the platform proxy", () => {
    delete scope[key];
    expect(resolveIpGeolocation()).toBeNull();
  });
  it("returns null when the request context has no cf", () => {
    scope[key] = { env: {}, ctx: {} };
    expect(resolveIpGeolocation()).toBeNull();
  });
});

describe("nothing about the visitor's location is logged", () => {
  it("reads a location outside South Africa without writing a log line", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    try {
      scope[key] = { cf: { country: "GB", regionCode: "ENG", city: "London" } };
      expect(resolveIpGeolocation()).toMatchObject({ country: "GB", province: null });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
