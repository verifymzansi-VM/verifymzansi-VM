"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { postStaffCommand } from "@/lib/admin/post-staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import {
  LOST_DAYS,
  LOST_DAYS_REASON,
  endAfterDays,
  lostDaysReasonValid,
  lostDaysTermLabel,
  lostDaysValue,
  type LostDaysMove,
  type LostDaysTerm,
} from "@/lib/admin/lost-days";
import { formatSaLongDate } from "@/lib/utils/format";
import { ActionMessage, AdminCard } from "./commercial-action";

const PATH = "/admin/payments";
const ENDPOINT = "/api/admin/commercial";
const UNCONFIRMED = "The change could not be confirmed. Check the member's slots again.";
const INPUT = "mt-1 block w-full rounded-md border bg-background p-2";

type Message = { tone: "error" | "success"; text: string } | null;
type Preview = { email: string; items: LostDaysTerm[]; requestId: string };

const daysLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);

/**
 * "Add lost days" on Payments & refunds (database update
 * 20261125024039_add_lost_days.sql). Staff first check the member's running
 * paid slots and package, then add 1 to 30 days to all of them with a reason.
 * The database checks the staff member, the member and every bound again;
 * a retried request (same request id) adds nothing twice.
 */
export function LostDaysPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [moved, setMoved] = useState<LostDaysMove[] | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const chosenDays = lostDaysValue(days);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    const answer = await postStaffCommand(ENDPOINT, body, UNCONFIRMED);
    setBusy(false);
    if (answer.ok) return answer.data.data as Record<string, unknown>;
    if (answer.verifyUrl) router.push(staffVerifyHref(answer.verifyUrl, PATH));
    else setMessage({ tone: "error", text: answer.message });
    return null;
  };

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    setEmail("");
    setDays("");
    setReason("");
    setPreview(null);
    setMoved(null);
    setMessage(null);
  }

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const asked = email.trim();
    const data = await send({ action: "slots.lost_days_preview", accountEmail: asked });
    if (!data) return;
    setMoved(null);
    setPreview({
      email: asked,
      items: (data.items as LostDaysTerm[]) ?? [],
      requestId: crypto.randomUUID(),
    });
  }

  async function addDays(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !preview) return;
    if (chosenDays === null)
      return setMessage({
        tone: "error",
        text: `Choose ${LOST_DAYS.min} to ${LOST_DAYS.max} days.`,
      });
    if (!lostDaysReasonValid(reason))
      return setMessage({
        tone: "error",
        text: `Write a reason of ${LOST_DAYS_REASON.min} to ${LOST_DAYS_REASON.max} characters on one line.`,
      });
    const data = await send({
      action: "slots.add_lost_days",
      accountEmail: preview.email,
      days: chosenDays,
      reason: reason.trim(),
      requestId: preview.requestId,
    });
    if (!data) return;
    const items = (data.items as LostDaysMove[]) ?? [];
    setMoved(items);
    setPreview(null);
    setOpen(false);
    setEmail("");
    setDays("");
    setReason("");
    setMessage({
      tone: "success",
      text: data.repeated
        ? "These days were already added: nothing changed."
        : `Added ${daysLabel(Number(data.days))} to ${preview.email}.`,
    });
    router.refresh();
  }

  return (
    <AdminCard
      title="Add lost days"
      description="When a member lost paid days (a wrongly rejected post, a slot that didn't work, the site down more than 24 hours, or an overturned suspension). Days go on every running paid slot and package. An ended slot gets a refund instead. We don't email the member."
    >
      <ActionMessage message={message} />
      {moved ? (
        <ul className="divide-y rounded-lg border text-sm" aria-label="Slots with days added">
          {moved.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 p-3">
              <span className="font-medium">{lostDaysTermLabel(item)}</span>
              <span className="text-muted-foreground">
                {formatSaLongDate(item.endsBefore)} → {formatSaLongDate(item.endsAfter)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {!open ? (
        <Button type="button" variant="outline" className="h-11" onClick={() => reset(true)}>
          Add lost days
        </Button>
      ) : (
        <div className="space-y-3">
          <form className="space-y-3" aria-label="Check a member's slots" onSubmit={check}>
            <label className="block text-sm">
              <span className="font-medium">Member&apos;s account email</span>
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="off"
                spellCheck={false}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setPreview(null);
                }}
                disabled={busy}
                className={INPUT}
              />
            </label>
            {preview ? null : (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" className="h-11" disabled={busy}>
                  {busy ? "Checking…" : "Check slots"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={busy}
                  onClick={() => reset(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </form>
          {preview && preview.items.length === 0 ? (
            <div className="space-y-3">
              <p role="status" className="text-sm">
                This member has no running paid slot or package, so there is nothing to add days to.
                An ended slot gets a refund instead.
              </p>
              <Button type="button" variant="outline" className="h-11" onClick={() => reset(false)}>
                Close
              </Button>
            </div>
          ) : null}
          {preview && preview.items.length > 0 ? (
            <form className="space-y-3" aria-label="Add lost days" onSubmit={addDays}>
              <ul className="divide-y rounded-lg border text-sm" aria-label="Running paid slots">
                {preview.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 p-3">
                    <span className="font-medium">{lostDaysTermLabel(item)}</span>
                    <span className="text-muted-foreground">
                      Ends {formatSaLongDate(item.endsAt)}
                      {chosenDays !== null
                        ? ` → ${formatSaLongDate(endAfterDays(item.endsAt, chosenDays))}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="w-28">
                <label className="block text-sm">
                  <span className="font-medium">Days</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    required
                    min={LOST_DAYS.min}
                    max={LOST_DAYS.max}
                    value={days}
                    onChange={(event) => setDays(event.target.value)}
                    disabled={busy}
                    className={INPUT}
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="font-medium">Reason (audited)</span>
                <input
                  required
                  minLength={LOST_DAYS_REASON.min}
                  maxLength={LOST_DAYS_REASON.max}
                  autoComplete="off"
                  placeholder="Site down 3 to 5 December"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy}
                  className={INPUT}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" className="h-11" disabled={busy}>
                  {busy
                    ? "Adding…"
                    : chosenDays !== null
                      ? `Add ${daysLabel(chosenDays)}`
                      : "Add days"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={busy}
                  onClick={() => reset(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </AdminCard>
  );
}
