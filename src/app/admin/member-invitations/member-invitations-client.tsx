"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, Copy, Info, Loader2, UserPlus } from "lucide-react";
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
import { postStaffCommand } from "@/lib/admin/post-staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import {
  displayLink,
  formatInvitationDate,
  memberInvitationView,
  normaliseInvitationEmail,
  renewsWaitingInvitation,
  type MemberInvitation,
} from "@/lib/admin/member-invitations";

const PATH = "/admin/member-invitations";
const ENDPOINT = "/api/admin/member-invitations";
const send = (action: "invite" | "withdraw", email: string) =>
  postStaffCommand(
    ENDPOINT,
    { action, email },
    "The invitation could not be confirmed. Reload the page before trying again."
  );

type Notice =
  | { tone: "success"; email: string }
  | { tone: "renewed"; expiresAt: string }
  | { tone: "error"; reason: string | null; message: string };

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-lg border bg-card px-2.5 py-1.5 text-sm font-semibold text-foreground">
        {displayLink(url)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-3"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

function NoticeBox({
  notice,
  registerUrl,
  loginUrl,
}: {
  notice: Notice;
  registerUrl: string;
  loginUrl: string;
}) {
  let body: ReactNode;
  let tone: string;
  let icon: ReactNode;
  if (notice.tone === "success") {
    tone = "border-brand-green-200 bg-brand-green-50 text-brand-green-900";
    icon = <CheckCircle2 className="h-4 w-4 text-brand-green-700" />;
    body = (
      <>
        <p>
          <strong className="font-semibold">Invited {notice.email}.</strong> We don&apos;t email
          them. Send them this link and ask them to sign up with that email:
        </p>
        <CopyLink url={registerUrl} />
      </>
    );
  } else if (notice.tone === "renewed") {
    tone = "border-border bg-muted/60 text-foreground";
    icon = <Info className="h-4 w-4 text-muted-foreground" />;
    body = (
      <>
        <p>
          <strong className="font-semibold">Already invited.</strong> The invitation now lasts until{" "}
          {formatInvitationDate(notice.expiresAt)}. Send them the link again if they lost it:
        </p>
        <CopyLink url={registerUrl} />
      </>
    );
  } else {
    tone = "border-brand-red-200 bg-brand-red-50 text-brand-red-900";
    icon = <AlertCircle className="h-4 w-4 text-destructive" />;
    body =
      notice.reason === "member_invitation_account_exists" ? (
        <p>
          This email already has an account. They can sign in at{" "}
          <strong className="font-semibold">{displayLink(loginUrl)}</strong>.
        </p>
      ) : (
        <p>{notice.message}</p>
      );
  }
  return (
    <div
      id="member-invite-notice"
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border p-3 text-sm", tone)}
    >
      <span className="mt-0.5" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-2">{body}</div>
    </div>
  );
}

export function MemberInvitationsClient({
  invitations,
  registerUrl,
  loginUrl,
}: {
  invitations: MemberInvitation[];
  registerUrl: string;
  loginUrl: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());
  const verify = (url: string) => router.push(staffVerifyHref(url, PATH));

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = normaliseInvitationEmail(email);
    if (!address || inviting) return;
    setInviting(true);
    const renewing = renewsWaitingInvitation(invitations, address);
    const answer = await send("invite", address);
    setInviting(false);
    if (!answer.ok) {
      if (answer.verifyUrl) return verify(answer.verifyUrl);
      setHighlight(null);
      setNotice({ tone: "error", reason: answer.reason, message: answer.message });
      return;
    }
    const invited = typeof answer.data.email === "string" ? answer.data.email : address;
    const expiresAt = typeof answer.data.expiresAt === "string" ? answer.data.expiresAt : "";
    if (renewing) {
      setHighlight(null);
      setNotice({ tone: "renewed", expiresAt });
    } else {
      setHighlight(invited);
      setNotice({ tone: "success", email: invited });
      setEmail("");
    }
    refresh();
  }

  async function withdraw() {
    if (!confirming || withdrawing) return;
    setWithdrawing(true);
    setWithdrawError(null);
    const answer = await send("withdraw", confirming);
    setWithdrawing(false);
    if (!answer.ok) {
      if (answer.verifyUrl) return verify(answer.verifyUrl);
      setWithdrawError(answer.message);
      return;
    }
    if (highlight === confirming) setHighlight(null);
    setNotice(null);
    setConfirming(null);
    refresh();
  }

  const invalid =
    notice?.tone === "error" &&
    (notice.reason === "member_invitation_account_exists" ||
      notice.reason === "member_invitation_email_invalid");

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="space-y-4 p-4 sm:p-5">
        <div>
          <h2 id="invite-member-title" className="font-display text-base font-semibold">
            Invite a member
          </h2>
          <p className="text-sm text-muted-foreground">
            Lets one person create a normal account with this email in the next 30 days. It never
            gives staff access.
          </p>
        </div>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={invite}>
          <div className="min-w-0 flex-1 text-sm">
            <Label htmlFor="member-invite-email" className="font-medium">
              Email address
            </Label>
            <Input
              id="member-invite-email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              placeholder="name@example.co.za"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={inviting}
              aria-invalid={invalid || undefined}
              aria-describedby={notice ? "member-invite-notice" : undefined}
              className={cn(
                "mt-1.5 sm:h-11",
                invalid && "border-destructive ring-1 ring-destructive/30"
              )}
            />
          </div>
          <Button type="submit" className="h-11 w-full sm:w-auto" disabled={inviting}>
            {inviting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Invite
          </Button>
        </form>
        {notice && <NoticeBox notice={notice} registerUrl={registerUrl} loginUrl={loginUrl} />}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
          <h2 id="member-invitations-title" className="font-display text-base font-semibold">
            Invitations
          </h2>
          {invitations.length > 0 && (
            <span className="text-sm text-muted-foreground">Newest first</span>
          )}
        </div>
        {invitations.length === 0 ? (
          <div className="border-t px-4 py-10 text-center sm:px-5">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-foreground">No invitations yet</p>
            <p className="mt-1 text-sm text-muted-foreground">People you invite appear here.</p>
          </div>
        ) : (
          <ul className="divide-y border-t">
            {invitations.map((row) => {
              const view = memberInvitationView(row);
              return (
                <li
                  key={row.email}
                  className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5",
                    highlight === row.email && "bg-brand-green-50"
                  )}
                >
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="break-all text-sm font-semibold text-foreground">{row.email}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <Badge variant={view.badge}>{view.label}</Badge>
                      <span>{view.dateLine}</span>
                    </p>
                  </div>
                  {view.canWithdraw && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 shrink-0 rounded-lg px-3 sm:h-9"
                      aria-label={`Withdraw the invitation for ${row.email}`}
                      onClick={() => {
                        setWithdrawError(null);
                        setConfirming(row.email);
                      }}
                    >
                      Withdraw
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !withdrawing) setConfirming(null);
        }}
      >
        <DialogContent role="alertdialog">
          <DialogHeader>
            <DialogTitle>Withdraw this invitation?</DialogTitle>
            <DialogDescription>
              <strong className="break-all font-semibold text-foreground">{confirming}</strong> will
              no longer be able to sign up with it. You can invite them again later.
            </DialogDescription>
          </DialogHeader>
          {withdrawError && (
            <p role="alert" className="text-sm text-destructive">
              {withdrawError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={withdrawing}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 px-4"
              disabled={withdrawing}
              onClick={withdraw}
            >
              {withdrawing && <Loader2 className="h-4 w-4 animate-spin" />}
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
