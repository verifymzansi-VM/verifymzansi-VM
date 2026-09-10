import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContentEditRequest } from "./content-edit-requests";

const { notifyStaff } = vi.hoisted(() => ({ notifyStaff: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyStaffForAdminEvent: notifyStaff }));

describe("createContentEditRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyStaff.mockResolvedValue(true);
  });

  function submit(targetType: "listing" | "business" | "promotion", result: unknown) {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(result) }),
    });
    const promise = createContentEditRequest({
      supabase: { from: () => ({ insert }) },
      targetType,
      targetId: "post-id",
      ownerId: "owner-id",
      area: "MZANSI_MARKET",
      proposedData: { title: "Updated post" },
      currentSnapshot: { title: "Live post" },
    });
    return { promise, insert };
  }

  it.each(["listing", "business", "promotion"] as const)(
    "saves the %s edit and waits for the staff notification before succeeding",
    async (targetType) => {
      let finishNotification!: (value: boolean) => void;
      notifyStaff.mockReturnValue(
        new Promise<boolean>((resolve) => {
          finishNotification = resolve;
        })
      );
      const { promise, insert } = submit(targetType, { data: { id: "edit-id" }, error: null });
      const completed = vi.fn();
      void promise.then(completed);
      await vi.waitFor(() =>
        expect(notifyStaff).toHaveBeenCalledWith(
          expect.objectContaining({
            capability: "queue:view",
            href: "/admin/moderation",
            excludeUserId: "owner-id",
          })
        )
      );
      expect(completed).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          target_type: targetType,
          proposed_data: { title: "Updated post" },
          current_snapshot: { title: "Live post" },
        })
      );
      finishNotification(true);
      await expect(promise).resolves.toEqual({ response: null, requestId: "edit-id" });
    }
  );

  it("does not report success or notify staff if no edit was saved", async () => {
    await expect(submit("listing", { data: null, error: null }).promise).rejects.toThrow(
      "not saved"
    );
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("returns a conflict without notifying staff when an earlier edit is pending", async () => {
    const result = await submit("listing", {
      data: null,
      error: { code: "23505", message: "duplicate" },
    }).promise;
    expect(result.response?.status).toBe(409);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("preserves a saved edit when notification delivery fails", async () => {
    notifyStaff.mockResolvedValue(false);
    await expect(
      submit("listing", { data: { id: "edit-id" }, error: null }).promise
    ).resolves.toEqual({ response: null, requestId: "edit-id" });
  });
});
