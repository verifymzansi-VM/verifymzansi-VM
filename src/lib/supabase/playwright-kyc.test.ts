// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createPlaywrightSession,
  ensurePlaywrightVerifiedMember,
  listPlaywrightTableRows,
  writePlaywrightTableRows,
} from "./playwright-fixture-store";
import { createPlaywrightStubSupabaseClient } from "./playwright-stub";

describe("synthetic KYC reviewer authority", () => {
  it("counts velocity by account and step over the existing 24-hour window", async () => {
    const userId = crypto.randomUUID();
    const now = Date.now();
    const rows = [0, 1, 2].map((index) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      step_type: "id_doc",
      created_at: new Date(now - index * 3600000).toISOString(),
    }));
    rows.push({
      id: crypto.randomUUID(),
      user_id: userId,
      step_type: "selfie",
      created_at: new Date(now).toISOString(),
    });
    writePlaywrightTableRows("kyc_artifacts", [
      ...listPlaywrightTableRows("kyc_artifacts"),
      ...rows,
    ]);
    const client = createPlaywrightStubSupabaseClient();
    expect(
      (await client.rpc("check_kyc_velocity", { p_user_id: userId, p_step_type: "id_doc" })).data
    ).toBe(false);
    expect(
      (await client.rpc("check_kyc_velocity", { p_user_id: userId, p_step_type: "selfie" })).data
    ).toBe(true);
    expect(
      (
        await client.rpc("check_kyc_velocity", {
          p_user_id: userId,
          p_step_type: "id_doc",
          p_max_per_24h: 4,
        })
      ).data
    ).toBe(true);
  });
  it("requires active database staff authority rather than a metadata role hint", async () => {
    const persona = `kyc-member-${crypto.randomUUID()}`;
    const user = ensurePlaywrightVerifiedMember(persona);
    user.app_metadata.role = "moderator";
    const client = createPlaywrightStubSupabaseClient();
    expect((await client.rpc("staff_access_of", { p_user: user.id })).data).toEqual([]);
    expect(user.id).toMatch(/^[a-f0-9-]{36}$/);
  });
  it("models independent active claims and refuses self, missing and other-held claims", async () => {
    const { user } = createPlaywrightSession(`kyc-reviewer-${crypto.randomUUID()}`);
    const client = createPlaywrightStubSupabaseClient();
    const stepId = crypto.randomUUID();
    writePlaywrightTableRows("verification_steps", [
      ...listPlaywrightTableRows("verification_steps"),
      { id: stepId, user_id: crypto.randomUUID(), status: "pending" },
    ]);
    const params = { p_actor: user.id, p_item_type: "verification_step", p_item_id: stepId };
    expect((await client.rpc("check_queue_claim", params)).data).toEqual({
      ok: false,
      error: "claim_required",
    });
    const claims = listPlaywrightTableRows("queue_claims");
    const claim = {
      id: crypto.randomUUID(),
      item_type: "verification_step",
      item_id: stepId,
      claimed_by: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    writePlaywrightTableRows("queue_claims", [...claims, claim]);
    expect((await client.rpc("check_queue_claim", params)).data).toEqual({
      ok: false,
      error: "claimed_by_other",
    });
    claim.claimed_by = user.id;
    writePlaywrightTableRows("queue_claims", [...claims, claim]);
    expect((await client.rpc("check_queue_claim", params)).data).toEqual({ ok: true });
    writePlaywrightTableRows(
      "verification_steps",
      listPlaywrightTableRows("verification_steps").map((row) =>
        row.id === stepId ? { ...row, user_id: user.id } : row
      )
    );
    expect((await client.rpc("check_queue_claim", params)).data).toEqual({
      ok: false,
      error: "not_independent",
    });
    writePlaywrightTableRows(
      "staff_roles",
      listPlaywrightTableRows("staff_roles").map((row) =>
        row.user_id === user.id ? { ...row, status: "revoked" } : row
      )
    );
    expect((await client.rpc("staff_access_of", { p_user: user.id })).data).toEqual([]);
  });
});
