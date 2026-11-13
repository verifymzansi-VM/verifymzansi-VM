import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { NextResponse } from "next/server";
import type { ContentEditTargetType } from "@/types/database";
import type { MarketplaceArea } from "@/types/enums";

export type { ContentEditRequest, ContentEditTargetType } from "@/types/database";

import { CURRENT_MAX_APPROVED_CONTENT_EDITS } from "@/lib/posting/current-edit-policy";

export const MAX_APPROVED_CONTENT_EDITS = CURRENT_MAX_APPROVED_CONTENT_EDITS;

type QueryableClient = {
  from: (table: string) => unknown;
};

type SupabaseInsertBuilder = {
  insert: (values: Record<string, unknown>) => {
    select: (columns: string) => {
      maybeSingle: () => Promise<{
        data: { id: string } | null;
        error: { code?: string; message: string } | null;
      }>;
    };
  };
  select: (
    columns: string,
    options?: { count?: "exact"; head?: boolean }
  ) => {
    eq: (column: string, value: unknown) => unknown;
  };
};

function pendingEditExistsResponse() {
  return NextResponse.json(
    {
      error: "This post already has an edit pending admin review.",
      code: "pending_edit_exists",
      pendingEditExists: true,
    },
    { status: 409 }
  );
}

export async function createContentEditRequest({
  supabase,
  targetType,
  targetId,
  ownerId,
  area,
  proposedData,
  currentSnapshot,
}: {
  supabase: QueryableClient;
  targetType: ContentEditTargetType;
  targetId: string;
  ownerId: string;
  area: MarketplaceArea;
  proposedData: Record<string, unknown>;
  currentSnapshot: Record<string, unknown>;
}) {
  const { data, error } = await (supabase.from("content_edit_requests") as SupabaseInsertBuilder)
    .insert({
      target_type: targetType,
      target_id: targetId,
      owner_id: ownerId,
      area,
      proposed_data: proposedData,
      current_snapshot: currentSnapshot,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { response: pendingEditExistsResponse(), requestId: null };
    }
    throw new Error(error.message);
  }

  if (!data?.id) {
    throw new Error("Edit request was not saved");
  }

  // Await delivery so the server runtime cannot end before staff are notified.
  await notifyStaffForAdminEvent({
    capability: "queue:view",
    title: "Post edit submitted for review",
    message: "A live post has changes waiting for approval in the moderation queue.",
    href: "/admin/moderation",
    excludeUserId: ownerId,
  });

  return { response: null, requestId: data.id };
}
