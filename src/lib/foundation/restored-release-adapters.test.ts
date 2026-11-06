import { afterEach, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationPublicApi } from "./public-api";
import type * as Organisations from "./organisations";
import {
  inviteFrontendStaffOrganisationAdmin,
  manageFrontendStaffOrganisation,
  saveFrontendStaffOrganisation,
} from "./staff-organisation-commands";
import { readFrontendStaffPayments, recordFrontendStaffPaymentReversal } from "./staff-payments";
import { readRestoredBusinessAffiliations } from "./public-business-affiliations";
import {
  readAffiliationOrganisationDashboard,
  readAffiliationWorkspace,
} from "./affiliation-workspace";
import { readFoundationOrganisationManagementData } from "./organisation-management-data";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), send: vi.fn(), invite: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./staff-organisations", () => ({ readFrontendStaffOrganisationDetail: mocks.detail }));
vi.mock("../services/email", () => ({ sendOrganisationAdminInviteEmail: mocks.send }));
vi.mock("./organisations", async (load) => ({
  ...(await load<typeof Organisations>()),
  inviteFoundationOrganisationAdmin: mocks.invite,
}));

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const date = "2026-11-05T10:00:00Z";
const reason = "Approved at programme review";
const profile = { slug: "test-org", name: "Test Organisation", organisationType: "other" };
const saved = { id, slug: profile.slug, revision: 3 };
const ok = (data: unknown) => ({ data, error: null });
const fixture = (data: unknown) => {
  const rpc = vi.fn().mockResolvedValue(ok(data));
  return { rpc, api: { rpc } as unknown as FoundationAuthenticatedApi };
};
const command = { organisationId: id, revision: 2, reason };
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

it("normalises profile form values, binds updates to the revision and rejects an unapproved logo change", async () => {
  const { rpc, api } = fixture(saved);
  mocks.detail.mockResolvedValue({ id, logo_object_key: null });
  await expect(
    saveFrontendStaffOrganisation(api, {
      ...command,
      values: {
        ...profile,
        province: " Gauteng ",
        publicPhone: "082 111 2222",
        description: " ",
        logoUrl: "",
      },
    })
  ).resolves.toBe(id);
  expect(rpc).toHaveBeenCalledWith(
    "save_frontend_organisation_profile",
    expect.objectContaining({
      p_id: id,
      p_expected: 2,
      p_patch: expect.objectContaining({
        province_id: "gp",
        public_phone: "+27821112222",
        description: null,
      }),
    }),
    { get: false }
  );
  rpc.mockClear();
  await expect(
    saveFrontendStaffOrganisation(api, {
      ...command,
      values: { ...profile, logoUrl: "https://example.test/unapproved.png" },
    })
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    saveFrontendStaffOrganisation(api, {
      ...command,
      values: { ...profile, province: "Unknown province" },
    })
  ).rejects.toMatchObject({ status: 422 });
  expect(rpc).not.toHaveBeenCalled();
});

it("revokes a new organisation invitation if delivery fails and never returns the token", async () => {
  const { rpc, api } = fixture({ invite_id: other, revoked: true });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  mocks.detail.mockResolvedValue({ id });
  mocks.invite.mockResolvedValue({
    invite_id: other,
    expires_at: date,
    organisation_name: "Test Organisation",
    token: "synthetic-token",
  });
  const request = { organisationId: id, email: "Person@example.test", reason };
  mocks.send.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
  await expect(inviteFrontendStaffOrganisationAdmin(api, request)).resolves.toEqual({
    inviteId: other,
    expiresAt: date,
  });
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      email: "person@example.test",
      idempotencyKey: "organisation-invite/" + other,
      acceptUrl: "https://verifymzansi.com/organisation-invite?token=synthetic-token",
    })
  );
  expect(rpc).not.toHaveBeenCalled();
  await expect(inviteFrontendStaffOrganisationAdmin(api, request)).rejects.toMatchObject({
    status: 503,
  });
  expect(rpc).toHaveBeenCalledWith(
    "revoke_organisation_invite",
    expect.objectContaining({ p_invite: other }),
    { get: false }
  );
});

