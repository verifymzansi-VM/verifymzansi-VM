"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { normalizeSaPhone, sanitizeSaPhoneInput } from "@/lib/utils/phone";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { createTimeoutFetch } from "@/lib/supabase/fetch-with-timeout";
import {
  foundationPhoneSendSchema,
  foundationPhoneVerifySchema,
  foundationPhoneChallengeSchema,
} from "@/lib/foundation/phone-verification-input";

type Flow = { account: string | null; phone: string; code: string; challenge: string | null };
const emptyFlow: Flow = { account: null, phone: "", code: "", challenge: null };
function destination() {
  const next = sanitizeReturnUrl(new URLSearchParams(window.location.search).get("returnUrl"));
  return next === "/" || next.split("?", 1)[0] === "/dashboard/complete-profile"
    ? "/dashboard"
    : next;
}

/** Current-account phone proof only. Flow state is bound to its verified account
 * and cannot be displayed or restored after another account takes over. */
export function FoundationCompleteProfile() {
  const { user, foundationContext, isLoading, refresh } = useAuth();
  const router = useRouter();
  const [stored, setStored] = useState<Flow>(emptyFlow);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const flow = stored.account === user?.id ? stored : emptyFlow;
  const ready = Boolean(user && foundationContext?.account_id === user.id);
  useEffect(() => {
    if (ready && foundationContext?.phone) router.replace(destination());
  }, [ready, foundationContext?.phone, router]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready || !user) return;
    const owner = user.id;
    const verifying = Boolean(flow.challenge);
    const body = verifying
      ? { challenge_id: flow.challenge, code: flow.code }
      : { phone: normalizeSaPhone(flow.phone) };
    const valid = verifying
      ? foundationPhoneVerifySchema.safeParse(body).success
      : foundationPhoneSendSchema.safeParse(body).success;
    if (!valid) {
      setError(verifying ? "Enter the six-digit code." : "Enter a South African mobile number.");
      return;
    }
    if (!verifying && cooldown) return;
    setBusy(true);
    setError(null);
    const current = () => useAuthStore.getState().user?.id === owner;
    try {
      if (!(await ensureCsrfTokenReady()) || !current()) throw new Error();
      const response = await createTimeoutFetch(20000)(
        `/api/foundation/phone/${verifying ? "verify" : "send"}`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        }
      );
      const result: unknown = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many attempts. Try again later."
            : "Verification could not be completed. Check the details or request a new code."
        );
        return;
      }
      if (verifying) {
        if (
          !result ||
          typeof result !== "object" ||
          !("verified" in result) ||
          result.verified !== true
        )
          throw new Error();
        setStored({ ...flow, account: owner, code: "", challenge: null });
        await refresh();
      } else {
        const created = foundationPhoneChallengeSchema.parse(result);
        setStored({ ...flow, account: owner, code: "", challenge: created.challenge_id });
      }
    } catch {
      if (current())
        setError(
          "We could not confirm the request. Check your account status or try again shortly."
        );
    } finally {
      if (!verifying) setCooldown(60);
      setBusy(false);
    }
  }
  if (isLoading) return <p role="status">Loading your account…</p>;
  if (!ready)
    return (
      <div className="space-y-4">
        <p role="alert">Your account could not be loaded.</p>
        <Button onClick={() => void refresh()}>Retry</Button>
        <Link href="/login">Sign in</Link>
      </div>
    );
  if (foundationContext?.phone) return <p role="status">Phone verified. Continuing…</p>;
  return (
    <section
      aria-labelledby="foundation-phone-heading"
      className="mx-auto max-w-md space-y-6 px-4 py-8"
    >
      <h1 id="foundation-phone-heading" className="font-display text-2xl font-bold">
        Verify your mobile number
      </h1>
      <p>We will send a six-digit code to confirm that this is your number.</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="foundation-phone">South African mobile number</Label>
          <Input
            id="foundation-phone"
            type="tel"
            autoComplete="tel-national"
            placeholder="082 123 4567"
            value={flow.phone}
            disabled={busy || Boolean(flow.challenge)}
            onChange={(event) =>
              setStored({
                ...flow,
                account: user!.id,
                phone: sanitizeSaPhoneInput(event.target.value),
              })
            }
          />
        </div>
        {flow.challenge ? (
          <div className="space-y-2">
            <Label htmlFor="foundation-otp">Verification code</Label>
            <Input
              id="foundation-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={flow.code}
              disabled={busy}
              onChange={(event) =>
                setStored({
                  ...flow,
                  account: user!.id,
                  code: event.target.value.replace(/\D/g, "").slice(0, 6),
                })
              }
            />
            <p className="text-sm">The code expires after five minutes.</p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || (!flow.challenge && cooldown > 0)}>
          {busy
            ? "Please wait…"
            : flow.challenge
              ? "Verify number"
              : cooldown
                ? `Try again in ${cooldown}s`
                : "Send code"}
        </Button>
        {flow.challenge ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setStored({ ...flow, account: user!.id, code: "", challenge: null })}
          >
            Change number or request a new code
          </Button>
        ) : null}
      </form>
      <Button type="button" variant="ghost" onClick={() => void refresh()} disabled={busy}>
        Check verification status
      </Button>
    </section>
  );
}
