"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  CheckCircle,
  XCircle,
  RotateCcw,
  Phone,
  CreditCard,
  Camera,
  MapPin,
  FileCheck,
  User,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Eye,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils/format";
import Link from "next/link";
import type { DashboardKycItem, VerificationStepCounts } from "@/lib/utils/admin-queries";

const STEP_ICONS: Record<string, React.ElementType> = {
  phone: Phone,
  id_doc: CreditCard,
  selfie: Camera,
  location: MapPin,
};

const STEP_LABELS: Record<string, string> = {
  phone: "Phone Verification",
  id_doc: "ID Document",
  selfie: "Selfie",
  location: "Location Proof",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  sa_id_card: "SA ID Card",
  sa_id_book: "SA ID Book",
  sa_passport: "Passport",
  sa_drivers_license: "Driver's Licence",
};

const LOCATION_METHOD_LABELS: Record<string, string> = {
  gps: "GPS coordinates",
  proof_of_address: "Proof of address document",
};

const REASON_CODES = [
  { value: "blurry_image", label: "Image too blurry to verify" },
  { value: "mismatch", label: "Selfie does not match ID photo" },
  { value: "expired_document", label: "ID document is expired" },
  { value: "incomplete_info", label: "Missing or unreadable fields" },
  { value: "fraudulent", label: "Suspected fraudulent document" },
  { value: "wrong_document_type", label: "Uploaded wrong document type" },
  { value: "not_sa_document", label: "Document is not South African" },
  { value: "other", label: "Other (provide note)" },
];

type StepFilter = "all" | "phone" | "id_doc" | "selfie" | "location";

function AccountStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    warned: "outline",
    suspended: "destructive",
    banned: "destructive",
  };
  return (
    <Badge variant={variants[status] || "secondary"} className="text-[10px] capitalize">
      {status}
    </Badge>
  );
}

function VerificationStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    incomplete: { label: "Incomplete", variant: "secondary" },
    pending_review: { label: "Pending Review", variant: "outline" },
    verified: { label: "Verified", variant: "default" },
  };
  const entry = map[status] || { label: status, variant: "secondary" };
  return (
    <Badge variant={entry.variant} className="text-[10px]">
      {entry.label}
    </Badge>
  );
}

interface KycDialogState {
  step: DashboardKycItem;
  decision: "approved" | "rejected" | "needs_resubmission";
}

