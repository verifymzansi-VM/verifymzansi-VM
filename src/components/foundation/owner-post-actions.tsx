"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getFoundationBrowserClient } from "@/lib/foundation/browser-client";
import type { FoundationOwnerPost } from "@/lib/foundation/owner-posts";
import type { FoundationBillingCatalogue } from "@/lib/foundation/billing-catalogue";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { navigateToFoundationCheckout } from "@/lib/foundation/checkout-navigation";
import { useAuthStore } from "@/stores/auth-store";
export function FoundationOwnerPostActions({
  post,
  addons,
  accountId,
}: {
  post: FoundationOwnerPost;
  addons: FoundationBillingCatalogue["addons"];
  accountId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const offered =
    post.status !== "live"
      ? []
      : addons.filter((addon) =>
          post.kind === "event"
            ? addon.kind !== "urgent"
            : post.kind === "listing" && addon.kind === "urgent"
        );
  async function buyAddon(addon: FoundationBillingCatalogue["addons"][number]) {
    setBusy(true);
    setMessage("");
    try {
      if (!(await ensureCsrfTokenReady()))
        throw new Error("Refresh the page before starting checkout");
      if (useAuthStore.getState().user?.id !== accountId)
        throw new Error("Sign in again before starting checkout");
      const response = await fetch("/api/foundation/billing/addon", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ post_id: post.id, kind: addon.kind, days: addon.days }),
        cache: "no-store",
        redirect: "error",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.error === "string" ? data.error : "The add-on is unavailable for this post"
        );
      navigateToFoundationCheckout(data, accountId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout could not be started");
      setBusy(false);
    }
  }
  async function act(action: "pause" | "sold" | "activate" | "delete") {
    if (action === "delete" && !window.confirm("Delete this post? This cannot be undone.")) return;
    setBusy(true);
    setMessage("");
    try {
      const api = getFoundationBrowserClient();
      const result =
        action === "delete"
          ? await api.rpc("delete_post", { p_post_id: post.id, p_expected_revision: post.revision })
          : action === "activate"
            ? await api.rpc("activate_post", { p_post_id: post.id })
            : await api.rpc("set_post_state", {
                p_post_id: post.id,
                p_expected_revision: post.revision,
                p_action: action,
              });
      if (result.error)
        throw new Error(
          "This action could not be completed. Refresh the post; publishing also requires an available plan and current verification."
        );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The action could not be confirmed. Refresh before trying again."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {post.status === "live" && (
          <button
            disabled={busy}
            className="rounded-lg border px-3 py-2"
            onClick={() => void act("pause")}
          >
            Pause
          </button>
        )}
        {post.status === "live" && post.kind === "listing" && (
          <button
            disabled={busy}
            className="rounded-lg border px-3 py-2"
            onClick={() => void act("sold")}
          >
            Mark sold
          </button>
        )}
        {["paused", "expired"].includes(post.status) && (
          <button
            disabled={busy}
            className="rounded-lg border px-3 py-2"
            onClick={() => void act("activate")}
          >
            Activate
          </button>
        )}
        <button
          disabled={busy}
          className="rounded-lg border px-3 py-2 text-destructive"
          onClick={() => void act("delete")}
        >
          Delete
        </button>
      </div>
      {message && (
        <p role="status" className="max-w-md text-sm">
          {message}
        </p>
      )}
      {offered.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Add-ons are available for posts covered by an eligible paid plan.
          </p>
          <div className="flex flex-wrap gap-2">
            {offered.map((addon) => (
              <button
                key={addon.id}
                disabled={busy}
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => void buyAddon(addon)}
              >
                {addon.kind === "boost"
                  ? "Boost"
                  : addon.kind === "featured"
                    ? "Featured"
                    : "Urgent"}{" "}
                · {addon.days} days ·{" "}
                {new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
                  Number(addon.price_cents) / 100
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
