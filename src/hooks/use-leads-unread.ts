"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import { getRestoredFoundationBrowserClient as createClient } from "@/lib/foundation/restored-browser-client";
import { getOwnerColumn, type OwnerColumn } from "@/lib/account/compat";

interface UseLeadsUnreadResult {
  unreadCount: number;
  isLoading: boolean;
}

export function useLeadsUnread(): UseLeadsUnreadResult {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id;
  const [ownerColumn, setOwnerColumn] = useState<OwnerColumn | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const enabled = useMemo(
    () => Boolean(isAuthenticated && userId && ownerColumn),
    [isAuthenticated, userId, ownerColumn]
  );

  const refreshUnreadCount = useCallback(async () => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }

    const response = await fetch("/api/leads?countOnly=true", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json().catch(() => null)) as {
      unreadCount?: number;
      accountId?: string;
    } | null;
    if (payload?.accountId && payload.accountId !== userId) return;
    if (typeof payload?.unreadCount === "number") {
      setUnreadCount(payload.unreadCount);
    }
  }, [userId]);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      queueMicrotask(() => {
        setOwnerColumn(null);
        setUnreadCount(0);
      });
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    async function hydrateUnreadCount() {
      setIsLoading(true);
      try {
        const detectedOwnerColumn = await getOwnerColumn(supabase, "leads");
        if (!cancelled) {
          setOwnerColumn(detectedOwnerColumn);
        }

        const response = await fetch("/api/leads?countOnly=true", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          unreadCount?: number;
          accountId?: string;
        } | null;
        if (payload?.accountId && payload.accountId !== userId) return;

        if (!cancelled) {
          setUnreadCount(typeof payload?.unreadCount === "number" ? payload.unreadCount : 0);
        }
      } catch {
        if (!cancelled) {
          setOwnerColumn(null);
          setUnreadCount(0);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void hydrateUnreadCount();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId]);

  useRealtime({
    table: "leads",
    event: "*",
    filterColumn: ownerColumn ?? undefined,
    filterValue: userId,
    enabled,
    onEvent: () => {
      void refreshUnreadCount();
    },
  });

  return { unreadCount, isLoading };
}
