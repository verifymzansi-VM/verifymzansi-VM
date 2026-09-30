import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/posting/visibility", () => ({
  applyVisibleExpiryFilter: <T>(query: T) => query,
}));

import {
  buildPublicEventPromotionsQuery,
  buildPublicTourismBusinessesQuery,
} from "./public-tourism-events";

function fakeClient() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "or", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  const from = vi.fn(() => chain);
  return { client: { from } as never, chain };
}

describe("public tourism/event query builders", () => {
  it("pass the caller's explicit column list through to select", () => {
    const { client, chain } = fakeClient();
    buildPublicTourismBusinessesQuery(client, "id, business_name");
    expect(chain.select).toHaveBeenCalledWith("id, business_name");

    const events = fakeClient();
    buildPublicEventPromotionsQuery(events.client, "2026-09-30T00:00:00.000Z", "id, title");
    expect(events.chain.select).toHaveBeenCalledWith("id, title");
  });

  it("refuse to run without an explicit column list (no implicit select *)", () => {
    const { client, chain } = fakeClient();
    // @ts-expect-error select is required
    expect(() => buildPublicTourismBusinessesQuery(client)).toThrow(/explicit column list/);
    // @ts-expect-error select is required
    expect(() => buildPublicEventPromotionsQuery(client, "2026-09-30T00:00:00.000Z")).toThrow(
      /explicit column list/
    );
    expect(() => buildPublicTourismBusinessesQuery(client, "*")).toThrow(/explicit column list/);
    expect(chain.select).not.toHaveBeenCalled();
  });
});
