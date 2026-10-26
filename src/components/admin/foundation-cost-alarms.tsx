"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useAuthStore } from "@/stores/auth-store";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { createTimeoutFetch } from "@/lib/supabase/fetch-with-timeout";
const reply = z.strictObject({
  account_id: z.uuid(),
  data: z.strictObject({ id: z.uuid(), acknowledged_at: z.iso.datetime({ offset: true }) }),
});
export function FoundationCostAlarms({
  accountId,
  alarms,
}: {
  accountId: string;
  alarms: { id: string; metric: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const current = () => {
    const state = useAuthStore.getState();
    return state.user?.id === accountId && state.foundationContext?.staff?.can_access === true;
  };
  async function acknowledge(id: string) {
    if (busy || !current()) return;
    setBusy(true);
    setMessage("");
    try {
      if (!(await ensureCsrfTokenReady()) || !current()) throw new Error();
      const response = await createTimeoutFetch(15000)("/api/foundation/staff/costs", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ alarm_id: id }),
        cache: "no-store",
        redirect: "error",
      });
      const data = reply.safeParse(await response.json());
      if (!current()) return;
      if (
        !response.ok ||
        !data.success ||
        data.data.account_id !== accountId ||
        data.data.data.id !== id
      )
        throw new Error();
      setMessage("Alarm acknowledged. Its audit record is retained.");
      router.refresh();
    } catch {
      if (current())
        setMessage("Unable to acknowledge the alarm. Refresh and check your staff session.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="Acknowledge cost alarms">
      {message && <p role="status">{message}</p>}
      {alarms.map((alarm) => (
        <button
          key={alarm.id}
          type="button"
          disabled={busy}
          onClick={() => void acknowledge(alarm.id)}
          className="mr-3 rounded-lg border px-4 py-2 disabled:opacity-50"
        >
          Acknowledge {alarm.metric}
        </button>
      ))}
    </section>
  );
}
