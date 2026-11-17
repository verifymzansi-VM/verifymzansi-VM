/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { restoredOrganisationDirectory } from "@/lib/foundation/marketplace-server";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/foundation/marketplace-server", () => ({
  restoredOrganisationDirectory: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: vi.fn(() => ({ limited: false })),
  getClientRateLimitKey: () => "client",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

const organisation = (name: string, accepting: boolean) => ({
  id: `id-${name}`,
  slug: name.toLowerCase(),
  name,
  organisation_type: "association",
  service_area: null,
  province: null,
  accepting_applications: accepting,
  programmes: [],
});
const url = "https://verifymzansi.com/api/organisations/search";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(restoredOrganisationDirectory).mockResolvedValue([
    organisation("Zeta", true),
    organisation("Alpha", true),
    organisation("Closed", false),
  ] as never);
});

it("rate limits before reading the directory", async () => {
  vi.mocked(checkLocalRateLimit).mockReturnValueOnce({ limited: true } as never);
  const res = await GET(new NextRequest(url));
  expect(res.status).toBe(429);
  expect(restoredOrganisationDirectory).not.toHaveBeenCalled();
});

it("lists organisations accepting applications from the foundation directory", async () => {
  const res = await GET(new NextRequest(url));
  const body = await res.json();
  expect(body.organisations.map((org: { name: string }) => org.name)).toEqual(["Alpha", "Zeta"]);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(createClient).not.toHaveBeenCalled();
});

it("lists every organisation for filters and matches the search text", async () => {
  const res = await GET(new NextRequest(`${url}?purpose=filter&q=clo`));
  const body = await res.json();
  expect(body.organisations.map((org: { name: string }) => org.name)).toEqual(["Closed"]);
});

it("answers 503 when the directory is unavailable", async () => {
  vi.mocked(restoredOrganisationDirectory).mockRejectedValueOnce(new Error("down"));
  const res = await GET(new NextRequest(url));
  expect(res.status).toBe(503);
});
