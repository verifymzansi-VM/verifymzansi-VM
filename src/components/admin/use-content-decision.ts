import { useState, useRef } from "react";
import type { NativeContentReview } from "@/lib/admin/native-content-review";
import { getDataBackend } from "@/lib/data-backend";
import { fetchStaffEvidence } from "@/lib/auth/staff-evidence-fetch";

import { withCsrfHeaders } from "@/lib/utils/csrf";

export type ContentDecision = "approve" | "reject";

export function useContentDecision<T extends { id: string; foundation?: NativeContentReview }>({
  getArea,
  getContentType,
  getEndpoint = () => "/api/admin/content/decide",
  getItemId = (item) => item.id,
  getExpectedUpdatedAt,
  onDecisionComplete,
  rejectReasonRequiredMessage,
}: {
  getArea: (item: T) => string;
  getContentType?: (item: T) => string | undefined;
  getEndpoint?: (item: T) => string;
  getItemId?: (item: T) => string;
  /** The version reviewed: the server refuses if the content changed since. */
  getExpectedUpdatedAt?: (item: T) => string | null | undefined;
  onDecisionComplete?: () => void;
  rejectReasonRequiredMessage: string;
}) {
  const [selectedItem, setSelectedItem] = useState<T | null>(null);
  const [decision, setDecision] = useState<ContentDecision | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const reviewVersion = useRef(0);

  function openReview(item: T, nextDecision: ContentDecision, initialRejectReason = "") {
    ++reviewVersion.current;
    setSelectedItem(item);
    setDecision(nextDecision);
    setRejectReason(initialRejectReason);
    setError("");
  }

  function closeDialog() {
    ++reviewVersion.current;
    setSelectedItem(null);
    setDecision(null);
    setRejectReason("");
    setError("");
  }

  async function submitDecision() {
    if (!selectedItem || !decision || inFlight.current) return;

    if (decision === "reject" && !rejectReason.trim()) {
      setError(rejectReasonRequiredMessage);
      return;
    }

    if (getDataBackend() === "foundation" && !selectedItem.foundation) {
      setError("Claim this item and reload the queue before deciding it.");
      return;
    }
    inFlight.current = true;
    const submittedVersion = reviewVersion.current;
    setLoading(true);
    setError("");

    try {
      const itemId = getItemId(selectedItem);
      const isContentEdit = getEndpoint(selectedItem).includes("/content-edits/");
      const res = await fetchStaffEvidence(getEndpoint(selectedItem), {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...(isContentEdit
            ? { requestId: itemId }
            : {
                itemId,
                area: getArea(selectedItem),
                contentType: getContentType?.(selectedItem),
                expectedUpdatedAt: getExpectedUpdatedAt?.(selectedItem) ?? undefined,
              }),
          decision,
          reason: decision === "reject" ? rejectReason : undefined,
          ...(getDataBackend() === "foundation" ? selectedItem.foundation : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit decision");
      }

      if (submittedVersion !== reviewVersion.current) return;
      closeDialog();
      onDecisionComplete?.();
    } catch (err) {
      if (submittedVersion === reviewVersion.current)
        setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      inFlight.current = false;
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
