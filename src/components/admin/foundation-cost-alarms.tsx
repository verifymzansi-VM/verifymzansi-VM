"use client";
import { z } from "zod";
import { useFoundationStaffAction } from "@/hooks/use-foundation-staff-action";
import { ActionMessage } from "./commercial/commercial-action";
const reply = z.strictObject({ id: z.uuid(), acknowledged_at: z.iso.datetime({ offset: true }) });
export function FoundationCostAlarms({
  accountId,
  alarms,
}: {
  accountId: string;
  alarms: { id: string; metric: string }[];
}) {
  const action = useFoundationStaffAction(accountId);
  async function acknowledge(id: string) {
    await action.run({
      path: "/api/foundation/staff/costs",
      body: { alarm_id: id },
      schema: reply.refine((value) => value.id === id),
      successText: "Alarm acknowledged. Its audit record is retained.",
    });
  }
  return (
    <section className="space-y-3" aria-label="Acknowledge cost alarms">
      <ActionMessage message={action.message} />
      {alarms.map((alarm) => (
        <button
          key={alarm.id}
          type="button"
          disabled={action.busy}
          onClick={() => void acknowledge(alarm.id)}
          className="mr-3 rounded-lg border px-4 py-2 disabled:opacity-50"
        >
          Acknowledge {alarm.metric}
        </button>
      ))}
    </section>
  );
}