export function DashboardKycPanel({
  initialItems,
  stepCounts,
}: {
  initialItems: DashboardKycItem[];
  stepCounts?: VerificationStepCounts;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<StepFilter>("all");
  const [dialog, setDialog] = useState<KycDialogState | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filtered = filter === "all" ? items : items.filter((i) => i.step_type === filter);

  function openDialog(step: DashboardKycItem, decision: KycDialogState["decision"]) {
    setDialog({ step, decision });
    setReasonCode("");
    setReasonNote("");
    setError("");
  }

  function closeDialog() {
    setDialog(null);
    setReasonCode("");
    setReasonNote("");
    setError("");
  }

  async function submitDecision() {
    if (!dialog) return;
    if (dialog.decision !== "approved" && !reasonCode) {
      setError("Please select a reason code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: dialog.step.id,
          decision: dialog.decision,
          reasonCode: dialog.decision !== "approved" ? reasonCode : undefined,
          reasonNote: reasonNote || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit decision");
      }

      setItems((prev) => prev.filter((i) => i.id !== dialog.step.id));
      closeDialog();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  // Build filter tabs with counts
  const tabs: { key: StepFilter; label: string; icon: React.ElementType; count: number }[] = [
    { key: "all", label: "All", icon: FileCheck, count: items.length },
    {
      key: "id_doc",
      label: "ID Doc",
      icon: CreditCard,
      count: stepCounts?.id_doc ?? items.filter((i) => i.step_type === "id_doc").length,
    },
    {
      key: "selfie",
      label: "Selfie",
      icon: Camera,
      count: stepCounts?.selfie ?? items.filter((i) => i.step_type === "selfie").length,
    },
    {
      key: "location",
      label: "Location",
      icon: MapPin,
      count: stepCounts?.location ?? items.filter((i) => i.step_type === "location").length,
    },
    {
      key: "phone",
      label: "Phone",
      icon: Phone,
      count: stepCounts?.phone ?? items.filter((i) => i.step_type === "phone").length,
    },
  ];

  return (
    <>
      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = filter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-0.5 rounded-full px-1.5 py-0 text-[10px] font-bold ${
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-background text-foreground"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <FileCheck className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">
            {items.length === 0
              ? "No pending KYC submissions."
              : `No pending ${STEP_LABELS[filter] || filter} submissions.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const StepIcon = STEP_ICONS[item.step_type] || FileCheck;
            const stepLabel = STEP_LABELS[item.step_type] || item.step_type;
            const waitTime = item.submitted_at || item.created_at;
            const waitMs = Date.now() - new Date(waitTime).getTime();
            const waitHours = waitMs / (1000 * 60 * 60);
            const isUrgent = waitHours > 24;
            const displayName = item.account_display_name ?? item.seller_display_name;
            const verificationStatus =
              item.account_verification_status ?? item.seller_verification_status;
            const accountStatus = item.account_status ?? item.seller_account_status;
            const strikeCount = item.account_strikes ?? item.seller_strikes;

            return (
              <Card
                key={item.id}
                className={`overflow-hidden ${isUrgent ? "border-amber-300 dark:border-amber-700" : ""}`}
              >
                <CardContent className="py-4">
                  <div className="flex items-start gap-4">
                    {/* Step icon */}
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center mt-0.5">
                      <StepIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Header row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">
                          {displayName || (
                            <span className="text-muted-foreground font-normal flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {item.user_id.slice(0, 8)}…
                            </span>
                          )}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {stepLabel}
                        </Badge>
                        {item.risk_level && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              item.risk_level === "critical"
                                ? "border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950"
                                : item.risk_level === "high"
                                  ? "border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950"
                                  : item.risk_level === "medium"
                                    ? "border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950"
                                    : "border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950"
                            }`}
                          >
                            {item.risk_level} risk
                            {item.risk_score !== null ? ` (${item.risk_score})` : ""}
                          </Badge>
                        )}
                        <span
                          className={`text-xs ${isUrgent ? "text-amber-600 font-medium" : "text-muted-foreground"}`}
                        >
                          {isUrgent && <AlertTriangle className="inline h-3 w-3 mr-0.5" />}
                          waiting {formatRelativeTime(waitTime)}
                        </span>
                      </div>

                      {/* ID doc details */}
                      {item.step_type === "id_doc" && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                          {item.full_name && (
                            <span>
                              <span className="text-muted-foreground">Name on doc: </span>
                              <span className="font-medium">{item.full_name}</span>
                            </span>
                          )}
                          {item.dob && (
                            <span>
                              <span className="text-muted-foreground">DOB: </span>
                              <time dateTime={item.dob} className="font-medium">
                                {new Date(item.dob).toLocaleDateString("en-ZA", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </time>
                            </span>
                          )}
                          {item.document_type && (
                            <span>
                              <span className="text-muted-foreground">Type: </span>
                              <span className="font-medium">
                                {DOC_TYPE_LABELS[item.document_type] || item.document_type}
                              </span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Location details */}
                      {item.step_type === "location" && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          {item.location_method && (
                            <span>
                              <span className="text-muted-foreground">Method: </span>
                              <span className="font-medium">
                                {LOCATION_METHOD_LABELS[item.location_method] ||
                                  item.location_method}
                              </span>
                            </span>
                          )}
                          {(item.location_province || item.location_city) && (
                            <span>
                              <span className="text-muted-foreground">Area: </span>
                              <span className="font-medium">
                                {[item.location_city, item.location_province]
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Selfie note */}
                      {item.step_type === "selfie" && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 rounded px-2 py-1">
                          Compare against the submitted ID document before approving.
                        </p>
                      )}

                      {/* Account status row */}
                      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/50">
                        <span className="text-xs text-muted-foreground">Account:</span>
                        <AccountStatusBadge status={accountStatus} />
                        <VerificationStatusBadge status={verificationStatus} />
                        {strikeCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            {strikeCount} strike{strikeCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex-shrink-0 flex flex-col gap-1 items-end">
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950 w-full justify-start"
                      >
                        <Link
                          href={`/admin/verification/evidence?stepId=${item.id}&userId=${item.user_id}`}
                        >
                          <Eye className="h-4 w-4 mr-1.5" />
                          Evidence
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950 w-full justify-start"
                        onClick={() => openDialog(item, "approved")}
                      >
                        <CheckCircle className="h-4 w-4 mr-1.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-destructive hover:bg-destructive/10 w-full justify-start"
                        onClick={() => openDialog(item, "rejected")}
                      >
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950 w-full justify-start"
                        onClick={() => openDialog(item, "needs_resubmission")}
                      >
                        <RotateCcw className="h-4 w-4 mr-1.5" />
                        Resubmit
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-2">
        <Link
          href="/admin/verification"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          View full KYC queue
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Decision Dialog */}
      <Dialog open={!!dialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.decision === "approved"
                ? "Approve Verification Step"
                : dialog?.decision === "rejected"
                  ? "Reject Verification Step"
                  : "Request Resubmission"}
            </DialogTitle>
            <DialogDescription>
              {dialog && (
                <>
                  {STEP_LABELS[dialog.step.step_type] || dialog.step.step_type} for{" "}
                  <strong>
                    {dialog.step.account_display_name ||
                      dialog.step.seller_display_name ||
                      dialog.step.user_id.slice(0, 8) + "…"}
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {dialog?.decision === "approved" ? (
            <p className="text-sm text-muted-foreground">
              This will mark the step as approved. If all 4 steps (phone, ID document, selfie,
              location) are approved, the account will be marked as verified.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">
                  Reason Code <span className="text-destructive">*</span>
                </Label>
                <select
                  title="Reason code"
                  aria-label="Reason code"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a reason…</option>
                  {REASON_CODES.map((rc) => (
                    <option key={rc.value} value={rc.value}>
                      {rc.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-sm font-medium">Additional Notes</Label>
                <Textarea
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  placeholder="Optional: add detail to help the account holder resubmit correctly…"
                  rows={3}
                  className="mt-1.5"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={submitDecision}
              disabled={loading}
              variant={dialog?.decision === "approved" ? "default" : "destructive"}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {dialog?.decision === "approved"
                ? "Confirm Approve"
                : dialog?.decision === "rejected"
                  ? "Confirm Reject"
                  : "Request Resubmission"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
