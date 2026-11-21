import { describe, expect, it } from "vitest";
import {
  stockCount,
  stockNoun,
  storefrontCard,
  storefrontFacts,
  storefrontTrade,
} from "./storefront";

describe("storefront presentation", () => {
  it("takes the trade from what most posts are", () => {
    expect(storefrontTrade({ vehicles: 17, property: 1 })).toBe("vehicles");
    expect(storefrontTrade({ property: 6, vehicles: 2 })).toBe("property");
    expect(storefrontTrade({ electronics: 5, vehicles: 2 })).toBe("other");
    expect(storefrontTrade({})).toBe("other");
  });

  it("names the stock by its trade only when every listing is of that trade", () => {
    expect(stockCount({ vehicles: 18 }, 18)).toBe("18 cars");
    expect(stockCount({ vehicles: 1 }, 1)).toBe("1 car");
    expect(stockCount({ property: 2 }, 2)).toBe("2 properties");
    expect(stockCount({ electronics: 6 }, 6)).toBe("6 listings");
    // Mixed stock: listings, even when most are cars.
    expect(stockCount({ vehicles: 17, property: 1 }, 18)).toBe("18 listings");
    expect(stockCount({ vehicles: 1, auto_parts: 1 }, 2)).toBe("2 listings");
    expect(stockNoun({ vehicles: 3 })).toBe("cars");
    expect(stockNoun({ vehicles: 3, property: 1 })).toBe("listings");
  });

  it("shows year, km and gearbox for cars, beds, baths and parking for homes", () => {
    expect(
      storefrontFacts("vehicles", { year: 2019, mileage_km: 98000, transmission: "manual" })
    ).toBe("2019 · 98 000 km · Manual");
    expect(storefrontFacts("vehicles", { year: 2021, transmission: "automatic" })).toBe(
      "2021 · Auto"
    );
    expect(storefrontFacts("property", { bedrooms: 3, bathrooms: 1, parking_spots: 2 })).toBe(
      "3 beds · 1 bath · 2 parking"
    );
    expect(storefrontFacts("other", { year: 2019 })).toBe("");
  });

  it("makes a card from a public listing row, never with the town", () => {
    const card = storefrontCard("vehicles", {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Demo bakkie",
      category: "vehicles",
      price_cents: 28990000,
      price_mode: "amount",
      video_thumbnail: "/media/cover",
      photos: ["/media/photo"],
      videos: ["/media/video"],
      attributes: { year: 2019 },
    });
    expect(card).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Demo bakkie",
      price: expect.stringMatching(/^R289/),
      image: "/media/cover",
      hasVideo: true,
      facts: "2019",
    });
  });
});
