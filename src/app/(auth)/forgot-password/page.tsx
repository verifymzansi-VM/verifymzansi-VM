"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, KeyRound, Loader2, MailCheck } from "lucide-react";
import { useCallback, useState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { AuthEmailField } from "@/components/auth/auth-email-field";
import { AuthTurnstileFeedback } from "@/components/auth/auth-turnstile-feedback";
import { AuthIconTile, AuthPageHeader } from "@/components/auth/auth-ui";
import {
  TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  getTurnstileClientState,
} from "@/lib/turnstile-client";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { useHydrated } from "@/hooks/use-hydrated";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [turnstileRetryToken, setTurnstileRetryToken] = useState(0);
  const [turnstileUnavailableMessage, setTurnstileUnavailableMessage] = useState<string | null>(
    getTurnstileClientState().mode === "unavailable" ? TURNSTILE_UNAVAILABLE_MESSAGE : null
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  // Keep the form inert until hydrated so a pre-hydration submit cannot fall
  // back to a native GET that would put the email address in the URL.
  const isInteractive = useHydrated();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
      turnstileToken: "",
    },
  });

  // Turnstile widget load timeout
  const turnstileState = getTurnstileClientState();
  const captchaUnavailable = Boolean(turnstileUnavailableMessage);
  const canRetryUnavailableCaptcha =
    turnstileState.mode === "configured" &&
    turnstileUnavailableMessage !== TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE;
  const skipTurnstileTimeout = turnstileState.mode !== "configured" || captchaUnavailable;

  useEffect(() => {
    if (skipTurnstileTimeout || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileError(true);
      setValue("turnstileToken", "turnstile-unavailable", { shouldValidate: true });
    }, 15000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [skipTurnstileTimeout, turnstileLoaded, turnstileRetryToken, setValue]);

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setTurnstileUnavailableMessage(null);
      setTurnstileError(false);
      setTurnstileLoaded(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue]
  );

  const handleTurnstileLoad = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileLoaded(true);
    setTurnstileError(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileError(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("turnstileToken", "turnstile-unavailable", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileUnavailable = useCallback(
    (message?: string) => {
      setTurnstileUnavailableMessage(message || TURNSTILE_UNAVAILABLE_MESSAGE);
      setTurnstileLoaded(false);
      setTurnstileError(false);
      setValue("turnstileToken", "", { shouldValidate: false });
    },
    [setValue]
  );

  const handleRetry = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileError(false);
    setTurnstileLoaded(false);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setTurnstileRetryToken((value) => value + 1);
  }, [setValue]);

  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  async function onSubmit(data: ForgotPasswordInput) {
    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        toast({
          title: "Security check failed",
          description: "Please refresh the page and try again.",
          variant: "destructive",
        });
        return;
      }

      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Turnstile tokens are single-use: get a fresh one for the next attempt.
        if (turnstileState.mode === "configured") handleRetry();
        toast({
          title: "Reset request failed",
          description:
            typeof result.error === "string" ? result.error : "Unable to submit request.",
          variant: "destructive",
        });
        return;
      }

      setSentTo(data.email);
      setSent(true);
    } catch {
      toast({
        title: "Something went wrong",
        description: "We couldn't send your request. Check your connection and try again.",
        variant: "destructive",
      });
    }
  }

  function handleTryAgain() {
    // The previous Turnstile token was consumed by the first request.
    setValue("turnstileToken", "", { shouldValidate: false });
    setTurnstileLoaded(false);
    setTurnstileError(false);
    setSent(false);
  }

  if (sent) {
    return (
      <div className="space-y-6">
        <AuthPageHeader
          icon={
            <AuthIconTile>
              <MailCheck />
            </AuthIconTile>
          }
          title="Check your email"
          description={
            <>
              If <span className="break-all font-semibold text-foreground">{sentTo}</span> has an
              account, a reset link is on its way.
            </>
          }
        />

        <div className="flex flex-col gap-3">
          <Button asChild variant="trust-verified" size="lg" className="h-12 w-full text-[15px]">
            <Link href="/login">Back to sign in</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="h-12 w-full text-[15px]"
            onClick={handleTryAgain}
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthPageHeader
        icon={
          <AuthIconTile>
            <KeyRound />
          </AuthIconTile>
        }
        title="Forgot your password?"
        description="We'll email you a link to reset it."
      />

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <AuthEmailField
          inputProps={register("email")}
          errorMessage={errors.email?.message}
          disabled={!isInteractive}
        />

        <TurnstileWidget
          retryToken={turnstileRetryToken}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          onLoad={handleTurnstileLoad}
          onUnavailable={handleTurnstileUnavailable}
        />
        <AuthTurnstileFeedback
          tokenErrorMessage={errors.turnstileToken?.message}
          unavailableMessage={captchaUnavailable ? turnstileUnavailableMessage : null}
          errorMessage={turnstileError ? "Security check failed to load. Please try again." : null}
          canRetryUnavailable={canRetryUnavailableCaptcha}
          canRetryError={Boolean(turnstileError)}
          onRetry={handleRetry}
        />

        <Button
          type="submit"
          size="lg"
          className="h-12 w-full text-[15px]"
          variant="trust-verified"
          disabled={!isInteractive || isSubmitting || captchaUnavailable}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isSubmitting ? "Sending link…" : "Send reset link"}
        </Button>
      </form>

      <p className="text-center">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-brand-green-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
