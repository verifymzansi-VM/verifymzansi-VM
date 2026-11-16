// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";

const require = createRequire(import.meta.url);
const configPath = path.resolve("next.config.js");

/** Loads next.config.js afresh as a build with these settings would. */
async function headersFor(environment: "staging" | "production") {
  const ref = environment === "staging" ? "vgplszqfcmdskwseoyam" : "gntzjtuncsyefujajmjy";
  vi.stubEnv("ENVIRONMENT", environment === "staging" ? "staging" : "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${ref}.supabase.co`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_synthetic");
  delete require.cache[configPath];
  const config = require(configPath) as {
    headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
  };
  return config.headers();
}

describe("the staging copy stays out of search results (M0.15b)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete require.cache[configPath];
  });

  it("adds X-Robots-Tag to every route of a staging build only", async () => {
    const staging = await headersFor("staging");
    expect(staging).toContainEqual({
      source: "/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    });
    const production = await headersFor("production");
    expect(JSON.stringify(production)).not.toContain("X-Robots-Tag");
    expect(production.map((rule) => rule.source)).toEqual([
      "/api/:path((?!(?:media/serve/|share-preview/)).*)",
      "/images/:path*",
    ]);
  }, 120_000);

  it("serves a disallow-all robots.txt on staging only", () => {
    vi.stubEnv("ENVIRONMENT", "staging");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    vi.stubEnv("ENVIRONMENT", "production");
    const live = robots();
    expect(live.sitemap).toMatch(/sitemap\.xml$/);
    expect(JSON.stringify(live.rules)).toContain("/api/share-preview/");
  });
});
