"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";

const when = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
});
const day = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

export interface ExtensionOfferView {
  id: string;
  target_label: string;
  days: number;
  current_ends_at: string;
  proposed_ends_at: string;
  respond_by: string;
}

/**
 * "Trial extension offered" card (Document 08 §6.4). Accepting changes only
 * the end date: no payment and no automatic renewal. `canRespond` is false for
 * programme administrators other than the owner, who see the offer read-only.
 */
export function ExtensionOfferCard({
  offer,
  canRespond = true,
}: {
  offer: ExtensionOfferView;
  canRespond?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function respond(decision: "accept" | "decline") {
    setBusy(decision);
    setMessage(null);
    try {
      const res = await fetch(`/api/trial-extensions/${offer.id}`, {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: body.error ?? "Your answer could not be saved." });
        return;
      }
      setMessage({
        tone: "success",
        text:
          decision === "accept"
            ? `Extension accepted. Your access now ends on ${when.format(new Date(offer.proposed_ends_at))}.`
            : "Extension declined. Your access ends on the original date.",
      });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Network error. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      id="extension-offer"
      aria-labelledby={`extension-offer-${offer.id}`}
      className="scroll-mt-24 rounded-2xl border border-brand-gold-300 bg-brand-gold-50 p-4 text-sm dark:border-brand-gold-400/30 dark:bg-brand-gold-400/10 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <CalendarClock
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
        />
        <div className="min-w-0 space-y-2">
          <h2 id={`extension-offer-${offer.id}`} className="text-base font-semibold">
            Trial extension offered
          </h2>
          <p>
            VerifyMzansi has offered to extend your free access for{" "}
            <strong>{offer.target_label}</strong> by <strong>{offer.days} days</strong>.
          </p>
          <dl className="grid gap-1 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Current end</dt>
              <dd className="font-medium">{when.format(new Date(offer.current_ends_at))}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">New end if you accept</dt>
              <dd className="font-medium">{when.format(new Date(offer.proposed_ends_at))}</dd>
            </div>
          </dl>
          <p className="text-muted-foreground">
            Accepting does not create any payment or automatic renewal.
          </p>
          {canRespond ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                className="h-11 rounded-full"
                disabled={busy !== null}
                onClick={() => respond("accept")}
              >
                {busy === "accept" ? "Accepting…" : "Accept extension"}
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-full"
                disabled={busy !== null}
                onClick={() => respond("decline")}
              >
                {busy === "decline" ? "Declining…" : "Decline"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Respond by {day.format(new Date(offer.respond_by))}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiting for the programme owner to respond by {day.format(new Date(offer.respond_by))}
              .
            </p>
          )}
          {message ? (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              className={message.tone === "error" ? "text-destructive" : "text-brand-green-700"}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
