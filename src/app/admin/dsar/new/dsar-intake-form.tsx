"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";

const TYPES = [
  { value: "access", label: "Access: a copy of their data" },
  { value: "correction", label: "Correction of their data" },
  { value: "deletion", label: "Deletion of their data" },
  { value: "objection", label: "Objection to processing" },
] as const;

/** Today in the browser's time zone, as yyyy-mm-dd for a date input. */
function todayInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function DsarIntakeForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("access");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayInput);
  const [description, setDescription] = useState("");
  const [intakeNote, setIntakeNote] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Midday South African time on the received date, so the date never
      // shifts across midnight.
      const receivedAt = receivedOn === todayInput() ? undefined : `${receivedOn}T12:00:00+02:00`;
      const res = await fetch("/api/admin/dsar/intake", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          type,
          requesterEmail: email.trim(),
          requesterPhone: phone.trim() || undefined,
          description: description.trim(),
          intakeNote: intakeNote.trim(),
          receivedAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      router.push("/admin/dsar?view=open");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const valid =
    email.includes("@") && description.trim().length >= 10 && intakeNote.trim().length >= 10;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="dsar-type">Request type</Label>
        <select
          id="dsar-type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          disabled={submitting}
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dsar-email">Requester email</Label>
          <Input
            id="dsar-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dsar-phone">Requester phone (optional)</Label>
          <Input
            id="dsar-phone"
            type="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dsar-received">Date received</Label>
        <Input
          id="dsar-received"
          type="date"
          value={receivedOn}
          max={todayInput()}
          onChange={(e) => setReceivedOn(e.target.value)}
          required
          disabled={submitting}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dsar-description">What the requester asked for</Label>
        <Textarea
          id="dsar-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          minLength={10}
          maxLength={2000}
          required
          disabled={submitting}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dsar-intake-note">How it arrived and how you will check identity</Label>
        <Textarea
          id="dsar-intake-note"
          value={intakeNote}
          onChange={(e) => setIntakeNote(e.target.value)}
          rows={3}
          minLength={10}
          maxLength={1000}
          required
          disabled={submitting}
          placeholder="For example: emailed to privacy@ on 2 Sept; will ask for a certified ID copy."
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting || !valid}>
        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Record request
      </Button>
    </form>
  );
}
