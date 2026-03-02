"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseRealtimeOptions {
  /** Supabase table to subscribe to */
  table: string;
  /** Event filter: INSERT, UPDATE, DELETE, or * for all */
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  /** Optional filter column (e.g., "user_id") */
  filterColumn?: string;
  /** Optional filter value (e.g., the current user's ID) */
  filterValue?: string;
  /** Callback when a matching event is received */
  onEvent: (payload: Record<string, unknown>) => void;
  /** Whether the subscription is active (default: true) */
  enabled?: boolean;
}

/**
 * Hook for subscribing to Supabase Realtime changes on a table.
 * Automatically manages channel lifecycle on mount/unmount.
 *
 * @example
 * ```tsx
 * useRealtime({
 *   table: "verification_steps",
 *   event: "UPDATE",
 *   filterColumn: "user_id",
 *   filterValue: user.id,
 *   onEvent: (payload) => {
 *     console.log("Verification updated:", payload);
 *     refresh();
 *   },
 * });
 * ```
 */
export function useRealtime({
  table,
  event = "*",
  filterColumn,
  filterValue,
  onEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbackRef = useRef(onEvent);
  useEffect(() => {
    callbackRef.current = onEvent;
  });

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      // Use the same singleton client that created the subscription
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return cleanup;
    }

    const supabase = createClient();

    let filter: string | undefined;
    if (filterColumn && filterValue) {
      filter = `${filterColumn}=eq.${filterValue}`;
    }

    const channel = supabase
      .channel(`realtime:${table}:${event}:${filter || "all"}`)
      .on(
        "postgres_changes" as "system",
        {
          event,
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        } as Record<string, unknown>,
        (payload: Record<string, unknown>) => {
          callbackRef.current(payload);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return cleanup;
  }, [table, event, filterColumn, filterValue, enabled, cleanup]);
}
