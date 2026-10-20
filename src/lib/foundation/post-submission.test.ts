/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import {
  createFoundationAuthenticatedApi,
  type FoundationAuthenticatedApi,
} from "./authenticated-api";
import { buildFoundationPostSubmission, submitFoundationPost } from "./post-submission";
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
const request = { id, expected_revision: 3 };
const ack = () => ({ id, status: "pending_moderation", revision: 4 });
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
it("submits once as the supplied caller and binds the exact whole-post revision", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(ack()));
  expect(await submitFoundationPost(api(fetcher), { ...request, id: id.toUpperCase() })).toEqual(
    ack()
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    p_post_id: id,
    p_expected_revision: 3,
  });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe(
    "Bearer " + token
  );
});
it("rejects authority injection, invalid revisions and malformed identity before transport", () => {
  for (const bad of [
    null,
    {},
    { ...request, id: "missing" },
    { ...request, owner_id: other },
    { ...request, kind: "event" },
    { ...request, expected_revision: 0 },
    { ...request, expected_revision: 2147483647 },
    { ...request, expected_revision: "3" },
  ])
    expect(() => buildFoundationPostSubmission(bad)).toThrow(
      "Invalid foundation post submission request"
    );
});
it("rejects mismatched identity, stale/future acknowledgements, public states and extra metadata", async () => {
  for (const data of [
    null,
    { ...ack(), id: other },
    { ...ack(), revision: 3 },
    { ...ack(), revision: 5 },
    { ...ack(), revision: "4" },
    { ...ack(), status: "live" },
    { ...ack(), owner_id: id },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(data));
    await expect(submitFoundationPost(api(fetcher), request)).rejects.toThrow(
      "Invalid foundation post submission response"
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("distinguishes a controlled duplicate conflict without exposing backend diagnostics or retrying", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    response(
      { code: "PT409", details: "duplicate_event", message: "private diagnostic", hint: other },
      409
    )
  );
  await expect(submitFoundationPost(api(fetcher), request)).rejects.toThrow(
    "A matching event is already pending or live on your account; edit that event instead"
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("requires explicit reload on a stale revision instead of replaying", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    response({ code: "PT409", details: null, message: "private" }, 409)
  );
  await expect(submitFoundationPost(api(fetcher), request)).rejects.toThrow(
    "Foundation post changed; reload before submitting"
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reports an allowance conflict without retrying", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    response({ code: "PT429", message: "private" }, 429)
  );
  await expect(submitFoundationPost(api(fetcher), request)).rejects.toThrow(
    "Foundation posting allowance reached"
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("safely rejects access/transport failures and never starts another write", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    response({ code: "42501", message: "private" }, 403)
  );
  await expect(submitFoundationPost(api(fetcher), request)).rejects.toThrow(
    /^Foundation post submission unavailable$/
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("safely maps an unexpected rejected RPC promise without another attempt", async () => {
  const rpc = vi.fn().mockRejectedValue(new Error("private transport diagnostic"));
  await expect(
    submitFoundationPost({ rpc } as unknown as FoundationAuthenticatedApi, request)
  ).rejects.toThrow(/^Foundation post submission unavailable$/);
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("maps only the exact readiness refusal safely and never retries", async () => {
  for (const [code, details, message] of [
    [
      "42501",
      "posting_verification_required",
      "Complete identity, phone and locality verification before submitting",
    ],
    ["42501", "private owner diagnosis", "Foundation post submission unavailable"],
    ["PT409", "posting_verification_required", "Foundation post changed; reload before submitting"],
    ["22023", "contact_channels_required", "Choose at least one contact method before submitting"],
    ["PT409", "contact_phone_required", "Verify your account phone before using Call or WhatsApp"],
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response(
        { code, details, message: "private diagnostic", hint: other },
        code === "42501" ? 403 : 409
      )
    );
    await expect(submitFoundationPost(api(fetcher), request)).rejects.toThrow(
      new RegExp("^" + message + "$")
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
