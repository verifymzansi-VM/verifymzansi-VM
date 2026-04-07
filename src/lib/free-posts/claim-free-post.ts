import type { MarketplaceArea } from "@/types/enums";

type FreePostUsageError = {
  message: string;
  code?: string;
};

type FreePostUsageClient = {
  from: (table: "free_posts_used") => unknown;
};

type FreePostCountQueryResult = {
  count?: number | null;
  error?: FreePostUsageError | null;
};

type FreePostUsageTable = {
  select: (
    columns: string,
    options?: { count?: "exact"; head?: boolean }
  ) => {
    eq: (
      column: string,
      value: unknown
    ) => {
      eq: (nextColumn: string, nextValue: unknown) => Promise<FreePostCountQueryResult>;
    };
  };
  insert: (payload: Record<string, unknown>) => Promise<{ error?: FreePostUsageError | null }>;
};

function getFreePostsTable(client: FreePostUsageClient): FreePostUsageTable {
  return client.from("free_posts_used") as FreePostUsageTable;
}

type ClaimFreePostSlotResult =
  | { ok: true; slot: number }
  | {
      ok: false;
      reason: "limit_reached" | "count_failed" | "insert_failed";
      error?: FreePostUsageError;
    };

async function readFreePostCount(
  client: FreePostUsageClient,
  userId: string,
  area: MarketplaceArea
): Promise<{ count: number; error: FreePostUsageError | null }> {
  const { count, error } = await getFreePostsTable(client)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("area", area);

  return { count: count ?? 0, error: error ?? null };
}

export async function claimFreePostSlot(
  client: FreePostUsageClient,
  userId: string,
  area: MarketplaceArea,
  maxAllowed: number
): Promise<ClaimFreePostSlotResult> {
  for (let attempt = 0; attempt < maxAllowed; attempt += 1) {
    const { count, error } = await readFreePostCount(client, userId, area);
    if (error) {
      return { ok: false, reason: "count_failed", error };
    }

    if (count >= maxAllowed) {
      return { ok: false, reason: "limit_reached" };
    }

    const nextSlot = count + 1;
    const { error: insertError } = await getFreePostsTable(client).insert({
      user_id: userId,
      area,
      slot: nextSlot,
    });

    if (!insertError) {
      return { ok: true, slot: nextSlot };
    }

    if (insertError.code !== "23505") {
      return { ok: false, reason: "insert_failed", error: insertError };
    }
  }

  const { count, error } = await readFreePostCount(client, userId, area);
  if (error) {
    return { ok: false, reason: "count_failed", error };
  }

  if (count >= maxAllowed) {
    return { ok: false, reason: "limit_reached" };
  }

  return {
    ok: false,
    reason: "insert_failed",
    error: { message: "Unable to reserve a free-post slot after retrying." },
  };
}
