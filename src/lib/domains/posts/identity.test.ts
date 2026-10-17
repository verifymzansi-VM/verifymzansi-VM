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
        .p_detail.timezone
    ).toBe("Africa/Johannesburg");
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
