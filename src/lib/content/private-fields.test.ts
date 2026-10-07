// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "@/lib/business-verification/test-db";

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof createFakeDb> | null,
  broken: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (state.broken) throw new Error("no service role");
    return state.db!.client;
  },
}));

import {
  loadBusinessPrivateFields,
  withAllPrivateFields,
  withVisibleBusinessPrivateFields,
} from "./private-fields";

const SHOP = "b-shop";
const HOME = "b-home";

beforeEach(() => {
  state.broken = false;
  state.db = createFakeDb({
    business_private: [
      {
        business_id: SHOP,
        phone: "+27821111111",
        whatsapp: null,
        email: "shop@example.co.za",
        location_address: "1 Main Rd",
        map_directions: "https://maps.example/shop",
      },
      {
        business_id: HOME,
        phone: "+27822222222",
        whatsapp: "+27822222222",
        email: null,
        location_address: "9 Private St",
        map_directions: null,
      },
    ],
    listing_private: [{ listing_id: "l1", location_address: "3 Home St" }],
  });
});

const shop = {
  id: SHOP,
  owner_id: "owner-1",
  business_type: "standalone_shop",
  category_details: null,
};
const home = {
  id: HOME,
  owner_id: "owner-2",
  business_type: "home_business",
  category_details: null,
};

describe("withVisibleBusinessPrivateFields", () => {
  it("gives visitors a published address but never contact details", async () => {
    const [row] = await withVisibleBusinessPrivateFields([{ ...shop, phone: "leaked" }], null);
    expect(row).toMatchObject({
      location_address: "1 Main Rd",
      map_directions: "https://maps.example/shop",
    });
    expect(row).not.toHaveProperty("phone");
    expect(row.contact_available).toEqual({ phone: true, whatsapp: false, email: true });
  });

  it("never shows a home business's address to visitors", async () => {
    const [row] = await withVisibleBusinessPrivateFields([home], "someone-else");
    expect(row).not.toHaveProperty("location_address");
  });

  it("gives the owner everything", async () => {
    const [row] = await withVisibleBusinessPrivateFields([home], "owner-2");
    expect(row).toMatchObject({ phone: "+27822222222", location_address: "9 Private St" });
  });
});

describe("withAllPrivateFields", () => {
  it("fills business and listing rows from the private tables, nulls when absent", async () => {
    const businesses = await withAllPrivateFields("businesses", [{ id: SHOP }, { id: "none" }]);
    expect(businesses[0]).toMatchObject({ phone: "+27821111111", location_address: "1 Main Rd" });
    expect(businesses[1]).toMatchObject({ phone: null, email: null, location_address: null });
    const listings = await withAllPrivateFields("listings", [{ id: "l1" }, { id: "l2" }]);
    expect(listings.map((l) => l.location_address)).toEqual(["3 Home St", null]);
  });

  it("throws rather than deciding without the real values", async () => {
    state.broken = true;
    await expect(withAllPrivateFields("businesses", [{ id: SHOP }])).rejects.toThrow();
  });
});

describe("loadBusinessPrivateFields", () => {
  it("returns nothing (never throws) when the private table can't be read", async () => {
    state.broken = true;
    expect((await loadBusinessPrivateFields([SHOP])).size).toBe(0);
  });
});
