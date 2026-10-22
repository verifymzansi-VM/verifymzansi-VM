import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  FoundationOrganisationError,
  acceptFoundationOrganisationInvite,
  applyToFoundationOrganisation,
  createFoundationInviteToken,
  createFoundationOrganisation,
  decideFoundationApplication,
  hashFoundationInviteToken,
  inviteFoundationOrganisationAdmin,
  readFoundationOrganisationApplications,
  readFoundationPostAffiliations,
  updateFoundationOrganisation,
} from "./organisations";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const post = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const api = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as FoundationAuthenticatedApi & {
    rpc: ReturnType<typeof vi.fn>;
  };

describe("foundation organisations adapter", () => {
  it("creates 43-character tokens and sends only their SHA-256 hash", async () => {
    const token = createFoundationInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await hashFoundationInviteToken(token)).toBe(
      createHash("sha256").update(token).digest("hex")
    );
    const client = api({
      data: { organisation_slug: "synthetic-chamber", role: "owner" },
      error: null,
    });
    await acceptFoundationOrganisationInvite(client, { token });
    expect(client.rpc).toHaveBeenCalledWith("accept_organisation_invite", {
      p_token_hash: createHash("sha256").update(token).digest("hex"),
    });
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain(token);
    await expect(
      acceptFoundationOrganisationInvite(client, { token: "short" })
    ).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("returns the staff invitation token to the caller but never sends it to SQL", async () => {
    const client = api({
      data: { invite_id: id, expires_at: "2026-10-29T10:00:00Z", organisation_name: "Synthetic" },
      error: null,
    });
    const result = await inviteFoundationOrganisationAdmin(client, {
      organisation_id: id,
      email: " Admin@Example.org ",
      reason: "Synthetic invitation",
    });
    const [, args] = client.rpc.mock.calls[0];
    expect(args.p_email).toBe("admin@example.org");
    expect(args.p_token_hash).toBe(await hashFoundationInviteToken(result.token));
    expect(JSON.stringify(args)).not.toContain(result.token);
  });

  it("requires explicit consent and refuses identity-bearing fields", async () => {
    const client = api({ data: { id, status: "submitted" }, error: null });
    const base = {
      organisation_id: id,
      post_id: post,
      share_representative_name: false,
      consent: true,
    };
    await applyToFoundationOrganisation(client, base);
    expect(client.rpc).toHaveBeenCalledWith("apply_to_organisation", {
      p_org: id,
      p_post_id: post,
      p_share_representative_name: false,
      p_consent: true,
    });
    for (const value of [
      { ...base, consent: false },
      { ...base, applicant_id: id },
      { ...base, reason: "x".repeat(1001) },
    ])
      await expect(applyToFoundationOrganisation(client, value)).rejects.toMatchObject({
        reason: "invalid",
      });
  });

  it("maps database refusals to stable reasons", async () => {
    for (const [code, details, reason] of [
      ["PT409", "application_state", "conflict"],
      ["42501", "verification_required", "verification_required"],
      ["42501", null, "forbidden"],
      ["PT404", "application_unavailable", "not_found"],
      ["XX000", "internal", "unavailable"],
    ])
      await expect(
        decideFoundationApplication(api({ data: null, error: { code, details } }), {
          application_id: id,
          decision: "approve",
        })
      ).rejects.toMatchObject({ reason });
  });

  it("parses minimal review DTOs strictly", async () => {
    const item = {
      id,
      status: "submitted",
      post_id: post,
      business_name: "Synthetic Workshop",
      category: "automotive_services",
      province: "gp",
      city: "gp_johannesburg",
      identity_verified: true,
      representative_name: null,
      programme_name: null,
      reason: null,
      member_reference: null,
      info_request: null,
      info_response: null,
      submitted_at: "2026-10-22T08:00:00Z",
      decision_at: null,
      decision_note: null,
    };
    await expect(
      readFoundationOrganisationApplications(api({ data: [item], error: null }), {
        organisation_id: id,
      })
    ).resolves.toEqual([item]);
    await expect(
      readFoundationOrganisationApplications(
        api({ data: [{ ...item, applicant_id: id }], error: null }),
        {
          organisation_id: id,
        }
      )
    ).rejects.toBeInstanceOf(FoundationOrganisationError);
  });

  it("deduplicates and bounds badge lookups", async () => {
    const client = api({ data: [], error: null });
    await readFoundationPostAffiliations(client as never, { post_ids: [post, post.toUpperCase()] });
    expect(client.rpc).toHaveBeenCalledWith("public_post_affiliations", { p_post_ids: [post] });
    await expect(
      readFoundationPostAffiliations(client as never, { post_ids: Array(101).fill(post) })
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("creates organisations with a normalized name and refuses invalid slugs", async () => {
    const client = api({ data: { id, slug: "synthetic-chamber", revision: 1 }, error: null });
    await createFoundationOrganisation(client, {
      slug: "synthetic-chamber",
      name: " Synthetic Chamber ",
      organisation_type: "chamber_of_commerce",
      reason: "Synthetic setup",
    });
    expect(client.rpc).toHaveBeenCalledWith("create_organisation", {
      p_slug: "synthetic-chamber",
      p_name: "Synthetic Chamber",
      p_type: "chamber_of_commerce",
      p_reason: "Synthetic setup",
    });
    await expect(
      createFoundationOrganisation(client, {
        slug: "Bad Slug",
        name: "Synthetic",
        organisation_type: "other",
        reason: "Synthetic setup",
      })
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("allows only reviewed organisation fields in staff updates", async () => {
    const client = api({ data: { id, slug: "synthetic-chamber", revision: 3 }, error: null });
    await updateFoundationOrganisation(client, {
      id,
      expected_revision: 2,
      patch: { is_public: true, website: "https://example.org" },
      reason: "Synthetic publish",
    });
    for (const p of [{ owner_id: id }, { website: "http://example.org" }, {}])
      await expect(
        updateFoundationOrganisation(client, {
          id,
          expected_revision: 2,
          patch: p,
          reason: "Synthetic",
        })
      ).rejects.toMatchObject({ reason: "invalid" });
  });
});
