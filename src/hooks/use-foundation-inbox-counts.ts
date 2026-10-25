"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuthStore } from "@/stores/auth-store";
import { createTimeoutFetch } from "@/lib/supabase/fetch-with-timeout";

const countsSchema = z.strictObject({
  unread_enquiries: z.number().int().nonnegative(),
  unread_notifications: z.number().int().nonnegative(),
});
export function useFoundationInboxCounts() {
  const accountId = useAuthStore((state) => state.user?.id);
  const [snapshot, setSnapshot] = useState<{
    accountId: string;
    counts: z.infer<typeof countsSchema>;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    if (!accountId) return;
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const response = await createTimeoutFetch()("/api/foundation/inbox", {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        });
        if (!response.ok) throw new Error();
        const next = countsSchema.parse(await response.json());
        if (!cancelled && useAuthStore.getState().user?.id === accountId)
          setSnapshot({ accountId, counts: next });
      } catch {
        if (!cancelled) setSnapshot(null);
      } finally {
        running = false;
      }
    };
    void refresh();
    const onFocus = () => void refresh();
    const interval = window.setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [accountId]);
  return snapshot && snapshot.accountId === accountId ? snapshot.counts : null;
}
