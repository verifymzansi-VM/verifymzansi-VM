/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { verifyFoundationGateway } from "./gateway-readiness";

const environment = {
  NEXT_PUBLIC_DATA_BACKEND: "foundation",
  FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy",
  FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_readiness",
  NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic_readiness",
  FOUNDATION_SUPABASE_SECRET_KEY: "sb_secret_synthetic_readiness_credential",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_readiness_credential",
};
const spec = { swagger: "2.0", paths: { "/": {}, "/rpc/run_retention": {} }, definitions: {} };
const terms = {
  version: "posting-v1",
  document_hash: "a".repeat(43),
  document_path: "/terms/versions/posting-v1",
};
function gateway(override?: (url: URL, init: RequestInit) => Response | undefined) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const custom = override?.(url, init!);
    if (custom) return custom;
    const headers = new Headers(init?.headers);
    if (headers.get("Accept-Profile") !== "api")
      return Response.json({ code: "PGRST106" }, { status: 406 });
    if (url.pathname === "/rest/v1/") {
      if (headers.get("apikey") !== environment.FOUNDATION_SUPABASE_SECRET_KEY)
        return Response.json({ message: "Secret API key required" }, { status: 401 });
      return Response.json(spec);
    }
    return Response.json(terms);
  });
}
describe("hosted foundation readiness", () => {
  it("verifies an actual public read and secret-only OpenAPI without writes or bearer secrets", async () => {
    const fetcher = gateway();
    await expect(verifyFoundationGateway(environment, fetcher)).resolves.toEqual({
      serviceOpenapi: spec,
    });
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (const [input, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(init).toMatchObject({ credentials: "omit", cache: "no-store", redirect: "error" });
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(headers.has("Authorization")).toBe(false);
      if (String(input).endsWith("/rest/v1/"))
        expect(headers.get("apikey")).toBe(environment.FOUNDATION_SUPABASE_SECRET_KEY);
    }
  });
  it("rejects mixed project configuration before any request", async () => {
    const fetcher = gateway();
    await expect(
      verifyFoundationGateway(
        { ...environment, NEXT_PUBLIC_SUPABASE_URL: "https://tnygdgormnofpgjknlhr.supabase.co" },
        fetcher
      )
    ).rejects.toThrow("approved London project");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([200, 401, 403, 404, 500])(
    "rejects hidden-schema response %s rather than mistaking it for isolation",
    async (status) => {
      const fetcher = gateway((_url, init) =>
        new Headers(init.headers).get("Accept-Profile") === "private"
          ? Response.json({ code: "not_PGRST106" }, { status })
          : undefined
      );
      await expect(verifyFoundationGateway(environment, fetcher)).rejects.toThrow(
        "Only the foundation API schema"
      );
    }
  );
  it.each([null, {}, { ...terms, document_hash: "invalid" }])(
    "rejects missing or malformed public terms %j",
    async (body) => {
      const fetcher = gateway((url, init) =>
        url.pathname.endsWith("/rpc/get_current_posting_terms") &&
        new Headers(init.headers).get("Accept-Profile") === "api"
          ? Response.json(body)
          : undefined
      );
      await expect(verifyFoundationGateway(environment, fetcher)).rejects.toThrow();
    }
  );
  it("rejects tables exposed alongside the RPC surface", async () => {
    const fetcher = gateway((url) =>
      url.pathname === "/rest/v1/"
        ? Response.json({ ...spec, paths: { ...spec.paths, "/profiles": {} } })
        : undefined
    );
    await expect(verifyFoundationGateway(environment, fetcher)).rejects.toThrow("functions only");
  });
  it("does not echo credential or provider bodies on authentication failure", async () => {
    const fetcher = gateway(() =>
      Response.json({ message: environment.FOUNDATION_SUPABASE_SECRET_KEY }, { status: 401 })
    );
    try {
      await verifyFoundationGateway(environment, fetcher);
      expect.fail("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain(environment.FOUNDATION_SUPABASE_SECRET_KEY);
      expect(String(error)).toContain("credential check failed");
    }
  });
});
