/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import {
  createFoundationAuthenticatedApi,
  type FoundationAuthenticatedApi,
} from "./authenticated-api";
import { readFoundationVerificationReadiness } from "./verification-readiness";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  session = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const token =
  "e30." +
  Buffer.from(JSON.stringify({ role: "authenticated", sub: id, session_id: session })).toString(
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
const facts = (ready = false, phone = false, locality = false) => ({
  verification_ready: ready,
  phone_verified: phone,
  locality_confirmed: locality,
});

it("observes only the supplied caller with one empty no-store request", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new URL(String(url)).pathname).toBe("/rest/v1/rpc/get_owner_verification_readiness");
    expect(JSON.parse(String(init?.body))).toEqual({});
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer " + token);
    expect(init?.cache).toBe("no-store");
    return response(facts(true, true, true));
  });
  expect(await readFoundationVerificationReadiness(api(fetcher))).toEqual(facts(true, true, true));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects actor or authority selection and malformed input before transport", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const input of [
    null,
    [],
    false,
    { owner_id: id },
    { p_owner: id },
    { verification_ready: true },
    { can_submit: true },
  ])
    await expect(readFoundationVerificationReadiness(api(fetcher), input)).rejects.toThrow(
      "Invalid foundation verification readiness request"
    );
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps phone and locality observations separate from complete verification", async () => {
  for (const body of [
    facts(),
    facts(false, true, false),
    facts(false, false, true),
    facts(false, true, true),
    facts(true, true, true),
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(body));
    expect(await readFoundationVerificationReadiness(api(fetcher))).toEqual(body);
  }
});
it("rejects private metadata, coercions, missing fields and impossible readiness", async () => {
  for (const body of [
    null,
    [],
    {},
    facts(true, false, true),
    facts(true, true, false),
    { ...facts(), verification_ready: "true" },
    { ...facts(), phone_verified: 1 },
    { ...facts(), phone: "+27000000000" },
    { ...facts(), identity_hmac: "private" },
    { ...facts(), owner_id: id },
    { ...facts(), can_submit: true },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () => response(body));
    await expect(readFoundationVerificationReadiness(api(fetcher))).rejects.toThrow(
      "Invalid foundation verification readiness response"
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("keeps controlled errors opaque and never retries", async () => {
  for (const status of [401, 403, 409, 500]) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ code: "42501", message: "private", details: id, hint: session }, status)
    );
    await expect(readFoundationVerificationReadiness(api(fetcher))).rejects.toThrow(
      /^Foundation verification readiness unavailable$/
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("keeps rejected transport promises opaque without replay", async () => {
  const rpc = vi.fn().mockRejectedValue(new Error("private transport diagnosis"));
  await expect(
    readFoundationVerificationReadiness({ rpc } as unknown as FoundationAuthenticatedApi)
  ).rejects.toThrow(/^Foundation verification readiness unavailable$/);
  expect(rpc).toHaveBeenCalledTimes(1);
});
