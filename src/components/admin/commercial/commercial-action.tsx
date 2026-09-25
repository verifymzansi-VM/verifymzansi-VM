"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";

export type CommercialPayload = Record<string, unknown> & { action: string };

/** Posts an audited change to /api/admin/commercial and refreshes the page. */
export function useCommercialAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function run(payload: CommercialPayload, successText = "Saved") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/commercial", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: body.error ?? "The change could not be applied." });
        return null;
      }
      setMessage({ tone: "success", text: successText });
      router.refresh();
      return body.data ?? true;
    } catch {
      setMessage({ tone: "error", text: "Network error. Please try again." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { run, busy, message };
}

export function ActionMessage({
  message,
}: {
  message: { tone: "error" | "success"; text: string } | null;
}) {
  if (!message) return null;
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={
        message.tone === "error" ? "text-sm text-destructive" : "text-sm text-brand-green-700"
      }
    >
      {message.text}
    </p>
  );
}

/** Audit reason input used by every commercial form (5–500 characters). */
export function ReasonField({ name = "reason" }: { name?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">Reason (audited)</span>
      <input
        name={name}
        required
        minLength={5}
        maxLength={500}
        className="mt-1 block w-full rounded-md border bg-background p-2"
        placeholder="Why is this change being made?"
      />
    </label>
  );
}

export function AdminCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={busy} className="h-11">
      {busy ? "Saving…" : children}
    </Button>
  );
}

export function readForm(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    Array.from(new FormData(form).entries()).map(([key, value]) => [key, String(value)])
  );
}

export function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}
