import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rpc,
  getUserById,
  updateUserById,
  userSummary,
  sendNotice,
  sendDsarExtension,
  logAuditEvent,
  tableRow,
  tableUpdate,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendDsarExtension: vi.fn(),
  tableRow: vi.fn(),
  tableUpdate: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  userSummary: vi.fn(),
  sendNotice: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    auth: { admin: { getUserById, updateUserById } },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => tableRow(table) }) }),
      update: (values: unknown) => ({
        eq: () => ({ select: () => ({ maybeSingle: () => tableUpdate(table, values) }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/auth-admin-user", () => ({ getAuthAdminUserSummary: userSummary }));
vi.mock("@/lib/services/email", () => ({
  sendModerationNoticeEmail: sendNotice,
  sendDsarExtensionEmail: sendDsarExtension,
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent }));

import { runOperationJobs } from "./operation-jobs";

const notice = {
  id: "job-1",
  kind: "email_notice",
  attempts: 1,
  locked_until: "2099-01-01T00:00:00Z",
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
    sendDsarExtension.mockResolvedValue({ success: true });
    tableRow.mockResolvedValue({ data: null, error: null });
    tableUpdate.mockResolvedValue({ data: { id: "case-1" }, error: null });
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
      idempotencyKey: "operation-job/job-1",
    });
    expect(rpc).toHaveBeenCalledWith("complete_operation_job", {
      p_job: "job-1",
      p_ok: true,
      p_error: null,
      p_attempt: 1,
      p_locked_until: "2099-01-01T00:00:00Z",
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
      p_attempt: 1,
      p_locked_until: "2099-01-01T00:00:00Z",
    });
  });

  it("counts jobs the database marks dead", async () => {
    jobs([notice], "dead");
    sendNotice.mockResolvedValue({ success: false, error: "bounced" });
    await expect(runOperationJobs()).resolves.toMatchObject({ dead: 1 });
  });

  it("does not execute effects whose batch lease expired", async () => {
    jobs([{ ...notice, locked_until: "2000-01-01T00:00:00Z" }]);
    await expect(runOperationJobs()).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      retrying: 0,
      dead: 0,
    });
    expect(sendNotice).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("complete_operation_job", expect.anything());
  });

  it("does not count a rejected stale completion as a retry", async () => {
    jobs([notice], "succeeded");
    rpc.mockImplementation(async (fn: string) =>
      fn === "claim_operation_jobs" ? { data: [notice], error: null } : { data: null, error: null }
    );
    await expect(runOperationJobs()).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      retrying: 0,
      dead: 0,
    });
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

  it("retries recipient lookup failures instead of silently losing the notice", async () => {
    jobs([notice], "retrying");
    userSummary.mockResolvedValue({
      email: null,
      accountName: "there",
      errorMessage: "Auth service unavailable",
    });
    await expect(runOperationJobs()).resolves.toMatchObject({ succeeded: 0, retrying: 1 });
    expect(sendNotice).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("complete_operation_job", {
      p_job: "job-1",
      p_ok: false,
      p_error: "Could not look up notice recipient: Auth service unavailable",
      p_attempt: 1,
      p_locked_until: "2099-01-01T00:00:00Z",
    });
  });

  it("reuses the email key when a sent notice's completion write is lost", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "claim_operation_jobs"
        ? { data: [notice], error: null }
        : { data: null, error: { message: "connection lost" } }
    );
    await runOperationJobs();
    jobs([{ ...notice, attempts: 2 }]);
    await runOperationJobs();
    expect(sendNotice).toHaveBeenCalledTimes(2);
    expect(sendNotice.mock.calls.map(([params]) => params.idempotencyKey)).toEqual([
      "operation-job/job-1",
      "operation-job/job-1",
    ]);
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
        locked_until: "2099-01-01T00:00:00Z",
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

  it("writes the role the person holds now, not the one queued earlier", async () => {
    jobs([
      {
        id: "job-3",
        kind: "auth_metadata_sync",
        attempts: 2,
        locked_until: "2099-01-01T00:00:00Z",
        decision_id: null,
        payload: { user_id: "u", role: "moderator" },
      },
    ]);
    // Demoted after this job was queued.
    tableRow.mockResolvedValue({ data: null, error: null });
    getUserById.mockResolvedValue({
      data: { user: { app_metadata: { role: "moderator" } } },
      error: null,
    });
    updateUserById.mockResolvedValue({ error: null });
    await runOperationJobs();
    expect(updateUserById).toHaveBeenCalledWith("u", { app_metadata: { role: "member" } });
  });

  it.each(["database error", "zero updated rows"])(
    "retries an unrecorded DSAR extension after %s with the same provider key",
    async (mode) => {
      const extension = {
        id: "job-4",
        kind: "email_notice",
        attempts: 2,
        locked_until: "2099-01-01T00:00:00Z",
        decision_id: null,
        payload: {
          template: "dsar_extension",
          case_id: "11111111-2222-4333-8444-555555555555",
          email: "subject@example.com",
          due: "2026-11-01T00:00:00Z",
          reason: "Records are held in two systems",
        },
      };
      jobs([extension]);
      tableRow.mockResolvedValue({
        data: { extension_notified_at: "2026-10-01T00:00:00Z" },
        error: null,
      });
      const already = await runOperationJobs();
      expect(sendDsarExtension).not.toHaveBeenCalled();
      expect(already.succeeded).toBe(1);

      // Sent, but recording it failed: retry delivery/recording with the same key.
      tableRow.mockResolvedValue({ data: { extension_notified_at: null }, error: null });
      tableUpdate.mockResolvedValue(
        mode === "database error"
          ? { data: null, error: { message: "timeout" } }
          : { data: null, error: null }
      );
      rpc.mockImplementation(async (fn: string, args?: { p_ok?: boolean }) =>
        fn === "claim_operation_jobs"
          ? { data: [extension], error: null }
          : { data: args?.p_ok ? "succeeded" : "retrying", error: null }
      );
      const sent = await runOperationJobs();
      expect(sendDsarExtension).toHaveBeenCalledTimes(1);
      expect(sent.succeeded).toBe(0);
      expect(sent.retrying).toBe(1);
      expect(rpc).toHaveBeenLastCalledWith(
        "complete_operation_job",
        expect.objectContaining({
          p_ok: false,
          p_error: expect.stringContaining("DSAR extension notice sent but not recorded"),
        })
      );
      tableUpdate.mockResolvedValue({ data: { id: extension.payload.case_id }, error: null });
      const recovered = await runOperationJobs();
      expect(recovered.succeeded).toBe(1);
      expect(sendDsarExtension.mock.calls.map((args) => args[4])).toEqual([
        "operation-job/job-4",
        "operation-job/job-4",
      ]);
    }
  );

  it("throws when jobs cannot be claimed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(runOperationJobs()).rejects.toThrow("Could not claim jobs");
  });
});
