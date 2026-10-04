import { describe, expect, it } from "vitest";
import { defaultBrowse } from "./browse";
import {
  browseFromListUrl,
  listHrefForBrowse,
  positionSearch,
  readPosition,
  videoModeHref,
} from "./video-mode";

const params = (value: string) => new URLSearchParams(value);

describe("Video mode entry from a list", () => {
  it("keeps the list's compatible filters and sort", () => {
    expect(
      browseFromListUrl(
        "/mzansi-market",
        params("category=vehicles&condition=like_new&province=Gauteng&q=bmw&sort=price_asc&page=3")
      )
    ).toEqual({
      ...defaultBrowse("market", "Gauteng"),
      category: "vehicles",
      condition: "like_new",
      query: "bmw",
      sort: "price_asc",
    });
  });

  it("drops only the filters Video mode does not understand", () => {
    // "popular" is a list sort the viewer has no equivalent for; the province is unknown.
    expect(
      browseFromListUrl(
        "/mzansi-market",
        params("category=vehicles&sort=popular&province=Atlantis")
      )
    ).toEqual({ ...defaultBrowse("market"), category: "vehicles" });
    // Business categories exist; Market conditions do not apply to businesses.
    expect(
      browseFromListUrl("/mzansi-business", params("category=beauty_personal&condition=new"))
    ).toEqual({ ...defaultBrowse("business"), category: "beauty_personal" });
  });

  it("maps the Tourism & Events list's tabs and stay types", () => {
    expect(browseFromListUrl("/tourism-events", params("tab=events"))).toEqual({
      ...defaultBrowse("tourism"),
      kind: "events",
    });
    expect(browseFromListUrl("/tourism-events", params("subcategory=hotel_resort"))).toEqual({
      ...defaultBrowse("tourism"),
      category: "hotel_resort",
    });
    expect(browseFromListUrl("/promotions/events", params(""))?.kind).toBe("events");
  });

  it("opens the remembered section from home and other pages", () => {
    expect(browseFromListUrl("/", params("category=vehicles"))).toBeNull();
    expect(videoModeHref(null)).toBe("/video-mode");
    expect(videoModeHref(defaultBrowse("business", "Limpopo"))).toBe(
      "/video-mode?v=business&province=Limpopo"
    );
  });
});

describe("Video mode back to a list (desktop visits, close)", () => {
  it("builds the list address with the same filters", () => {
    expect(
      listHrefForBrowse({
        ...defaultBrowse("market", "Gauteng"),
        category: "vehicles",
        condition: "new",
        sort: "newest",
        query: "polo",
      })
    ).toBe("/mzansi-market?province=Gauteng&q=polo&category=vehicles&condition=new&sort=newest");
    expect(listHrefForBrowse({ ...defaultBrowse("tourism"), kind: "events" })).toBe(
      "/tourism-events?tab=events"
    );
    expect(listHrefForBrowse(defaultBrowse("business"))).toBe("/mzansi-business");
  });

  it("round-trips list → Video mode → list", () => {
    const search = "province=Western+Cape&category=vehicles&condition=new&sort=newest";
    const browse = browseFromListUrl("/mzansi-market", params(search))!;
    const back = new URL(listHrefForBrowse(browse), "https://example.test");
    expect(browseFromListUrl(back.pathname, back.searchParams)).toEqual(browse);
  });
});

describe("Video mode position in the address", () => {
  it("round-trips the session, post and media", () => {
    const browse = defaultBrowse("market");
    const position = {
      ctx: "abc123xyz0",
      post: "0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a01",
      media: 2,
    };
    expect(readPosition(params(positionSearch(browse, position)))).toEqual(position);
  });

  it("ignores values that could not have come from Video mode", () => {
    expect(readPosition(params("ctx=../../x&post=<script>&m=-1"))).toEqual({
      ctx: null,
      post: null,
      media: 0,
    });
    expect(readPosition(params("m=1e3")).media).toBe(0);
  });
});
