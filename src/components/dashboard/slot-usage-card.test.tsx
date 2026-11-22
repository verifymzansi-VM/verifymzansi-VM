import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SlotUsageCard, type SlotUsageEntry } from "./slot-usage-card";

const entry: SlotUsageEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  source: "FREE_CREDIT",
  area: null,
  planName: null,
  status: "active",
  slotCapacity: 2,
  activeUsage: 1,
  activationCount: 1,
  activationLimitTotal: null,
  activationLimitPerPeriod: 8,
  activationPeriodDays: 30,
  periodActivations: 1,
  startsAt: "2026-11-22T10:00:00Z",
  expiresAt: "2026-12-22T10:00:00Z",
  autoRenew: false,
  sponsored: false,
};

describe("SlotUsageCard", () => {
  it("names free credits once, says they are never charged, with their end date", () => {
    render(<SlotUsageCard entries={[entry]} />);
    expect(screen.getAllByText("Free credits from VerifyMzansi")).toHaveLength(1);
    expect(screen.getByText("Never charged · All sections")).toBeInTheDocument();
    expect(screen.getByText(/1/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("until 22 Dec 2026")).toBeInTheDocument();
    expect(screen.getByText("Does not renew automatically")).toBeInTheDocument();
  });

  it("keeps other sources as before", () => {
    render(<SlotUsageCard entries={[{ ...entry, source: "ADMIN_GRANT" }]} />);
    expect(screen.getAllByText(/VerifyMzansi grant/)).toHaveLength(2);
  });
});
