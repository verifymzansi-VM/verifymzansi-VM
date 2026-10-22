import { describe, expect, it, vi } from "vitest";
import {
  changeFoundationSponsorship,
  readFoundationProgrammeShowcases,
  saveFoundationProgrammeShowcase,
} from "./organisation-sponsorships";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const api = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as FoundationAuthenticatedApi & {
    rpc: ReturnType<typeof vi.fn>;
  };
const showcase = {
  organisation_id: id,
  showcase_id: null,
  expected_revision: null,
  title: "Supplier spotlight",
  placement: "business",
  enabled: true,
  starts_at: "2026-10-22T10:00:00Z",
  ends_at: "2026-11-22T10:00:00Z",
  max_cards: 6,
  display_order: 1,
  sponsored_only: false,
  reason: "Synthetic showcase",
};

describe("foundation sponsorship adapter", () => {
  it("sends only the affiliation and reason; the type is decided in SQL", async () => {
    const client = api({
      data: { id, status: "waitlisted", sponsor_type: "founding", ends_at: null },
      error: null,
    });
    await changeFoundationSponsorship(client, {
      action: "sponsor",
      affiliation_id: id.toUpperCase(),
      reason: "Supported place (synthetic)",
    });
    expect(client.rpc).toHaveBeenCalledWith("sponsor_business", {
      p_affiliation: id,
      p_reason: "Supported place (synthetic)",
    });
    await expect(
      changeFoundationSponsorship(client, {
        action: "sponsor",
        affiliation_id: id,
        reason: "Place",
        sponsor_type: "founding",
      })
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("maps refusals to stable reasons", async () => {
    for (const [details, reason] of [
      ["programme_inactive", "conflict"],
      ["sponsorship_busy", "conflict"],
      ["self_sponsorship", "forbidden"],
      ["sponsorship_unavailable", "not_found"],
    ])
      await expect(
        changeFoundationSponsorship(api({ data: null, error: { code: "PT409", details } }), {
          action: "end",
          sponsorship_id: id,
          reason: "Place ended (synthetic)",
        })
      ).rejects.toMatchObject({ reason });
  });

  it("creates a showcase without a revision and replaces one with it", async () => {
    const client = api({ data: { id, revision: 1 }, error: null });
    await saveFoundationProgrammeShowcase(client, showcase);
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty("p_showcase");
    await saveFoundationProgrammeShowcase(client, {
      ...showcase,
      showcase_id: id,
      expected_revision: 1,
    });
    expect(client.rpc.mock.calls[1][1]).toMatchObject({ p_showcase: id, p_expected_revision: 1 });
    for (const bad of [
      { ...showcase, showcase_id: id },
      { ...showcase, ends_at: showcase.starts_at },
      { ...showcase, placement: "everywhere" },
      { ...showcase, max_cards: 2 },
    ])
      await expect(saveFoundationProgrammeShowcase(client, bad)).rejects.toMatchObject({
        reason: "invalid",
      });
  });

  it("rejects showcase replies with fewer than three cards", async () => {
    const client = api({
      data: [
        {
          id,
          title: "Spotlight",
          organisation_slug: "synthetic-network",
          organisation_name: "Synthetic",
          cards: [],
        },
      ],
      error: null,
    });
    await expect(
      readFoundationProgrammeShowcases(client, { placement: "home" })
    ).rejects.toMatchObject({ reason: "unavailable" });
  });
});
