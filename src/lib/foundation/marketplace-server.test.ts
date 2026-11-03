/** @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./server-public", () => ({ foundationServerPublicApi: () => ({ rpc }) }));
import {
  restoredOrganisationDirectory,
  restoredHomeCollection,
  restoredProgrammeShowcases,
  restoredListingDetail,
  restoredPublicDetail,
} from "./marketplace-server";
afterEach(() => vi.clearAllMocks());

it("treats malformed detail identifiers as missing pages without a database request", async () => {
  expect(await restoredPublicDetail("not-a-post")).toBeNull();
  expect(await restoredPublicDetail("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it("maps only listed organisations whose public detail link still resolves", async () => {
  const entry = {
    slug: "local-org",
    name: "Local organisation",
    organisation_type: "ngo",
    service_area: null,
    province: "gp",
    logo_object_key: null,
    programme_status: "active_paid",
    live_businesses: 1,
    accepting_applications: true,
    on_strip: true,
    on_home: true,
  };
  const detail = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    slug: entry.slug,
    name: entry.name,
    organisation_type: entry.organisation_type,
    description: "Public programme",
    programme_description: null,
    service_area: null,
    province: "gp",
    website: null,
    public_email: null,
    public_phone: null,
    logo_object_key: null,
    programme_status: "active_paid",
    accepting_applications: true,
    affiliation_wording: "Member of",
    live_businesses: 1,
    programmes: [],
  };
  rpc.mockImplementation(async (name: string, args?: { p_slug: string }) => ({
    data:
      name === "public_organisation_directory"
        ? [entry, { ...entry, slug: "ended-org" }]
        : args?.p_slug === entry.slug
          ? detail
          : null,
    error: null,
  }));
  const rows = await restoredOrganisationDirectory();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: detail.id,
    slug: entry.slug,
    on_strip: true,
    on_home: true,
    programmes: [],
  });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "public_organisation_directory",
    "get_public_organisation",
    "get_public_organisation",
  ]);
});

it("preserves selected public contact methods without putting a phone number in the page", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
  const post = {
    id,
    kind: "listing",
    area: "market",
    category: "electronics",
    activity: null,
    title: "Fixture",
    description: null,
    price_mode: "amount",
    price_cents: "100",
    price_negotiable: false,
    province: "gp",
    city: "gp_johannesburg",
    locality: "Johannesburg",
    condition: "good",
    published_at: "2026-10-16T12:00:00Z",
    visible_until: "2027-01-01T00:00:00Z",
    event_window: null,
    media: [],
    seller: { public_name: "Tester T.", avatar_object_key: null, identity_verified: true },
  };
  rpc.mockImplementation(async (name: string) => ({
    data: name === "get_public_post" ? post : ["call", "whatsapp"],
    error: null,
  }));
  const row = await restoredListingDetail(id);
  expect(row?.contact_methods).toEqual(["call", "whatsapp"]);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "get_public_post",
    "get_public_contact_channels",
  ]);
  expect(JSON.stringify(row)).not.toContain("+27");
});

it("isolates unavailable home previews and optional programme feeds from the page shell", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "Synthetic provider outage" } });
  await expect(restoredHomeCollection("listings")).resolves.toEqual({
    data: null,
    error: { message: "Posts could not be loaded" },
  });
  await expect(restoredProgrammeShowcases("home")).resolves.toEqual([]);
});
