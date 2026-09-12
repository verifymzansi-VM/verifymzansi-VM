import { getContentEditChanges } from "@/lib/content-edit-diff";
import type { ContentEditRequest } from "@/types/database";
import { AREA_LABELS } from "@/types/enums";

type QueuedEdit = Pick<
  ContentEditRequest,
  | "id"
  | "target_type"
  | "target_id"
  | "owner_id"
  | "area"
  | "status"
  | "proposed_data"
  | "current_snapshot"
  | "created_at"
>;

/** Use the same request identity and proposed values in every staff queue. */
export function toContentEditModerationItem(request: QueuedEdit) {
  const proposed = request.proposed_data ?? {};
  const current = request.current_snapshot ?? {};
  const title = [proposed.title, proposed.business_name, current.title, current.business_name].find(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  return {
    ...proposed,
    id: request.id,
    targetId: request.target_id,
    title: title ?? `Edit ${request.id.slice(0, 8)}`,
    status: request.status,
    created_at: request.created_at,
    owner_id: request.owner_id,
    area: request.area,
    areaLabel: AREA_LABELS[request.area],
    itemType:
      request.target_type === "business"
        ? "Business edit"
        : request.target_type === "promotion"
          ? "Promotion edit"
          : "Listing edit",
    contentType: request.target_type,
    isEditRequest: true,
    current_snapshot: current,
    change_summary: getContentEditChanges(current, proposed),
  };
}
