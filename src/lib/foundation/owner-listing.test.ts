/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import {
  parseFoundationListingDraft,
  readFoundationListingDraft,
  saveFoundationListingTerms,
} from "./owner-listing";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const token = `e30.${Buffer.from(JSON.stringify({ role: "authenticated", sub: id, session_id: other })).toString("base64url")}.c2ln`;
const connection = {
  url: "http://127.0.0.1:55443",
  expectedProjectRef: "local-foundation",
  publishableKey: "sb_publishable_synthetic",
};
const draft = () => ({
  id,
  kind: "listing",
  area: "market",
  category_key: "electronics",
  status: "draft",
  revision: 1,
  price_mode: null,
  price_cents: null,
  price_negotiable: false,
});
const request = () => ({
  id,
  category: "electronics",
  expected_revision: 1,
  form: { mode: "on_request", amount: "", negotiable: true },
});
const saved = () => ({ ...draft(), revision: 2, price_mode: "on_request", price_negotiable: true });
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const api = (fetcher: typeof fetch) => createFoundationAuthenticatedApi(connection, token, fetcher);
it("restores unset and explicit free/request/amount forms without guessing legacy zero intent", () => {
  expect(parseFoundationListingDraft(draft())?.form).toEqual({
    mode: "",
    amount: "",
    negotiable: false,
  });
  expect(parseFoundationListingDraft(saved())?.form).toEqual(request().form);
  expect(
    parseFoundationListingDraft({
      ...saved(),
      price_mode: "free",
      price_cents: 0,
      price_negotiable: false,
    })?.form.mode
  ).toBe("free");
  expect(
    parseFoundationListingDraft({ ...saved(), price_mode: "amount", price_cents: 10001 })?.form
      .amount
  ).toBe("100.01");
  expect(parseFoundationListingDraft(null)).toBeNull();
});
it("rejects private metadata, incompatible resources and corrupt or hidden price terms with safe errors", () => {
  for (const value of [
    undefined,
    { ...draft(), owner_id: id },
    { ...draft(), status: "live" },
    { ...draft(), kind: "business" },
    { ...draft(), price_cents: 0 },
    { ...saved(), price_cents: 100 },
    { ...saved(), category_key: "jobs_services" },
  ])
    expect(() => parseFoundationListingDraft(value)).toThrow(/^Invalid foundation listing draft$/);
});
it("binds owner read UUID and forwards the real supplied caller token exactly once", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(draft()));
  expect((await readFoundationListingDraft(api(fetcher), { id: id.toUpperCase() }))?.id).toBe(id);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ p_id: id });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe(
    `Bearer ${token}`
  );
  await expect(readFoundationListingDraft(api(fetcher), { id, owner_id: id })).rejects.toThrow(
    /^Invalid foundation listing draft request$/
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    readFoundationListingDraft(
      api(async () => response({ ...draft(), id: other })),
      { id }
    )
  ).rejects.toThrow(/^Invalid foundation listing draft$/);
  expect(
    await readFoundationListingDraft(
      api(async () => response(null)),
      { id }
    )
  ).toBeNull();
});
it("saves negotiable request terms with only revision-fenced SQL parameters", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(saved()));
  expect((await saveFoundationListingTerms(api(fetcher), request())).expected_revision).toBe(2);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    p_id: id,
    p_expected_revision: 1,
    p_terms: { price: { mode: "on_request" }, negotiable: true },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects injected authority, hidden amounts, job/free negotiability and terminal revision before any write", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(saved()));
  for (const value of [
    { ...request(), owner_id: other },
    { ...request(), expected_revision: 2147483647 },
    { ...request(), form: { ...request().form, amount: "99" } },
    { ...request(), category: "jobs_services" },
    { ...request(), form: { ...request().form, mode: "free" } },
  ])
    await expect(saveFoundationListingTerms(api(fetcher), value)).rejects.toThrow(
      /^Invalid foundation listing terms request$/
    );
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects wrong post/category/revision and null replies without silently replaying a possibly committed save", async () => {
  for (const value of [
    null,
    { ...saved(), id: other },
    { ...saved(), category_key: "vehicles" },
    { ...saved(), revision: 1 },
    { ...saved(), revision: 3 },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(value));
    await expect(saveFoundationListingTerms(api(fetcher), request())).rejects.toThrow(
      /^Invalid foundation listing draft$/
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("reports stale revisions and transport failures without leaking diagnostics or retrying", async () => {
  for (const [code, status, message] of [
    ["PT409", 409, "Foundation listing draft changed; reload before saving"],
    ["42501", 403, "Foundation listing terms unavailable"],
    ["57014", 500, "Foundation listing terms unavailable"],
  ] as const) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ code, message: "private diagnostic" }, status)
    );
    await expect(saveFoundationListingTerms(api(fetcher), request())).rejects.toThrow(
      new RegExp(`^${message}$`)
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
