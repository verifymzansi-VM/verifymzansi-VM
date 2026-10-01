"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { withCsrfHeaders } from "@/lib/utils/csrf";

export interface MultiListingPlanAdmins {
  entitlementId: string;
  slotCapacity: number;
  expiresAt: string;
  admins: Array<{ name: string; email: string | null }>;
}

const day = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

function PlanAdmins({ plan }: { plan: MultiListingPlanAdmins }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function change(action: "add" | "remove", email: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/billing/plan-admins", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ entitlementId: plan.entitlementId, action, email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: body.error ?? "The change could not be applied." });
        return false;
      }
      setMessage({
        tone: "success",
        text: action === "add" ? "Administrator added." : "Administrator removed.",
      });
      router.refresh();
      return true;
    } catch {
      setMessage({ tone: "error", text: "Network error. Please try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const full = plan.admins.length >= 1;
  return (
    <li className="space-y-3 rounded-xl border p-3 text-sm">
      <p className="font-medium">
        {plan.slotCapacity} live slots · until {day.format(new Date(plan.expiresAt))}
      </p>
      <ul className="space-y-1">
        <li>You (buyer)</li>
        {plan.admins.map((admin) => (
          <li key={admin.email ?? admin.name} className="flex flex-wrap items-center gap-2">
            <span>
              {admin.name}
              {admin.email ? <span className="text-muted-foreground"> · {admin.email}</span> : null}
            </span>
            {admin.email ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-11"
                disabled={busy}
                onClick={() => void change("remove", admin.email as string)}
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {full ? null : (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const email = String(new FormData(form).get("email") ?? "");
            if (await change("add", email)) form.reset();
          }}
        >
          <label className="block flex-1">
            <span className="font-medium">Second administrator&rsquo;s email</span>
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              className="mt-1 block h-11 w-full rounded-md border bg-background px-3"
            />
          </label>
          <Button type="submit" className="h-11" disabled={busy}>
            Add administrator
          </Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        They need a VerifyMzansi account with a reviewed identity. They post from this plan&rsquo;s
        shared slots; removing them stops new posts, and posts already live run until they end.
      </p>
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={message.tone === "error" ? "text-destructive" : "text-brand-green-700"}
        >
          {message.text}
        </p>
      ) : null}
    </li>
  );
}

/** Multi-listing plans include two named administrators: the buyer and one more. */
export function PlanAdministratorsCard({ plans }: { plans: MultiListingPlanAdmins[] }) {
  if (plans.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" className="h-5 w-5 text-brand-green" />
          <h2 className="font-display text-base font-semibold">Multi-listing administrators</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Each multi-listing plan includes two named administrators: you and one more.
        </p>
        <ul className="space-y-3">
          {plans.map((plan) => (
            <PlanAdmins key={plan.entitlementId} plan={plan} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
