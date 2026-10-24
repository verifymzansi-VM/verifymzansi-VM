"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/hooks/use-hydrated";
import { useAuthStore } from "@/stores/auth-store";
import { foundationPasswordUpdateSchema } from "@/lib/foundation/password-update-input";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { createTimeoutFetch } from "@/lib/supabase/fetch-with-timeout";

export function FoundationPasswordForm({ accountId }: { accountId: string }) {
  const hydrated = useHydrated();
  const currentId = useAuthStore((state) => state.user?.id);
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sameAccount = () => useAuthStore.getState().user?.id === accountId;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !hydrated || !sameAccount()) return;
    const parsed = foundationPasswordUpdateSchema.safeParse({
      currentPassword,
      newPassword,
      confirmNewPassword: confirmation,
    });
    if (!parsed.success) {
      setFailed(true);
      setMessage(
        "Use matching new passwords of 12–128 characters, different from your current password."
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!(await ensureCsrfTokenReady()) || !sameAccount()) throw new Error();
      const response = await createTimeoutFetch(20000)("/api/foundation/auth/password", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(parsed.data),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!sameAccount()) return;
      if (!response.ok) {
        setFailed(true);
        setMessage(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "Password change could not be confirmed."
        );
        return;
      }
      if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true)
        throw new Error();
      setCurrent("");
      setNew("");
      setConfirmation("");
      setFailed(false);
      setMessage("Password updated.");
    } catch {
      if (sameAccount()) {
        setFailed(true);
        setMessage(
          "Password change could not be confirmed. Check your connection before trying again."
        );
      }
    } finally {
      setBusy(false);
    }
  }
  if (!currentId || currentId !== accountId)
    return <p role="alert">Reload your account settings to continue.</p>;
  const disabled = !hydrated || busy || currentId !== accountId;
  return (
    <section aria-labelledby="password-heading" className="space-y-4 border-t pt-6">
      <h2 id="password-heading" className="font-display text-xl font-bold">
        Change password
      </h2>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="native-current-password">Current password</Label>
          <Input
            id="native-current-password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            disabled={disabled}
            value={currentPassword}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="native-new-password">New password</Label>
          <Input
            id="native-new-password"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            disabled={disabled}
            value={newPassword}
            onChange={(event) => setNew(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="native-confirm-password">Confirm new password</Label>
          <Input
            id="native-confirm-password"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            disabled={disabled}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
        <Button type="submit" disabled={disabled}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
    </section>
  );
}
