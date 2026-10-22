import { describe, expect, it, vi } from "vitest";
import {
  decideFoundationCommission,
  readFoundationPartnerDashboard,
  recordFoundationAcquisition,
  saveFoundationPartner,
} from "./partners";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const api = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as FoundationAuthenticatedApi & {
    rpc: ReturnType<typeof vi.fn>;
  };

describe("foundation partner adapter", () => {
  it("sends only provided attribution fields and allowlisted UTM keys", async () => {
    const client = api({ data: { source: "partner", recorded: true }, error: null });
    await recordFoundationAcquisition(client, {
      partner_code: "abcd12",
      utm: { utm_source: "flyer" },
    });
    expect(client.rpc).toHaveBeenCalledWith("record_my_acquisition", {
      p_utm: { utm_source: "flyer" },
      p_partner_code: "abcd12",
    });
    for (const bad of [
      { utm: { tracking_id: "x" } },
      { landing_path: "https://elsewhere.example/" },
      { referrer_host: "Bad Host" },
      { source: "partner" },
    ])
      await expect(recordFoundationAcquisition(client, bad)).rejects.toMatchObject({
        reason: "invalid",
      });
  });

  it("parses the dashboard strictly and accepts a non-partner", async () => {
    expect(await readFoundationPartnerDashboard(api({ data: null, error: null }))).toBeNull();
    await expect(
      readFoundationPartnerDashboard(
        api({
          data: {
            code: "ABCD12",
            status: "active",
            rate_bps: 2000,
            referrals: 1,
            paying_referrals: 1,
            totals: {},
            recent: [],
            referred_account_id: id,
          },
          error: null,
        })
      )
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("requires a payout reference only to mark a commission paid", async () => {
    const client = api({ data: { id, status: "paid" }, error: null });
    await decideFoundationCommission(client, {
      commission_id: id,
      action: "mark_paid",
      reference: "EFT 0001",
      reason: "Synthetic payout",
    });
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_reference: "EFT 0001" });
    await expect(
      decideFoundationCommission(client, {
        commission_id: id,
        action: "mark_paid",
        reason: "Synthetic payout",
      })
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("maps a self-management refusal to forbidden", async () => {
    await expect(
      saveFoundationPartner(
        api({ data: null, error: { code: "42501", details: "self_partner" } }),
        {
          account_id: id,
          action: "suspend",
          reason: "Synthetic suspension",
        }
      )
    ).rejects.toMatchObject({ reason: "forbidden" });
  });
});
