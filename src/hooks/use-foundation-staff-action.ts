"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useAuthStore } from "@/stores/auth-store";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { createTimeoutFetch } from "@/lib/supabase/fetch-with-timeout";
const envelope = z.strictObject({ account_id: z.uuid(), data: z.unknown() });
export function useFoundationStaffAction(accountId: string) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const current = () => {
    const state = useAuthStore.getState();
    return state.user?.id === accountId && state.foundationContext?.staff?.can_access === true;
  };
  async function run<T>({
    path,
    body,
    schema,
    successText,
    method = "POST",
    refresh = true,
  }: {
    path: string;
    body: unknown;
    schema: z.ZodType<T>;
    successText: string;
    method?: "POST" | "PATCH";
    refresh?: boolean;
  }): Promise<T | undefined> {
    if (pending.current || !current()) return;
    if (!path.startsWith("/api/foundation/staff/")) throw new Error("Invalid staff action path");
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (!(await ensureCsrfTokenReady()) || !current()) throw new Error();
      const response = await createTimeoutFetch(20000)(path, {
        method,
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      });
      const raw: unknown = await response.json();
      if (!current()) return;
      if (!response.ok) {
        const failure = z.object({ error: z.string().max(1000) }).safeParse(raw);
        setMessage({
          tone: "error",
          text: failure.success ? failure.data.error : "This change could not be saved",
        });
        return;
      }
      const parsed = envelope.safeParse(raw);
      if (!parsed.success || parsed.data.account_id !== accountId) throw new Error();
      const value = schema.parse(parsed.data.data);
      setMessage({ tone: "success", text: successText });
      if (refresh) router.refresh();
      return value;
    } catch {
      if (current())
        setMessage({
          tone: "error",
          text: "Unable to save this change. Refresh the page and check your staff session.",
        });
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  }
  return { run, busy, message };
}
