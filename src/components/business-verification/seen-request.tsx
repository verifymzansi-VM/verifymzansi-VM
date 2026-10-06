"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { withCsrfHeaders } from "@/lib/utils/csrf";

/**
 * Owner books "Seen by VerifyMzansi": a live video call (anywhere) or an
 * in-person visit where we can. Three preferred times; consent to
 * screenshots is required because the verifier records what they saw.
 */
export function SeenRequest({
  businessId,
  onBooked,
}: {
  businessId: string;
  onBooked: () => void;
}) {
  const [method, setMethod] = useState<"video" | "visit">("video");
  const [address, setAddress] = useState("");
  const [slots, setSlots] = useState(["", "", ""]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = slots.map((s) => s.trim()).filter(Boolean);

  async function book() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/businesses/${businessId}/verification/seen`, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        method,
        address: method === "visit" ? address.trim() : undefined,
        slots: filled,
        consentScreenshots: consent,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(data.error ?? "We couldn't book that. Please try again.");
    }
    onBooked();
  }

  return (
    <div className="space-y-4 text-sm">
      <fieldset className="space-y-2">
        <legend className="font-medium">How should we see your business?</legend>
        {(
          [
            [
              "video",
              "Live video call",
              "A short call where you show us your premises, stock or work. Works anywhere.",
            ],
            [
              "visit",
              "In-person visit",
              "Where we can reach you. We visit the address you give us.",
            ],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            aria-label={`${label}. ${hint}`}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border p-3",
              method === value &&
                "border-brand-green-600 bg-brand-green-50 dark:bg-brand-green-500/10"
            )}
          >
            <input
              type="radio"
              name="seen-method"
              value={value}
              checked={method === value}
              onChange={() => setMethod(value)}
              className="mt-1 h-4 w-4 accent-brand-green-700"
            />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {method === "visit" && (
        <div className="space-y-1">
          <Label htmlFor="seen-address">Address to visit</Label>
          <Input
            id="seen-address"
            value={address}
            maxLength={300}
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Only our team sees this. Your profile shows the city.
          </p>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="font-medium">Three times that suit you</legend>
        {slots.map((slot, i) => (
          <div key={i} className="space-y-1">
            <Label htmlFor={`seen-slot-${i}`} className="sr-only">
              Preferred time {i + 1}
            </Label>
            <Input
              id={`seen-slot-${i}`}
              value={slot}
              maxLength={80}
              placeholder={i === 0 ? "e.g. Tuesday morning" : "Another option (optional)"}
              onChange={(e) => setSlots(slots.map((s, j) => (j === i ? e.target.value : s)))}
            />
          </div>
        ))}
      </fieldset>

      <label className="flex min-h-11 cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 accent-brand-green-700"
        />
        <span>
          I agree that the verifier may take photos or screenshots of my business for this check.
          <span className="block text-muted-foreground">
            Calls are not recorded. Photos are private and deleted 30 days after the decision.
          </span>
        </span>
      </label>

      <Button
        className="h-11"
        disabled={
          busy ||
          !consent ||
          filled.length === 0 ||
          (method === "visit" && address.trim().length < 5)
        }
        onClick={book}
      >
        {busy && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />}
        Book my check
      </Button>
      {error && (
        <p role="alert" className="text-brand-red-700 dark:text-brand-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
