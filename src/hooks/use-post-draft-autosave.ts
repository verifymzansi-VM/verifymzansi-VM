"use client";

import { useEffect, useRef, useCallback } from "react";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useHydrated } from "@/hooks/use-hydrated";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  type DraftFlow,
  type DraftEnvelope,
} from "@/lib/post-drafts/storage";

/* ------------------------------------------------------------------ */
/*  Server sync helpers                                                */
/* ------------------------------------------------------------------ */

async function saveToServer<T>(flow: DraftFlow, step: number, data: T): Promise<void> {
  try {
    await fetch("/api/drafts", {
      method: "PUT",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ flow, step, data }),
    });
  } catch {
    // Server save is best-effort; localStorage is the primary store.
  }
}

async function loadFromServer<T>(flow: DraftFlow): Promise<DraftEnvelope<T> | null> {
  try {
    const res = await fetch(`/api/drafts?flow=${encodeURIComponent(flow)}`);
    if (!res.ok) return null;
    const { draft } = await res.json();
    if (!draft) return null;
    return {
      v: 1,
      savedAt: new Date(draft.saved_at).getTime(),
      step: draft.step,
      data: draft.data as T,
    };
  } catch {
    return null;
  }
}

async function deleteFromServer(flow: DraftFlow): Promise<void> {
  try {
    await fetch(`/api/drafts?flow=${encodeURIComponent(flow)}`, {
      method: "DELETE",
      headers: withCsrfHeaders(),
    });
  } catch {
    // Best-effort.
  }
}

/**
 * Returns helpers to autosave a create-post form's serializable state to
 * localStorage **and** the server, and restore it on mount.
 * localStorage is the primary fast cache; the server persists across devices.
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

  /* ---------- save (debounced 800ms to localStorage, 5s to server) ---------- */

  const save = useDebouncedCallback((step: number, data: T) => {
    if (!userId || !enabled) return;
    saveDraft<T>(flow, userId, step, data);
  }, 800);

  const serverSync = useDebouncedCallback((step: number, data: T) => {
    if (!userId || !enabled) return;
    void saveToServer<T>(flow, step, data);
  }, 5_000);

  const saveAll = useCallback(
    (step: number, data: T) => {
      save(step, data);
      serverSync(step, data);
    },
    [save, serverSync]
  );

  /* ---------- restore (once, after hydration) ---------- */

  const restore = useCallback((): DraftEnvelope<T> | null => {
    if (!hydrated || !userId) return null;
    if (restoredRef.current) return null; // only restore once per mount
    restoredRef.current = true;

    const local = loadDraft<T>(flow, userId);

    // Kick off async server load — if the server draft is newer, overwrite local.
    void loadFromServer<T>(flow).then((server) => {
      if (!server) return;
      if (local && local.savedAt >= server.savedAt) return;
      // Server draft is newer — persist to localStorage for next read.
      saveDraft<T>(flow, userId!, server.step, server.data);
    });

    return local;
  }, [hydrated, userId, flow]);

  /* ---------- discard ---------- */

  const discard = useCallback(() => {
    if (!userId) return;
    save.cancel();
    serverSync.cancel();
    clearDraft(flow, userId);
    void deleteFromServer(flow);
  }, [userId, flow, save, serverSync]);

  /* Cancel pending saves on unmount */
  useEffect(
    () => () => {
      save.cancel();
      serverSync.cancel();
    },
    [save, serverSync]
  );

  return { save: saveAll, restore, discard } as const;
}
