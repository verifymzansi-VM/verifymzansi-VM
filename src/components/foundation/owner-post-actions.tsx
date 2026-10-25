"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getFoundationBrowserClient } from "@/lib/foundation/browser-client";
import type { FoundationOwnerPost } from "@/lib/foundation/owner-posts";
export function FoundationOwnerPostActions({ post }: { post: FoundationOwnerPost }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
    </div>
  );
}
