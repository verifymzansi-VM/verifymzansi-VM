"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Phone, MessageSquare, Share2, Flag, Loader2, CheckCircle, Check } from "lucide-react";
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

/* ─────────────────────────────────────────────────────────── */

interface ListingContactActionsProps {
  listingId: string;
  /** Owner's phone from contact_methods if available */
  ownerPhone?: string | null;
  /** Owner's whatsapp from contact_methods if available */
  ownerWhatsapp?: string | null;
  /** @deprecated Use ownerPhone instead */
  sellerPhone?: string | null;
  /** @deprecated Use ownerWhatsapp instead */
  sellerWhatsapp?: string | null;
}

export function ListingContactActions({
  listingId,
  ownerPhone,
  ownerWhatsapp,
  sellerPhone,
  sellerWhatsapp,
}: ListingContactActionsProps) {
  const contactPhone = ownerPhone ?? sellerPhone;
  const contactWhatsapp = ownerWhatsapp ?? sellerWhatsapp;
  /* ── state ─────────────────────────────────────────────── */
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

  // Message dialog state
  const [message, setMessage] = useState("");
  const [msgTurnstile, setMsgTurnstile] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgSent, setMsgSent] = useState(false);
  const [msgError, setMsgError] = useState("");

  // Report dialog state
  const [reportReason, setReportReason] = useState("scam");
  const [reportDescription, setReportDescription] = useState("");
  const [rptTurnstile, setRptTurnstile] = useState("");
  const [rptSending, setRptSending] = useState(false);
  const [rptSent, setRptSent] = useState(false);
  const [rptError, setRptError] = useState("");

  /* ── Show Contact ──────────────────────────────────────── */
  function handleShowContact() {
    setShowContact(true);
  }

  /* ── Send Message ──────────────────────────────────────── */
  const handleMsgTurnstile = useCallback((token: string) => {
    setMsgTurnstile(token);
  }, []);

  async function handleSendMessage() {
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          message: message.trim(),
          contactMethod: "form",
          turnstileToken: msgTurnstile,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to send message");
      }

      setMsgSent(true);
      setMessage("");
    } catch (err: unknown) {
      setMsgError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setMsgSending(false);
    }
  }

  /* ── Share ──────────────────────────────────────────────── */
  async function handleShare() {
    const url = `${window.location.origin}/listing/${listingId}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Check out this listing on VerifyMzansi", url });
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

  /* ── Report ────────────────────────────────────────────── */
  const handleRptTurnstile = useCallback((token: string) => {
    setRptTurnstile(token);
  }, []);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "listing",
          targetId: listingId,
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

  /* ── render ────────────────────────────────────────────── */
  return (
    <>
      {/* ── Contact Buttons ────────────────────────────────── */}
      <div className="space-y-2">
        <Button className="w-full gap-2" size="lg" onClick={handleShowContact}>
          <Phone className="h-4 w-4" />
          {showContact && contactPhone ? contactPhone : "Show Contact"}
        </Button>

        {showContact && contactWhatsapp && (
          <Button variant="outline" className="w-full gap-2" size="lg" asChild>
            <a
              href={`https://wa.me/${contactWhatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <MessageSquare className="h-4 w-4" />
              WhatsApp
            </a>
          </Button>
        )}

        <Button
          variant="outline"
          className="w-full gap-2"
          size="lg"
          onClick={() => {
            setMsgSent(false);
            setMsgError("");
            setMessageOpen(true);
          }}
        >
          <MessageSquare className="h-4 w-4" />
          Send Message
        </Button>
      </div>

      {/* ── Action Row ─────────────────────────────────────── */}
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

      {/* ── Send Message Dialog ────────────────────────────── */}
      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send a Message</DialogTitle>
            <DialogDescription>
              Your message will be sent to the member. They will see your email if you are logged
              in.
            </DialogDescription>
          </DialogHeader>

          {msgSent ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-10 w-10 text-brand-green" />
              <p className="font-medium">Message sent!</p>
              <p className="text-sm text-muted-foreground">The member has been notified.</p>
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
                  placeholder="Hi, I'm interested in this listing..."
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
                  onClick={handleSendMessage}
                  disabled={msgSending || !msgTurnstile}
                  className="gap-2"
                >
                  {msgSending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Report Dialog ──────────────────────────────────── */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report Listing</DialogTitle>
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
                Thank you. Our team will review this listing.
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
                  <option value="fake_listing">Fake listing</option>
                  <option value="prohibited_item">Prohibited item</option>
                  <option value="harassment">Harassment</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="spam">Spam</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-description">Describe the issue</Label>
                <Textarea
                  id="report-description"
                  placeholder="Please describe what's wrong with this listing..."
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
