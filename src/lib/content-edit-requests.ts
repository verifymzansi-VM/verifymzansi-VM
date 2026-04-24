import { NextResponse } from "next/server";
import type { MarketplaceArea } from "@/types/enums";

export const MAX_APPROVED_CONTENT_EDITS = 2;

export type ContentEditTargetType = "listing" | "business" | "promotion";
export type ContentEditStatus = "pending" | "approved" | "rejected";

export interface ContentEditRequest {
  id: string;
  target_type: ContentEditTargetType;
  target_id: string;
  owner_id: string;
  area: MarketplaceArea;
  status: ContentEditStatus;
  proposed_data: Record<string, unknown>;
  current_snapshot: Record<string, unknown>;
  reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

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

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

type CountQuery = PromiseLike<CountResult> & {
  eq: (column: string, value: unknown) => CountQuery;
};

export function isEditLimitReached(approvedEditCount: number | null | undefined) {
  return (approvedEditCount ?? 0) >= MAX_APPROVED_CONTENT_EDITS;
}

export function getRemainingApprovedEdits(approvedEditCount: number | null | undefined) {
  return Math.max(0, MAX_APPROVED_CONTENT_EDITS - (approvedEditCount ?? 0));
}

export function editLimitReachedResponse() {
  return NextResponse.json(
    {
      error: "This post has reached the maximum of two approved edits.",
      code: "edit_limit_reached",
      editLimitReached: true,
      editAttemptsRemaining: 0,
    },
    { status: 409 }
  );
}

export function pendingEditExistsResponse() {
  return NextResponse.json(
    {
      error: "This post already has an edit pending admin review.",
      code: "pending_edit_exists",
      pendingEditExists: true,
    },
    { status: 409 }
  );
}

export async function hasPendingContentEdit(
  supabase: QueryableClient,
  targetType: ContentEditTargetType,
  targetId: string
) {
  const query = (supabase.from("content_edit_requests") as SupabaseInsertBuilder)
    .select("id", { count: "exact", head: true })
    .eq("target_type", targetType) as CountQuery;
  const result = await query.eq("target_id", targetId).eq("status", "pending");

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.count ?? 0) > 0;
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

  return { response: null, requestId: data?.id ?? null };
}

export function contentEditSubmittedResponse(
  targetId: string,
  approvedEditCount: number | null | undefined
) {
  return NextResponse.json({
    id: targetId,
    success: true,
    pendingReview: true,
    message: "Edit submitted for admin review",
    editAttemptsRemaining: getRemainingApprovedEdits(approvedEditCount),
  });
}
