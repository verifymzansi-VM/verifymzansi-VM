"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, MailCheck, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { GoogleOAuthButton } from "@/components/ui/google-oauth-button";
import { AuthEmailField } from "@/components/auth/auth-email-field";
import { AuthTurnstileFeedback } from "@/components/auth/auth-turnstile-feedback";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { useToast } from "@/hooks/use-toast";
import {
  TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  getTurnstileClientState,
} from "@/lib/turnstile-client";
import { TURNSTILE_AUTH_PAGE_LOAD_TIMEOUT_MS } from "@/lib/turnstile-constants";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { useHydrated } from "@/hooks/use-hydrated";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AuthLoginPage");

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [turnstileRetryToken, setTurnstileRetryToken] = useState(0);
  const [turnstileUnavailableMessage, setTurnstileUnavailableMessage] = useState<string | null>(
    getTurnstileClientState().mode === "unavailable" ? TURNSTILE_UNAVAILABLE_MESSAGE : null
  );
  const [resendPromptVisible, setResendPromptVisible] = useState(false);
  const [emailConfirmedVisible, setEmailConfirmedVisible] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInteractive = useHydrated();
  const router = useRouter();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    getValues,
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      turnstileToken: "",
    },
  });

  const loginPageFlags = isInteractive
    ? (() => {
        const params = new URLSearchParams(window.location.search);
        return {
          justRegistered: params.get("registered") === "true",
          emailConfirmed: params.get("confirmed") === "true",
          error: params.get("error"),
          reason: params.get("reason"),
        };
      })()
    : {
        justRegistered: false,
        emailConfirmed: false,
        error: null as string | null,
        reason: null as string | null,
      };
  const justRegistered = resendPromptVisible || loginPageFlags.justRegistered;
  const emailConfirmed = emailConfirmedVisible || loginPageFlags.emailConfirmed;

  // Read query params client-side to avoid useSearchParams + Suspense,
  // ensuring the full form renders on first paint for Playwright assertions.
  useEffect(() => {
    if (!isInteractive) {
      return;
    }

    if (loginPageFlags.emailConfirmed) {
      setEmailConfirmedVisible(true);
      // Clean URL to prevent re-flash on refresh/back navigation
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (loginPageFlags.error === "auth_callback_failed") {
      toast({
        title: "Authentication failed",
        description:
          loginPageFlags.reason === "missing_code"
            ? "Your verification link appears incomplete. Please request a new email and try again."
            : "Your sign-in link has expired or is invalid. Please try again.",
        variant: "destructive",
      });
    } else if (loginPageFlags.error === "auth_unavailable") {
      toast({
        title: "Service temporarily unavailable",
        description: "Authentication is currently unavailable. Please try again shortly.",
        variant: "destructive",
      });
    }
  }, [
    isInteractive,
    loginPageFlags.emailConfirmed,
    loginPageFlags.error,
    loginPageFlags.reason,
    toast,
  ]);

  // Turnstile widget load timeout — show error if it doesn't load in 15s.
  // Skip in dev/test environments where the widget may be slow or unavailable,
  // and in dev mode (dummy keys) since the widget auto-bypasses.
  const turnstileState = getTurnstileClientState();
  const captchaUnavailable = Boolean(turnstileUnavailableMessage);
  const canRetryUnavailableCaptcha =
    turnstileState.mode === "configured" &&
    turnstileUnavailableMessage !== TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE;
  const skipTurnstileTimeout = turnstileState.mode !== "configured" || captchaUnavailable;

  const resetTurnstileChallenge = useCallback(() => {
    if (turnstileState.mode !== "configured") {
      return;
    }

    log.info("Resetting Turnstile challenge", {
      currentRetryToken: turnstileRetryToken,
    });

    setTurnstileLoaded(false);
    setTurnstileError(false);
    setTurnstileUnavailableMessage(null);
    setValue("turnstileToken", "", { shouldValidate: false });
    TurnstileWidget.retry();
    setTurnstileRetryToken((value) => value + 1);
  }, [setValue, turnstileRetryToken, turnstileState.mode]);

  useEffect(() => {
    if (skipTurnstileTimeout || turnstileLoaded) return;
    timeoutRef.current = setTimeout(() => {
      setTurnstileLoaded(false);
      setTurnstileError(true);
      setValue("turnstileToken", "", { shouldValidate: true });
    }, TURNSTILE_AUTH_PAGE_LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [setValue, skipTurnstileTimeout, turnstileLoaded, turnstileRetryToken]);

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
    setTurnstileError(false);
    setTurnstileLoaded(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Treat the widget as ready once Turnstile mounts. The token may still
    // arrive later or require user interaction, but the CAPTCHA itself is no
    // longer "failed to load" at that point.
  }, []);

  const handleTurnstileError = useCallback(() => {
    log.warn("Login Turnstile reported error callback");
    setTurnstileUnavailableMessage(null);
    setTurnstileLoaded(false);
    setTurnstileError(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileUnavailableMessage(null);
    setTurnstileLoaded(false);
    setTurnstileError(true);
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileUnavailable = useCallback(
    (message?: string) => {
      log.warn("Login Turnstile reported unavailable state");
      setTurnstileUnavailableMessage(message || TURNSTILE_UNAVAILABLE_MESSAGE);
      setTurnstileLoaded(false);
      setTurnstileError(false);
      setValue("turnstileToken", "", { shouldValidate: false });
    },
    [setValue]
  );

  const handleRetry = useCallback(() => {
    resetTurnstileChallenge();
  }, [resetTurnstileChallenge]);

  // Clean up cooldown interval on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  // Pre-bootstrap CSRF token on mount to avoid race condition where user
  // submits form before ensureCsrfTokenReady completes during handleSubmit.
  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  function startCooldown() {
    setResendCooldown(60);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleResendConfirmation() {
    if (resendCooldown > 0) return;

    const email = getValues("email");
    const turnstileToken = getValues("turnstileToken");
    if (!email) {
      toast({
        title: "Enter your email",
        description: "Please enter your email address in the field above, then try again.",
        variant: "destructive",
      });
      return;
    }
    if (!turnstileToken) {
      toast({
        title: "Complete the security check",
        description: "Please complete the CAPTCHA before resending the confirmation email.",
        variant: "destructive",
      });
      return;
    }
    setResendingEmail(true);
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

      const res = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast({
          title: "Failed to resend",
          description:
            typeof data.error === "string"
              ? data.error
              : "Something went wrong. Please try again later.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Confirmation email sent",
        description: data.message || "Check your inbox for the new confirmation link.",
        variant: "success",
      });
      startCooldown();
    } catch {
      toast({
        title: "Failed to resend",
        description: "Something went wrong. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setResendingEmail(false);
    }
  }

  async function onSubmit(data: LoginInput) {
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

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        resetTurnstileChallenge();

        if (result.code === "email_not_confirmed") {
          setResendPromptVisible(true);
        }

        toast({
          title: typeof result.error === "string" ? result.error : "Sign in failed",
          description:
            typeof result.error === "string"
              ? undefined
              : "Please check your credentials and try again.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Welcome back!", variant: "success" });
      router.refresh();
      const returnUrl = sanitizeReturnUrl(
        new URLSearchParams(window.location.search).get("returnUrl")
      );
      router.push(returnUrl);
    } catch {
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      {emailConfirmed && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Email confirmed!</p>
            <p className="text-sm text-muted-foreground">
              Your email address has been verified. You can now sign in to your account.
            </p>
          </div>
        </div>
      )}

      {justRegistered && !emailConfirmed && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4"
        >
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Check your email</p>
            <p className="text-sm text-muted-foreground">
              We&apos;ve sent a confirmation link to your email address. Please click the link to
              verify your account before signing in.
            </p>
            <button
              type="button"
              onClick={handleResendConfirmation}
              disabled={resendingEmail || resendCooldown > 0}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-green underline hover:text-brand-green/80 disabled:opacity-50 disabled:no-underline"
            >
              {resendingEmail ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend confirmation"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Sign in to your account</h1>
      </div>

      <GoogleOAuthButton mode="login" />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or continue with email</span>
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <AuthEmailField
          inputProps={register("email")}
          errorMessage={errors.email?.message}
          disabled={!isInteractive}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-brand-green underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              autoComplete="current-password"
              spellCheck={false}
              autoCapitalize="none"
              disabled={!isInteractive}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            <button
              type="button"
              className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => setShowPassword(!showPassword)}
              disabled={!isInteractive}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p id="password-error" className="inline-form-error" role="alert">
              {errors.password.message}
            </p>
          )}
        </div>

        <TurnstileWidget
          retryToken={turnstileRetryToken}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          onExpire={handleTurnstileExpire}
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
          className="w-full"
          variant="trust-verified"
          disabled={!isInteractive || isSubmitting || captchaUnavailable || turnstileError}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-brand-green underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
