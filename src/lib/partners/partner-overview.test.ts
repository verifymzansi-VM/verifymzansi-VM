import { describe, expect, it } from "vitest";
import {
  PARTNER_RECENT_LIMIT,
  customerShortName,
  earnedThisMonth,
  nextPayoutCents,
  partnerReferralLink,
  whatsAppShareUrl,
  type PartnerDashboard,
} from "./partner-overview";

type Row = PartnerDashboard["recent"][number];
function row(createdAt: string, amountCents: number, status = "PENDING", id = createdAt): Row {
  return {
    id,
    amountCents,
    baseCents: amountCents * 5,
    status,
    createdAt,
    eligibleAt: createdAt,
    manual: false,
  };
}

// 21 November 2026, 10:00 in South Africa.
const NOW = new Date("2026-11-21T08:00:00.000Z");

describe("earnedThisMonth", () => {
  it("adds this month's pending, approved and paid commission and leaves out reversed", () => {
    const recent = [
      row("2026-11-20T10:00:00.000Z", 1000, "PENDING"),
      row("2026-11-10T10:00:00.000Z", 2000, "APPROVED"),
      row("2026-11-05T10:00:00.000Z", 3000, "PAID"),
      row("2026-11-03T10:00:00.000Z", 4000, "REVERSED"),
      row("2026-10-30T10:00:00.000Z", 5000, "APPROVED"),
    ];
    expect(earnedThisMonth(recent, NOW)).toEqual({ cents: 6000, complete: true });
  });

  it("counts months in South African time", () => {
    // 31 October 23:30 UTC is 1 November 01:30 in South Africa.
    const recent = [row("2026-10-31T23:30:00.000Z", 700), row("2026-10-31T21:30:00.000Z", 900)];
    expect(earnedThisMonth(recent, new Date("2026-11-01T06:00:00.000Z")).cents).toBe(700);
  });

  it("is zero with no commission", () => {
    expect(earnedThisMonth([], NOW)).toEqual({ cents: 0, complete: true });
  });

  it("says when the latest rows may not reach the start of the month", () => {
    const full = Array.from({ length: PARTNER_RECENT_LIMIT }, (_, i) =>
      row(`2026-11-20T10:00:${String(i).padStart(2, "0")}.000Z`, 100)
    );
    expect(earnedThisMonth(full, NOW)).toEqual({ cents: 5000, complete: false });
    const reachesOctober = [...full.slice(1), row("2026-10-30T10:00:00.000Z", 100)];
    expect(earnedThisMonth(reachesOctober, NOW).complete).toBe(true);
  });
});

describe("nextPayoutCents", () => {
  it("holds approved commission only", () => {
    expect(nextPayoutCents({ PENDING: 100, APPROVED: 250, PAID: 900, REVERSED: 50 })).toBe(250);
    expect(nextPayoutCents({ PENDING: 100 })).toBe(0);
  });
});

describe("sharing", () => {
  it("builds the referral link and a WhatsApp message holding it", () => {
    const link = partnerReferralLink("https://verifymzansi.com", "THANDO1");
    expect(link).toBe("https://verifymzansi.com/?ref=THANDO1");
    expect(whatsAppShareUrl(link)).toBe(
      "https://wa.me/?text=https%3A%2F%2Fverifymzansi.com%2F%3Fref%3DTHANDO1"
    );
  });
});

describe("customerShortName", () => {
  it("shows the first name and the surname's initial only", () => {
    expect(customerShortName("Thando", "Dlamini")).toBe("Thando D.");
    expect(customerShortName("  Thando Lwazi ", " van der Merwe")).toBe("Thando V.");
    expect(customerShortName("Ané", "ölz")).toBe("Ané Ö.");
  });

  it("never shows more than it has", () => {
    expect(customerShortName("Thando", "")).toBe("Thando");
    expect(customerShortName("", "Dlamini")).toBe("D.");
  });
});
