/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationPublicApi } from "./public-api";
import {
  parseFoundationReferenceCatalogue,
  readFoundationReferenceCatalogue,
} from "./reference-catalogue";
const catalogue = () => ({
  version: 1,
  content_hash: "A".repeat(43),
  categories: [
    {
      key: "electronics",
      label: "Electronics",
      kind: "listing",
      area: "market",
      activity_required: false,
    },
  ],
  activities: [],
  provinces: [{ id: "gp", code: "GP", label: "Gauteng" }],
  cities: [{ id: "gp_johannesburg", province: "gp", label: "Johannesburg" }],
  fields: [
    {
      category: "electronics",
      key: "condition",
      label: "Condition",
      renderer: "select",
      required: false,
      options: [{ value: "good", label: "Good" }],
      facet: "choice",
    },
  ],
});
const config = {
  url: "http://127.0.0.1:55443",
  expectedProjectRef: "local-foundation",
  publishableKey: "sb_publishable_synthetic",
};
it("parses both labelled options and string options without inventing form/write authority", () => {
  expect(parseFoundationReferenceCatalogue(catalogue())).toEqual(catalogue());
  const value = { ...catalogue(), fields: [{ ...catalogue().fields[0], options: ["good"] }] };
  expect(parseFoundationReferenceCatalogue(value).fields[0].options).toEqual(["good"]);
});
it("rejects private/extra fields, unsupported renderer code and invalid kind/area combinations", () => {
  for (const value of [
    { ...catalogue(), private_notes: "hidden" },
    { ...catalogue(), categories: [{ ...catalogue().categories[0], owner_id: "private" }] },
    { ...catalogue(), categories: [{ ...catalogue().categories[0], kind: "event" }] },
    { ...catalogue(), fields: [{ ...catalogue().fields[0], renderer: "script" }] },
    { ...catalogue(), fields: [{ ...catalogue().fields[0], validation: {} }] },
  ])
    expect(() => parseFoundationReferenceCatalogue(value)).toThrow(
      "Invalid foundation reference catalogue"
    );
});
it("rejects duplicate identities, orphan references and ambiguous option values", () => {
  const value = catalogue();
  for (const bad of [
    { ...value, categories: [...value.categories, ...value.categories] },
    { ...value, cities: [{ ...value.cities[0], province: "unknown" }] },
    { ...value, fields: [{ ...value.fields[0], category: "unknown" }] },
    { ...value, categories: [{ ...value.categories[0], activity_required: true }] },
    {
      ...value,
      fields: [{ ...value.fields[0], options: ["good", { value: "good", label: "Also Good" }] }],
    },
  ])
    expect(() => parseFoundationReferenceCatalogue(bad)).toThrow();
});
it("uses one anonymous API call and safely reports remote errors", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(catalogue()), { headers: { "content-type": "application/json" } })
  );
  expect(
    await readFoundationReferenceCatalogue(createFoundationPublicApi(config, fetcher))
  ).toEqual(catalogue());
  expect(String(fetcher.mock.calls[0][0])).toBe(
    "http://127.0.0.1:55443/rest/v1/rpc/reference_catalog"
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const failed = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ code: "42501", message: "private" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
  );
  await expect(
    readFoundationReferenceCatalogue(createFoundationPublicApi(config, failed))
  ).rejects.toThrow(/^Foundation reference catalogue unavailable$/);
  expect(failed).toHaveBeenCalledTimes(1);
});
