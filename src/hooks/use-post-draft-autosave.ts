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
      body: JSON.stringify({ flow: serverFlow(flow), step, data }),
    });
  } catch {
    // Server save is best-effort; localStorage is the primary store.
  }
}

// Tourism replaced the promotion wizard; retain its persisted database key.
function serverFlow(flow: DraftFlow): DraftFlow {
  return flow === "tourism" ? "promotion" : flow;
}

async function loadFromServer<T>(flow: DraftFlow): Promise<DraftEnvelope<T> | null | undefined> {
  try {
    const res = await fetch(`/api/drafts?flow=${encodeURIComponent(serverFlow(flow))}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return undefined;
    const { draft } = await res.json();
    if (!draft) return null;
    return {
      v: 1,
      savedAt: new Date(draft.saved_at).getTime(),
      step: draft.step,
      data: draft.data as T,
    };
  } catch {
    return undefined;
  }
}

async function deleteFromServer(flow: DraftFlow): Promise<void> {
  try {
    await fetch(`/api/drafts?flow=${encodeURIComponent(serverFlow(flow))}`, {
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
  const restoreRef = useRef<{
    key: string;
    promise: Promise<DraftEnvelope<T> | null>;
    ready: boolean;
    canSync: boolean;
  } | null>(null);

  /* ---------- save (debounced 800ms to localStorage, 5s to server) ---------- */

  const save = useDebouncedCallback((step: number, data: T) => {
    if (!userId || !enabled || !restoreRef.current?.ready) return;
    saveDraft<T>(flow, userId, step, data);
  }, 800);

  const serverSync = useDebouncedCallback((step: number, data: T) => {
    if (!userId || !enabled || !restoreRef.current?.canSync) return;
    void saveToServer<T>(flow, step, data);
  }, 5_000);

  const saveAll = useCallback(
    (step: number, data: T) => {
      if (!restoreRef.current?.ready) return;
      save(step, data);
      serverSync(step, data);
    },
    [save, serverSync]
  );

  /* ---------- restore (once, after hydration) ---------- */

  const restore = useCallback((): Promise<DraftEnvelope<T> | null> => {
    if (!hydrated || !userId || !enabled) return Promise.resolve(null);
    const key = `${flow}:${userId}`;
    if (restoreRef.current?.key === key) return restoreRef.current.promise;
    const local = loadDraft<T>(flow, userId);
    const entry = {
      key,
      ready: false,
      canSync: false,
      promise: Promise.resolve<DraftEnvelope<T> | null>(null),
    };
    restoreRef.current = entry;
    entry.promise = loadFromServer<T>(flow).then((server) => {
      if (restoreRef.current !== entry) return null;
      entry.ready = true;
      // If loading failed, retain local editing without overwriting an unknown
      // server draft. A subsequent mount can retry synchronization.
      entry.canSync = server !== undefined;
      if (!server || (local && local.savedAt >= server.savedAt)) return local;
      saveDraft<T>(flow, userId, server.step, server.data);
      return server;
    });
    return entry.promise;
  }, [hydrated, userId, flow, enabled]);

  /* ---------- discard ---------- */

  const discard = useCallback(() => {
    if (!userId) return;
    save.cancel();
    serverSync.cancel();
    restoreRef.current = null;
    clearDraft(flow, userId);
    void deleteFromServer(flow);
  }, [userId, flow, save, serverSync]);

  /* Cancel pending saves on unmount */
  useEffect(
    () => () => {
      save.cancel();
      serverSync.cancel();
    },
    [save, serverSync, userId, flow]
  );

  return { save: saveAll, restore, discard } as const;
}
