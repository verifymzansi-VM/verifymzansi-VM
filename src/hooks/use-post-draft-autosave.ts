"use client";

import { useEffect, useRef, useCallback } from "react";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  type DraftFlow,
  type DraftEnvelope,
} from "@/lib/post-drafts/storage";

/**
 * Returns helpers to autosave a create-post form's serializable state to
 * localStorage and restore it on mount. Debounces writes to avoid thrashing.
 *
 * @param flow       – Which create-post flow ("listing" | "promotion" | "business")
 * @param userId     – Authenticated user id (required to scope the draft key)
 * @param enabled    – Set false while userId is unknown to prevent saving empty drafts
 */
export function usePostDraftAutosave<T>(
  flow: DraftFlow,
  userId: string | null | undefined,
  enabled: boolean = true
) {
  const hydrated = useHydrated();
  const restoredRef = useRef(false);

  /* ---------- save (debounced 800ms) ---------- */

  const save = useDebouncedCallback((step: number, data: T) => {
    if (!userId || !enabled) return;
    saveDraft<T>(flow, userId, step, data);
  }, 800);

  /* ---------- restore (once, after hydration) ---------- */

  const restore = useCallback((): DraftEnvelope<T> | null => {
    if (!hydrated || !userId) return null;
    if (restoredRef.current) return null; // only restore once per mount
    restoredRef.current = true;
    return loadDraft<T>(flow, userId);
  }, [hydrated, userId, flow]);

  /* ---------- discard ---------- */

  const discard = useCallback(() => {
    if (!userId) return;
    save.cancel();
    clearDraft(flow, userId);
  }, [userId, flow, save]);

  /* Cancel pending save on unmount */
  useEffect(() => () => save.cancel(), [save]);

  return { save, restore, discard } as const;
}
