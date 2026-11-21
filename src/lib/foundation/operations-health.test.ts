import { describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readStaffOperationsHealth, SCHEDULED_JOBS } from "./operations-health";
import { FoundationStaffCommandError } from "./staff-command";

// As the database writes it (to_jsonb of timestamptz).
const AT = "2026-11-20T16:35:00.123456+00:00";

function reply() {
  return {
    generated_at: AT,
    jobs: SCHEDULED_JOBS.map((job) => ({
      job,
      every: job === "refund_check" ? "day" : "minute",
      last_run_at: job === "sponsorships" ? null : AT,
      late: job === "sponsorships",
    })),
    emails: {
      waiting: 3,
      stuck: 1,
      items: [{ kind: "post_expired", attempts: 8, queued_at: AT, last_error: "delivery_failed" }],
    },
    notices: { stuck: 0, undeliverable: 1, items: [] },
    payments: {
      problems: 1,
      not_activated: 0,
      items: [
        {
          payment_ref: null,
          reason: "unknown_reference",
          source: "notice",
          first_seen_at: AT,
          last_seen_at: AT,
          occurrences: 1,
          alerted: false,
        },
      ],
    },
    deletions: {
      accounts_blocked: 1,
      files_stuck: 0,
      files_queued: 0,
      evidence_overdue: 0,
      legal_holds: 0,
      items: [{ reason: "legal_hold", blocked_at: AT, erase_after: AT, closed_by: "staff" }],
    },
    incidents: {
      open: 1,
      items: [{ metric: "sms_codes_day", level: "warning", period: "2026-11-20", raised_at: AT }],
    },
  };
}

function apiAnswering(answer: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}) {
  const rpc = vi.fn(async () => answer);
  return { api: { rpc } as unknown as FoundationAuthenticatedApi, rpc };
}

describe("readStaffOperationsHealth", () => {
  it("reads the one staff command, as a POST", async () => {
    const { api, rpc } = apiAnswering({ data: reply(), error: null });
    await expect(readStaffOperationsHealth(api)).resolves.toEqual(reply());
    expect(rpc).toHaveBeenCalledWith("get_staff_operations_health", {}, { get: false });
  });

  it("refuses a reply with an unknown job or an extra field", async () => {
    const unknownJob = reply();
    unknownJob.jobs[0] = { ...unknownJob.jobs[0], job: "something_else" as never };
    const withOwner = reply();
    Object.assign(withOwner.emails.items[0], { owner_id: "11111111-1111-4111-8111-111111111111" });
    const fullPaymentId = reply();
    fullPaymentId.payments.items[0].payment_ref = "11111111-1111-4111-8111-111111111111" as never;
    for (const data of [unknownJob, withOwner, fullPaymentId, { ...reply(), extra: 1 }, null]) {
      const { api } = apiAnswering({ data, error: null });
      await expect(readStaffOperationsHealth(api)).rejects.toMatchObject({ status: 503 });
    }
  });

  it("refuses more than 50 rows in a list", async () => {
    const many = reply();
    many.emails.items = Array.from({ length: 51 }, () => many.emails.items[0]);
    const { api } = apiAnswering({ data: many, error: null });
    await expect(readStaffOperationsHealth(api)).rejects.toBeInstanceOf(
      FoundationStaffCommandError
    );
  });

  it("asks staff to verify their authenticator again when it is too old", async () => {
    const { api } = apiAnswering({
      data: null,
      error: { code: "42501", message: "recent second-factor verification required" },
    });
    await expect(readStaffOperationsHealth(api)).rejects.toMatchObject({
      status: 403,
      mfaRequired: true,
    });
  });

  it("does not ask for the authenticator when the capability is missing", async () => {
    const { api } = apiAnswering({
      data: null,
      error: { code: "42501", message: "capability not granted" },
    });
    await expect(readStaffOperationsHealth(api)).rejects.toMatchObject({
      status: 403,
      mfaRequired: false,
    });
  });
});
