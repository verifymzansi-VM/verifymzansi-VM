"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { withCsrfHeaders } from "@/lib/utils/csrf";

/**
 * "More" on a My posts card (business tools plan section 3, SHOW_POST_COPY):
 * "Copy this post" makes a draft from the listing and opens it in the
 * "Post an item" form.
 */
export function PostMoreMenu({ postId, title }: { postId: string; title: string }) {
  const router = useRouter();
  // One copy per click; a retry of the same click returns the same draft.
  const operation = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyPost() {
    setBusy(true);
    setError(null);
    operation.current ??= crypto.randomUUID();
    try {
      const res = await fetch(`/api/listings/${postId}/copy`, {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ operationId: operation.current }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: unknown; error?: unknown };
      if (!res.ok || typeof data.id !== "string") {
        setError(typeof data.error === "string" ? data.error : "The post could not be copied.");
        if (res.status !== 503) operation.current = null;
        return;
      }
      router.push(`/post/create-listing?copy=${encodeURIComponent(data.id)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-11 w-11 p-0"
            aria-label={`More actions for ${title}`}
            disabled={busy}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical aria-hidden="true" className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => void copyPost()}>
            <Copy aria-hidden="true" className="h-4 w-4" />
            Copy this post
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p role="alert" className="inline-form-error max-w-64 text-right">
          {error}
        </p>
      ) : null}
    </div>
  );
}
