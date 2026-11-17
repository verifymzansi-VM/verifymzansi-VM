import { beforeEach, describe, expect, it, vi } from "vitest";

const { readRestoredGovernancePage } = vi.hoisted(() => ({
  readRestoredGovernancePage: vi.fn(),
}));

vi.mock("@/lib/foundation/governance-server", () => ({ readRestoredGovernancePage }));

import { decisionRefusalResponse, getPendingDecisions } from "@/lib/services/decision-ledger";

const DECISION = "22222222-2222-4222-8222-222222222222";

describe("decision ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps refusal codes to statuses and plain messages", async () => {
    const res = decisionRefusalResponse("not_independent");
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "not_independent" });
    expect(decisionRefusalResponse("expired").status).toBe(410);
    expect(decisionRefusalResponse("something_new").status).toBe(400);
  });

  it("lists pending decisions from the foundation governance page", async () => {
    readRestoredGovernancePage.mockResolvedValue([{ id: DECISION }]);

    await expect(getPendingDecisions(25)).resolves.toEqual([{ id: DECISION }]);
    expect(readRestoredGovernancePage).toHaveBeenCalledExactlyOnceWith(25);
  });
});
