import { describe, expect, it } from "vitest";
import { OWNER_DEACTIVATED_REASON, eventLifecycle, toDisplayContentStatus } from "./content-status";

describe("toDisplayContentStatus", () => {
  it("maps stored statuses to the spec lifecycle", () => {
    expect(toDisplayContentStatus("live")).toBe("ACTIVE");
    expect(toDisplayContentStatus("pending_moderation")).toBe("PENDING_REVIEW");
    expect(toDisplayContentStatus("sold")).toBe("SOLD");
    expect(toDisplayContentStatus("expired")).toBe("EXPIRED");
    expect(toDisplayContentStatus("hidden", OWNER_DEACTIVATED_REASON)).toBe("INACTIVE");
    expect(toDisplayContentStatus("hidden", "Moderation")).toBe("SUSPENDED");
    expect(toDisplayContentStatus("archived")).toBe("ARCHIVED");
  });
});

describe("eventLifecycle", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  it("derives upcoming, active, ended and archived", () => {
    expect(eventLifecycle({ status: "pending_moderation" }, now)).toBe("DRAFT");
    expect(eventLifecycle({ status: "live", start_date: "2026-10-01T10:00:00Z" }, now)).toBe(
      "PUBLISHED"
    );
    expect(
      eventLifecycle(
        { status: "live", start_date: "2026-09-25T10:00:00Z", end_date: "2026-09-27T10:00:00Z" },
        now
      )
    ).toBe("ACTIVE");
    expect(eventLifecycle({ status: "live", end_date: "2026-09-25T10:00:00Z" }, now)).toBe("ENDED");
    expect(eventLifecycle({ status: "expired" }, now)).toBe("ENDED");
    expect(eventLifecycle({ status: "archived" }, now)).toBe("ARCHIVED");
  });
});