it("keeps organisation programme writes revision fenced and rejects an unsupported paid conversion", async () => {
  const { rpc, api } = fixture(saved);
  await manageFrontendStaffOrganisation(api, {
    ...command,
    operation: "set_capacity",
    values: { sponsoredCapacity: 7 },
  });
  expect(rpc).toHaveBeenCalledWith(
    "update_organisation",
    expect.objectContaining({ p_expected_revision: 2, p_patch: { sponsored_capacity: 7 } }),
    { get: false }
  );
  rpc.mockClear();
  await expect(
    manageFrontendStaffOrganisation(api, {
      ...command,
      revision: undefined,
      operation: "suspend",
      values: {},
    })
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    manageFrontendStaffOrganisation(api, {
      ...command,
      operation: "convert_paid",
      values: {},
    })
  ).rejects.toMatchObject({ status: 501 });
  expect(rpc).not.toHaveBeenCalled();
});

it("accepts a scoped payment page and rejects a mismatched reversal receipt", async () => {
  const { rpc, api } = fixture({
    page: 2,
    total: 51,
    items: [
      {
        id,
        user_id: other,
        area: "market",
        status: "complete",
        amount_cents: 5500,
        created_at: date,
        description: "Listing",
      },
    ],
  });
  await expect(readFrontendStaffPayments(api, 2, "complete")).resolves.toMatchObject({ total: 51 });
  expect(rpc).toHaveBeenCalledWith(
    "get_frontend_staff_payments",
    { p_page: 2, p_status: "complete" },
    { get: false }
  );
  rpc.mockResolvedValueOnce(ok({ status: "chargeback", released_activations: 1 }));
  await expect(
    recordFrontendStaffPaymentReversal(api, id, "refunded", reason)
  ).rejects.toMatchObject({ status: 503 });
  rpc.mockResolvedValueOnce(ok({ status: "refunded", released_activations: 1 }));
  await expect(
    recordFrontendStaffPaymentReversal(api, id, "refunded", reason)
  ).resolves.toMatchObject({ released_activations: 1 });
});

it("publishes affiliation badges for requested businesses only and strips storage keys", async () => {
  const badge = {
    business_id: id,
    organisation_id: other,
    organisation_slug: "test-org",
    organisation_name: "Test Org",
    logo_object_key: "media/" + other,
    label: "Member",
    programme_name: null,
    confirmed_at: date,
    sponsored: false,
    sponsorship_label: null,
  };
  const { rpc } = fixture([badge]);
  const api = { rpc } as unknown as FoundationPublicApi;
  await expect(readRestoredBusinessAffiliations(api, [id, id])).resolves.toEqual([
    expect.objectContaining({ business_id: id, logo_url: expect.stringContaining(other) }),
  ]);
  expect(rpc).toHaveBeenCalledWith(
    "get_public_frontend_business_affiliations",
    { p_post_ids: [id] },
    { get: false }
  );
  await expect(readRestoredBusinessAffiliations(api, [other])).rejects.toThrow("scope changed");
  rpc.mockResolvedValueOnce(ok([{ ...badge, sponsored: true }]));
  await expect(readRestoredBusinessAffiliations(api, [id])).rejects.toThrow();
});

it("keeps owner workspace and organisation dashboard on their distinct contracts", async () => {
  const { rpc, api } = fixture({
    account_id: id,
    businesses: [],
    affiliations: [],
    applications: [],
    administered: [],
    preselected: null,
  });
  await expect(readAffiliationWorkspace(api, profile.slug)).resolves.toMatchObject({
    account_id: id,
  });
  expect(rpc).toHaveBeenCalledWith(
    "get_frontend_affiliation_workspace",
    { p_slug: profile.slug },
    { get: false }
  );
  rpc.mockResolvedValueOnce(ok(null));
  await expect(readAffiliationOrganisationDashboard(api, profile.slug)).resolves.toBeNull();
  rpc.mockResolvedValueOnce(ok({ account_id: other }));
  await expect(readAffiliationOrganisationDashboard(api, profile.slug)).rejects.toThrow();
});

