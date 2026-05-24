import { useState } from "react";

import { withCsrfHeaders } from "@/lib/utils/csrf";

export type ContentDecision = "approve" | "reject";

export function useContentDecision<T extends { id: string }>({
  getArea,
  getContentType,
  getEndpoint = () => "/api/admin/content/decide",
  getItemId = (item) => item.id,
  onDecisionComplete,
  rejectReasonRequiredMessage,
}: {
  getArea: (item: T) => string;
  getContentType?: (item: T) => string | undefined;
  getEndpoint?: (item: T) => string;
  getItemId?: (item: T) => string;
  onDecisionComplete?: () => void;
  rejectReasonRequiredMessage: string;
}) {
  const [selectedItem, setSelectedItem] = useState<T | null>(null);
  const [decision, setDecision] = useState<ContentDecision | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function openReview(item: T, nextDecision: ContentDecision) {
    setSelectedItem(item);
    setDecision(nextDecision);
    setRejectReason("");
    setError("");
  }

  function closeDialog() {
    setSelectedItem(null);
    setDecision(null);
    setRejectReason("");
    setError("");
  }

  async function submitDecision() {
    if (!selectedItem || !decision) return;

    if (decision === "reject" && !rejectReason.trim()) {
      setError(rejectReasonRequiredMessage);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const itemId = getItemId(selectedItem);
      const isContentEdit = getEndpoint(selectedItem).includes("/content-edits/");
      const res = await fetch(getEndpoint(selectedItem), {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...(isContentEdit
            ? { requestId: itemId }
            : { itemId, area: getArea(selectedItem), contentType: getContentType?.(selectedItem) }),
          decision,
          reason: decision === "reject" ? rejectReason : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit decision");
      }

      closeDialog();
      onDecisionComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return {
    selectedItem,
    decision,
    rejectReason,
    loading,
    error,
    setRejectReason,
    openReview,
    closeDialog,
    submitDecision,
  };
}
