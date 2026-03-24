"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { TURNSTILE_UNAVAILABLE_MESSAGE, getTurnstileClientState } from "@/lib/turnstile-client";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [turnstileRetryToken, setTurnstileRetryToken] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(
    getTurnstileClientState().mode === "unavailable"
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

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
      setCaptchaUnavailable(false);
      setTurnstileError(false);
      setTurnstileLoaded(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue]
  );

  const handleTurnstileLoad = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileLoaded(true);
    setTurnstileError(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("turnstileToken", "turnstile-unavailable", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileUnavailable = useCallback(() => {
    setCaptchaUnavailable(true);
    setTurnstileLoaded(false);
    setTurnstileError(false);
    setValue("turnstileToken", "", { shouldValidate: false });
  }, [setValue]);

  const handleRetry = useCallback(() => {
    setCaptchaUnavailable(false);
    setTurnstileError(false);
    setTurnstileLoaded(false);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setTurnstileRetryToken((value) => value + 1);
  }, [setValue]);

  async function onSubmit(data: ForgotPasswordInput) {
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({
          title: "Reset request failed",
          description:
            typeof result.error === "string" ? result.error : "Unable to submit request.",
          variant: "destructive",
        });
        return;
      }

      setSent(true);
    } catch {
      toast({
        title: "Something went wrong",
        variant: "destructive",
      });
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand-green-50 dark:bg-brand-green-950 text-brand-green mx-auto">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold">Check your email</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          We&apos;ve sent a password reset link to your email. It may take a few minutes to arrive.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="text-sm text-brand-green hover:underline"
        >
          Didn&apos;t receive it? Try again
        </button>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/login">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" className="inline-form-error" role="alert">
              {errors.email.message}
            </p>
          )}
        </div>

        <TurnstileWidget
          retryToken={turnstileRetryToken}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          onLoad={handleTurnstileLoad}
          onUnavailable={handleTurnstileUnavailable}
        />
        {errors.turnstileToken && !turnstileError && (
          <p className="inline-form-error">{errors.turnstileToken.message}</p>
        )}
        {captchaUnavailable && <p className="inline-form-error">{TURNSTILE_UNAVAILABLE_MESSAGE}</p>}
        {turnstileError && (
          <div className="flex items-center gap-2">
            <p className="inline-form-error">Security check failed to load. Please try again.</p>
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline hover:text-brand-green/80"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          variant="trust-verified"
          disabled={isSubmitting || captchaUnavailable}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send Reset Link
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-brand-green underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
