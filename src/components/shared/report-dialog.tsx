"use client";

import { useState } from "react";
import { Flag, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type TargetType = "listing" | "business";

interface ReportDialogProps {
  targetId: string;
  targetType: TargetType;
  targetName?: string;
  variant?: "ghost" | "outline" | "default";
  size?: "sm" | "default" | "icon";
  className?: string;
}

const REPORT_REASONS = [
  { value: "scam", label: "Scam or fraud" },
  { value: "fake_listing", label: "Fake or misleading" },
  { value: "prohibited_item", label: "Prohibited item/service" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "impersonation", label: "Impersonation" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
] as const;

export function ReportDialog({
  targetId,
  targetType,
  targetName,
  variant = "ghost",
  size = "sm",
  className,
}: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || description.length < 10) {
      toast({
        title: "Please complete all fields",
        description: "Select a reason and provide at least 10 characters of detail.",
        variant: "destructive",
      });
      return;
    }

    if (!turnstileToken) {
      toast({
        title: "CAPTCHA required",
        description: "Please complete the CAPTCHA verification before submitting.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          description,
          turnstileToken: turnstileToken || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit report");
      }

      setSubmitted(true);
    } catch (err) {
      toast({
        title: "Report failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      // Reset on close
      setTimeout(() => {
        setReason("");
        setDescription("");
        setTurnstileToken("");
        setSubmitted(false);
      }, 200);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={`gap-1.5 text-muted-foreground hover:text-destructive ${className || ""}`}
        >
          <Flag className="h-3.5 w-3.5" />
          {size !== "icon" && "Report"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {submitted ? (
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 className="h-12 w-12 text-brand-green mx-auto" />
            <DialogTitle className="font-display text-xl">Report Submitted</DialogTitle>
            <DialogDescription>
              Thank you. Our moderation team will review this report within 24 hours.
            </DialogDescription>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report {targetName || "Content"}</DialogTitle>
              <DialogDescription>
                Help keep VerifyMzansi safe. Tell us what&apos;s wrong with this{" "}
                {targetType}.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Reason</Label>
                <div className="grid grid-cols-2 gap-2">
                  {REPORT_REASONS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setReason(r.value)}
                      className={`rounded-lg border p-2.5 text-left text-sm transition-colors ${
                        reason === r.value
                          ? "border-destructive bg-destructive/5 font-medium"
                          : "border-muted hover:border-foreground/20"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-desc">Details (min 10 characters)</Label>
                <textarea
                  id="report-desc"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the issue..."
                  maxLength={2000}
                />
              </div>

              <TurnstileWidget
                onSuccess={(token) => setTurnstileToken(token)}
                onError={() => setTurnstileToken("")}
                onExpire={() => setTurnstileToken("")}
              />

              <Button
                type="submit"
                variant="destructive"
                className="w-full gap-2"
                disabled={submitting || !reason || description.length < 10}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Flag className="h-4 w-4" />
                )}
                Submit Report
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
