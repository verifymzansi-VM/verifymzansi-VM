/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import { buildCoreDraftCommand } from "../domains/posts/identity";
import {
  buildFoundationPostContacts,
  readFoundationPostContacts,
  saveFoundationPostContacts,
} from "./post-contacts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const token =
  "e30." +
  Buffer.from(JSON.stringify({ role: "authenticated", sub: other, session_id: id })).toString(
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
const view = () => ({
  id,
  kind: "listing",
  status: "draft",
  revision: 2,
  edit_of: null,
  channels: null,
  phone_ready: false,
});

it("keeps explicit canonical contact selection and rejects authority injection before transport", async () => {
  expect(
    buildFoundationPostContacts({
      id: id.toUpperCase(),
      expected_revision: 1,
      channels: ["in_app", "call", "form", "whatsapp"],
    })
  ).toEqual({ p_post_id: id, p_expected_revision: 1, p_channels: ["call", "whatsapp", "form"] });
  const fetcher = vi.fn<typeof fetch>();
  for (const value of [
    { id, expected_revision: 1 },
    { id, expected_revision: 1, channels: null },
    { id, expected_revision: 1, channels: ["email"] },
    { id, expected_revision: 1, channels: [null] },
    { id, expected_revision: 2147483647, channels: [] },
    { id, expected_revision: 1, channels: [], owner_id: other },
    { id, expected_revision: 1, channels: [], phone: "+27000000000" },
  ])
    await expect(saveFoundationPostContacts(api(fetcher), value)).rejects.toThrow(
      "Invalid foundation contact preferences"
    );
  expect(fetcher).not.toHaveBeenCalled();
});

it("carries an explicit create preference without fabricating a default or accepting business contacts", () => {
  const context = { kind: "listing", area: "market", category_key: "electronics" };
  expect(buildCoreDraftCommand({ context, detail: {} }).p_detail).toEqual({});
  expect(
    buildCoreDraftCommand({ context, detail: { contact_channels: ["in_app", "call"] } }).p_detail
  ).toEqual({ contact_channels: ["call", "form"] });
  expect(() =>
    buildCoreDraftCommand({
      context: { kind: "business", area: "business", category_key: "other" },
      detail: { contact_channels: ["form"] },
    })
  ).toThrow();
  expect(() => buildCoreDraftCommand({ context, detail: { contact_channels: null } })).toThrow();
});

it("distinguishes missing resources, unset preferences and explicit cleared drafts", async () => {
  for (const body of [
    null,
    view(),
    { ...view(), channels: [] },
    { ...view(), channels: ["call"], phone_ready: true },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(body));
    expect(await readFoundationPostContacts(api(fetcher), { id })).toEqual(body);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("rejects private fields, wrong resources, noncanonical stored channels and invalid lifecycle DTOs", async () => {
  for (const body of [
    { ...view(), phone: "+27000000000" },
    { ...view(), owner_id: other },
    { ...view(), id: other },
    { ...view(), channels: ["in_app"] },
    { ...view(), channels: ["form", "call"] },
    { ...view(), channels: ["form", "form"] },
    { ...view(), kind: "business" },
    { ...view(), kind: "event", status: "sold" },
    { ...view(), edit_of: id },
    { ...view(), edit_of: other, status: "live" },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(body));
    await expect(readFoundationPostContacts(api(fetcher), { id })).rejects.toThrow(
      "Invalid foundation contact preferences response"
    );
  }
});

it("sends one exact revision-bound save and validates the acknowledged selection", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new URL(String(url)).pathname).toBe("/rest/v1/rpc/set_post_contacts");
    expect(JSON.parse(String(init?.body))).toEqual({
      p_post_id: id,
      p_expected_revision: 2,
      p_channels: ["call", "form"],
    });
    expect(init?.cache).toBe("no-store");
    return response({ id, revision: 3, channels: ["call", "form"] });
  });
  expect(
    await saveFoundationPostContacts(api(fetcher), {
      id,
      expected_revision: 2,
      channels: ["in_app", "call"],
    })
  ).toEqual({ id, revision: 3, channels: ["call", "form"] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects mismatched acknowledgements without replaying a possibly committed save", async () => {
  for (const body of [
    { id: other, revision: 3, channels: ["form"] },
    { id, revision: 2, channels: ["form"] },
    { id, revision: 3, channels: ["call"] },
    { id, revision: 3, channels: ["form"], phone: "secret" },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(body));
    await expect(
      saveFoundationPostContacts(api(fetcher), { id, expected_revision: 2, channels: ["form"] })
    ).rejects.toThrow("Invalid foundation contact preferences response");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("keeps protocol and network failures safe and never retries", async () => {
  for (const fetcher of [
    vi.fn<typeof fetch>(async () =>
      response({ code: "42501", message: "private server diagnostic" }, 403)
    ),
    vi.fn<typeof fetch>(async () => {
      throw new Error("private transport diagnostic");
    }),
  ]) {
    await expect(
      saveFoundationPostContacts(api(fetcher), { id, expected_revision: 2, channels: [] })
    ).rejects.toThrow("Foundation contact preferences unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const changed = vi.fn<typeof fetch>(async () =>
    response({ code: "PT409", message: "private detail" }, 409)
  );
  await expect(
    saveFoundationPostContacts(api(changed), { id, expected_revision: 2, channels: [] })
  ).rejects.toThrow("Foundation post changed; reload");
  expect(changed).toHaveBeenCalledTimes(1);
});

it("keeps oversized malformed channel responses behind the fixed response error", async () => {
  const malformed = ["call", "whatsapp", "form", "call", "form"];
  const reader = vi.fn<typeof fetch>(async () => response({ ...view(), channels: malformed }));
  await expect(readFoundationPostContacts(api(reader), { id })).rejects.toMatchObject({
    name: "Error",
    message: "Invalid foundation contact preferences response",
  });
  expect(reader).toHaveBeenCalledTimes(1);
  const writer = vi.fn<typeof fetch>(async () =>
    response({ id, revision: 3, channels: malformed })
  );
  await expect(
    saveFoundationPostContacts(api(writer), { id, expected_revision: 2, channels: ["form"] })
  ).rejects.toMatchObject({
    name: "Error",
    message: "Invalid foundation contact preferences response",
  });
  expect(writer).toHaveBeenCalledTimes(1);
});
