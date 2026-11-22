"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Gift, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import {
  FREE_CREDIT_DAYS,
  FREE_CREDIT_POSTS,
  FREE_CREDIT_REASON,
  formatFreeCreditDate,
  freeCreditReasonValid,
  postsLabel,
  type FreeCredit,
} from "@/lib/admin/free-credits";

const PATH = "/admin/free-credits";
const ENDPOINT = "/api/admin/free-credits";
const SELECT =
  "flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POST_CHOICES = Array.from(
  { length: FREE_CREDIT_POSTS.max - FREE_CREDIT_POSTS.min + 1 },
  (_, i) => FREE_CREDIT_POSTS.min + i
);

type Answer =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string | null; message: string; verifyUrl?: string };

async function send(body: Record<string, unknown>): Promise<Answer> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data };
    return {
      ok: false,
      reason: typeof data.reason === "string" ? data.reason : null,
      message:
        typeof data.error === "string" ? data.error : "Something went wrong. Please try again.",
      ...(data.code === "step_up_required"
        ? { verifyUrl: typeof data.redirectUrl === "string" ? data.redirectUrl : "/staff/two-step" }
        : {}),
    };
  } catch {
    return {
      ok: false,
      reason: null,
      message: "The free credit could not be confirmed. Reload the page before trying again.",
    };
  }
}

function daysValue(value: string): number | null {
  const days = Number(value);
  return Number.isInteger(days) && days >= FREE_CREDIT_DAYS.min && days <= FREE_CREDIT_DAYS.max
    ? days
    : null;
}

type Notice = { tone: "success"; message: string } | { tone: "error"; message: string };

function NoticeBox({ notice, id }: { notice: Notice; id: string }) {
  const error = notice.tone === "error";
  return (
    <div
      id={id}
      role={error ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-xl border p-3 text-sm",
        error
          ? "border-brand-red-200 bg-brand-red-50 text-brand-red-900"
          : "border-brand-green-200 bg-brand-green-50 text-brand-green-900"
      )}
    >
      <span className="mt-0.5" aria-hidden="true">
        {error ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-brand-green-700" />
        )}
      </span>
      <p className="min-w-0 flex-1">{notice.message}</p>
    </div>
  );
}

function ReasonField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="text-sm">
      <Label htmlFor={id} className="font-medium">
        Reason
      </Label>
      <Input
        id={id}
        required
        minLength={FREE_CREDIT_REASON.min}
        maxLength={FREE_CREDIT_REASON.max}
        autoComplete="off"
        placeholder="Recruited at the market day"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-1.5 sm:h-11"
      />
    </div>
  );
}

function DaysField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="text-sm">
      <Label htmlFor={id} className="font-medium">
        Days
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        required
        min={FREE_CREDIT_DAYS.min}
        max={FREE_CREDIT_DAYS.max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-1.5 sm:h-11"
      />
    </div>
  );
}

