"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postStaffCommand } from "@/lib/admin/post-staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { cn } from "@/lib/utils";
import {
  IDENTITY_CHECK_MODES,
  IDENTITY_CHECK_MODE_NAMES,
  IDENTITY_CHECK_PAUSE_TEXT,
  IDENTITY_CHECK_REASON,
  formatSastDateTime,
  formatSastTime,
  identityCheckCountsLine,
  identityCheckReasonValid,
  type IdentityCheckMode,
  type IdentityCheckSettings,
} from "@/lib/admin/identity-check-settings";

const PATH = "/admin/verification";
const ENDPOINT = "/api/admin/identity-check-settings";
const UNCONFIRMED =
  "The ID check setting could not be confirmed. Reload the page before trying again.";
/** Setting the current mode again only ends the pause; the database keeps no
 * reason for it (only changes of mode are logged). */
const RESUME_REASON = "Resume after a pause";

/**
 * "ID checks" on Verify accounts (Didit plan, section 6, pictures 09 and 10):
 * where members' ID checks go. Everyone working the queue sees it; only admins
 * can change it (the database also requires a recent authenticator code).
 */
export function IdentityCheckSettingsCard({
  settings,
  canChange,
}: {
  settings: IdentityCheckSettings;
  canChange: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [chosen, setChosen] = useState<IdentityCheckMode>(settings.mode);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const paused = settings.pausedUntil && settings.pauseReason;

  async function send(mode: IdentityCheckMode, why: string) {
    setBusy(true);
    setNotice(null);
    const answer = await postStaffCommand(ENDPOINT, { mode, reason: why }, UNCONFIRMED);
    setBusy(false);
    if (!answer.ok) {
      if (answer.verifyUrl) return router.push(staffVerifyHref(answer.verifyUrl, PATH));
      return setNotice({ error: true, message: answer.message });
    }
    setReason("");
    setNotice({
      error: false,
      message:
        answer.data.resumed && !answer.data.changed ? "Didit checks resumed." : "Setting saved.",
    });
    startTransition(() => router.refresh());
  }

  function save() {
    if (chosen === settings.mode)
      return setNotice({ error: true, message: "Choose a different setting first." });
    if (!identityCheckReasonValid(reason))
      return setNotice({
        error: true,
        message: `Write a reason of ${IDENTITY_CHECK_REASON.min} to ${IDENTITY_CHECK_REASON.max} characters.`,
      });
    void send(chosen, reason.trim());
  }

  return (
    <Card className="space-y-4 p-4 sm:p-6" aria-labelledby="id-checks-title">
      <div>
        <h2 id="id-checks-title" className="font-display text-lg font-semibold">
          ID checks
        </h2>
        <p className="text-sm text-muted-foreground">
          Where members&apos; ID checks go. Members don&apos;t choose: this setting decides for
          everyone.
        </p>
      </div>

      {paused ? (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-brand-gold-300/70 bg-brand-gold-50 p-3.5 text-sm text-brand-gold-900 dark:border-brand-gold-400/30 dark:bg-brand-gold-400/10 dark:text-brand-gold-100"
        >
          <Pause className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p>
              <strong>Paused: {IDENTITY_CHECK_PAUSE_TEXT[settings.pauseReason!].why}</strong> (until{" "}
              {formatSastTime(settings.pausedUntil!)}). Members take their photos with the in-page
              camera and staff check them, whatever the setting.{" "}
              {IDENTITY_CHECK_PAUSE_TEXT[settings.pauseReason!].next}
            </p>
            {canChange && settings.mode !== "manual" && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void send(settings.mode, RESUME_REASON)}
              >
                Resume Didit checks
              </Button>
            )}
          </div>
        </div>
      ) : (
        settings.mode !== "manual" && (
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-green-50 px-3 py-1 font-semibold text-brand-green-800 dark:bg-brand-green-500/10 dark:text-brand-gold-200">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Didit working
            </span>
            {identityCheckCountsLine(settings.last7Days)}
          </p>
        )
      )}

      <fieldset className="grid gap-3 md:grid-cols-3" disabled={!canChange || busy}>
        <legend className="sr-only">Where ID checks go</legend>
        {IDENTITY_CHECK_MODES.map((option) => {
          const selected = chosen === option.mode;
          return (
            <label
              key={option.mode}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border p-4 text-sm",
                selected
                  ? "border-brand-green-600 bg-brand-green-50/60 ring-1 ring-brand-green-600 dark:bg-brand-green-500/10"
                  : "border-border"
              )}
            >
              <input
                type="radio"
                name="identity-check-mode"
                value={option.mode}
                checked={selected}
                onChange={() => setChosen(option.mode)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-green-600"
              />
              <span className="space-y-1">
                <span className="block font-semibold text-foreground">{option.title}</span>
                {option.lines.map((line) => (
                  <span key={line} className="block text-muted-foreground">
                    {line}
                  </span>
                ))}
              </span>
            </label>
          );
        })}
      </fieldset>

      {canChange && (
        <div className="space-y-2">
          <Label htmlFor="identity-check-reason">Reason for the change</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="identity-check-reason"
              value={reason}
              maxLength={IDENTITY_CHECK_REASON.max}
              placeholder="e.g. Launch: Didit on, staff decide unclear cases"
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
            <Button variant="trust-verified" onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save setting
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <p
          role={notice.error ? "alert" : "status"}
          className={
            notice.error
              ? "inline-form-error"
              : "text-sm text-brand-green-700 dark:text-brand-gold-300"
          }
        >
          {notice.message}
        </p>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        Only admins can change this, with a 2-step check in the last 15 minutes. If Didit is paused
        or over the spending limit, members take photos with the in-page camera and staff decide.
        Every change is logged with its reason.
      </p>

      {settings.recentChanges.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Latest changes
          </h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {settings.recentChanges.map((change) => (
              <li key={change.changedAt + change.toMode}>
                {formatSastDateTime(change.changedAt)}: {IDENTITY_CHECK_MODE_NAMES[change.fromMode]}{" "}
                → {IDENTITY_CHECK_MODE_NAMES[change.toMode]} · {change.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
