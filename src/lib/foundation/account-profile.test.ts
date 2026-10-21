import { describe, expect, it, vi } from "vitest";
import {
  FoundationProfileError,
  buildFoundationLegalNameClaim,
  buildFoundationProfileUpdate,
  isAllowedNewDisplayName,
  readFoundationAccountProfile,
  saveFoundationAccountProfile,
  setFoundationAvatar,
} from "./account-profile";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const profile = {
  display_name: "Thando Dlamini",
  public_name: "Thando D.",
  bio: null,
  avatar_object_id: null,
  legal_first_name: null,
  legal_last_name: null,
  legal_name_locked: false,
  identity_verified: false,
  revision: 2,
  updated_at: "2026-10-21T10:00:00.123+00:00",
};
const api = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as FoundationAuthenticatedApi & {
    rpc: ReturnType<typeof vi.fn>;
  };

describe("foundation account profile adapter", () => {
  it("builds normalized display name and bio commands", () => {
    expect(
      buildFoundationProfileUpdate({
        expected_revision: 2,
        display_name: "  E\u0301rika Nkosi ",
        bio: " Hello\r\nthere \n",
      })
    ).toEqual({ p_expected_revision: 2, p_display_name: "Érika Nkosi", p_bio: "Hello\nthere" });
    expect(
      buildFoundationProfileUpdate({ expected_revision: 2, display_name: null, bio: "" })
    ).toEqual({ p_expected_revision: 2 });
  });

  it("refuses invalid, oversized and extra input before any request", () => {
    for (const input of [
      { expected_revision: 2, display_name: "Tab\tName" },
      { expected_revision: 2, display_name: "Thando", bio: "x".repeat(301) },
      { expected_revision: 2, display_name: "Thando", bio: "a\u202eb" },
      { expected_revision: 0, display_name: "Thando" },
      { expected_revision: 2, display_name: "Thando", owner_id: "x" },
    ])
      expect(() => buildFoundationProfileUpdate(input)).toThrow(FoundationProfileError);
    expect(() =>
      buildFoundationLegalNameClaim({ expected_revision: 1, first_name: "A", last_name: "Dlamini" })
    ).toThrow(FoundationProfileError);
    expect(isAllowedNewDisplayName("Site Admin")).toBe(false);
    expect(isAllowedNewDisplayName(" Thando ")).toBe(true);
  });

  it("parses the strict owner DTO and rejects unexpected fields", async () => {
    await expect(
      readFoundationAccountProfile(api({ data: profile, error: null }))
    ).resolves.toEqual(profile);
    await expect(
      readFoundationAccountProfile(api({ data: { ...profile, role: "admin" }, error: null }))
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("maps database refusals to stable reasons", async () => {
    for (const [code, details, reason] of [
      ["PT409", "legal_name_locked", "locked"],
      ["PT409", "profile_changed", "changed"],
      ["22023", "display_name_reserved", "reserved"],
      ["22023", "avatar_unavailable", "avatar_unavailable"],
      ["42501", null, "unavailable"],
    ])
      await expect(
        saveFoundationAccountProfile(api({ data: null, error: { code, details } }), {
          expected_revision: 2,
          display_name: "Thando",
        })
      ).rejects.toMatchObject({ reason });
  });

  it("sends lower-case avatar identifiers once", async () => {
    const client = api({ data: profile, error: null });
    await setFoundationAvatar(client, {
      expected_revision: 2,
      object_id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
    });
    expect(client.rpc).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledWith("set_my_avatar", {
      p_expected_revision: 2,
      p_object_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
  });
});
