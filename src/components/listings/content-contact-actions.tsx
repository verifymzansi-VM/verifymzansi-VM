"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Phone, Share2, Flag, Loader2, CheckCircle, Check, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { withCsrfHeaders } from "@/lib/utils/csrf";

type ReportOption = {
  value: string;
  label: string;
};

type ContactActionConfig = {
  targetId: string;
  sharePath: string;
  shareTitle: string;
  contactPayloadKey: "listingId" | "promotionId";
  contactErrorFallback: string;
  reportTargetType: "listing" | "promotion";
  reportTitle: string;
  reportPlaceholder: string;
  reportSuccessCopy: string;
  reportOptions: ReportOption[];
  messageTitle: string;
  messageDescription: string;
  messagePlaceholder: string;
  messageSubmitLabel: string;
  messageSuccessCopy: string;
};

type ContentContactActionsProps = {
  phone?: string | null;
  whatsapp?: string | null;
  showPhoneButton: boolean;
  showMessageButton: boolean;
  config: ContactActionConfig;
  messageIcon: LucideIcon;
};

export function ContentContactActions({
  phone,
  whatsapp,
  showPhoneButton,
  showMessageButton,
  config,
  messageIcon: MessageIcon,
}: ContentContactActionsProps) {
  const [showContact, setShowContact] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const [message, setMessage] = useState("");
  const [messageTurnstile, setMessageTurnstile] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [messageError, setMessageError] = useState("");

  const [reportReason, setReportReason] = useState(config.reportOptions[0]?.value ?? "other");
  const [reportDescription, setReportDescription] = useState("");
  const [reportTurnstile, setReportTurnstile] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState("");

  const handleMessageTurnstile = useCallback((token: string) => {
    setMessageTurnstile(token);
  }, []);

  const handleReportTurnstile = useCallback((token: string) => {
    setReportTurnstile(token);
  }, []);

  async function handleSendMessage() {
    setMessageError("");
    if (message.trim().length < 5) {
      setMessageError("Message must be at least 5 characters.");
      return;
    }
    if (!messageTurnstile) {
      setMessageError("Please complete the CAPTCHA.");
      return;
    }

    setMessageSending(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          [config.contactPayloadKey]: config.targetId,
          message: message.trim(),
          contactMethod: "form",
          turnstileToken: messageTurnstile,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || config.contactErrorFallback);
      }

      setMessageSent(true);
      setMessage("");
    } catch (err: unknown) {
      setMessageError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setMessageSending(false);
    }
  }

  async function handleShare() {
    const url = `${window.location.origin}${config.sharePath}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: config.shareTitle, url });
        return;
      } catch {
        /* user cancelled or unsupported — fall through to clipboard */
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
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
    }
  }

  return (
    <>
      <div className="space-y-2">
        {showPhoneButton && (
          <Button className="w-full gap-2" size="lg" onClick={() => setShowContact(true)}>
            <Phone className="h-4 w-4" />
            {showContact && phone ? phone : "Show Contact"}
          </Button>
        )}

        {showContact && whatsapp && (
          <Button variant="outline" className="w-full gap-2" size="lg" asChild>
            <a
              href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <MessageIcon className="h-4 w-4" />
              WhatsApp
            </a>
          </Button>
        )}

        {showMessageButton && (
          <Button
            variant="outline"
            className="w-full gap-2"
            size="lg"
            onClick={() => {
              setMessageSent(false);
              setMessageError("");
              setMessageOpen(true);
            }}
          >
            <MessageIcon className="h-4 w-4" />
            Send Message
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="h-11 gap-1 px-3 text-sm sm:h-10 sm:text-xs"
          onClick={handleShare}
        >
          {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
          {copied ? "Link Copied!" : "Share"}
        </Button>
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

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{config.messageTitle}</DialogTitle>
            <DialogDescription>{config.messageDescription}</DialogDescription>
          </DialogHeader>

          {messageSent ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-10 w-10 text-brand-green" />
              <p className="font-medium">Message sent!</p>
              <p className="text-sm text-muted-foreground">{config.messageSuccessCopy}</p>
              <DialogClose asChild>
                <Button variant="outline" size="sm" className="h-11 px-4 sm:h-10">
                  Close
                </Button>
              </DialogClose>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="contact-message">Your message</Label>
                <Textarea
                  id="contact-message"
                  placeholder={config.messagePlaceholder}
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground text-right">{message.length}/1000</p>
              </div>

              <TurnstileWidget onSuccess={handleMessageTurnstile} size="compact" />

              {messageError && <p className="text-sm text-destructive">{messageError}</p>}

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" className="h-11 px-4 sm:h-10">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  onClick={handleSendMessage}
                  disabled={messageSending || !messageTurnstile}
                  className="gap-2"
                >
                  {messageSending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {config.messageSubmitLabel}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

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

              <TurnstileWidget onSuccess={handleReportTurnstile} size="compact" />

              {reportError && <p className="text-sm text-destructive">{reportError}</p>}

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
                  Submit Report
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
