"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { formatPhone, formatSaLongDate } from "@/lib/utils/format";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import type { PhoneReleases } from "@/lib/foundation/phone-releases";

type Action = "propose" | "approve" | "reject";
const DONE: Record<Action, string> = {
  propose: "proposed",
  approve: "released",
  reject: "rejected",
};

/**
 * Blocked phone numbers: one staff member asks to release a number a ban
 * blocks, a different one approves. The person's ID ban stays.
 */
export function PhoneReleasesCard({ data }: { data: PhoneReleases | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function send(action: Action, number: string, why?: string) {
    setBusy(`${action}:${number}`);
    setError(null);
    try {
      const res = await fetch("/api/admin/governance/phone-releases", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(
          why === undefined ? { action, phone: number } : { action, phone: number, reason: why }
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== DONE[action]) {
        if (body.code === "mfa_required" || body.code === "step_up_required") {
          router.push(staffVerifyHref("/staff/two-step", "/admin/governance/enforcement"));
          return;
        }
        setError(
          body.error ?? "The change could not be confirmed. Reload the page before trying again."
        );
        return;
      }
      if (action === "propose") {
        setPhone("");
        setReason("");
      }
      startTransition(() => router.refresh());
    } catch {
      setError("The change could not be confirmed. Reload the page before trying again.");
    } finally {
      setBusy(null);
    }
  }

  function propose(event: React.FormEvent) {
    event.preventDefault();
    const number = normalizeSaPhone(phone);
    if (!/^\+27[0-9]{9}$/.test(number)) {
      setError("Enter a South African number, for example 082 123 4567.");
      return;
    }
    if (reason.trim().length < 10) {
      setError("Explain why in at least 10 characters.");
      return;
    }
    void send("propose", number, reason.trim());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked phone numbers</CardTitle>
        <CardDescription>
          Free one number a ban blocks, for example when the network gave it to someone else. The
          person&apos;s ID ban stays. A different staff member approves.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          onSubmit={propose}
          className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end"
        >
          <div className="space-y-1">
            <Label htmlFor="release-phone">Phone number</Label>
            <Input
              id="release-phone"
              inputMode="tel"
              autoComplete="off"
              placeholder="082 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="release-reason">Why</Label>
            <Input
              id="release-reason"
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <Button type="submit" disabled={busy !== null} className="gap-1">
            {busy?.startsWith("propose:") && <Loader2 className="h-4 w-4 animate-spin" />}
            Ask to release
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {data === null ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Release requests could not be loaded. Refresh to try again.
          </p>
        ) : (
          <>
            <section className="space-y-2" aria-labelledby="release-waiting">
              <h3 id="release-waiting" className="text-sm font-medium">
                Waiting for approval
              </h3>
              {data.pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <ul className="space-y-2">
                  {data.pending.map((item) => (
                    <li
                      key={item.phone}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium tabular-nums">
                          {formatPhone(item.phone)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.proposed_by_me ? "You" : (item.proposed_by_name ?? "Staff")} ·{" "}
                          {formatSaLongDate(item.proposed_at)} · expires{" "}
                          {formatSaLongDate(item.expires_at)}
                        </p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
                      </div>
                      {item.conflicted ? (
                        <p className="text-xs text-muted-foreground">
                          You verified this number, so someone else must decide.
                        </p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {item.proposed_by_me ? (
                            <p className="text-xs text-muted-foreground">
                              Waiting for another staff member.
                            </p>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => void send("approve", item.phone)}
                              disabled={busy !== null}
                              className="gap-1"
                            >
                              {busy === `approve:${item.phone}` && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              )}
                              Approve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void send("reject", item.phone)}
                            disabled={busy !== null}
                            className="gap-1"
                          >
                            {busy === `reject:${item.phone}` && (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {item.proposed_by_me ? "Withdraw" : "Reject"}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2" aria-labelledby="release-done">
              <h3 id="release-done" className="text-sm font-medium">
                Released
              </h3>
              {data.released.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <ul className="space-y-2">
                  {data.released.map((item) => (
                    <li key={item.phone} className="space-y-1 rounded-lg border p-4">
                      <p className="text-sm font-medium tabular-nums">{formatPhone(item.phone)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSaLongDate(item.released_at)} · asked by{" "}
                        {item.proposed_by_name ?? "staff"}, approved by{" "}
                        {item.released_by_name ?? "staff"}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
