import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { checkFoundationPageAccess, isMissingDetailPage } = vi.hoisted(() => ({
  checkFoundationPageAccess: vi.fn(),
  isMissingDetailPage: vi.fn(),
}));
vi.mock("@/lib/foundation/page-access", () => ({ checkFoundationPageAccess }));
vi.mock("@/lib/foundation/missing-detail-page", () => ({ isMissingDetailPage }));

import { middleware } from "@/middleware";
import { routeRequest } from "@/proxy-handler";

const POST = "3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f";

function request(
  path: string,
  { host = "localhost:3000", headers = {} as Record<string, string>, method = "GET" } = {}
) {
  return new NextRequest(`http://${host}${path}`, {
    method,
    headers: { host, ...headers },
  });
}

describe("proxy — www moves to the apex domain", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["/", "https://verifymzansi.com/"],
    [
      "/mzansi-market?category=vehicles&page=2",
      "https://verifymzansi.com/mzansi-market?category=vehicles&page=2",
    ],
    [`/listing/${POST}`, `https://verifymzansi.com/listing/${POST}`],
    ["/dashboard", "https://verifymzansi.com/dashboard"],
  ])("redirects www%s permanently, keeping the path and query", async (path, target) => {
    const response = await middleware(request(path, { host: "www.verifymzansi.com" }));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(target);
    expect(checkFoundationPageAccess).not.toHaveBeenCalled();
    expect(isMissingDetailPage).not.toHaveBeenCalled();
  });

  it("matches the host without regard to case or port", async () => {
    const response = await routeRequest(request("/pricing", { host: "WWW.VerifyMzansi.com:443" }));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://verifymzansi.com/pricing");
  });

  it("keeps the method for a form sent to www (308)", async () => {
    const response = await routeRequest(
      request("/api/contact", { host: "www.verifymzansi.com", method: "POST" })
    );
    expect(response.status).toBe(308);
  });

  it.each([
    "verifymzansi.com",
    "staging.verifymzansi.com",
    "localhost:3000",
    "wwwverifymzansi.com",
  ])("leaves %s alone", async (host) => {
    const response = await routeRequest(request("/pricing", { host }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy — real 404 for missing detail pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMissingDetailPage.mockResolvedValue(false);
  });

  it.each([
    "/listing/not-a-uuid",
    "/listing/12345",
    "/mzansi-business/not-a-uuid",
    "/tourism-events/not-a-uuid",
    "/organisation/No_Such_Org",
    "/organisation/ab",
  ])("answers a malformed address %s with 404 without a read", async (path) => {
    const response = await routeRequest(request(path));
    expect(response.status).toBe(404);
    expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe(path);
    expect(isMissingDetailPage).not.toHaveBeenCalled();
  });

  it.each([
    [`/listing/${POST}`, { area: "listing", id: POST }],
    [`/mzansi-business/${POST}`, { area: "business", id: POST }],
    [`/tourism-events/${POST}`, { area: "tourism", id: POST }],
    ["/organisation/no-such-org", { area: "organisation", slug: "no-such-org" }],
    ["/pricing/multi-listing", { area: "multi-listing" }],
  ])("answers %s with 404 when the read finds nothing", async (path, page) => {
    isMissingDetailPage.mockResolvedValue(true);
    const response = await routeRequest(request(path));
    expect(isMissingDetailPage).toHaveBeenCalledWith(page);
    expect(response.status).toBe(404);
    // Same address: the page renders its own "not available" design.
    expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe(path);
  });

  it("lets an existing post render as before", async () => {
    const response = await routeRequest(request(`/listing/${POST}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("leaves the app's own navigation and prefetch fetches to the page", async () => {
    // Next.js strips its RSC headers before the proxy; the browser's
    // Sec-Fetch-Dest is "empty" for those fetches.
    const response = await routeRequest(
      request("/listing/not-a-uuid", { headers: { "sec-fetch-dest": "empty" } })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(isMissingDetailPage).not.toHaveBeenCalled();
  });

  it("checks a browser page load", async () => {
    const response = await routeRequest(
      request("/listing/not-a-uuid", { headers: { "sec-fetch-dest": "document" } })
    );
    expect(response.status).toBe(404);
  });

  it("never rewrites a request it already rewrote (no loop)", async () => {
    isMissingDetailPage.mockResolvedValue(true);
    const response = await routeRequest(
      request(`/listing/${POST}`, { headers: { "x-vm-rewritten": "1" } })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(isMissingDetailPage).not.toHaveBeenCalled();
  });

  it("answers 404 on the pass-through when the server's own address differs from the Host", async () => {
    // `next start -H 127.0.0.1` sees http://localhost:<port> while the browser
    // sends Host 127.0.0.1:<port>; a rewrite would be fetched again as an
    // outside address. The status rides on the pass-through instead.
    const mismatched = new NextRequest("http://localhost:3110/listing/not-a-uuid", {
      headers: { host: "127.0.0.1:3110" },
    });
    const response = await routeRequest(mismatched);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();

    const wrapped = await middleware(
      new NextRequest("http://localhost:3110/listing/not-a-uuid", {
        headers: { host: "127.0.0.1:3110", accept: "text/html" },
      })
    );
    expect(wrapped.status).toBe(404);
    expect(wrapped.headers.get("x-middleware-next")).toBe("1");
    expect(wrapped.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(wrapped.headers.get("x-middleware-request-x-vm-rewritten")).toBeNull();
  });

  it.each(["/listing", "/mzansi-business", "/tourism-events", "/pricing", `/listing/${POST}/x`])(
    "does not check other addresses (%s)",
    async (path) => {
      await routeRequest(request(path));
      expect(isMissingDetailPage).not.toHaveBeenCalled();
    }
  );

  it("throttles organisation pages like the other browse pages, before any read", async () => {
    const headers = { "x-forwarded-for": "203.0.113.77" };
    let last = 0;
    for (let i = 0; i < 61; i++)
      last = (await routeRequest(request("/organisation/some-org", { headers }))).status;
    expect(last).toBe(429);
    expect(isMissingDetailPage).toHaveBeenCalledTimes(60);
  });

  it("renders the 404 page with the normal page policy, nonce and CSRF token", async () => {
    isMissingDetailPage.mockResolvedValue(true);
    const response = await middleware(
      request(`/listing/${POST}`, { headers: { accept: "text/html" } })
    );
    expect(response.status).toBe(404);
    expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe(
      `/listing/${POST}`
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("default-src 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(response.headers.get("x-middleware-request-x-current-pathname")).toBe(
      `/listing/${POST}`
    );
    expect(response.headers.get("x-middleware-request-x-csrf-token")).toBeTruthy();
    // Marked, so a server that fetches the rewrite again cannot loop.
    expect(response.headers.get("x-middleware-request-x-vm-rewritten")).toBe("1");
    expect(response.headers.get("set-cookie")).toContain("vm_csrf=");
    // Not a visit: no anonymous viewer id is issued for a missing page.
    expect(response.headers.get("set-cookie")).not.toContain("vm_viewer");
  });
});
