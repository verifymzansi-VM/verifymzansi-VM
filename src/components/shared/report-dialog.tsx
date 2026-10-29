"use client";

import { useState } from "react";
import { Flag, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type TargetType = "listing" | "business" | "promotion";

interface ReportDialogProps {
  targetId: string;
  targetType: TargetType;
  targetName?: string;
  variant?: "ghost" | "outline" | "default";
  size?: "sm" | "default" | "icon";
  className?: string;
  triggerLabel?: string;
  /** Extra classes for the dialog, e.g. docking it to the bottom on phones. */
  contentClassName?: string;
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
  triggerLabel = "Report",
  contentClassName,
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
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
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
          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
          {size !== "icon" ? triggerLabel : <span className="sr-only">{triggerLabel}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className={`sm:max-w-md ${contentClassName || ""}`}>
        {submitted ? (
          <div className="space-y-3 py-4 text-center">
            <div className="empty-state-icon">
              <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
            </div>
            <DialogTitle className="font-display text-xl tracking-tight">
              Thanks, report sent
            </DialogTitle>
            <DialogDescription className="mx-auto max-w-xs leading-6">
              Our moderation team will review it. If it breaks our rules, we can remove the content
              or restrict the account.
            </DialogDescription>
            <Button variant="outline" className="h-11" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-xl tracking-tight">
                Report {targetName || `this ${targetType}`}
              </DialogTitle>
              <DialogDescription className="leading-6">
                Help keep VerifyMzansi safe. Tell us what&apos;s wrong with this {targetType}.
              </DialogDescription>
            </DialogHeader>
            <form noValidate onSubmit={handleSubmit} className="space-y-5 pt-1">
              <div className="space-y-2">
                <p id="report-reason-label" className="text-sm font-medium leading-none">
                  Reason
                </p>
                <div
                  role="group"
                  aria-labelledby="report-reason-label"
                  className="grid grid-cols-2 gap-2"
                >
                  {REPORT_REASONS.map((r) => {
                    const selected = reason === r.value;
                    return (
                      <button
                        key={r.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setReason(r.value)}
                        className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                          selected
                            ? "border-brand-red-600 bg-brand-red-50 font-semibold text-brand-red-800 ring-1 ring-brand-red-600 dark:border-brand-red-400 dark:bg-brand-red-950/40 dark:text-brand-red-200 dark:ring-brand-red-400"
                            : "border-border text-foreground hover:border-foreground/25 hover:bg-muted/50"
                        }`}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-desc">Details (min 10 characters)</Label>
                <textarea
                  id="report-desc"
                  className="flex min-h-[96px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened? Include dates, amounts or chat details if you have them."
                  maxLength={2000}
                  aria-describedby="report-desc-count"
                />
                <p
                  id="report-desc-count"
                  className="text-right text-xs tabular-nums text-muted-foreground"
                >
                  {description.length < 10
                    ? `${10 - description.length} more characters needed`
                    : `${description.length}/2000`}
                </p>
              </div>

              <TurnstileWidget
                onSuccess={(token) => setTurnstileToken(token)}
                onError={() => setTurnstileToken("")}
                onExpire={() => setTurnstileToken("")}
              />

              <Button
                type="submit"
                variant="destructive"
                className="h-11 w-full"
                disabled={submitting || !reason || description.length < 10}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Flag className="h-4 w-4" aria-hidden="true" />
                )}
                Send report
              </Button>
              <p className="text-center text-xs leading-5 text-muted-foreground">
                In danger right now? Call SAPS on{" "}
                <a href="tel:10111" className="font-semibold underline underline-offset-4">
                  10111
                </a>
                .
              </p>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
