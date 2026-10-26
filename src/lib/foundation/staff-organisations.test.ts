import { expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readFoundationStaffOrganisation } from "./staff-organisations";
const id = "00000000-0000-4000-8000-000000000001";
const row = {
  id,
  slug: "example-org",
  name: "Example Organisation",
  organisation_type: "other",
  description: null,
  programme_description: null,
  service_area: null,
  province_id: null,
  website: null,
  public_email: null,
  public_phone: null,
  programme_status: "invited",
  programme_starts_at: null,
  programme_ends_at: null,
  affiliation_wording: "Programme participant",
  sponsorship_wording: "Supported by",
  sponsored_capacity: 50,
  admin_limit: 3,
  accepting_applications: true,
  is_public: false,
  show_on_strip: false,
  show_on_home: false,
  display_order: 100,
  revision: 1,
  logo_object_id: null,
  logo_object_key: null,
  logo_permission_at: null,
  logo_permission_reference: null,
  active_affiliations: 0,
  open_applications: 0,
  admins: [],
  open_invites: [],
  programmes: [],
  notes: [],
};
function client(value: unknown, error: { code: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: value, error });
  return { rpc, api: { rpc } as unknown as FoundationAuthenticatedApi };
}
it("projects only the editor's intended fields from a privileged row", async () => {
  const { api, rpc } = client({
    ...row,
    created_by: id,
    logo_permission_by: id,
    future_private_field: "withheld",
  });
  expect(await readFoundationStaffOrganisation(api, { id })).toEqual(row);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("staff_get_organisation", { p_id: id });
});
it("does not mistake another organisation for the requested record", async () => {
  await expect(
    readFoundationStaffOrganisation(
      client({ ...row, id: "00000000-0000-4000-8000-000000000002" }).api,
      { id }
    )
  ).rejects.toMatchObject({ reason: "unavailable" });
});
it("refuses an actor selector before calling the database", async () => {
  const { api, rpc } = client(row);
  await expect(readFoundationStaffOrganisation(api, { id, actor_id: id })).rejects.toMatchObject({
    reason: "invalid",
  });
  expect(rpc).not.toHaveBeenCalled();
});
it("keeps a missing organisation distinct from a failed read", async () => {
  expect(await readFoundationStaffOrganisation(client(null).api, { id })).toBeNull();
  await expect(
    readFoundationStaffOrganisation(client(null, { code: "42501" }).api, { id })
  ).rejects.toMatchObject({ reason: "forbidden" });
});
