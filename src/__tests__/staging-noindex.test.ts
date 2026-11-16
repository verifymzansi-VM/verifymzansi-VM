// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import { markStagingResponse, STAGING_ROBOTS_TAG } from "../../workers/staging-noindex.mjs";

describe("the staging copy stays out of search results (M0.15b)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("marks every staging response noindex and leaves production untouched", async () => {
    const original = new Response("ok", { status: 200, headers: { "Content-Type": "text/html" } });
    expect(markStagingResponse(original, { ENVIRONMENT: "production" })).toBe(original);
    expect(markStagingResponse(original, {})).toBe(original);
    const marked = markStagingResponse(
      new Response("ok", { status: 404, headers: { "Content-Type": "text/html" } }),
      { ENVIRONMENT: "staging" }
    );
    expect(marked.status).toBe(404);
    expect(marked.headers.get("X-Robots-Tag")).toBe(STAGING_ROBOTS_TAG);
    expect(marked.headers.get("Content-Type")).toBe("text/html");
    expect(await marked.text()).toBe("ok");
  });

  it("serves a disallow-all robots.txt on staging only", () => {
    vi.stubEnv("ENVIRONMENT", "staging");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    vi.stubEnv("ENVIRONMENT", "production");
    const live = robots();
    expect(live.sitemap).toMatch(/sitemap\.xml$/);
    expect(JSON.stringify(live.rules)).toContain("/api/share-preview/");
  });
});
