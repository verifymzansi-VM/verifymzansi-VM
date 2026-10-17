/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import { buildFoundationPostContent, saveFoundationPostContent } from "./post-content";
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
const input = (content: unknown) => ({ id, kind: "listing", expected_revision: 1, content });
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
it("preserves sparse omission versus explicit null and SQL text normalization", () => {
  expect(buildFoundationPostContent(input({ description: null, title: "  Device \n" }))).toEqual({
    p_post_id: id,
    p_expected_revision: 1,
    p_content: { description: null, title: "Device" },
  });
  expect(buildFoundationPostContent(input({ title: " \t ", city_id: null })).p_content).toEqual({
    title: null,
    city_id: null,
  });
  expect(
    buildFoundationPostContent(input({ title: undefined, description: "Kept" })).p_content
  ).toEqual({ description: "Kept" });
});
it("uses per-kind UTF16 limits and rejects hidden characters before trimming", () => {
  expect(() => buildFoundationPostContent(input({ title: "x".repeat(101) }))).toThrow();
  expect(
    buildFoundationPostContent({ ...input({ title: "x".repeat(120) }), kind: "event" })
  ).toBeDefined();
  expect(() =>
    buildFoundationPostContent({ ...input({ description: "x".repeat(3001) }), kind: "business" })
  ).toThrow();
  expect(() => buildFoundationPostContent(input({ title: "😀".repeat(51) }))).toThrow();
  for (const title of ["\ufeffTitle", "x\u202ay", "x\u0000y"])
    expect(() => buildFoundationPostContent(input({ title }))).toThrow();
  expect(() => buildFoundationPostContent(input({ locality_label: "Mid\u200brand" }))).toThrow();
});
it("rejects injected authority, empty patches, conflicting locality, oversized byte payloads and terminal writes", () => {
  for (const value of [
    { ...input({ title: "Device" }), owner_id: other },
    input({ owner_id: other }),
    input({ status: "live" }),
    input({ revision: 99 }),
    input({}),
    input({ title: undefined }),
    input({ city_id: "gp_johannesburg", locality_label: "Midrand" }),
    input({ description: "界".repeat(5000) }),
    { ...input({ title: "Device" }), expected_revision: 2147483647 },
  ])
    expect(() => buildFoundationPostContent(value)).toThrow(
      /^Invalid foundation post content request$/
    );
});
it("makes one bound mutation and requires the exact next revision and requested resource", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response({ id, revision: 2 }));
  expect(await saveFoundationPostContent(api(fetcher), input({ title: "Device" }))).toEqual({
    id,
    revision: 2,
  });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    p_post_id: id,
    p_expected_revision: 1,
    p_content: { title: "Device" },
  });
  for (const value of [
    { id: other, revision: 2 },
    { id, revision: 3 },
    { id, revision: 2, owner_id: id },
    null,
  ]) {
    const bad = vi.fn<typeof fetch>(async () => response(value));
    await expect(saveFoundationPostContent(api(bad), input({ title: "Device" }))).rejects.toThrow(
      /^Invalid foundation post content response$/
    );
    expect(bad).toHaveBeenCalledTimes(1);
  }
});
it("never retries stale, denied or uncertain writes and hides remote diagnostics", async () => {
  for (const [code, status, message] of [
    ["PT409", 409, "Foundation post changed; reload before saving"],
    ["42501", 403, "Foundation post content unavailable"],
    ["57014", 500, "Foundation post content unavailable"],
  ] as const) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ code, message: "private diagnostic" }, status)
    );
    await expect(
      saveFoundationPostContent(api(fetcher), input({ description: null }))
    ).rejects.toThrow(new RegExp(`^${message}$`));
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("trims boundary locality whitespace before rejecting remaining controls like SQL", () => {
  expect(
    buildFoundationPostContent(input({ locality_label: "\t Midrand \n" })).p_content.locality_label
  ).toBe("Midrand");
  expect(() => buildFoundationPostContent(input({ locality_label: "Mid\trand" }))).toThrow();
});
