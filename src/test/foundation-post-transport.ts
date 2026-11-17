import { act, waitFor } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";
import catalogue from "@/lib/legal/terms-documents/catalogue.json";

/**
 * Test double for the posting-terms request that every post form makes on the
 * foundation backend (`usePostTransport` in src/hooks/use-post-transport.ts).
 *
 *   const { api, terms, termsLoaded } = installFoundationPostFetch(vi.fn());
 *
 * replaces `global.fetch`. The posting-terms request is answered by `terms`
 * with the currently published terms; every other request goes to `api`, so a
 * test's own mock and its call indexes see only the form's API traffic.
 *
 * A form captures the terms when its submit starts, so a test that submits
 * awaits `termsLoaded()` after rendering, as a person would see the form
 * before pressing submit. Make `terms` hang
 * (`terms.mockReturnValue(new Promise(() => {}))`) to submit before the terms
 * have loaded.
 */
export const POSTING_TERMS_PATH = "/api/foundation/posting-terms";

const version = catalogue.active_version as keyof typeof catalogue.versions;

/** The owner's view of the currently published posting terms, as served. */
export const SERVED_POSTING_TERMS = {
  version,
  document_hash: catalogue.versions[version],
  document_path: `/terms/versions/${version}`,
  accepted_at: null,
} as const;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => unknown;

function requestPath(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? `${input.pathname}${input.search}` : input.url;
}

export function installFoundationPostFetch<Api extends FetchLike>(api: Api) {
  const served = vi.fn(async () => ({ ...SERVED_POSTING_TERMS }));
  const terms: Mock<FetchLike> = vi.fn(async () => ({ ok: true, status: 200, json: served }));
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    requestPath(input) === POSTING_TERMS_PATH ? terms(input, init) : api(input, init)
  ) as unknown as typeof fetch;
  /** Resolves once the form has read the served terms and re-rendered. */
  async function termsLoaded() {
    await waitFor(() => expect(served).toHaveBeenCalled());
    await act(async () => {
      await served.mock.results.at(-1)?.value;
    });
  }
  return { api, terms, termsLoaded };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asserts that a submitted post body carries the foundation transport fields:
 * a request receipt, the exact terms version and hash that were served, and
 * for edits the revision of the post as it was loaded.
 */
export function expectFoundationPostFields(
  body: Record<string, unknown>,
  { expectedRevision }: { expectedRevision?: number } = {}
) {
  expect(body.postRequestId).toMatch(UUID);
  expect(body.postingTerms).toEqual({
    version: SERVED_POSTING_TERMS.version,
    document_hash: SERVED_POSTING_TERMS.document_hash,
  });
  if (expectedRevision === undefined) expect(body).not.toHaveProperty("expectedRevision");
  else expect(body.expectedRevision).toBe(expectedRevision);
}
