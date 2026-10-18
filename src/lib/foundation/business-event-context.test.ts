/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import {
  buildFoundationBusinessEventContext as build,
  saveFoundationBusinessEventContext as save,
} from "./business-event-context";
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
const window = () => ({
  starts_at: "2020-01-01T02:00:00+02:00",
  ends_at: "2020-01-01T03:00:00.1+02:00",
  timezone: "US/Eastern",
});
const request = (patch: unknown) => ({ id, expected_revision: 7, patch });
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
it("normalizes complete instants while preserving the requested stored timezone alias", () => {
  expect(build(request({ activity_key: "tour_operator", event_window: window() }))).toEqual({
    p_post_id: id,
    p_expected_revision: 7,
    p_patch: {
      activity_key: "tour_operator",
      event_window: {
        starts_at: "2020-01-01T00:00:00.000Z",
        ends_at: "2020-01-01T01:00:00.100Z",
        timezone: "US/Eastern",
      },
    },
  });
});
it("distinguishes omission from explicit null and removes undefined only", () => {
  expect(build(request({ activity_key: null, event_window: undefined })).p_patch).toEqual({
    activity_key: null,
  });
  expect(
    build(request({ event_window: window(), activity_key: undefined })).p_patch
  ).not.toHaveProperty("activity_key");
});
it("rejects empty patches and authority/category injections before any RPC", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response({ id, revision: 8 }));
  for (const value of [
    request({}),
    request({ activity_key: undefined }),
    request({ owner_id: other }),
    request({ kind: "business" }),
    request({ category_key: "events" }),
    { ...request({ activity_key: null }), actor_id: other },
    request({ activity_key: "UpperCase" }),
  ]) {
    await expect(save(api(fetcher), value)).rejects.toThrow(
      /^Invalid foundation business\/event context request$/
    );
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires a full non-null event window and rejects nested metadata", () => {
  for (const value of [
    null,
    {},
    { starts_at: window().starts_at },
    { ...window(), owner_id: other },
    { ...window(), ends_at: null },
  ])
    expect(() => build(request({ event_window: value }))).toThrow(
      /^Invalid foundation business\/event context request$/
    );
});
it("enforces ordered at-most-90-day millisecond windows including UTC year rollover", () => {
  const start = "2026-01-01T00:00:00.000Z",
    end = new Date(Date.parse(start) + 90 * 86400000).toISOString();
  expect(
    build(request({ event_window: { starts_at: start, ends_at: end, timezone: "UTC" } })).p_patch
  ).toHaveProperty("event_window");
  for (const event_window of [
    { ...window(), ends_at: window().starts_at },
    { ...window(), starts_at: "2020-01-01T00:00:00.000001Z" },
    { starts_at: start, ends_at: new Date(Date.parse(end) + 1).toISOString(), timezone: "UTC" },
    {
      starts_at: "0001-01-01T00:00:00+14:00",
      ends_at: "0001-01-01T01:00:00+14:00",
      timezone: "UTC",
    },
    {
      starts_at: "9999-12-31T23:00:00-14:00",
      ends_at: "9999-12-31T23:30:00-14:00",
      timezone: "UTC",
    },
  ])
    expect(() => build(request({ event_window }))).toThrow();
});
it("bounds timezone shape while SQL remains the supported-catalogue authority", () => {
  expect(
    build(request({ event_window: { ...window(), timezone: "SystemV/EST5" } })).p_patch
  ).toHaveProperty("event_window.timezone", "SystemV/EST5");
  for (const timezone of ["", "US/Eastern\n", "x".repeat(81)])
    expect(() => build(request({ event_window: { ...window(), timezone } }))).toThrow();
});
it("makes one actual-caller write with the exact expected revision and no implicit read", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response({ id, revision: 8 }));
  expect(await save(api(fetcher), request({ activity_key: null }))).toEqual({ id, revision: 8 });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    p_post_id: id,
    p_expected_revision: 7,
    p_patch: { activity_key: null },
  });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe(
    `Bearer ${token}`
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects stale/mismatched/private acknowledgements without replaying a possibly committed write", async () => {
  for (const value of [
    { id: other, revision: 8 },
    { id, revision: 7 },
    { id, revision: 9 },
    { id, revision: "8" },
    { id, revision: 8, owner_id: other },
    null,
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(value));
    await expect(save(api(fetcher), request({ activity_key: null }))).rejects.toThrow(
      /^Invalid foundation business\/event context response$/
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("requires explicit reload for PT409 and hides all other server diagnostics", async () => {
  for (const [code, status, message] of [
    ["PT409", 409, "Foundation post changed; reload before saving"],
    ["42501", 403, "Foundation business/event context unavailable"],
  ] as const) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ code, message: "private diagnostics" }, status)
    );
    await expect(save(api(fetcher), request({ activity_key: null }))).rejects.toThrow(message);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("hides thrown transport diagnostics without automatic retries", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("private transport");
  });
  await expect(save(api(fetcher), request({ activity_key: null }))).rejects.toThrow(
    /^Foundation business\/event context unavailable$/
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("normalizes request UUIDs and permits only the final safe write revision", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response({ id, revision: 2147483647 }));
  expect(
    await save(api(fetcher), {
      ...request({ activity_key: null }),
      id: id.toUpperCase(),
      expected_revision: 2147483646,
    })
  ).toEqual({ id, revision: 2147483647 });
  for (const expected_revision of [0, -1, 2147483647, 7.5]) {
    await expect(
      save(api(fetcher), { ...request({ activity_key: null }), expected_revision })
    ).rejects.toThrow(/^Invalid foundation business\/event context request$/);
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});
