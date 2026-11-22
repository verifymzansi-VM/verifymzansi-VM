import { afterEach, describe, expect, it, vi } from "vitest";
import { listingCopyFields, parseCopyId, submitListingCopy } from "./listing-copy";

const id = "33333333-3333-4333-8333-333333333333";

describe("parseCopyId", () => {
  it("accepts only a post id", () => {
    expect(parseCopyId(id.toUpperCase())).toBe(id);
    expect(parseCopyId("../admin")).toBeNull();
    expect(parseCopyId(null)).toBeNull();
  });
});

describe("listingCopyFields", () => {
  it("fills the form from the owner's read of the copy", () => {
    const fields = listingCopyFields({
      title: "Demo bakkie",
      description: "A synthetic description.",
      price_cents: 28990000,
      price_negotiable: true,
      category: "vehicles",
      attributes: { make: "Toyota", condition: "used" },
      location_province: "Gauteng",
      location_city: "Johannesburg",
      location_town: "Sandton",
      location_address: "1 Synthetic Road",
      contact_methods: ["call"],
      photos: ["https://media.example/media/a", "https://media.example/media/b"],
      logo_url: "https://media.example/media/l",
      focal_x: 0.25,
      focal_y: 0.75,
    });
    expect(fields).toMatchObject({
      title: "Demo bakkie",
      price: "289900",
      negotiable: true,
      category: "vehicles",
      condition: "used",
      town: "Sandton",
      photos: ["https://media.example/media/a", "https://media.example/media/b"],
      logo: "https://media.example/media/l",
      focal: { x: 0.25, y: 0.75 },
    });
    expect(fields.contactMethods).toContain("call");
  });

  it("falls back to empty values", () => {
    const fields = listingCopyFields({});
    expect(fields).toMatchObject({ title: "", price: "", photos: [], logo: null });
  });
});

describe("submitListingCopy", () => {
  afterEach(() => vi.unstubAllGlobals());
  const resubmit = (revision: number) => ({
    operationId: "op",
    expectedRevision: revision,
    contentType: "listing",
  });

  it("saves the copy, then submits it at the saved revision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ success: true, status: "draft", revision: 4 }))
      .mockResolvedValueOnce(Response.json({ id, status: "pending_moderation", success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await submitListingCopy(id, { title: "Demo bakkie" }, resubmit);
    expect(response.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/listings/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/content/resubmit");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      itemId: id,
      area: "MZANSI_MARKET",
      operationId: "op",
      expectedRevision: 4,
      contentType: "listing",
    });
  });

  it("returns a refused save without submitting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "Check your post" }, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await submitListingCopy(id, {}, resubmit)).status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes on the new-photo refusal as a photo error and other refusals as a plain error", async () => {
    const photo = "Add at least one new photo of this item. Each car or home is a different item.";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ revision: 2 }))
        .mockResolvedValueOnce(
          Response.json({ error: photo, reason: "copy_new_photo_required" }, { status: 422 })
        )
        .mockResolvedValueOnce(Response.json({ revision: 2 }))
        .mockResolvedValueOnce(
          Response.json(
            { error: "Plan required", reason: "posting_plan_required" },
            { status: 403 }
          )
        )
    );
    const first = await submitListingCopy(id, {}, resubmit);
    expect(first.status).toBe(422);
    expect(await first.json()).toEqual({ error: photo });
    const second = await submitListingCopy(id, {}, resubmit);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Plan required" });
  });
});
