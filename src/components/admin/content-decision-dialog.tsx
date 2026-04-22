import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

import type { ContentDecision } from "@/components/admin/use-content-decision";

export function ContentDecisionDialog({
  open,
  decision,
  rejectReason,
  error,
  loading,
  onOpenChange,
  onRejectReasonChange,
  onConfirm,
  title,
  description,
  confirmLabel,
}: {
  open: boolean;
  decision: ContentDecision | null;
  rejectReason: string;
  error: string;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRejectReasonChange: (value: string) => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {decision === "reject" && (
          <div>
            <Label htmlFor="reject-reason" className="text-sm font-medium">
              Rejection Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => onRejectReasonChange(e.target.value)}
              placeholder="Explain why this content is being rejected..."
              rows={3}
              className="mt-1.5"
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            variant={decision === "approve" ? "default" : "destructive"}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
