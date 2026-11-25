/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { addLostDays, lostDaysAddInput, lostDaysPreviewInput, previewLostDays } from "./lost-days";
import { FoundationStaffCommandError } from "./staff-command";

const SLOT = "6f1d3c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f";
const PACKAGE = "7a2e4d2f-9b3c-4d4e-8f5a-6b7c8d9e0f1a";
const REQUEST = "8b3f5e3a-ac4d-4e5f-9a6b-7c8d9e0f1a2b";
const ENDS = "2026-12-22T08:00:00.123+00:00";
const LATER = "2026-12-29T08:00:00.123+00:00";
const apiWith = (answer: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(answer);
  return { api: { rpc } as unknown as Parameters<typeof previewLostDays>[0], rpc };
};
const refusal = async (promise: Promise<unknown>) => {
  const thrown = await promise.catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(FoundationStaffCommandError);
  return thrown as FoundationStaffCommandError;
};
const input = {
  email: " thandi@example.co.za ",
  days: 7,
  reason: " Site down ",
  requestId: REQUEST,
};

describe("previewLostDays", () => {
  it("reads api.get_lost_days_preview into the panel's terms", async () => {
    const { api, rpc } = apiWith({
      data: {
        items: [
          { kind: "individual", id: SLOT, slots: 1, renewals: 1, ends_at: ENDS },
          { kind: "package", id: PACKAGE, slots: 12, renewals: 0, ends_at: LATER },
        ],
      },
      error: null,
    });
    await expect(previewLostDays(api, " thandi@example.co.za ")).resolves.toEqual({
      items: [
        { kind: "individual", id: SLOT, slots: 1, renewals: 1, endsAt: ENDS },
        { kind: "package", id: PACKAGE, slots: 12, renewals: 0, endsAt: LATER },
      ],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_lost_days_preview",
      { p_email: "thandi@example.co.za" },
      { get: false }
    );
  });

  it("refuses an answer it does not expect", async () => {
    for (const data of [
      { items: [{ kind: "free_credit", id: SLOT, slots: 1, renewals: 0, ends_at: ENDS }] },
      {
        items: [{ kind: "individual", id: SLOT, slots: 1, renewals: 0, ends_at: ENDS, email: "x" }],
      },
      { items: [{ kind: "individual", id: SLOT, slots: 0, renewals: 0, ends_at: ENDS }] },
      null,
    ])
      await expect(previewLostDays(apiWith({ data, error: null }).api, "a@b.co")).rejects.toThrow(
        "could not be confirmed"
      );
  });

  it("words the database's refusals", async () => {
    const cases: Array<[unknown, number, RegExp]> = [
      [{ code: "PT409", details: "lost_days_member_not_found" }, 404, /No active member/],
      [{ code: "42501", details: "staff_review_required" }, 403, /ID review of your own/],
      [{ code: "42501", details: "staff_same_identity" }, 403, /Another staff member/],
      [{ code: "42501", message: "capability not granted" }, 403, /Only admins/],
      [{ code: "42501", message: "account suspended" }, 403, /staff access changed/],
    ];
    for (const [error, status, words] of cases) {
      const thrown = await refusal(previewLostDays(apiWith({ data: null, error }).api, "a@b.co"));
      expect(thrown.status).toBe(status);
      expect(thrown.message).toMatch(words);
      expect(thrown.mfaRequired).toBe(false);
    }
  });

  it("asks staff to verify again on an expired authenticator code", async () => {
    const thrown = await refusal(
      previewLostDays(
        apiWith({
          data: null,
          error: { code: "42501", message: "staff second-factor verification expired" },
        }).api,
        "a@b.co"
      )
    );
    expect(thrown.mfaRequired).toBe(true);
  });

  it("leaves an unknown database error to the route's generic answer", async () => {
    const thrown = await previewLostDays(
      apiWith({ data: null, error: { code: "XX000", message: "boom" } }).api,
      "a@b.co"
    ).catch((error: unknown) => error);
    expect(thrown).not.toBeInstanceOf(FoundationStaffCommandError);
    expect((thrown as Error).message).toBe("Lost days command failed");
  });
});

describe("addLostDays", () => {
  const answer = {
    request_id: REQUEST,
    days: 7,
    repeated: false,
    items: [
      { kind: "individual", id: SLOT, slots: 1, renewals: 0, ends_before: ENDS, ends_after: LATER },
    ],
  };

  it("sends the trimmed input with the request id and reads what moved", async () => {
    const { api, rpc } = apiWith({ data: answer, error: null });
    await expect(addLostDays(api, input)).resolves.toEqual({
      days: 7,
      repeated: false,
      items: [
        { kind: "individual", id: SLOT, slots: 1, renewals: 0, endsBefore: ENDS, endsAfter: LATER },
      ],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "add_lost_days",
      {
        p_email: "thandi@example.co.za",
        p_days: 7,
        p_reason: "Site down",
        p_request_id: REQUEST,
      },
      { get: false }
    );
  });

  it("refuses an answer for another request, other days or nothing moved", async () => {
    for (const data of [
      { ...answer, request_id: SLOT },
      { ...answer, days: 8 },
      { ...answer, items: [] },
      { ...answer, staff: "someone" },
    ])
      await expect(addLostDays(apiWith({ data, error: null }).api, input)).rejects.toThrow(
        "could not be confirmed"
      );
  });

  it("words the database's refusals", async () => {
    const cases: Array<[string, string, number, RegExp]> = [
      ["PT409", "lost_days_nothing_running", 409, /refund instead/],
      ["PT409", "lost_days_busy", 409, /changed just now/],
      ["PT409", "lost_days_request_reused", 409, /already sent/],
      ["22023", "lost_days_days_invalid", 422, /1 to 30 days/],
      ["22023", "lost_days_reason_required", 422, /5 to 500 characters/],
      ["22023", "lost_days_request_invalid", 422, /Reload/],
    ];
    for (const [code, details, status, words] of cases) {
      const thrown = await refusal(
        addLostDays(apiWith({ data: null, error: { code, details } }).api, input)
      );
      expect(thrown.status).toBe(status);
      expect(thrown.message).toMatch(words);
    }
  });
});

describe("the commercial route's bodies", () => {
  it("accept a bounded email, 1 to 30 days, a reason and a request id", () => {
    expect(
      lostDaysPreviewInput.safeParse({ action: "slots.lost_days_preview", accountEmail: "a@b.co" })
        .success
    ).toBe(true);
    const body = {
      action: "slots.add_lost_days",
      accountEmail: "a@b.co",
      days: 30,
      reason: "Site down",
      requestId: REQUEST,
    };
    expect(lostDaysAddInput.safeParse(body).success).toBe(true);
    for (const bad of [
      { days: 0 },
      { days: 31 },
      { days: 1.5 },
      { reason: "abcd" },
      { reason: "a".repeat(501) },
      { requestId: "not-a-uuid" },
      { accountEmail: "a\u0000@b.co" },
      { accountEmail: "a".repeat(255) },
    ])
      expect(lostDaysAddInput.safeParse({ ...body, ...bad }).success).toBe(false);
  });
});
