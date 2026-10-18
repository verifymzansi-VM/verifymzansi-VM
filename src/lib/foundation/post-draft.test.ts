/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import { createFoundationPostDraft, readFoundationPostDraft } from "./post-draft";
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
const request = () => ({
  context: {
    kind: "business",
    area: "tourism_events",
    category_key: "tourism_hospitality",
    activity_key: "guided_tour",
  },
  detail: {},
});
const dto = () => ({
  id,
  kind: "business",
  area: "tourism_events",
  category_key: "tourism_hospitality",
  activity_key: "guided_tour",
  status: "draft",
  revision: 1,
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
it("makes one activity-aware creation call with the actual supplied caller and no followup read", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(dto()));
  expect(await createFoundationPostDraft(api(fetcher), request())).toEqual(dto());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    p_kind: "business",
    p_area: "tourism_events",
    p_category_key: "tourism_hospitality",
    p_activity_key: "guided_tour",
    p_detail: {},
  });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe(
    `Bearer ${token}`
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects changed or missing activity, category, kind and revision acknowledgements without retries", async () => {
  for (const value of [
    { ...dto(), activity_key: "other" },
    { ...dto(), activity_key: undefined },
    { ...dto(), category_key: "automotive_services" },
    { ...dto(), kind: "event" },
    { ...dto(), revision: 2 },
    { ...dto(), owner_id: id },
    null,
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(value));
    await expect(createFoundationPostDraft(api(fetcher), request())).rejects.toThrow(
      /^Invalid foundation post creation response$/
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("retains the no-activity acknowledgement and old parameter shape", async () => {
  const value = {
    id,
    kind: "listing",
    area: "market",
    category_key: "electronics",
    status: "draft",
    revision: 1,
  };
  const fetcher = vi.fn<typeof fetch>(async () => response(value));
  expect(
    await createFoundationPostDraft(api(fetcher), {
      context: { kind: "listing", area: "market", category_key: "electronics" },
      detail: {},
    })
  ).toEqual(value);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty("p_activity_key");
});
it("rejects caller/status injections and malformed activity before any RPC", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(dto()));
  for (const value of [
    { ...request(), owner_id: id },
    { ...request(), context: { ...request().context, status: "live" } },
    { ...request(), context: { ...request().context, activity_key: "" } },
  ])
    await expect(createFoundationPostDraft(api(fetcher), value)).rejects.toThrow(
      /^Invalid foundation post creation request$/
    );
  expect(fetcher).not.toHaveBeenCalled();
});
it("binds a separate identity read to its UUID and distinguishes normal null", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(dto()));
  expect(await readFoundationPostDraft(api(fetcher), { id: id.toUpperCase() })).toEqual(dto());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ p_id: id });
  expect(
    await readFoundationPostDraft(
      api(async () => response(null)),
      { id }
    )
  ).toBeNull();
  await expect(
    readFoundationPostDraft(
      api(async () => response({ ...dto(), id: other })),
      { id }
    )
  ).rejects.toThrow(/^Invalid foundation post draft response$/);
  await expect(readFoundationPostDraft(api(fetcher), { id, actor_id: other })).rejects.toThrow(
    /^Invalid foundation post draft request$/
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("returns fixed safe errors for authority/transport failures without replaying creation", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    response({ code: "42501", message: "private diagnostics" }, 403)
  );
  await expect(createFoundationPostDraft(api(fetcher), request())).rejects.toThrow(
    /^Foundation post creation unavailable$/
  );
  await expect(readFoundationPostDraft(api(fetcher), { id })).rejects.toThrow(
    /^Foundation post draft unavailable$/
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("hides thrown network diagnostics and never retries either operation", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("private network diagnostics");
  });
  await expect(createFoundationPostDraft(api(fetcher), request())).rejects.toThrow(
    /^Foundation post creation unavailable$/
  );
  await expect(readFoundationPostDraft(api(fetcher), { id })).rejects.toThrow(
    /^Foundation post draft unavailable$/
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
