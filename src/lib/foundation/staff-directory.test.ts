import { expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  readFoundationStaffCommissions,
  readFoundationStaffPartners,
  readFoundationStaffShowcases,
} from "./staff-directory";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const at = "2026-10-23T00:00:00Z";
const client = (data: unknown) =>
  ({
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  }) as unknown as FoundationAuthenticatedApi;

it("preserves exact money strings and excludes referred people from the staff commission DTO", async () => {
  const row = {
    id,
    partner_id: id,
    payment_id: id,
    base_cents: "999999999999999",
    rate_bps: 2000,
    amount_cents: "199999999999999",
    status: "paid",
    eligible_at: at,
    approved_at: at,
    paid_at: at,
    paid_reference: "BANK-001",
    reversed_at: null,
    reversal_reason: null,
    created_at: at,
  };
  expect(await readFoundationStaffCommissions(client([row]), {})).toEqual([row]);
  for (const bad of [
    { ...row, amount_cents: 199999999999999 },
    { ...row, referred_account_id: id },
  ])
    await expect(readFoundationStaffCommissions(client([bad]), {})).rejects.toMatchObject({
      reason: "unavailable",
    });
});

it("accepts the reviewed partner summary and fails closed on private additions", async () => {
  const row = {
    id,
    account_id: id,
    code: "TEST123",
    status: "active",
    commission_bps: null,
    revision: 1,
    referrals: 4,
    pending_cents: "0",
    approved_cents: "2500",
  };
  expect(await readFoundationStaffPartners(client([row]))).toEqual([row]);
  await expect(
    readFoundationStaffPartners(client([{ ...row, email: "synthetic@example.invalid" }]))
  ).rejects.toMatchObject({ reason: "unavailable" });
});

it("bounds the staff showcase collection and rejects invalid path identifiers before transport", async () => {
  const api = client([]);
  await expect(
    readFoundationStaffShowcases(api, { organisation_id: "invalid" })
  ).rejects.toMatchObject({ reason: "invalid" });
  expect(api.rpc).not.toHaveBeenCalled();
  const row = {
    id,
    programme_id: null,
    title: "Programme",
    placement: "home",
    enabled: true,
    starts_at: at,
    ends_at: "2026-10-24T00:00:00Z",
    max_cards: 3,
    province: null,
    city: null,
    display_order: 0,
    sponsored_only: false,
    revision: 1,
    updated_at: at,
  };
  await expect(
    readFoundationStaffShowcases(client(Array(21).fill(row)), { organisation_id: id })
  ).rejects.toMatchObject({ reason: "unavailable" });
});
