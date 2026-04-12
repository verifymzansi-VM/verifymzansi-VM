"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Phone, MessageCircle, Share2, Flag, Loader2, CheckCircle, Check } from "lucide-react";
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

interface PromotionContactActionsProps {
  promotionId: string;
  contactMethods: string[];
  advertiserPhone?: string | null;
  advertiserWhatsapp?: string | null;
}

export function PromotionContactActions({
  promotionId,
  contactMethods,
  advertiserPhone,
  advertiserWhatsapp,
}: PromotionContactActionsProps) {
  const [showContact, setShowContact] = useState(false);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  // Enquiry state
  const [message, setMessage] = useState("");
  const [msgTurnstile, setMsgTurnstile] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgSent, setMsgSent] = useState(false);
  const [msgError, setMsgError] = useState("");

  // Report state
  const [reportReason, setReportReason] = useState("scam");
  const [reportDescription, setReportDescription] = useState("");
  const [rptTurnstile, setRptTurnstile] = useState("");
  const [rptSending, setRptSending] = useState(false);
  const [rptSent, setRptSent] = useState(false);
  const [rptError, setRptError] = useState("");

  const handleMsgTurnstile = useCallback((token: string) => {
    setMsgTurnstile(token);
  }, []);

  const handleRptTurnstile = useCallback((token: string) => {
    setRptTurnstile(token);
  }, []);

  async function handleSendEnquiry() {
    setMsgError("");
    if (message.trim().length < 5) {
      setMsgError("Message must be at least 5 characters.");
      return;
    }
    if (!msgTurnstile) {
      setMsgError("Please complete the CAPTCHA.");
      return;
    }

    setMsgSending(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          promotionId,
          message: message.trim(),
          contactMethod: "form",
          turnstileToken: msgTurnstile,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to send enquiry");
      }

      setMsgSent(true);
      setMessage("");
    } catch (err: unknown) {
      setMsgError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setMsgSending(false);
    }
  }

  async function handleShare() {
    const url = `${window.location.origin}/promotion/${promotionId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Check out this promotion on VerifyMzansi", url });
        return;
      } catch {
        /* user cancelled — fall through to clipboard */
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
    setRptError("");
    if (reportDescription.trim().length < 10) {
      setRptError("Please describe the issue in at least 10 characters.");
      return;
    }
    if (!rptTurnstile) {
      setRptError("Please complete the CAPTCHA.");
      return;
    }

    setRptSending(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          targetType: "promotion",
          targetId: promotionId,
          reason: reportReason,
          description: reportDescription.trim(),
          turnstileToken: rptTurnstile,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to submit report");
      }

      setRptSent(true);
      setReportDescription("");
    } catch (err: unknown) {
      setRptError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRptSending(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        {contactMethods.includes("call") && (
          <Button className="w-full gap-2" size="lg" onClick={() => setShowContact(true)}>
            <Phone className="h-4 w-4" />
            {showContact && advertiserPhone ? advertiserPhone : "Show Contact"}
          </Button>
        )}

        {showContact && contactMethods.includes("whatsapp") && advertiserWhatsapp && (
          <Button variant="outline" className="w-full gap-2" size="lg" asChild>
            <a
              href={`https://wa.me/${advertiserWhatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
          </Button>
        )}

        {contactMethods.includes("form") && (
          <Button
            variant="outline"
            className="w-full gap-2"
            size="lg"
            onClick={() => {
              setMsgSent(false);
              setMsgError("");
              setEnquiryOpen(true);
            }}
          >
            <MessageCircle className="h-4 w-4" />
            Send Message
          </Button>
        )}
      </div>

      {/* Action Row */}
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
            setRptSent(false);
            setRptError("");
            setReportOpen(true);
          }}
        >
          <Flag className="h-3 w-3" />
          Report
        </Button>
      </div>

      {/* Message Dialog */}
      <Dialog open={enquiryOpen} onOpenChange={setEnquiryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send a Message</DialogTitle>
            <DialogDescription>
              Your message will be sent to the advertiser. They will see your email if you are
              logged in.
            </DialogDescription>
          </DialogHeader>

          {msgSent ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-10 w-10 text-brand-green" />
              <p className="font-medium">Message sent!</p>
              <p className="text-sm text-muted-foreground">The advertiser has been notified.</p>
              <DialogClose asChild>
                <Button variant="outline" size="sm" className="h-11 px-4 sm:h-10">
                  Close
                </Button>
              </DialogClose>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="enquiry-message">Your message</Label>
                <Textarea
                  id="enquiry-message"
                  placeholder="Hi, I'm interested in this promotion..."
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground text-right">{message.length}/1000</p>
              </div>

              <TurnstileWidget onSuccess={handleMsgTurnstile} size="compact" />

              {msgError && <p className="text-sm text-destructive">{msgError}</p>}

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" className="h-11 px-4 sm:h-10">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  onClick={handleSendEnquiry}
                  disabled={msgSending || !msgTurnstile}
                  className="gap-2"
                >
                  {msgSending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send message
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report Promotion</DialogTitle>
            <DialogDescription>
              Help keep VerifyMzansi safe. Reports are anonymous and reviewed by our moderation
              team.
            </DialogDescription>
          </DialogHeader>

          {rptSent ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-10 w-10 text-brand-green" />
              <p className="font-medium">Report submitted</p>
              <p className="text-sm text-muted-foreground">
                Thank you. Our team will review this promotion.
              </p>
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
                  <option value="scam">Scam or fraud</option>
                  <option value="misleading">Misleading promotion</option>
                  <option value="expired">Already expired</option>
                  <option value="harassment">Harassment</option>
                  <option value="spam">Spam</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-description">Describe the issue</Label>
                <Textarea
                  id="report-description"
                  placeholder="Please describe what's wrong with this promotion..."
                  rows={3}
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  maxLength={2000}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {reportDescription.length}/2000
                </p>
              </div>

              <TurnstileWidget onSuccess={handleRptTurnstile} size="compact" />

              {rptError && <p className="text-sm text-destructive">{rptError}</p>}

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" className="h-11 px-4 sm:h-10">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleReport}
                  disabled={rptSending || !rptTurnstile}
                  className="gap-2"
                >
                  {rptSending && <Loader2 className="h-4 w-4 animate-spin" />}
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
