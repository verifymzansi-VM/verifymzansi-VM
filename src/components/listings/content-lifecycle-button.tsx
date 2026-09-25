"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PauseCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";

type LifecycleAction = "mark_sold" | "deactivate" | "reactivate";

const ACTION_COPY: Record<LifecycleAction, { label: string; busy: string; confirm?: string }> = {
  mark_sold: {
    label: "Mark sold",
    busy: "Updating…",
    confirm: "Mark this item as sold? It leaves public view and frees your posting slot.",
  },
  deactivate: {
    label: "Deactivate",
    busy: "Updating…",
    confirm: "Take this post offline? It stays saved and frees your posting slot.",
  },
  reactivate: { label: "Reactivate", busy: "Reactivating…" },
};

const ACTION_ICONS = {
  mark_sold: CheckCircle2,
  deactivate: PauseCircle,
  reactivate: RotateCcw,
} as const;

/** Slot actions on a dashboard post. Rules and capacity are enforced server-side. */
export function ContentLifecycleButton({
  contentType,
  id,
  action,
}: {
  contentType: "listing" | "business" | "promotion";
  id: string;
  action: LifecycleAction;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; upgradeUrl?: string } | null>(null);
  const router = useRouter();
  const copy = ACTION_COPY[action];
  const Icon = ACTION_ICONS[action];

  async function run() {
    if (copy.confirm && !window.confirm(copy.confirm)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/lifecycle", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ contentType, id, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError({
          message: typeof data.error === "string" ? data.error : "Unable to update this post",
          upgradeUrl: typeof data.upgradeUrl === "string" ? data.upgradeUrl : undefined,
        });
        return;
      }
      router.refresh();
    } catch {
      setError({ message: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={action === "reactivate" ? "outline" : "ghost"}
        size="sm"
        className={`h-11 gap-1.5 px-3 ${
          action === "reactivate"
            ? "border-brand-green text-brand-green hover:bg-brand-green/10"
            : ""
        }`}
        onClick={run}
        disabled={loading}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {loading ? copy.busy : copy.label}
      </Button>
      {error ? (
        <p role="alert" className="inline-form-error max-w-xs">
          {error.message}{" "}
          {error.upgradeUrl ? (
            <Link className="font-medium underline" href={error.upgradeUrl}>
              See plans
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
