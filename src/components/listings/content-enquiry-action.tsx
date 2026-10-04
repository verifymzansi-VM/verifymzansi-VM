"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
import { Loader2, CheckCircle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { contactPhone } from "@/lib/utils/contact-links";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { cn } from "@/lib/utils";
import type { ContactActionConfig } from "./contact-action-types";

/** Private enquiries go to the existing recipient inbox; nothing is published on the post. */
export function ContentEnquiryAction({
  config,
  rail = false,
  children,
  renderTrigger,
  contentClassName,
}: {
  config: ContactActionConfig;
  rail?: boolean;
  children?: ReactNode;
  /** Own trigger (Video mode's rail); receives the function that opens the form. */
  renderTrigger?: (open: () => void) => ReactNode;
  /** Extra classes for the form's dialog, e.g. docking it to the bottom on phones. */
  contentClassName?: string;
}) {
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [messageOpen, setMessageOpen] = useState(false);
  useEffect(() => {
    if (!messageOpen) return;
    let cancelled = false;
    void (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const client = createClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user || cancelled) return;
      setBuyerEmail((current) => current || user.email || "");
      const { data } = await client
        .from("account_profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data?.display_name) setBuyerName((current) => current || data.display_name);
    })().catch(() => {
      // The form remains usable when profile details cannot be loaded.
    });
    return () => {
      cancelled = true;
    };
  }, [messageOpen]);
  const [message, setMessage] = useState("");
  const [messageTurnstile, setMessageTurnstile] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [messageError, setMessageError] = useState("");

  const handleMessageTurnstile = useCallback((token: string) => {
    setMessageTurnstile(token);
  }, []);

  async function handleSendMessage() {
    setMessageError("");
    if (message.trim().length < 10) {
      setMessageError("Message must be at least 10 characters.");
      return;
    }
    if (buyerName.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      setMessageError("Enter your name and a valid reply email.");
      return;
    }
    if (buyerPhone.trim() && !contactPhone(buyerPhone)) {
      setMessageError("Enter a valid South African WhatsApp mobile number.");
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
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          buyerPhone: buyerPhone.trim() || undefined,
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
      setMessageTurnstile("");
      setCaptchaAttempt((value) => value + 1);
    }
  }

  function openEnquiry() {
    setMessageSent(false);
    setMessageError("");
    setMessageOpen(true);
  }
  return (
    <>
      {renderTrigger ? (
        renderTrigger(openEnquiry)
      ) : rail ? (
        <button
          type="button"
          onClick={openEnquiry}
          aria-label="Message account holder"
          className="viewer-rail-action group flex flex-col items-center gap-1.5 rounded-full focus-visible:outline-none"
        >
          <span className="viewer-action-circle">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="viewer-action-label" aria-hidden="true">
            Message
          </span>
        </button>
      ) : (
        <Button variant="outline" className="w-full gap-2" size="lg" onClick={openEnquiry}>
          {children ?? <MessageSquare className="h-4 w-4" />}Send an enquiry
        </Button>
      )}
      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className={cn("sm:max-w-md", contentClassName)}>
          <DialogHeader>
            <DialogTitle>{config.messageTitle}</DialogTitle>
            <DialogDescription>
              This message is private and will not appear on the profile.{" "}
              {config.messageDescription}
            </DialogDescription>
          </DialogHeader>

          {messageSent ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-10 w-10 text-brand-green" />
              <p className="font-medium">Enquiry saved!</p>
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
                <Label htmlFor="buyer-name">Your name</Label>
                <Input
                  id="buyer-name"
                  autoComplete="name"
                  maxLength={80}
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                />
                <Label htmlFor="buyer-email">Reply email</Label>
                <Input
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                />
                <Label htmlFor="buyer-phone">WhatsApp number (optional)</Label>
                <Input
                  id="buyer-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="082 123 4567"
                  maxLength={20}
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  These details are shared with the recipient so they can reply.
                </p>
              </div>
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

              <TurnstileWidget
                key={captchaAttempt}
                onSuccess={handleMessageTurnstile}
                onExpire={() => setMessageTurnstile("")}
                onError={(error) => {
                  setMessageTurnstile("");
                  setMessageError(error);
                }}
                size="compact"
              />

              {messageError && (
                <p role="alert" className="text-sm text-destructive">
                  {messageError}
                </p>
              )}

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
    </>
  );
}
