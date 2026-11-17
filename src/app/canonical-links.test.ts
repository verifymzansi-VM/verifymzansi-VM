import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

// The pages are imported only for their metadata export.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
  tryCreateAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

/**
 * Each public page names its own address as canonical (resolved against the
 * root layout's metadataBase, https://verifymzansi.com), so a copy reached
 * through another host or with tracking query strings points search engines
 * at the one address. The root layout sets none: it would apply to every page.
 */
const PAGES: Array<[string, () => Promise<{ metadata: Metadata }>]> = [
  ["/", () => import("./page")],
  ["/pricing", () => import("./pricing/page")],
  ["/privacy", () => import("./privacy/page")],
  ["/terms", () => import("./terms/page")],
  ["/trust-safety", () => import("./trust-safety/page")],
  ["/paia", () => import("./paia/page")],
  ["/help/verification", () => import("./help/verification/page")],
  ["/help/business-verification", () => import("./help/business-verification/page")],
  ["/safety/meeting-checklist", () => import("./safety/meeting-checklist/page")],
  ["/safety/scam-alerts", () => import("./safety/scam-alerts/page")],
];

describe("canonical links", () => {
  it.each(PAGES)("%s names itself as canonical", async (address, load) => {
    const { metadata } = await load();
    expect(metadata.alternates?.canonical).toBe(address);
  });

  it("the root layout sets the site address but no canonical of its own", () => {
    const layout = readFileSync(path.join(__dirname, "layout.tsx"), "utf8");
    expect(layout).toContain("metadataBase:");
    expect(layout).not.toContain("canonical");
  });
});
