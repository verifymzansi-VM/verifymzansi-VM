import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUserById, updateUserById, userSummary, sendNotice, logAuditEvent } = vi.hoisted(
  () => ({
    rpc: vi.fn(),
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
    userSummary: vi.fn(),
    sendNotice: vi.fn(),
    logAuditEvent: vi.fn(),
  })
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, auth: { admin: { getUserById, updateUserById } } }),
}));
vi.mock("@/lib/supabase/auth-admin-user", () => ({ getAuthAdminUserSummary: userSummary }));
vi.mock("@/lib/services/email", () => ({ sendModerationNoticeEmail: sendNotice }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent }));

import { runOperationJobs } from "./operation-jobs";

const notice = {
  id: "job-1",
  kind: "email_notice",
  attempts: 1,
  decision_id: "decision-1",
  payload: {
    template: "account_ban",
    user_id: "user-1",
    decision_id: "decision-1",
    reason: "Fraud",
  },
};

function jobs(list: unknown[], outcome = "succeeded") {
  rpc.mockImplementation(async (fn: string) =>
    fn === "claim_operation_jobs" ? { data: list, error: null } : { data: outcome, error: null }
  );
}

describe("runOperationJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSummary.mockResolvedValue({ email: "member@example.com", accountName: "Thando" });
    sendNotice.mockResolvedValue({ success: true });
  });

  it("sends a notice with the reason and reports success", async () => {
    jobs([notice]);
    await expect(runOperationJobs(5)).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      retrying: 0,
      dead: 0,
    });
    expect(rpc).toHaveBeenCalledWith("claim_operation_jobs", { p_limit: 5 });
    expect(sendNotice).toHaveBeenCalledWith({
      email: "member@example.com",
      accountName: "Thando",
      template: "account_ban",
      reason: "Fraud",
      endsAt: null,
      decisionId: "decision-1",
    });
    expect(rpc).toHaveBeenCalledWith("complete_operation_job", {
      p_job: "job-1",
      p_ok: true,
      p_error: null,
    });
  });

  it("reports a provider failure so the database schedules a retry", async () => {
    jobs([notice], "retrying");
    sendNotice.mockResolvedValue({ success: false, error: "rate limited" });
    await expect(runOperationJobs()).resolves.toMatchObject({ retrying: 1 });
    expect(rpc).toHaveBeenCalledWith("complete_operation_job", {
      p_job: "job-1",
      p_ok: false,
      p_error: "rate limited",
    });
  });

  it("counts jobs the database marks dead", async () => {
    jobs([notice], "dead");
    sendNotice.mockResolvedValue({ success: false, error: "bounced" });
    await expect(runOperationJobs()).resolves.toMatchObject({ dead: 1 });
  });

  it("treats accounts without an email as done", async () => {
    jobs([notice]);
    userSummary.mockResolvedValue({ email: null, accountName: "there" });
    await runOperationJobs();
    expect(sendNotice).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_operation_job",
      expect.objectContaining({ p_ok: true })
    );
  });

  it("rejects unknown templates instead of sending something wrong", async () => {
    jobs([{ ...notice, payload: { ...notice.payload, template: "free_money" } }], "retrying");
    await runOperationJobs();
    expect(sendNotice).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_operation_job",
      expect.objectContaining({ p_ok: false })
    );
  });

  it("syncs auth metadata while keeping other keys", async () => {
    jobs([
      {
        id: "job-2",
        kind: "auth_metadata_sync",
        attempts: 1,
        decision_id: null,
        payload: { user_id: "u", role: "member" },
      },
    ]);
    getUserById.mockResolvedValue({
      data: { user: { app_metadata: { provider: "email", role: "moderator" } } },
      error: null,
    });
    updateUserById.mockResolvedValue({ error: null });
    await runOperationJobs();
    expect(updateUserById).toHaveBeenCalledWith("u", {
      app_metadata: { provider: "email", role: "member" },
    });
  });

  it("throws when jobs cannot be claimed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(runOperationJobs()).rejects.toThrow("Could not claim jobs");
  });
});
