/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import {
  parseFoundationListingEditor,
  readFoundationListingEditor,
  createFoundationListingDraft,
} from "./owner-listing-editor";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const token = `e30.${Buffer.from(JSON.stringify({ role: "authenticated", sub: id, session_id: other })).toString("base64url")}.c2ln`;
const api = (fetcher: typeof fetch) =>
  createFoundationAuthenticatedApi(
    {
      url: "http://127.0.0.1:55443",
      expectedProjectRef: "local-foundation",
      publishableKey: "sb_publishable_synthetic",
    },
    token,
    fetcher
  );
const dto = () => ({
  id,
  kind: "listing",
  area: "market",
  category_key: "electronics",
  status: "draft",
  revision: 1,
  edit_of: null,
  content: {
    title: null,
    description: null,
    province_id: null,
    city_id: null,
    locality_label: null,
  },
  terms: { price_mode: null, price_cents: null, price_negotiable: false },
  attributes_version: 1,
  attributes: {},
  media: [],
});
const image = () => ({
  object_id: other,
  kind: "image",
  state: "ready",
  purpose: "cover",
  position: 0,
  width: 800,
  height: 600,
  focal_x: null,
  focal_y: null,
});
const ack = () => ({
  id,
  kind: "listing",
  area: "market",
  category_key: "electronics",
  status: "draft",
  revision: 1,
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
it("restores incomplete drafts and distinguishes inspection state from mutation permission", () => {
  expect(parseFoundationListingEditor(dto())?.price_form).toEqual({
    mode: "",
    amount: "",
    negotiable: false,
  });
  expect(
    parseFoundationListingEditor({ ...dto(), status: "paused", revision: 2147483647 })?.status
  ).toBe("paused");
  expect(
    parseFoundationListingEditor({
      ...dto(),
      terms: { price_mode: "on_request", price_cents: null, price_negotiable: true },
    })?.price_form.negotiable
  ).toBe(true);
  expect(parseFoundationListingEditor(null)).toBeNull();
});
it("rejects private extra fields, unsupported versions, bad prices and foreign category attributes", () => {
  for (const value of [
    { ...dto(), owner_id: id },
    { ...dto(), terms: { ...dto().terms, billing_status: "paid" } },
    { ...dto(), content: { ...dto().content, phone: "private" } },
    { ...dto(), attributes_version: 2 },
    { ...dto(), attributes: { engine_type: "diesel" } },
    { ...dto(), terms: { ...dto().terms, price_cents: 0 } },
    { ...dto(), terms: { price_mode: "free", price_cents: 0, price_negotiable: true } },
  ])
    expect(() => parseFoundationListingEditor(value)).toThrow(
      /^Invalid foundation listing editor$/
    );
});
it("bounds edit links and media references while permitting cover/gallery reuse", () => {
  expect(
    parseFoundationListingEditor({ ...dto(), media: [image(), { ...image(), purpose: "gallery" }] })
  ).not.toBeNull();
  for (const value of [
    { ...dto(), edit_of: id },
    { ...dto(), edit_of: other, status: "live" },
    { ...dto(), media: [image(), image()] },
    { ...dto(), media: [image(), { ...image(), position: 1, object_id: id }] },
    { ...dto(), media: [{ ...image(), object_key: "evidence/private" }] },
    { ...dto(), media: [{ ...image(), width: null }] },
    { ...dto(), media: [{ ...image(), purpose: "video" }] },
  ])
    expect(() => parseFoundationListingEditor(value)).toThrow();
});
it("binds one owner editor request and rejects injected actor metadata before RPC", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(dto()));
  expect((await readFoundationListingEditor(api(fetcher), { id: id.toUpperCase() }))?.id).toBe(id);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ p_post_id: id });
  await expect(readFoundationListingEditor(api(fetcher), { id, owner_id: other })).rejects.toThrow(
    /^Invalid foundation listing editor request$/
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    readFoundationListingEditor(
      api(async () => response({ ...dto(), id: other })),
      { id }
    )
  ).rejects.toThrow(/^Invalid foundation listing editor$/);
  expect(
    await readFoundationListingEditor(
      api(async () => response(null)),
      { id }
    )
  ).toBeNull();
});
it("creates exactly one listing identity acknowledgement without an implicit followup read", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(ack()));
  expect(await createFoundationListingDraft(api(fetcher), { category: "electronics" })).toEqual(
    ack()
  );
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    p_kind: "listing",
    p_area: "market",
    p_category_key: "electronics",
    p_detail: {},
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (const value of [
    { category: "invented" },
    { category: "electronics", owner_id: id },
    { category: "electronics", kind: "business" },
  ])
    await expect(createFoundationListingDraft(api(fetcher), value)).rejects.toThrow(
      /^Invalid foundation listing creation request$/
    );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects mismatched creation acknowledgements without repeating a possibly committed create", async () => {
  for (const value of [
    null,
    { ...ack(), category_key: "vehicles" },
    { ...ack(), revision: 2 },
    { ...ack(), owner_id: id },
    { ...ack(), kind: "business" },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(value));
    await expect(
      createFoundationListingDraft(api(fetcher), { category: "electronics" })
    ).rejects.toThrow(/^Invalid foundation listing creation response$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("reports remote creation and editor denials with fixed errors", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    response({ code: "42501", message: "private diagnostic" }, 403)
  );
  await expect(readFoundationListingEditor(api(fetcher), { id })).rejects.toThrow(
    /^Foundation listing editor unavailable$/
  );
  await expect(
    createFoundationListingDraft(api(fetcher), { category: "electronics" })
  ).rejects.toThrow(/^Foundation listing creation unavailable$/);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
