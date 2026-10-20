/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import {
  buildFoundationDuplicateEventPreview as buildPreview,
  buildFoundationDuplicateEventFlag as buildFlag,
  previewFoundationDuplicateEvents as preview,
  flagFoundationDuplicateEvents as flag,
  claimFoundationReport as claim,
  readFoundationDuplicateEventFlag as read,
  resolveFoundationDuplicateEventFlag as resolve,
} from "./staff-event-duplicate-flags";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  report = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  nonce = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const token =
  "e30." +
  Buffer.from(JSON.stringify({ role: "authenticated", sub: c, session_id: nonce })).toString(
    "base64url"
  ) +
  ".c2ln";
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
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const event = (id = a, revision = 2) => ({
  id,
  revision,
  title: "Community music event",
  description: "A synthetic community event for strict staff pair tests.",
  category: "events",
  activity: "music_festival",
  province: "gp",
  city: "gp_johannesburg",
  locality: "Johannesburg",
  event_window: {
    starts_at: "2027-01-01T12:00:00.000Z",
    ends_at: "2027-01-01T14:00:00.000Z",
    timezone: "Africa/Johannesburg",
  },
});
const request = () => ({
  post_a: b,
  expected_revision_a: 7,
  post_b: a,
  expected_revision_b: 2,
  reason: "  These events appear to describe the same programme.  ",
});
const ack = () => ({ id: report, status: "open", reused: false, post_a: a, post_b: b });
const fence = () => ({
  report_id: report,
  claim_generation: "9007199254740993",
  claim_nonce: nonce,
});
const claimed = () => ({
  subject: "report",
  id: report,
  claim_generation: fence().claim_generation,
  claim_nonce: nonce,
  claim_expires_at: "2027-01-01T10:00:00.123456Z",
  renewals_left: 4,
  revision: null,
  edit_of: null,
});
const review = () => ({
  id: report,
  origin: "staff",
  category: "duplicate_event",
  description: "These events appear to describe the same programme.",
  status: "open",
  created_at: "2026-10-18T10:00:00.123456Z",
  post_a: { id: a, reported_revision: 2, current: event() },
  post_b: { id: b, reported_revision: 7, current: event(b, 8) },
});
it("preserves revision-to-ID binding for reversed inputs and normalizes UUIDs/reason", () => {
  expect(buildPreview({ post_a: b.toUpperCase(), post_b: a })).toEqual({
    p_post_a: b,
    p_post_b: a,
  });
  expect(buildFlag(request())).toEqual({
    p_post_a: b,
    p_expected_revision_a: 7,
    p_post_b: a,
    p_expected_revision_b: 2,
    p_reason: "These events appear to describe the same programme.",
  });
  expect(buildFlag({ ...request(), expected_revision_a: 2147483647 }).p_expected_revision_a).toBe(
    2147483647
  );
});
it("rejects same pairs, injected authority and invalid revisions before any request", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(ack()));
  for (const bad of [
    { ...request(), post_b: b },
    { ...request(), actor_id: c },
    { ...request(), owner_id: c },
    { ...request(), report_origin: "staff" },
    { ...request(), reporter_ip_hmac: "fake" },
    { ...request(), expected_revision_a: 0 },
    { ...request(), expected_revision_a: 2147483648 },
    { ...request(), expected_revision_b: 1.5 },
  ])
    await expect(flag(api(fetcher), bad)).rejects.toThrow(
      /^Invalid foundation duplicate-event flag$/
    );
  expect(fetcher).not.toHaveBeenCalled();
});
it("bounds reasons and rejects hidden formatting before transport", () => {
  for (const reason of ["short", " ".repeat(30), "x".repeat(2001), "Hidden\u202ereason must fail"])
    expect(() => buildFlag({ ...request(), reason })).toThrow(
      /^Invalid foundation duplicate-event flag$/
    );
});
it("sends one caller-bound preview and checks the canonical pair", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(new URL(String(input)).pathname).toBe("/rest/v1/rpc/preview_duplicate_events");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer " + token);
    expect(new Headers(init?.headers).get("content-profile")).toBe("api");
    expect(JSON.parse(String(init?.body))).toEqual({ p_post_a: b, p_post_b: a });
    return response({ post_a: event(), post_b: event(b, 7), open_flag_id: null });
  });
  expect((await preview(api(fetcher), { post_a: b, post_b: a })).post_a.id).toBe(a);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects mismatched pairs, extra private fields and malformed public windows", async () => {
  for (const body of [
    { post_a: event(), post_b: event(c), open_flag_id: null },
    { post_a: { ...event(), owner_id: c }, post_b: event(b), open_flag_id: null },
    { post_a: { ...event(), event_window: null }, post_b: event(b), open_flag_id: null },
    { post_a: event(b), post_b: event(), open_flag_id: null },
    { post_a: event(), post_b: event(b), open_flag_id: null, reporter_id: c },
  ])
    await expect(
      preview(
        api(async () => response(body)),
        { post_a: a, post_b: b }
      )
    ).rejects.toThrow(/^Invalid foundation duplicate-event preview response$/);
});
it("requires a pair-bound closed flag acknowledgement including idempotent reuse", async () => {
  for (const reused of [false, true]) {
    const fetcher = vi.fn<typeof fetch>(async () => response({ ...ack(), reused }));
    expect((await flag(api(fetcher), request())).reused).toBe(reused);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  for (const body of [
    { ...ack(), post_b: c },
    { ...ack(), post_a: b, post_b: a },
    { ...ack(), reused: "true" },
    { ...ack(), account_action: "ban" },
    { id: report, status: "open", reused: false },
  ])
    await expect(
      flag(
        api(async () => response(body)),
        request()
      )
    ).rejects.toThrow(/^Invalid foundation duplicate-event flag response$/);
});
it("keeps bigint claim generation and microsecond timestamps losslessly", async () => {
  const lease = await claim(
    api(async () => response(claimed())),
    { report_id: report }
  );
  expect(lease.claim_generation).toBe("9007199254740993");
  expect(lease.claim_expires_at).toBe("2027-01-01T10:00:00.123456Z");
  const body = { ...review(), post_a: { ...review().post_a, current: null } };
  const viewed = await read(
    api(async () => response(body)),
    fence()
  );
  expect(viewed.post_a.current).toBeNull();
  expect(viewed.post_b.current?.revision).toBe(8);
});
it("rejects malformed/foreign claims, fabricated actor fields and unsafe generation numbers", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(review()));
  for (const bad of [
    { ...fence(), claim_generation: "bad" },
    { ...fence(), claim_generation: "092" },
    { ...fence(), claim_generation: "9223372036854775808" },
    { ...fence(), claim_generation: 9007199254740992 },
    { ...fence(), actor_id: c },
    { ...fence(), claim_nonce: "bad" },
  ])
    await expect(read(api(fetcher), bad)).rejects.toThrow(/^Invalid foundation report claim$/);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    claim(
      api(async () => response({ ...claimed(), id: c })),
      { report_id: report }
    )
  ).rejects.toThrow(/^Invalid foundation report claim response$/);
  await expect(
    claim(
      api(async () => response({ ...claimed(), subject: "post" })),
      { report_id: report }
    )
  ).rejects.toThrow(/^Invalid foundation report claim response$/);
});
it("requires the requested staff report and hides unexpected private DTO fields", async () => {
  for (const body of [
    { ...review(), id: c },
    { ...review(), origin: "public" },
    { ...review(), reporter_id: c },
    { ...review(), post_a: { ...review().post_a, current: event(c) } },
    { ...review(), post_b: { ...review().post_b, id: a } },
    { ...review(), post_a: { ...review().post_a, current: { ...event(), status: "paused" } } },
  ])
    await expect(
      read(
        api(async () => response(body)),
        fence()
      )
    ).rejects.toThrow(/^Invalid foundation duplicate-event review response$/);
});
it("closes only the exact claimed report with one safe decision acknowledgement", async () => {
  const input = {
    ...fence(),
    outcome: "dismissed",
    note: "  Different programmes after review.  ",
  };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new URL(String(url)).pathname).toBe("/rest/v1/rpc/resolve_report");
    expect(JSON.parse(String(init?.body))).toEqual({
      p_report_id: report,
      p_claim_generation: fence().claim_generation,
      p_claim_nonce: nonce,
      p_outcome: "dismissed",
      p_note: "Different programmes after review.",
    });
    return response({ id: report, status: "dismissed" });
  });
  expect(await resolve(api(fetcher), input)).toEqual({ id: report, status: "dismissed" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (const body of [
    { id: c, status: "dismissed" },
    { id: report, status: "resolved" },
    { id: report, status: "dismissed", post_hidden: true },
  ])
    await expect(
      resolve(
        api(async () => response(body)),
        input
      )
    ).rejects.toThrow(/^Invalid foundation duplicate-event resolution response$/);
});
it("rejects resolution actions and hidden/unbounded notes before requests", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response({}));
  for (const bad of [
    { ...fence(), outcome: "ban", note: "A review note" },
    { ...fence(), outcome: "resolved", note: "x".repeat(501) },
    { ...fence(), outcome: "resolved", note: "Hidden\u202enote" },
    { ...fence(), outcome: "resolved", note: "A review note", post_id: a },
  ])
    await expect(resolve(api(fetcher), bad)).rejects.toThrow(
      /^Invalid foundation duplicate-event resolution$/
    );
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not retry conflicts, permission failures, transport errors or uncertain writes", async () => {
  for (const [status, code] of [
    [409, "PT409"],
    [403, "42501"],
    [500, "XX000"],
  ] as const) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ code, message: "private internal failure" }, status)
    );
    await expect(flag(api(fetcher), request())).rejects.toThrow(
      code === "PT409"
        ? "Foundation duplicate-event data changed; reload before continuing"
        : "Foundation duplicate-event flag unavailable"
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("sensitive transport detail");
  });
  await expect(flag(api(fetcher), request())).rejects.toThrow(
    "Foundation duplicate-event flag unavailable"
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("matches actual event UTF16 bounds for supplementary Unicode characters", async () => {
  for (const [title, description] of [
    ["😀".repeat(3), "😀".repeat(10)],
    ["😀".repeat(60), "😀".repeat(2500)],
  ]) {
    const body = {
      post_a: { ...event(), title, description },
      post_b: event(b),
      open_flag_id: null,
    };
    expect(
      (
        await preview(
          api(async () => response(body)),
          { post_a: a, post_b: b }
        )
      ).post_a.title
    ).toBe(title);
  }
  for (const changes of [{ title: "😀".repeat(61) }, { description: "😀".repeat(2501) }])
    await expect(
      preview(
        api(async () =>
          response({
            post_a: { ...event(), ...changes },
            post_b: event(b),
            open_flag_id: null,
          })
        ),
        { post_a: a, post_b: b }
      )
    ).rejects.toThrow("Invalid foundation duplicate-event preview response");
});
it("uses PostgreSQL codepoint minima and UTF16 maxima for reasons and notes", async () => {
  expect(buildFlag({ ...request(), reason: "😀".repeat(1000) }).p_reason.length).toBe(2000);
  for (const reason of ["😀".repeat(5), "😀".repeat(1001), "invalid\u0000reason"])
    expect(() => buildFlag({ ...request(), reason })).toThrow(
      "Invalid foundation duplicate-event flag"
    );
  const fetcher = vi.fn<typeof fetch>(async () => response({ id: report, status: "resolved" }));
  for (const note of ["😀".repeat(3), "😀".repeat(251)])
    await expect(resolve(api(fetcher), { ...fence(), outcome: "resolved", note })).rejects.toThrow(
      "Invalid foundation duplicate-event resolution"
    );
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await resolve(api(fetcher), { ...fence(), outcome: "resolved", note: "😀".repeat(250) })
  ).toEqual({
    id: report,
    status: "resolved",
  });
  await expect(
    read(
      api(async () => response({ ...review(), description: "😀".repeat(1001) })),
      fence()
    )
  ).rejects.toThrow("Invalid foundation duplicate-event review response");
});
