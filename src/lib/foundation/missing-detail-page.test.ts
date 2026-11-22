import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetMissingDetailPageAnswers,
  isMissingDetailPage,
  type MissingDetailPageReads,
} from "./missing-detail-page";
import { detailPageKeyIsMalformed, matchDetailPage } from "@/lib/routing/detail-pages";

const POST = "3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f";

function reads(overrides: Partial<MissingDetailPageReads> = {}): MissingDetailPageReads {
  return {
    postKind: vi.fn(async () => null),
    organisationListed: vi.fn(async () => false),
    ...overrides,
  };
}

describe("matchDetailPage", () => {
  it.each([
    [`/listing/${POST}`, { area: "listing", id: POST }],
    [`/mzansi-business/${POST}`, { area: "business", id: POST }],
    [`/tourism-events/${POST}`, { area: "tourism", id: POST }],
    ["/organisation/some-org", { area: "organisation", slug: "some-org" }],
    ["/organisation/some%2Dorg", { area: "organisation", slug: "some-org" }],
  ])("%s", (path, page) => {
    expect(matchDetailPage(path)).toEqual(page);
  });

  it.each([
    "/",
    "/listing",
    "/listing/",
    `/listing/${POST}/extra`,
    "/mzansi-business",
    "/tourism-events",
    "/organisation",
    "/dashboard/organisation/some-org",
    "/pricing",
    // The multi-listing page is always shown, so its status is the page's own.
    "/pricing/multi-listing",
    "/pricing/multi-listing/extra",
  ])("ignores %s", (path) => {
    expect(matchDetailPage(path)).toBeNull();
  });

  it("treats undecodable segments as malformed", () => {
    const page = matchDetailPage("/listing/%E0%A4%A");
    expect(page).toEqual({ area: "listing", id: "" });
    expect(detailPageKeyIsMalformed(page!)).toBe(true);
  });
});

describe("detailPageKeyIsMalformed", () => {
  it.each([
    [{ area: "listing", id: POST }, false],
    [{ area: "listing", id: "not-a-uuid" }, true],
    [{ area: "business", id: "123" }, true],
    [{ area: "tourism", id: `${POST}0` }, true],
    [{ area: "organisation", slug: "some-org" }, false],
    [{ area: "organisation", slug: "Some-Org" }, true],
    [{ area: "organisation", slug: "ab" }, true],
    [{ area: "organisation", slug: "a".repeat(61) }, true],
    [{ area: "organisation", slug: "some--org" }, true],
  ] as const)("%j → %s", (page, malformed) => {
    expect(detailPageKeyIsMalformed(page)).toBe(malformed);
  });
});

describe("isMissingDetailPage", () => {
  beforeEach(() => forgetMissingDetailPageAnswers());

  it("is missing when no public post has that id", async () => {
    expect(await isMissingDetailPage({ area: "listing", id: POST }, reads())).toBe(true);
  });

  it.each([
    ["listing", "listing", false],
    ["listing", "business", true],
    ["listing", "event", true],
    ["business", "business", false],
    ["business", "listing", true],
    ["business", "event", true],
    ["tourism", "business", false],
    ["tourism", "event", false],
    ["tourism", "listing", true],
  ] as const)("a %s page for a public %s post: missing=%s", async (area, kind, missing) => {
    const result = await isMissingDetailPage(
      { area, id: POST },
      reads({ postKind: vi.fn(async () => kind) })
    );
    expect(result).toBe(missing);
  });

  it("lets the page decide when the read fails", async () => {
    const failing = reads({
      postKind: vi.fn(async () => {
        throw new Error("down");
      }),
      organisationListed: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    expect(await isMissingDetailPage({ area: "listing", id: POST }, failing)).toBe(false);
    expect(await isMissingDetailPage({ area: "organisation", slug: "x-org" }, failing)).toBe(false);
  });

  it("lets the page decide when the read is slow", async () => {
    vi.useFakeTimers();
    try {
      const pending = isMissingDetailPage(
        { area: "listing", id: POST },
        reads({ postKind: vi.fn(() => new Promise<null>(() => {})) })
      );
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("remembers an existing post for a minute, but never a missing one", async () => {
    let at = 1_000;
    const now = () => at;
    const postKind = vi.fn(async () => "listing" as const);
    const source = reads({ postKind });
    expect(await isMissingDetailPage({ area: "listing", id: POST }, source, now)).toBe(false);
    expect(await isMissingDetailPage({ area: "tourism", id: POST }, source, now)).toBe(true);
    expect(postKind).toHaveBeenCalledTimes(1);
    at += 60_001;
    expect(await isMissingDetailPage({ area: "listing", id: POST }, source, now)).toBe(false);
    expect(postKind).toHaveBeenCalledTimes(2);

    const absent = reads();
    await isMissingDetailPage({ area: "listing", id: POST.replace("3f", "4f") }, absent, now);
    await isMissingDetailPage({ area: "listing", id: POST.replace("3f", "4f") }, absent, now);
    expect(absent.postKind).toHaveBeenCalledTimes(2);
  });

  it("checks organisations and remembers listed ones", async () => {
    const organisationListed = vi.fn(async (slug: string) => slug === "listed-org");
    const source = reads({ organisationListed });
    expect(await isMissingDetailPage({ area: "organisation", slug: "no-such-org" }, source)).toBe(
      true
    );
    expect(await isMissingDetailPage({ area: "organisation", slug: "listed-org" }, source)).toBe(
      false
    );
    expect(await isMissingDetailPage({ area: "organisation", slug: "listed-org" }, source)).toBe(
      false
    );
    expect(organisationListed).toHaveBeenCalledTimes(2);
  });
});
