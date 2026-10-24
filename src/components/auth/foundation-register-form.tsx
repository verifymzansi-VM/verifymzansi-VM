"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { AuthPageHeader, authInputClassName } from "./auth-ui";
import { foundationRegistrationSchema } from "@/lib/foundation/registration-input";
import { foundationCaptchaToken } from "@/lib/foundation/auth-input";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { useHydrated } from "@/hooks/use-hydrated";

/** Fresh-account registration. Verified contacts and legal identity are separate
 * account steps; no legacy phone/profile row is collected or copied here.
 */
export function FoundationRegisterForm() {
  const ready = useHydrated();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [token, setToken] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function resetChallenge() {
    setToken("");
    TurnstileWidget.retry();
    setRetry((value) => value + 1);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = foundationRegistrationSchema.safeParse({
      displayName,
      email,
      password,
      confirmPassword: confirmation,
      acceptTerms: accepted,
      turnstileToken: token,
    });
    if (!parsed.success) {
      setError(
        "Check your name, email and matching passwords (at least 12 characters), accept the terms and complete the security check."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await ensureCsrfTokenReady())) throw new Error();
      const response = await fetch("/api/foundation/auth/register", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          typeof body?.error === "string"
            ? body.error
            : "Registration is temporarily unavailable. Try again shortly."
        );
        return;
      }
      setPassword("");
      setConfirmation("");
      setSubmitted(true);
    } catch {
      setError("Registration could not be completed. Try again with a fresh security check.");
    } finally {
      resetChallenge();
      setBusy(false);
    }
  }
  if (submitted)
    return (
      <div className="space-y-5">
        <AuthPageHeader
          title="Check your inbox"
          description="If registration is available for this email, follow the confirmation link to continue."
        />
        <p className="text-sm text-muted-foreground">
          Use the browser where you created your account when opening the link.
        </p>
        <Link href="/login" className="font-semibold text-brand-blue-600">
          Go to sign in
        </Link>
      </div>
    );
  return (
    <div className="space-y-5">
      <AuthPageHeader
        title="Create your account"
        description="Start with your email. You can add and verify your contact details afterwards."
      />
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="foundation-name">Display name</Label>
          <Input
            id="foundation-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="nickname"
            maxLength={100}
            disabled={!ready || busy}
            className={authInputClassName}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="foundation-email">Email</Label>
          <Input
            id="foundation-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            disabled={!ready || busy}
            className={authInputClassName}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="foundation-password">Password</Label>
          <Input
            id="foundation-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            disabled={!ready || busy}
            className={authInputClassName}
          />
          <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="foundation-confirmation">Confirm password</Label>
          <Input
            id="foundation-confirmation"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            maxLength={128}
            disabled={!ready || busy}
            className={authInputClassName}
          />
        </div>
        <Label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            disabled={!ready || busy}
          />
          <span>
            I accept the{" "}
            <Link href="/terms" className="underline">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline">
              privacy policy
            </Link>
            .
          </span>
        </Label>
        <TurnstileWidget
          retryToken={retry}
          onSuccess={setToken}
          onExpire={resetChallenge}
          onError={() => {
            setToken("");
            setError("The security check could not be completed. Try it again.");
          }}
          onUnavailable={(message) => {
            setToken("");
            setError(message);
          }}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {error && !token ? (
          <Button type="button" variant="outline" onClick={resetChallenge} disabled={busy}>
            Retry security check
          </Button>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={!ready || busy || !foundationCaptchaToken.safeParse(token).success}
        >
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-blue-600">
          Sign in
        </Link>
      </p>
    </div>
  );
}
