import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIpGeolocation } from "./ip-geolocation";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => {
    throw new Error("local");
  }),
}));
const scope = globalThis as Record<PropertyKey, unknown>;
const key = Symbol.for("__cloudflare-context__");
const original = scope[key];
afterEach(() => {
  if (original === undefined) delete scope[key];
  else scope[key] = original;
});

describe("Cloudflare province aliases", () => {
  it.each(["GP", "GT", "ZA-GT"])("accepts Gauteng code %s", async (regionCode) => {
    scope[key] = { cf: { country: "ZA", regionCode, city: "Johannesburg" } };
    expect(await resolveIpGeolocation()).toMatchObject({ province: "Gauteng" });
  });
  it("uses region names if the code is unavailable", async () => {
    scope[key] = { cf: { country: "ZA", region: "Western Cape", city: "Cape Town" } };
    expect(await resolveIpGeolocation()).toMatchObject({ province: "Western Cape" });
  });
  it("returns null outside the Cloudflare runtime", async () => {
    delete scope[key];
    expect(await resolveIpGeolocation()).toBeNull();
  });
});
