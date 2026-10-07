"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Phone, Share2, Flag, Loader2, CheckCircle, Check, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { contactPhone, whatsappLink } from "@/lib/utils/contact-links";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { ContentEnquiryAction } from "./content-enquiry-action";
import { shareContent } from "@/lib/sharing/share-content";
import { withCsrfHeaders } from "@/lib/utils/csrf";

import type { ContactActionConfig } from "./contact-action-types";

type ContentContactActionsProps = {
  phone?: string | null;
  whatsapp?: string | null;
  showPhoneButton: boolean;
  showMessageButton: boolean;
  config: ContactActionConfig;
  messageIcon: LucideIcon;
  /** Off where the page already has its own share button (the desktop viewer's rail). */
  showShare?: boolean;
  /**
   * Numbers aren't in public pages: when set, a signed-in visitor taps "Show
   * number" to fetch them (rate-limited, recorded). Says which methods exist.
   */
  revealable?: { phone: boolean; whatsapp: boolean } | null;
};

export function ContentContactActions({
  phone,
  whatsapp,
  showPhoneButton,
  showMessageButton,
  config,
  messageIcon: MessageIcon,
  showShare = true,
  revealable = null,
}: ContentContactActionsProps) {
  const [revealed, setRevealed] = useState<{
    phone: string | null;
    whatsapp: string | null;
  } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [signInHref, setSignInHref] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  if (revealed) {
    phone = revealed.phone;
    whatsapp = revealed.whatsapp;
  }
  const canReveal =
    !revealed && !phone && !whatsapp && Boolean(revealable?.phone || revealable?.whatsapp);

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    try {
      const res = await fetch("/api/contact/reveal", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ targetType: config.reportTargetType, targetId: config.targetId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        phone?: string | null;
        whatsapp?: string | null;
        code?: string;
        error?: string;
      };
      if (res.status === 401) {
        const back = `${window.location.pathname}${window.location.search}`;
        setSignInHref(`/login?returnUrl=${encodeURIComponent(back)}`);
        return;
      }
      if (!res.ok) {
        setRevealError(data.error ?? "Couldn't show the number. Try again.");
        return;
      }
      setRevealed({ phone: data.phone ?? null, whatsapp: data.whatsapp ?? null });
    } catch {
      setRevealError("Couldn't show the number. Try again.");
    } finally {
      setRevealing(false);
    }
  }

  const phoneNumber = contactPhone(phone);
  const whatsappUrl = whatsappLink(whatsapp, config.shareTitle, config.sharePath);
  // One number is shown once: on the call button when both buttons use it.
  const whatsappNumberShown = !(
    showPhoneButton &&
    phoneNumber &&
    contactPhone(whatsapp) === phoneNumber
  );
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const [reportReason, setReportReason] = useState(config.reportOptions[0]?.value ?? "other");
  const [reportDescription, setReportDescription] = useState("");
  const [reportTurnstile, setReportTurnstile] = useState("");
  const [reportCaptchaAttempt, setReportCaptchaAttempt] = useState(0);
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState("");

  const handleReportTurnstile = useCallback((token: string) => {
    setReportTurnstile(token);
  }, []);

  async function handleShare() {
    try {
      const shared = await shareContent({
        title: config.shareTitle,
        path: config.sharePath,
        targetId: config.targetId,
        targetType: config.reportTargetType,
      });
      if (shared?.method === "copy") {
        setCopied(true);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* Sharing failure does not interrupt contact actions. */
    }
  }

  async function handleReport() {
    setReportError("");
    if (reportDescription.trim().length < 10) {
      setReportError("Please describe the issue in at least 10 characters.");
      return;
    }
    if (!reportTurnstile) {
      setReportError("Please complete the CAPTCHA.");
      return;
    }

    setReportSending(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          targetType: config.reportTargetType,
          targetId: config.targetId,
          reason: reportReason,
          description: reportDescription.trim(),
          turnstileToken: reportTurnstile,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to submit report");
      }

      setReportSent(true);
      setReportDescription("");
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setReportSending(false);
      // Turnstile tokens are single-use: force a fresh challenge for any retry.
      setReportTurnstile("");
      setReportCaptchaAttempt((value) => value + 1);
    }
  }

  return (
    <>
      <div className="space-y-2">
        {canReveal && (
          <Button
            className="w-full gap-2"
            size="lg"
            onClick={reveal}
            disabled={revealing}
            aria-describedby="contact-reveal-note"
          >
            {revealing ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Phone aria-hidden="true" className="h-4 w-4" />
            )}
            Show contact number
          </Button>
        )}
        {canReveal && (
          <p id="contact-reveal-note" className="text-xs text-muted-foreground">
            Signed-in members can see numbers. This keeps sellers&apos; numbers from spammers.
          </p>
        )}
        {signInHref && (
          <p role="alert" className="text-sm">
            <a href={signInHref} className="font-medium text-brand-green underline">
              Sign in to see the number
            </a>
            . It keeps sellers&apos; numbers away from spammers.
          </p>
        )}
        {revealError && (
          <p role="alert" className="text-sm text-destructive">
            {revealError}
          </p>
        )}
        {whatsappUrl && (
          <Button className="w-full gap-2" size="lg" asChild>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer nofollow ugc">
              <MessageIcon className="h-4 w-4" />
              WhatsApp{whatsappNumberShown && whatsapp ? ` ${whatsapp}` : ""}
            </a>
          </Button>
        )}

        {showPhoneButton && phoneNumber && (
          <Button variant="outline" className="w-full gap-2" size="lg" asChild>
            <a href={`tel:${phoneNumber}`}>
              <Phone className="h-4 w-4" /> Call {phoneNumber}
            </a>
          </Button>
        )}

        {!canReveal && !whatsappUrl && !(showPhoneButton && phoneNumber) && !showMessageButton && (
          <p className="text-sm text-muted-foreground">No contact details added.</p>
        )}

        {showMessageButton ? (
          <ContentEnquiryAction config={config}>
            <MessageIcon className="h-4 w-4" />
          </ContentEnquiryAction>
        ) : null}
      </div>

      <div className={showShare ? "flex items-center justify-between" : "flex justify-end"}>
        {showShare ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 gap-1 px-3 text-sm sm:h-10 sm:text-xs"
            onClick={handleShare}
          >
            {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
            {copied ? "Link Copied!" : "Share"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-11 gap-1 px-3 text-sm text-muted-foreground sm:h-10 sm:text-xs"
          onClick={() => {
            setReportSent(false);
            setReportError("");
            setReportOpen(true);
          }}
        >
          <Flag className="h-3 w-3" />
          Report
        </Button>
      </div>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{config.reportTitle}</DialogTitle>
            <DialogDescription>
              Help keep VerifyMzansi safe. Reports are anonymous and reviewed by our moderation
              team.
            </DialogDescription>
          </DialogHeader>

          {reportSent ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-10 w-10 text-brand-green" />
              <p className="font-medium">Report submitted</p>
              <p className="text-sm text-muted-foreground">{config.reportSuccessCopy}</p>
              <DialogClose asChild>
                <Button variant="outline" size="sm" className="h-11 px-4 sm:h-10">
                  Close
                </Button>
              </DialogClose>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-reason">Reason</Label>
                <select
                  id="report-reason"
                  title="Report reason"
                  className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                >
                  {config.reportOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-description">Describe the issue</Label>
                <Textarea
                  id="report-description"
                  placeholder={config.reportPlaceholder}
                  rows={3}
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  maxLength={2000}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {reportDescription.length}/2000
                </p>
              </div>

              <TurnstileWidget
                key={reportCaptchaAttempt}
                onSuccess={handleReportTurnstile}
                onExpire={() => setReportTurnstile("")}
                onError={(error) => {
                  setReportTurnstile("");
                  setReportError(error);
                }}
                size="compact"
              />

              {reportError && (
                <p role="alert" className="text-sm text-destructive">
                  {reportError}
                </p>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" className="h-11 px-4 sm:h-10">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleReport}
                  disabled={reportSending || !reportTurnstile}
                  className="gap-2"
                >
                  {reportSending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send report
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