export function FreeCreditsClient({ gifts }: { gifts: FreeCredit[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [posts, setPosts] = useState(String(FREE_CREDIT_POSTS.initial));
  const [days, setDays] = useState(String(FREE_CREDIT_DAYS.initial));
  const [reason, setReason] = useState("");
  const [giving, setGiving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [extending, setExtending] = useState<FreeCredit | null>(null);
  const [extendDays, setExtendDays] = useState(String(FREE_CREDIT_DAYS.initial));
  const [extendReason, setExtendReason] = useState("");
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());
  const verify = (url: string) => router.push(staffVerifyHref(url, PATH));

  async function give(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (giving) return;
    const chosenDays = daysValue(days);
    if (chosenDays === null) return setNotice({ tone: "error", message: "Choose 1 to 30 days." });
    if (!freeCreditReasonValid(reason))
      return setNotice({
        tone: "error",
        message: "Write a reason of 5 to 200 characters on one line.",
      });
    setGiving(true);
    const answer = await send({
      action: "give",
      email: email.trim(),
      posts: Number(posts),
      days: chosenDays,
      reason: reason.trim(),
    });
    setGiving(false);
    if (!answer.ok) {
      if (answer.verifyUrl) return verify(answer.verifyUrl);
      setHighlight(null);
      return setNotice({ tone: "error", message: answer.message });
    }
    const endsAt = typeof answer.data.endsAt === "string" ? answer.data.endsAt : "";
    setHighlight(typeof answer.data.id === "string" ? answer.data.id : null);
    setNotice({
      tone: "success",
      message: `Gave ${postsLabel(Number(posts))} until ${formatFreeCreditDate(endsAt)}.`,
    });
    setEmail("");
    setReason("");
    setPosts(String(FREE_CREDIT_POSTS.initial));
    setDays(String(FREE_CREDIT_DAYS.initial));
    refresh();
  }

  function openExtend(gift: FreeCredit) {
    setExtendDays(String(FREE_CREDIT_DAYS.initial));
    setExtendReason("");
    setExtendError(null);
    setExtending(gift);
  }

  async function extend() {
    if (!extending || extendBusy) return;
    const chosenDays = daysValue(extendDays);
    if (chosenDays === null) return setExtendError("Choose 1 to 30 days.");
    if (!freeCreditReasonValid(extendReason))
      return setExtendError("Write a reason of 5 to 200 characters on one line.");
    setExtendBusy(true);
    setExtendError(null);
    const answer = await send({
      action: "extend",
      id: extending.id,
      days: chosenDays,
      reason: extendReason.trim(),
    });
    setExtendBusy(false);
    if (!answer.ok) {
      if (answer.verifyUrl) return verify(answer.verifyUrl);
      return setExtendError(answer.message);
    }
    const endsAt = typeof answer.data.endsAt === "string" ? answer.data.endsAt : "";
    setHighlight(extending.id);
    setNotice({
      tone: "success",
      message: `Extended until ${formatFreeCreditDate(endsAt)}.`,
    });
    setExtending(null);
    refresh();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="font-display text-base font-semibold">Give free credits</h2>
          <p className="text-sm text-muted-foreground">
            For an ID-verified member. Starts now; we don&apos;t email them.
          </p>
        </div>
        <form className="space-y-3" onSubmit={give}>
          <div className="text-sm">
            <Label htmlFor="free-credit-email" className="font-medium">
              Member&apos;s email
            </Label>
            <Input
              id="free-credit-email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              placeholder="name@example.co.za"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={giving}
              aria-describedby={notice ? "free-credit-notice" : undefined}
              className="mt-1.5 sm:h-11"
            />
          </div>
          <div className="flex gap-3">
            <div className="w-28 text-sm">
              <Label htmlFor="free-credit-posts" className="font-medium">
                Posts
              </Label>
              <select
                id="free-credit-posts"
                className={cn(SELECT, "mt-1.5")}
                value={posts}
                onChange={(event) => setPosts(event.target.value)}
                disabled={giving}
              >
                {POST_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <DaysField id="free-credit-days" value={days} onChange={setDays} disabled={giving} />
            </div>
          </div>
          <ReasonField
            id="free-credit-reason"
            value={reason}
            onChange={setReason}
            disabled={giving}
          />
          <div>
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={giving}>
              {giving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
              Give
            </Button>
          </div>
        </form>
        {notice && <NoticeBox notice={notice} id="free-credit-notice" />}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
          <h2 className="font-display text-base font-semibold">Gifts</h2>
          {gifts.length > 0 && <span className="text-sm text-muted-foreground">Newest first</span>}
        </div>
        {gifts.length === 0 ? (
          <div className="border-t px-4 py-10 text-center sm:px-5">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Gift className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-foreground">No free credits yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Gifts you give appear here.</p>
          </div>
        ) : (
          <ul className="divide-y border-t">
            {gifts.map((gift) => (
              <li
                key={gift.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5",
                  highlight === gift.id && "bg-brand-green-50"
                )}
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-all text-sm font-semibold text-foreground">
                    {gift.member ?? "Closed account"}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant={gift.status === "active" ? "live" : "draft"}>
                      {gift.status === "active" ? "Active" : "Ended"}
                    </Badge>
                    <span>
                      {postsLabel(gift.posts)} · {gift.status === "active" ? "until" : "ended"}{" "}
                      {formatFreeCreditDate(gift.endsAt)} · {gift.views}{" "}
                      {gift.views === 1 ? "view" : "views"}
                    </span>
                  </div>
                </div>
                {gift.member !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0 rounded-lg px-3 sm:h-9"
                    aria-label={`Extend the free credits for ${gift.member}`}
                    onClick={() => openExtend(gift)}
                  >
                    Extend
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={extending !== null}
        onOpenChange={(open) => {
          if (!open && !extendBusy) setExtending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend free credits</DialogTitle>
            <DialogDescription>
              {extending
                ? `${extending.member ?? "Closed account"} · ${postsLabel(extending.posts)}. Days are added ${
                    extending.status === "active"
                      ? `after ${formatFreeCreditDate(extending.endsAt)}`
                      : "from today"
                  }.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="w-28">
              <DaysField
                id="free-credit-extend-days"
                value={extendDays}
                onChange={setExtendDays}
                disabled={extendBusy}
              />
            </div>
            <ReasonField
              id="free-credit-extend-reason"
              value={extendReason}
              onChange={setExtendReason}
              disabled={extendBusy}
            />
          </div>
          {extendError && (
            <p role="alert" className="text-sm text-destructive">
              {extendError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={extendBusy}
              onClick={() => setExtending(null)}
            >
              Cancel
            </Button>
            <Button type="button" className="h-11 px-4" disabled={extendBusy} onClick={extend}>
              {extendBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