it("does not show ended sponsorships in the organisation member rows", async () => {
  const { rpc, api } = fixture(null);
  rpc
    .mockResolvedValueOnce(ok([]))
    .mockResolvedValueOnce(
      ok([
        {
          id,
          post_id: other,
          business_name: null,
          category: "retail",
          province: null,
          city: null,
          live: false,
          affiliation_type: "member",
          programme_name: null,
          confirmed_at: date,
        },
      ])
    )
    .mockResolvedValueOnce(
      ok({
        capacity: 1,
        active: 0,
        waitlisted: 0,
        programme_status: "active_paid",
        items: [
          {
            id: other,
            affiliation_id: id,
            post_id: other,
            business_name: null,
            sponsor_type: "organisation",
            status: "ended",
            starts_at: date,
            ends_at: date,
            created_at: date,
            ended_at: date,
            end_reason: null,
          },
        ],
      })
    );
  const result = await readFoundationOrganisationManagementData(api, id, []);
  expect(result.members).toEqual([
    expect.objectContaining({ business_status: "not_live", sponsorship_id: null }),
  ]);
});

it("requires a current showroom revision and preserves stored fields when toggling visibility", async () => {
  const { rpc, api } = fixture({ id: other, revision: 3 });
  const stored = {
    id: other,
    programme_id: null,
    title: "Market Showroom",
    placement: "market",
    enabled: true,
    starts_at: date,
    ends_at: "2027-11-05T10:00:00Z",
    max_cards: 12,
    province: null,
    city: null,
    display_order: 100,
    sponsored_only: true,
    revision: 2,
    updated_at: date,
  };
  const toggle = {
    ...command,
    operation: "upsert_showcase",
    values: { showcaseId: other, enabled: false, revision: 2 },
  };
  rpc.mockResolvedValueOnce(ok([{ ...stored, revision: 3 }]));
  await expect(manageFrontendStaffOrganisation(api, toggle)).rejects.toMatchObject({ status: 409 });
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockResolvedValueOnce(ok([stored]));
  await expect(manageFrontendStaffOrganisation(api, toggle)).resolves.toEqual({
    id: other,
    revision: 3,
  });
  expect(rpc).toHaveBeenLastCalledWith(
    "save_programme_showcase",
    expect.objectContaining({
      p_showcase: other,
      p_expected_revision: 2,
      p_title: stored.title,
      p_enabled: false,
      p_starts_at: stored.starts_at,
      p_ends_at: stored.ends_at,
      p_sponsored_only: true,
    })
  );
});

it("rejects ambiguous showroom locations and translates the represented province and city", async () => {
  const { rpc, api } = fixture({ id: other, revision: 1 });
  const create = {
    ...command,
    operation: "upsert_showcase",
    values: {
      title: "Market Showroom",
      placement: "market",
      enabled: true,
      endsAt: "2090-11-05T10:00:00Z",
      sponsoredOnly: false,
      province: "Gauteng",
    },
  };
  await expect(
    manageFrontendStaffOrganisation(api, {
      ...create,
      values: { ...create.values, city: "Cape Town" },
    })
  ).rejects.toMatchObject({ status: 422 });
  expect(rpc).not.toHaveBeenCalled();
  await manageFrontendStaffOrganisation(api, {
    ...create,
    values: { ...create.values, city: "Johannesburg" },
  });
  expect(rpc).toHaveBeenCalledWith(
    "save_programme_showcase",
    expect.objectContaining({
      p_province: "gp",
      p_city: "gp_johannesburg",
      p_max_cards: 12,
    })
  );
});
