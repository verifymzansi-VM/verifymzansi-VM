import { describe, it, expect } from "vitest";
import { buildCoreDraftCommand, readCoreDraft, postAreaLabels } from "./identity";

describe("canonical post identity candidate", () => {
  it.each([
    ["listing", "business"],
    ["event", "market"],
    ["event", "business"],
    ["business", "market"],
  ])("rejects wrong kind/area %s/%s", (kind, area) => {
    expect(() =>
      buildCoreDraftCommand({ context: { kind, area, category_key: "sample" }, detail: {} })
    ).toThrow();
  });
  it.each(["business", "tourism_events"])(
    "keeps businesses distinct from product area %s",
    (area) => {
      expect(
        buildCoreDraftCommand({
          context: { kind: "business", area, category_key: "sample" },
          detail: {},
        }).p_kind
      ).toBe("business");
    }
  );
  it("requires event fields regardless of form version and rejects recurrence/authority injection", () => {
    const context = { kind: "event", area: "tourism_events", category_key: "sample" };
    expect(() => buildCoreDraftCommand({ context, detail: { form_version: 1 } })).toThrow();
    expect(() => buildCoreDraftCommand({ context, detail: {}, owner_id: "foreign" })).toThrow();
    expect(() =>
      buildCoreDraftCommand({ context: { ...context, status: "live" }, detail: {} })
    ).toThrow();
  });
  it("validates ordered bounded event windows with explicit offsets and timezones", () => {
    const context = { kind: "event", area: "tourism_events", category_key: "sample" };
    const detail = {
      starts_at: "2026-11-01T18:00:00+02:00",
      ends_at: "2026-11-01T20:00:00+02:00",
      timezone: "Africa/Johannesburg",
    };
    expect(buildCoreDraftCommand({ context, detail }).p_detail).toEqual({
      starts_at: "2026-11-01T16:00:00.000Z",
      ends_at: "2026-11-01T18:00:00.000Z",
      timezone: "Africa/Johannesburg",
    });
    expect(
      buildCoreDraftCommand({ context, detail: { ...detail, timezone: "africa/johannesburg" } })
        .p_detail
    ).toMatchObject({ timezone: "Africa/Johannesburg" });
    for (const bad of [
      { ...detail, ends_at: detail.starts_at },
      { ...detail, timezone: "Moon/Base" },
      { ...detail, starts_at: "2026-11-01T18:00:00" },
      { ...detail, ends_at: "2027-11-01T20:00:00Z" },
      { ...detail, starts_at: "2026-11-01T18:00:00.000001+02:00" },
    ]) {
      expect(() => buildCoreDraftCommand({ context, detail: bad })).toThrow();
    }
  });
  it("rejects published or overbroad owner draft projections", () => {
    const dto = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "business",
      area: "tourism_events",
      category_key: "sample",
      status: "draft",
      revision: 1,
    };
    expect(readCoreDraft(dto).kind).toBe("business");
    expect(() => readCoreDraft({ ...dto, status: "live" })).toThrow();
    expect(() => readCoreDraft({ ...dto, owner_id: "private" })).toThrow();
    expect(postAreaLabels.tourism_events).toBe("Tourism & Events");
  });
});

describe("creation activity contract", () => {
  it("omits the optional RPC argument for legacy and explicit empty selections", () => {
    for (const activity of [undefined, null]) {
      const command = buildCoreDraftCommand({
        context: {
          kind: "listing",
          area: "market",
          category_key: "electronics",
          activity_key: activity,
        },
        detail: {},
      });
      expect(Object.hasOwn(command, "p_activity_key")).toBe(false);
      expect(command).toEqual({
        p_kind: "listing",
        p_area: "market",
        p_category_key: "electronics",
        p_detail: {},
      });
    }
  });
  it("forwards an activity separately without weakening required event fields", () => {
    const command = buildCoreDraftCommand({
      context: {
        kind: "event",
        area: "tourism_events",
        category_key: "events",
        activity_key: "community_event",
      },
      detail: {
        starts_at: "2026-11-01T10:00:00Z",
        ends_at: "2026-11-01T12:00:00Z",
        timezone: "Africa/Johannesburg",
      },
    });
    expect(command.p_activity_key).toBe("community_event");
    expect(command.p_detail).not.toHaveProperty("activity_key");
    expect(() =>
      buildCoreDraftCommand({
        context: {
          kind: "event",
          area: "tourism_events",
          category_key: "events",
          activity_key: "community_event",
        },
        detail: {},
      })
    ).toThrow();
  });
  it("rejects malformed activities and authority injection", () => {
    for (const activity of ["", "WrongCase", 123, {}, "x".repeat(81)])
      expect(() =>
        buildCoreDraftCommand({
          context: {
            kind: "business",
            area: "business",
            category_key: "automotive_services",
            activity_key: activity,
          },
          detail: {},
        })
      ).toThrow();
    expect(() =>
      buildCoreDraftCommand({
        context: {
          kind: "business",
          area: "business",
          category_key: "automotive_services",
          activity_key: "mechanic",
          owner_id: "injected",
        },
        detail: {},
      })
    ).toThrow();
  });
  it("restores activity-bearing drafts without loosening kind/area or private fields", () => {
    const dto = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "business",
      area: "tourism_events",
      category_key: "tourism_hospitality",
      activity_key: "guided_tour",
      status: "draft",
      revision: 1,
    };
    expect(readCoreDraft(dto)).toEqual(dto);
    expect(() => readCoreDraft({ ...dto, activity_key: null })).toThrow();
    expect(() => readCoreDraft({ ...dto, area: "market" })).toThrow();
    expect(() => readCoreDraft({ ...dto, owner_id: "private" })).toThrow();
  });
});
