/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import { createFoundationPublicApi } from "./public-api";
import {
  acceptFoundationPostingTerms,
  buildFoundationPostingTermsAcceptance,
  parseFoundationPostingTerms,
  parseFoundationOwnerPostingTerms,
  readFoundationOwnerPostingTerms,
  readFoundationPostingTerms,
} from "./posting-terms";

const config = {
  url: "http://127.0.0.1:55441",
  expectedProjectRef: "local-foundation",
  publishableKey: "sb_publishable_synthetic",
};
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token =
  "e30." +
  Buffer.from(JSON.stringify({ role: "authenticated", sub: id, session_id: id })).toString(
    "base64url"
  ) +
  ".c2ln";
const doc = {
  version: "posting-v1",
  document_hash: "A".repeat(43),
  document_path: "/terms/versions/posting-v1",
};
const accepted = { ...doc, accepted_at: "2026-10-21T08:00:00.123456+00:00" };
const auth = (f: typeof fetch) => createFoundationAuthenticatedApi(config, token, f);

it("reads the public document with GET and the caller status with an uncached POST", async () => {
  const f = vi.fn<typeof fetch>(async (_url, init) =>
    Response.json(init?.method === "GET" ? doc : accepted)
  );
  expect(await readFoundationPostingTerms(createFoundationPublicApi(config, f))).toEqual(doc);
  expect(await readFoundationOwnerPostingTerms(auth(f))).toEqual(accepted);
  expect(f.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "POST"]);
  for (const [, init] of f.mock.calls)
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
});
it("represents an unpublished policy as unavailable without inventing a document", () => {
  expect(parseFoundationPostingTerms(null)).toBeNull();
  expect(parseFoundationOwnerPostingTerms(null)).toBeNull();
});
it.each([
  { ...doc, version: "../other" },
  { ...doc, document_path: "https://other.example/terms" },
  { ...doc, owner_id: id },
  { ...doc, document_hash: "short" },
])("rejects unsafe or private document DTOs %#", (value) => {
  expect(() => parseFoundationPostingTerms(value)).toThrow("Invalid foundation posting terms");
});
it.each([
  { version: doc.version, document_hash: doc.document_hash },
  { version: doc.version, document_hash: doc.document_hash, accepted: false },
  { version: doc.version, document_hash: doc.document_hash, accepted: true, owner_id: id },
  {
    version: doc.version,
    document_hash: doc.document_hash,
    accepted: true,
    accepted_at: accepted.accepted_at,
  },
])("requires explicit consent and rejects actor/time injection before transport %#", (value) => {
  expect(() => buildFoundationPostingTermsAcceptance(value)).toThrow("Explicit acceptance");
});
it("binds an actual acceptance reply to the displayed version/hash and sends no actor", async () => {
  const f = vi.fn<typeof fetch>(async () => Response.json(accepted));
  expect(
    await acceptFoundationPostingTerms(auth(f), {
      version: doc.version,
      document_hash: doc.document_hash,
      accepted: true,
    })
  ).toEqual(accepted);
  expect(f).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({
    p_version: doc.version,
    p_document_hash: doc.document_hash,
  });
});
it.each([
  { ...accepted, version: "posting-v2" },
  { ...accepted, document_hash: "B".repeat(43) },
  { ...accepted, accepted_at: null },
])("rejects an unbound or unconfirmed acceptance reply %#", async (value) => {
  const f = vi.fn<typeof fetch>(async () => Response.json(value));
  await expect(
    acceptFoundationPostingTerms(auth(f), {
      version: doc.version,
      document_hash: doc.document_hash,
      accepted: true,
    })
  ).rejects.toThrow();
  expect(f).toHaveBeenCalledTimes(1);
});
it("returns a safe changed-version error and never retries the write", async () => {
  const f = vi.fn<typeof fetch>(async () =>
    Response.json(
      { code: "PT409", details: "posting_terms_changed", message: "private diagnostic" },
      { status: 409 }
    )
  );
  await expect(
    acceptFoundationPostingTerms(auth(f), {
      version: doc.version,
      document_hash: doc.document_hash,
      accepted: true,
    })
  ).rejects.toThrow("Posting terms changed; review the current version");
  expect(f).toHaveBeenCalledTimes(1);
});
